/**
 * Local bridge. HTTP API + WebSocket 이벤트 허브 + agent adapter.
 *
 * 세 개의 채널이 여기서 만난다. 이들을 섞지 않는 것이 이 spike의 핵심이다.
 *
 *   A. Agent control   브라우저 -> POST /api/tasks -> codex app-server
 *   B. Event stream    codex 알림 -> 정규화 -> WS /events
 *   C. MCP tools       codex -> stdio MCP server -> POST /internal/* -> 여기
 *
 * loopback에만 bind 한다.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import {
  BRIDGE_HOST,
  BRIDGE_TOKEN_HEADER,
  type AgentEvent,
  type AgentReadiness,
  type AskUserInput,
  type DesignDoc,
  type ExportDesignRequest,
  type InterviewMessageRequest,
  type ModelOption,
  type ResumeSessionRequest,
  type ResetSessionRequest,
  type ShowResultInput,
  type StartTaskRequest,
} from "@byoa/protocol";
import { fixturePath, loadBridgeConfig, spikeRootFromModule } from "@byoa/protocol/node";

import { checkGit, cliSpawnOptions } from "./platform.js";
import { ClaudeAdapter } from "./agents/claude/adapter.js";
import { CodexAdapter } from "./agents/codex/adapter.js";
import type { AgentAdapter, TaskMode } from "./agents/types.js";
import {
  HARNESS_MARKER,
  designGaps,
  renderAppDesign,
  renderHarness,
  renderNarrative,
  suggestFirstPrompt,
  validateDesign,
} from "./design.js";
import { buildInterviewPrompt, buildSpikePrompt } from "./prompt.js";
import { BridgeState } from "./state.js";

const log = (...args: unknown[]): void => console.log("[bridge]", ...args);

const spikeRoot = spikeRootFromModule(import.meta.url);
const config = loadBridgeConfig(spikeRoot);
const state = new BridgeState();

const defaultProjectPath = fixturePath(spikeRoot);

const codex = new CodexAdapter(log);
const claude = new ClaudeAdapter(log, {
  mcpServerEntry: join(spikeRoot, "packages", "mcp-server", "dist", "index.js"),
  bridgeUrl: config.baseUrl,
  bridgeToken: config.token,
});
const adapters = new Map<string, AgentAdapter>([
  ["codex", codex],
  ["claude", claude],
]);

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- 브라우저 API ----------

app.get("/api/health", async (_req: Request, res: Response) => {
  const readiness: AgentReadiness[] = [await codex.checkReady(), await claude.checkReady()];
  // git은 agent와 같은 급의 전제 조건이다. 없으면 되돌릴 지점을 남길 수 없다 (§6).
  const git = await checkGit();
  res.json({ ok: true, agents: readiness, tools: [{ tool: "git", ...git }] });
});

app.get("/api/state", (_req: Request, res: Response) => {
  const design = state.getDesign();
  res.json({
    defaultProjectPath,
    appContext: state.getAppContext(),
    activeTaskId: state.getActiveTaskId(),
    tasks: state.listTasks(),
    design,
    // 부실한 부분은 막지 않고 알려만 준다 (§4.10).
    designGaps: design ? designGaps(design) : [],
  });
});

/**
 * agent가 쓸 수 있는 모델 목록. provider에게 직접 물어본다.
 *
 * 캐시하는 이유는 Claude 쪽 조회가 CLI 프로세스를 하나 띄우기 때문이다. agent를 바꿀 때마다
 * 다시 띄우면 UI가 눈에 띄게 느려진다.
 */
const MODEL_CACHE_MS = 5 * 60 * 1000;
const modelCache = new Map<string, { at: number; models: ModelOption[] }>();

app.get("/api/models", async (req: Request, res: Response) => {
  const agentId = String(req.query.agent ?? "");
  const adapter = adapters.get(agentId);
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${agentId}. Supported agents: ${supported}.` });
    return;
  }

  const cached = modelCache.get(agentId);
  if (cached && Date.now() - cached.at < MODEL_CACHE_MS) {
    res.json({ agent: adapter.id, models: cached.models });
    return;
  }

  try {
    const models = await adapter.listModels();
    modelCache.set(agentId, { at: Date.now(), models });
    res.json({ agent: adapter.id, models });
  } catch (error) {
    // 목록을 못 가져와도 task 자체는 provider 기본값으로 돌 수 있다. 브라우저가 그렇게 처리한다.
    res.status(502).json({ error: asMessage(error) });
  }
});

/** 브라우저가 자신의 UI 상태를 여기에 미러링해 두면 `get_app_context`가 그것을 볼 수 있다. */
app.post("/api/app-context", (req: Request, res: Response) => {
  res.json(state.patchAppContext(req.body ?? {}));
});

app.post("/api/tasks", async (req: Request, res: Response) => {
  const body = req.body as StartTaskRequest;

  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is already running. Stop it before starting another." });
    return;
  }
  if (!body?.prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const ready = await adapter.checkReady();
  if (!ready.installed || ready.authenticated === false) {
    res.status(412).json({ error: ready.message ?? "Agent is not ready." });
    return;
  }

  const interview = body.mode === "interview";
  // 새 인터뷰는 새 프로젝트다. 지난 인터뷰의 흔적을 세 곳에서 모두 지운다.
  let cleared: string[] = [];
  if (interview) {
    // 1. bridge가 들고 있던 문답과 초안.
    state.resetInterview();
    // 2. agent 쪽 히스토리. 세션을 놓아주지 않으면 "처음부터 시작한다"고 말해 놓고 지난
    //    문답을 문맥에 안고 가게 되고, 그 비용을 매 turn 다시 낸다.
    adapter.resetSession(projectPath);
    // 3. 디스크에 남은 지난 설계와 하네스 (clearGeneratedArtifacts 주석).
    try {
      cleared = await clearGeneratedArtifacts(projectPath);
      if (cleared.length > 0) log(`이전 인터뷰 산출물 제거: ${cleared.join(", ")}`);
    } catch (error) {
      // 지우지 못해도 인터뷰 자체는 진행할 수 있다. 다만 하네스가 남으면 작업 turn이
      // 지난 설계를 따르게 되므로 조용히 넘기지 않는다.
      log(`이전 인터뷰 산출물 제거 실패: ${asMessage(error)}`);
    }
  }

  const taskId = randomUUID();
  const selectedItem = body.appContext?.selectedItem ?? null;

  state.patchAppContext({ projectPath, prompt: body.prompt, selectedItem });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: body.prompt,
    selectedItem,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  // 무엇을 지웠는지 브라우저에 알린다. 사용자의 파일이 사라진 것을 조용히 넘기지 않는다.
  res.json({ taskId, ...(cleared.length > 0 ? { cleared } : {}) });

  void runTask(
    adapter,
    taskId,
    projectPath,
    interview ? buildInterviewPrompt(null) : buildSpikePrompt(body.prompt),
    interview ? "interview" : "task",
    { model: body.model || undefined, effort: body.effort || undefined },
  );
});

/**
 * 인터뷰에 말을 건다. 발화를 기록하고 **다음 turn을 자동으로 시작한다** —
 * 이것이 인터뷰 루프의 핵심이다 (docs/requirements_flow.md §4.2).
 *
 * **질문이 대기 중이 아니어도 받는다.** 초안이 나온 뒤 "이건 아닌데", "이것도 필요해"라고
 * 말하는 것이 §4.10의 3단계이고, §4.5가 말하는 "자유 채팅은 항상 열려 있다"이기도 하다.
 * 질문에 답하는 것과 그냥 말을 거는 것을 두 경로로 나누면 초안 이후가 막다른 길이 된다.
 */
app.post("/api/interview/message", async (req: Request, res: Response) => {
  const body = req.body as InterviewMessageRequest;

  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is still running." });
    return;
  }
  if (!body?.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const recorded = state.recordMessage(body.message);

  const taskId = randomUUID();
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: body.message,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  emit({ type: "app.answer", taskId, questionId: recorded.question?.id ?? "", answer: body.message });
  res.json({ taskId });

  void runTask(adapter, taskId, projectPath, buildInterviewPrompt(body.message), "interview", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/**
 * 프로젝트에 묶인 세션을 놓아준다 (브라우저의 "New Session").
 *
 * 세션 파일을 지우지 않는다 — bridge가 들고 있던 참조만 버리므로, 다음 task는 새 세션에서
 * 시작하고 이전 세션은 디스크에 남아 CLI에서 이어받을 수 있다.
 */
app.post("/api/sessions/reset", async (req: Request, res: Response) => {
  const body = req.body as ResetSessionRequest;

  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is running. Stop it before starting a new session." });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  adapter.resetSession(projectPath);
  log(`session reset: ${adapter.id} @ ${projectPath}`);
  res.json({ ok: true });
});

/**
 * 인계 (docs/requirements_flow.md §7).
 *
 * 설계 하나에서 네 가지를 렌더해 **선택된 프로젝트 디렉터리 안에만** 쓴다.
 *
 *   app_design.md     설계도 (에이전트가 읽는다)
 *   AGENTS.md         Codex용 규율
 *   CLAUDE.md         Claude Code용 규율
 *   .project-intel/   일곱 단위 원본 (이후 기능이 사용)
 *
 * **사람이 쓴 파일은 덮어쓰지 않는다.** 이미 있는 파일에 우리 표식이 없으면 건너뛰고
 * 그 사실을 돌려준다. 사용자가 직접 관리하던 CLAUDE.md를 말없이 날리는 일이 없어야 한다.
 */
app.post("/api/design/export", async (req: Request, res: Response) => {
  const design = state.getDesign();
  if (!design) {
    res.status(409).json({ error: "There is no design to export yet. Finish the interview first." });
    return;
  }

  const body = req.body as ExportDesignRequest;
  if (!adapters.has(body?.agent ?? "")) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body?.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  // 사용자가 쓰는 도구의 harness만 만든다. 안 쓰는 도구의 파일까지 깔아 두면 두 파일이
  // 어긋났을 때 어느 것이 맞는지 알 수 없게 되고, 프로젝트에 쓰레기가 남는다.
  const harnessName = adapters.get(body?.agent ?? "")?.id === "claude" ? "CLAUDE.md" : "AGENTS.md";
  const files: Array<{ name: string; content: string }> = [
    { name: "app_design.md", content: renderAppDesign(design) },
    { name: harnessName, content: renderHarness(design, harnessName) },
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  try {
    for (const file of files) {
      const target = join(projectPath, file.name);
      if (await isHandWritten(target)) {
        skipped.push(file.name);
        continue;
      }
      await writeFile(target, file.content, "utf8");
      written.push(file.name);
    }

    // 일곱 단위 원본. 이후 기능(wiki, 시각화, drift)이 여기서 읽는다.
    const intelDir = join(projectPath, DESIGN_DIR);
    await mkdir(intelDir, { recursive: true });
    await writeFile(join(intelDir, "design.json"), JSON.stringify(design, null, 2), "utf8");
    written.push(`${DESIGN_DIR}/design.json`);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
    return;
  }

  // harness가 "자주 커밋하세요"라고 지시하므로 저장소가 없으면 그 지시가 조용히 실패한다.
  // 여기서 만들어 **agent가 시작하기 전에 되돌릴 지점 하나**를 확보한다.
  // 이미 저장소면 손대지 않는다 — 사용자의 이력에 개입하지 않는다.
  const gitInitialized = await ensureGitRepo(projectPath);

  log(`design exported to ${projectPath}: ${written.join(", ")}`);
  if (skipped.length > 0) log(`  skipped (hand-written): ${skipped.join(", ")}`);
  if (gitInitialized) log("  git repository initialized with a first commit");

  res.json({
    projectPath,
    written,
    skipped,
    gitInitialized,
    firstPrompt: suggestFirstPrompt(design),
    gaps: designGaps(design),
  });
});

/** 사람용 설명 (§5). 브라우저가 초안을 보여줄 때 쓴다. */
app.get("/api/design/narrative", (_req: Request, res: Response) => {
  const design = state.getDesign();
  if (!design) {
    res.status(404).json({ error: "No design yet." });
    return;
  }
  res.json({ markdown: renderNarrative(design), gaps: designGaps(design) });
});

/**
 * 이어받을 수 있는 기존 세션 목록.
 *
 * bridge를 재시작하면 물고 있던 세션 참조가 사라지지만 **세션 자체는 디스크에 남는다.**
 * 그래서 어제 하던 인터뷰를 오늘 이어받을 수 있다 (docs/requirements_flow.md §7).
 */
app.get("/api/sessions", async (req: Request, res: Response) => {
  const adapter = adapters.get(String(req.query.agent ?? ""));
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${req.query.agent}. Supported agents: ${supported}.` });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(String(req.query.projectPath ?? ""));
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  try {
    res.json({ agent: adapter.id, projectPath, sessions: await adapter.listSessions(projectPath) });
  } catch (error) {
    res.status(502).json({ error: asMessage(error) });
  }
});

/** 기존 세션에 붙는다. 다음 turn부터 그 대화를 이어받는다. */
app.post("/api/sessions/resume", async (req: Request, res: Response) => {
  const body = req.body as ResumeSessionRequest;

  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is running. Stop it before switching sessions." });
    return;
  }
  if (!body?.sessionId?.trim()) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  try {
    await adapter.resumeSession(projectPath, body.sessionId);
  } catch (error) {
    res.status(502).json({ error: asMessage(error) });
    return;
  }

  // 이어받은 대화의 문답은 그 세션 안에 있다. bridge가 들고 있던 인터뷰 상태는 다른
  // 대화의 것이므로 지운다 — 섞이면 agent가 앞선 문답을 두 벌 보게 된다.
  state.resetInterview();
  log(`session resumed: ${adapter.id} @ ${projectPath} -> ${body.sessionId}`);
  res.json({ ok: true });
});

app.post("/api/tasks/:taskId/stop", async (req: Request, res: Response) => {
  const taskId = req.params.taskId as string;
  const task = state.getTask(taskId);
  if (!task) {
    res.status(404).json({ error: "Unknown task" });
    return;
  }
  const adapter = adapters.get(task.agent);
  try {
    await adapter?.stopTask(taskId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
  }
});

// ---------- 내부 API (MCP server 전용) ----------

function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (req.get(BRIDGE_TOKEN_HEADER) !== config.token) {
    res.status(401).json({ error: "Invalid or missing bridge token" });
    return;
  }
  next();
}

app.get("/internal/app-context", requireToken, (req: Request, res: Response) => {
  noteMcpEndpointHit("get_app_context");
  // 초안 전체는 agent가 명시적으로 요청할 때만 싣는다 (AppContext.design 주석).
  res.json(state.getAppContext(req.query.design === "full"));
});

app.post("/internal/results", requireToken, (req: Request, res: Response) => {
  const result = req.body as ShowResultInput;
  if (!result?.title || !result?.summary || !result?.status) {
    res.status(400).json({ error: "title, summary and status are required" });
    return;
  }

  const taskId = noteMcpEndpointHit("show_result");
  if (taskId) {
    state.recordResult(taskId, result);
    emit({ type: "app.result", taskId, result });
  } else {
    log("show_result arrived with no active task; ignoring for UI routing");
  }
  res.json({ taskId });
});

/** agent가 `ask_user`로 던진 질문. 등록만 하고 즉시 응답한다 — 답을 기다리지 않는다. */
app.post("/internal/questions", requireToken, (req: Request, res: Response) => {
  const input = req.body as AskUserInput;
  if (!input?.question?.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const question = state.askQuestion(input);
  const taskId = noteMcpEndpointHit("ask_user");
  if (taskId) emit({ type: "app.question", taskId, question });
  else log("ask_user arrived with no active task; question stored but not routed to the UI");

  res.json({ questionId: question.id });
});

/**
 * `save_design`으로 들어온 구조화 설계 (docs/requirements_flow.md §4.11).
 *
 * patch가 아니라 전체 문서를 받는다. 교차 참조가 깨졌으면 거절하지 않고 **경고를 되돌려
 * agent가 다음 turn에 고칠 수 있게** 한다 — 초안 단계에서 완벽을 요구하면 루프가 멈춘다.
 */
app.post("/internal/design", requireToken, (req: Request, res: Response) => {
  const design = req.body as DesignDoc;
  if (!design?.title?.trim() || !Array.isArray(design.reqs)) {
    res.status(400).json({ error: "title and the seven unit arrays are required" });
    return;
  }

  const warnings = validateDesign(design);
  state.saveDesign(design);

  const taskId = noteMcpEndpointHit("save_design");
  if (taskId) {
    state.updateTask(taskId, { design });
    emit({ type: "app.design", taskId, design });
  } else {
    log("save_design arrived with no active task; design stored but not routed to the UI");
  }

  log(
    `save_design: ${design.title} (actors ${design.actors.length}, reqs ${design.reqs.length}, ` +
      `surfaces ${design.surfaces.length}, entities ${design.entities.length}, ` +
      `flows ${design.flows.length}, rules ${design.rules.length}, decisions ${design.decisions.length})`,
  );
  for (const warning of warnings) log(`  ! ${warning}`);

  res.json({ taskId, warnings });
});

// ---------- 연결 ----------

function emit(event: AgentEvent): void {
  state.emit(event);
}

/**
 * `/internal/*`로 요청이 들어왔다는 것은 우리 MCP server 프로세스가 실제로 우리를
 * 호출했다는 뜻이다. Codex 자신의 mcpToolCall 아이템과는 별개인 두 번째 독립 증거다.
 */
function noteMcpEndpointHit(tool: string): string | null {
  const taskId = state.getActiveTaskId();
  if (!taskId) return null;
  state.recordMcpCall(taskId, tool, "bridge-endpoint");
  emit({ type: "mcp.tool.called", taskId, tool, source: "bridge-endpoint" });
  return taskId;
}

/**
 * `prompt`는 이미 감싸진 최종 프롬프트다. 어떤 래퍼를 쓸지는 호출자가 정한다.
 *
 * `mode`는 adapter에게 격리 수준을 알려준다 — 인터뷰 turn은 프로젝트 문서도 내장 도구도
 * 없이 돈다 (StartTaskInput.mode 주석).
 */
async function runTask(
  adapter: AgentAdapter,
  taskId: string,
  projectPath: string,
  prompt: string,
  mode: TaskMode,
  overrides: { model?: string; effort?: string } = {},
): Promise<void> {
  state.updateTask(taskId, { status: "running" });
  emit({ type: "task.started", taskId, agent: adapter.id, projectPath });

  try {
    const outcome = await adapter.startTask({ taskId, projectPath, prompt, mode, ...overrides }, (event) => {
      if (event.type === "mcp.tool.called") state.recordMcpCall(taskId, event.tool, event.source);
      emit(event);
    });
    state.updateTask(taskId, { status: outcome, endedAt: new Date().toISOString() });
    emit(outcome === "interrupted" ? { type: "task.interrupted", taskId } : { type: "task.completed", taskId });
  } catch (error) {
    const message = asMessage(error);
    state.updateTask(taskId, { status: "error", endedAt: new Date().toISOString(), error: message });
    emit({ type: "task.error", taskId, message });
  }
}

/** 존재하는 디렉터리가 아니면 거부하고, 심볼릭 링크는 해소한다. */
async function canonicalizeProjectPath(input: string): Promise<string> {
  if (!input?.trim()) throw new Error("projectPath is required");
  let resolved: string;
  try {
    resolved = await realpath(input.trim());
  } catch {
    throw new Error(`Project path does not exist: ${input}`);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`);
  return resolved;
}

/**
 * 프로젝트가 git 저장소가 아니면 만들고 첫 커밋을 남긴다.
 *
 * **원격은 건드리지 않는다.** 목적은 로컬 되돌리기뿐이다. 이미 저장소면 아무것도 하지
 * 않는다 — 사용자가 쌓아 둔 이력에 우리가 커밋을 끼워 넣지 않는다.
 *
 * git이 없거나 실패하면 조용히 넘어간다. 설계 파일은 이미 쓰였고, 인계 자체를 막을 만큼
 * 치명적이지는 않다. 대신 `/api/health`가 git 부재를 미리 알린다.
 */
async function ensureGitRepo(projectPath: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const opts = { cwd: projectPath, ...cliSpawnOptions };

  try {
    await run("git", ["rev-parse", "--git-dir"], opts);
    return false; // 이미 저장소다
  } catch {
    // 저장소가 아니다. 아래에서 만든다.
  }

  try {
    await run("git", ["init"], opts);
    await run("git", ["add", "-A"], opts);
    await run("git", ["commit", "-m", "Start from the design produced by the requirements interview"], opts);
    return true;
  } catch (error) {
    log(`git init skipped: ${asMessage(error)}`);
    return false;
  }
}

/**
 * 이미 있는 파일이 사람이 쓴 것인지. 우리 표식이 없으면 사람이 쓴 것으로 본다.
 * 읽을 수 없으면(= 없으면) 사람이 쓴 것이 아니므로 써도 된다.
 */
async function isHandWritten(path: string): Promise<boolean> {
  try {
    const existing = await readFile(path, "utf8");
    return !existing.includes(HARNESS_MARKER);
  } catch {
    return false;
  }
}

/** 인터뷰가 프로젝트에 내보내는 것들. `create-fixture.mjs`도 같은 목록을 지운다. */
const GENERATED_DOCS = ["app_design.md", "AGENTS.md", "CLAUDE.md"] as const;
const DESIGN_DIR = ".project-intel";

/**
 * 지난 인터뷰가 이 디렉터리에 남긴 산출물을 지운다.
 *
 * **새 인터뷰는 새 프로젝트다.** 같은 디렉터리에서 다시 시작했는데 지난 설계와 하네스가
 * 남아 있으면, 그 순간부터 두 설계가 한 폴더에 공존한다. 게다가 하네스는 agent가 turn마다
 * 자동으로 읽는 파일이라, 새로 만들려는 것과 다른 앱의 지시가 계속 끼어든다.
 *
 * **우리가 만든 것만 지운다.** `HARNESS_MARKER`가 없으면 사용자가 직접 쓴 파일이므로
 * 손대지 않는다 — 내보낼 때 덮어쓰지 않는 것과 같은 기준이다.
 */
async function clearGeneratedArtifacts(projectPath: string): Promise<string[]> {
  const removed: string[] = [];

  for (const name of GENERATED_DOCS) {
    const path = join(projectPath, name);
    try {
      await stat(path);
    } catch {
      continue; // 없다
    }
    if (await isHandWritten(path)) continue; // 사용자가 쓴 파일이다
    await rm(path, { force: true });
    removed.push(name);
  }

  // 설계 원본. 이건 우리만 만드는 디렉터리라 마커가 필요 없다.
  const intel = join(projectPath, DESIGN_DIR);
  try {
    await stat(intel);
    await rm(intel, { recursive: true, force: true });
    removed.push(`${DESIGN_DIR}/`);
  } catch {
    // 없다
  }

  return removed;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------- 서버 ----------

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/events" });

wss.on("connection", (socket) => {
  const unsubscribe = state.subscribe((envelope) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(envelope));
  });
  socket.on("close", unsubscribe);
  socket.on("error", unsubscribe);
});

server.listen(config.port, BRIDGE_HOST, () => {
  log(`listening on http://${BRIDGE_HOST}:${config.port}`);
  log(`events:   ws://${BRIDGE_HOST}:${config.port}/events`);
  log(`config:   ${config.configPath}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, shutting down`);
  for (const socket of wss.clients) socket.terminate();
  await Promise.all([...adapters.values()].map((adapter) => adapter.dispose()));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
