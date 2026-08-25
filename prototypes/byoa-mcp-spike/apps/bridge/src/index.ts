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
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import {
  BRIDGE_HOST,
  BRIDGE_TOKEN_HEADER,
  type AgentEvent,
  type AgentReadiness,
  type ArchitectureDebtReport,
  type AskUserInput,
  type DesignDoc,
  type ExportDesignRequest,
  type InterviewMessageRequest,
  type ModelOption,
  type ReportDriftInput,
  type ResumeSessionRequest,
  type ResetSessionRequest,
  type ReviewCommit,
  type ReviewCriterion,
  type ReviewLog,
  type ReviewStart,
  type ShowResultInput,
  type StartReviewRequest,
  type StartArchitectureRequest,
  type StartTaskRequest,
  type StartWikiKeywordsRequest,
  type StartWikiRequest,
  type WikiKeyword,
  type WikiPage,
  type WikiPageInput,
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
import {
  collectArchitectureContext,
  renderArchitectureMarkdown,
  renderArchitectureResolutionPrompt,
} from "./architecture.js";
import {
  buildArchitecturePrompt,
  buildInterviewPrompt,
  buildReviewPrompt,
  buildSpikePrompt,
  buildWikiKeywordsPrompt,
  buildWikiPrompt,
  renderResolutionPrompt,
} from "./prompt.js";
import { condenseTranscript, countOccurrences, findAdvice, findMentions, renderWikiMarkdown } from "./wiki.js";
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
 * 드리프트 리뷰 (docs/vibe_coding_assistant_design.md §3.3).
 *
 * **PR 리뷰와 같은 모양이되 기준이 다르다.** 범용 베스트프랙티스가 아니라 이 프로젝트가
 * 인터뷰에서 정한 DEC/RULE 하나만 본다. 그래서 diff를 우리가 만들어 넘긴다 —
 * agent에게 git을 실행시키지 않으므로 리뷰 turn에는 셸도 쓰기 권한도 필요 없다.
 */
app.post("/api/review", async (req: Request, res: Response) => {
  const body = req.body as StartReviewRequest;

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

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  // 디스크를 먼저 본다. 메모리의 초안은 **다른 프로젝트의 것일 수 있다** — bridge는 오래
  // 살아 있고 state.design에는 프로젝트 구분이 없다. 같은 프로젝트일 때만 대체재로 쓴다.
  const inMemory = state.getAppContext().projectPath === projectPath ? state.getDesign() : null;
  const design = (await loadDesignFromDisk(projectPath)) ?? inMemory;
  if (!design) {
    res.status(400).json({ error: `No design found. Expected ${DESIGN_DIR}/design.json in ${projectPath}.` });
    return;
  }

  const criteria = criteriaFrom(design);
  if (criteria.length === 0) {
    // 기준이 없는 리뷰는 범용 코드 리뷰가 된다. 그건 우리가 하는 일이 아니다.
    res.status(400).json({ error: "The design has no DEC or RULE to check against." });
    return;
  }

  let start: ReviewStart;
  let commits: ReviewCommit[];
  let skipped: number;
  try {
    const resolved = await resolveReviewStart(projectPath, body.since);
    start = resolved.start;
    ({ commits, skipped } = await collectCommits(projectPath, resolved.since));
  } catch (error) {
    res.status(400).json({ error: `git log failed: ${asMessage(error)}` });
    return;
  }

  if (commits.length === 0) {
    // 볼 것이 없는 것과 리뷰가 실패한 것은 다르다. 200으로 "새 커밋이 없다"를 알린다.
    res.json({ taskId: null, commits: [], start, skipped: 0, criteriaCount: criteria.length });
    return;
  }

  state.startReview({ commits, criteria, skipped });

  const taskId = randomUUID();
  const label = `review ${commits.length}개 커밋`;
  state.patchAppContext({ projectPath, prompt: label, selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: label,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({
    taskId,
    commits: commits.map((c) => ({ sha: c.sha, subject: c.subject })),
    start,
    skipped,
    criteriaCount: criteria.length,
  });

  void runTask(adapter, taskId, projectPath, buildReviewPrompt(), "review", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/**
 * 기존 코드베이스 전체의 아키텍처·기술부채를 읽기 전용으로 분석한다.
 *
 * Wiki·Drift와 결과 상태를 공유하지 않는다. 이 기능을 다시 실행해도 architecture 결과만
 * 교체되며, 다른 기능의 산출물은 그대로 남는다.
 */
app.post("/api/architecture", async (req: Request, res: Response) => {
  const body = req.body as StartArchitectureRequest;

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

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const inMemory = state.getAppContext().projectPath === projectPath ? state.getDesign() : null;
  const design = (await loadDesignFromDisk(projectPath)) ?? inMemory;
  let context;
  try {
    context = await collectArchitectureContext(projectPath, design);
  } catch (error) {
    res.status(400).json({ error: `구조 점검 입력을 만들지 못했습니다: ${asMessage(error)}` });
    return;
  }

  state.startArchitecture(context);
  // 구조 점검 한 번이 독립된 sitting 하나다. 다른 mode의 세션 참조는 건드리지 않는다.
  adapter.resetSession(projectPath, "architecture");

  const taskId = randomUUID();
  const label = "architecture and technical debt";
  state.patchAppContext({ projectPath, prompt: label, selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: label,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId });

  void runTask(adapter, taskId, projectPath, buildArchitecturePrompt(), "architecture", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/**
 * 위키 후보 키워드 (§3.5).
 *
 * **agent가 고른다.** 빈도로 뽑아 봤더니 `wait` · `getting` · `turn`이 상위를 차지했다 —
 * 빈도는 낯섦과 반대 방향이라 당연한 결과다 (SPIKE_FINDINGS.md §16). "모를 만한 말"은
 * 판단이므로 turn을 하나 쓴다. 위키 패널을 열 때 한 번이고, 키워드마다가 아니다.
 */
app.post("/api/wiki/keywords", async (req: Request, res: Response) => {
  const body = req.body as StartWikiKeywordsRequest;

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

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  let messages;
  try {
    messages = await adapter.readTranscript(projectPath);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
    return;
  }

  const existing = await listWikiTerms(projectPath);
  const transcript = condenseTranscript(messages);
  if (transcript.messages.length === 0) {
    // 대화가 없으면 뽑을 것도 없다. turn을 낭비하지 않는다.
    res.json({ taskId: null, messages: 0, existing });
    return;
  }

  state.startWikiKeywords(transcript, messages);

  const taskId = randomUUID();
  state.patchAppContext({ projectPath, prompt: "wiki keywords", selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: "wiki keywords",
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId, messages: transcript.messages.length, existing });

  void runTask(adapter, taskId, projectPath, buildWikiKeywordsPrompt(), "wiki", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/**
 * 키워드 하나를 골랐을 때 페이지를 만든다.
 *
 * 위키 turn은 **읽되 쓰지 않는다.** 어느 파일을 봐야 할지 우리가 미리 알 수 없어서 리뷰처럼
 * 먹여 줄 수 없고, 그래서 읽기 도구만 열어 준다 (`needsReadTools`).
 */
app.post("/api/wiki", async (req: Request, res: Response) => {
  const body = req.body as StartWikiRequest;

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
  if (!body?.term?.trim()) {
    res.status(400).json({ error: "term is required" });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const term = body.term.trim();
  const messages = await adapter.readTranscript(projectPath);
  state.startWiki({ term, mentions: findMentions(messages, term), design: await loadDesignFromDisk(projectPath) });

  const taskId = randomUUID();
  state.patchAppContext({ projectPath, prompt: `wiki ${term}`, selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: `wiki ${term}`,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId, term });

  void runTask(adapter, taskId, projectPath, buildWikiPrompt(term), "wiki", {
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

/**
 * 리뷰 turn이 보는 전부 — diff와 기준. 우리가 만들어 넘기므로 agent는 git을 돌리지 않는다.
 */
app.get("/internal/review-context", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_review_context");
  const context = state.getReviewContext();
  if (!context) {
    res.status(409).json({ error: "No review is in progress." });
    return;
  }
  res.json(context);
});

/**
 * 리뷰 turn의 결론.
 *
 * **findings가 비어 있어도 정상 응답이다.** 그것이 오탐 시험의 통과 조건이다 —
 * "확인했고 어긋난 것이 없다"와 "아예 확인하지 않았다"를 구분할 수 있어야 한다.
 * 그래서 기준에 없는 id를 짚었을 때도 거절하지 않고 경고만 되돌린다. 무엇을 지어냈는지가
 * 결과에 남아야 판정할 수 있기 때문이다.
 */
app.post("/internal/drift", requireToken, (req: Request, res: Response) => {
  const report = req.body as ReportDriftInput;
  if (!Array.isArray(report?.findings) || typeof report?.summary !== "string") {
    res.status(400).json({ error: "findings (array) and summary (string) are required" });
    return;
  }

  const context = state.getReviewContext();
  const knownCommits = new Set((context?.commits ?? []).map((c) => c.sha));
  const warnings: string[] = [];
  // 해소 프롬프트는 여기서 채운다 — agent는 criterionId만 짚고, 그것을 고칠 문장은 우리가
  // criterion 원문으로 렌더한다 (LLM 없음, docs/vibe_coding_assistant_design.md §3.3).
  const findings = report.findings.map((finding) => {
    const criterion = context?.criteria.find((c) => c.id === finding.criterionId);
    if (!criterion) warnings.push(`Unknown criterion id: ${finding.criterionId}`);
    if (!knownCommits.has(finding.commit)) warnings.push(`Unknown commit: ${finding.commit}`);
    return criterion ? { ...finding, resolutionPrompt: renderResolutionPrompt(finding, criterion) } : finding;
  });
  const enrichedReport: ReportDriftInput = { ...report, findings };

  state.recordDrift(enrichedReport);
  const taskId = noteMcpEndpointHit("report_drift");
  if (taskId) emit({ type: "app.drift", taskId, report: enrichedReport });
  else log("report_drift arrived with no active task; stored but not routed to the UI");

  log(`report_drift: ${findings.length}건 (${findings.map((f) => f.criterionId).join(", ") || "없음"})`);
  for (const warning of warnings) log(`  ! ${warning}`);

  /**
   * 어디까지 봤는지를 남긴다. **이 기록이 없으면 켤 때마다 처음부터 다시 본다.**
   * 커밋은 변하지 않으므로 다시 볼 이유가 없고, 다시 보면 비용만 커밋 수만큼 곱해진다.
   *
   * 리포트가 도착했다는 것이 곧 그 커밋들을 다 봤다는 뜻이다. turn이 오류로 끝나면
   * 리포트가 오지 않으므로 기록도 갱신되지 않고, 다음 리뷰가 같은 구간을 다시 본다.
   */
  const projectPath = state.getAppContext().projectPath;
  const task = taskId ? state.getTask(taskId) : undefined;
  if (context && projectPath) {
    void (async () => {
      try {
        const existing = await readReviewLog(projectPath);
        existing.lastReviewedSha = context.commits.at(-1)?.sha ?? existing.lastReviewedSha;
        existing.runs.push({
          at: new Date().toISOString(),
          agent: task?.agent ?? "codex",
          commits: context.commits.map((c) => c.sha),
          findings,
          summary: report.summary,
        });
        await writeReviewLog(projectPath, existing);
      } catch (error) {
        log(`리뷰 기록 저장 실패: ${asMessage(error)}`);
      }
    })();
  }

  res.json({ taskId, warnings });
});

/** 코드가 준비한 세 목록. agent는 이 중 의미가 있는 후보만 실제 파일을 열어 확인한다. */
app.get("/internal/architecture-context", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_architecture_context");
  const context = state.getArchitectureContext();
  if (!context) {
    res.status(409).json({ error: "No architecture structure check is in progress." });
    return;
  }
  res.json(context);
});

/** architecture turn의 구조화된 결론. 근거를 검사하고 JSON+Markdown 현재 snapshot을 쓴다. */
app.post("/internal/architecture", requireToken, async (req: Request, res: Response) => {
  const report = req.body as ArchitectureDebtReport;
  if (
    typeof report?.summary !== "string" ||
    !Array.isArray(report?.findings) ||
    !Array.isArray(report?.limitations) ||
    report.findings.some(
      (finding) =>
        !["oversized-module", "duplicated-logic", "stale-temporary-workaround"].includes(finding.category) ||
        !Array.isArray(finding.files) ||
        !Array.isArray(finding.evidence) ||
        !Array.isArray(finding.designIds),
    )
  ) {
    res.status(400).json({ error: "summary, findings, evidence, designIds and limitations are required" });
    return;
  }

  const projectPath = state.getAppContext().projectPath;
  const context = state.getArchitectureContext();
  if (!context) {
    res.status(409).json({ error: "No architecture structure check is in progress." });
    return;
  }
  const evidence = new Set(report.findings.flatMap((finding) => finding.files));
  const knownDesignIds = new Set(context.designRefs.map((ref) => ref.id));
  const warnings: string[] = [];
  for (const file of evidence) {
    if (!file || file.startsWith("/") || file.split(/[\\/]/).includes("..")) {
      warnings.push(`Invalid project-relative evidence path: ${file || "(empty)"}`);
      continue;
    }
    try {
      await stat(join(projectPath, file));
    } catch {
      warnings.push(`Evidence path does not exist: ${file}`);
    }
  }
  for (const finding of report.findings) {
    for (const id of finding.designIds) {
      if (!knownDesignIds.has(id)) warnings.push(`Unknown design id: ${id}`);
    }
  }

  const automaticLimitations: string[] = [];
  if (context.designRefs.length === 0) {
    // 인터뷰를 거치지 않은 "기존 코드베이스" 진입에서는 design.json이 없는 쪽이 더 흔하다
    // (docs/product_flow_decisions.md). 이 경우에도 oversized-module 검출 자체는 계속한다 —
    // agent가 REQ/ENTITY 대신 코드를 직접 읽고 책임 분리를 판단한다. 그 사실만 알린다.
    automaticLimitations.push(
      ".project-intel/design.json이 없어, oversized-module 판정에 REQ/ENTITY 경계 대신 agent가 코드를 직접 읽은 판단만 사용했습니다.",
    );
  }
  const unreadContent = context.files.filter((file) => !file.contentScanned).length;
  if (unreadContent > 0) {
    automaticLimitations.push(`크기 상한 때문에 본문을 읽지 않은 source 파일이 ${unreadContent}개 있습니다.`);
  }
  if (context.truncated.files > 0) {
    automaticLimitations.push(`source 파일 상한으로 ${context.truncated.files}개를 목록에서 제외했습니다.`);
  }
  if (context.truncated.signatures > 0) {
    automaticLimitations.push(`함수/메서드 시그니처 상한으로 ${context.truncated.signatures}개를 제외했습니다.`);
  }
  if (context.truncated.temporaryMarkers > 0) {
    automaticLimitations.push(`임시 조치 마커 상한으로 ${context.truncated.temporaryMarkers}개를 제외했습니다.`);
  }

  const generatedAt = new Date().toISOString();
  const enrichedReport: ArchitectureDebtReport = {
    ...report,
    limitations: [...new Set([...report.limitations, ...automaticLimitations])],
    generatedAt,
    commit: context.currentCommit,
    findings: report.findings.map((finding) => ({
      ...finding,
      resolutionPrompt: renderArchitectureResolutionPrompt(finding),
    })),
  };

  try {
    await writeArchitectureReport(projectPath, enrichedReport);
  } catch (error) {
    res.status(500).json({ error: `아키텍처 리포트 저장 실패: ${asMessage(error)}` });
    return;
  }

  state.recordArchitecture(enrichedReport);
  const taskId = noteMcpEndpointHit("report_architecture");
  if (taskId) emit({ type: "app.architecture", taskId, report: enrichedReport });
  else log("report_architecture arrived with no active task; stored but not routed to the UI");

  log(`report_architecture: 부채 ${report.findings.length}건 → ${DESIGN_DIR}/architecture.{json,md}`);
  for (const warning of warnings) log(`  ! ${warning}`);
  res.json({ taskId, warnings });
});

/** 키워드 turn이 읽을 대화. 코드 블록과 우리 래퍼는 이미 걷어낸 상태다. */
app.get("/internal/wiki-transcript", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_wiki_transcript");
  const transcript = state.getWikiTranscript();
  if (!transcript) {
    res.status(409).json({ error: "No wiki keyword pass is in progress." });
    return;
  }
  res.json(transcript);
});

/**
 * agent가 고른 후보 키워드.
 *
 * **횟수는 여기서 센다.** agent가 신고한 숫자를 믿지 않는다 — 세는 일은 모델이 잘 못하고,
 * 여기서는 정확할 필요가 있다. agent는 무엇이 키워드인지만 정한다.
 */
app.post("/internal/wiki-keywords", requireToken, (req: Request, res: Response) => {
  const input = req.body as { keywords?: Array<{ term: string; why: string; sample: string }> };
  if (!Array.isArray(input?.keywords)) {
    res.status(400).json({ error: "keywords (array) is required" });
    return;
  }

  const source = state.getWikiSource();
  const keywords: WikiKeyword[] = input.keywords
    .filter((entry) => entry?.term?.trim())
    .map((entry) => ({
      term: entry.term.trim(),
      why: entry.why?.trim() ?? "",
      sample: entry.sample?.trim() ?? "",
      count: countOccurrences(source, entry.term.trim()),
    }));

  const taskId = noteMcpEndpointHit("save_wiki_keywords");
  if (taskId) emit({ type: "app.wiki.keywords", taskId, keywords });
  else log("save_wiki_keywords arrived with no active task; keywords not routed to the UI");

  log(`save_wiki_keywords: ${keywords.length}개 (${keywords.map((k) => k.term).join(", ") || "없음"})`);
  res.json({ taskId, keywords });
});

/** 위키 turn이 보는 것 — 그 말이 오간 대목과 설계. */
app.get("/internal/wiki-context", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_wiki_context");
  const context = state.getWikiContext();
  if (!context) {
    res.status(409).json({ error: "No wiki page is being written." });
    return;
  }
  res.json(context);
});

/**
 * 완성된 위키 페이지.
 *
 * `where`가 비어 있으면 **일반론**이라는 뜻이다. 그런 페이지는 검색으로 얻을 수 있으므로
 * 우리가 만들 이유가 없다. 거절하지는 않되 경고를 되돌려 다음 turn이 고칠 수 있게 한다.
 */
app.post("/internal/wiki", requireToken, (req: Request, res: Response) => {
  const input = req.body as WikiPageInput;
  if (!input?.term?.trim() || !input?.oneLine?.trim() || !input?.inThisProject?.trim()) {
    res.status(400).json({ error: "term, oneLine and inThisProject are required" });
    return;
  }

  const warnings: string[] = [];
  if (!Array.isArray(input.where) || input.where.length === 0) {
    warnings.push("`where` is empty — without evidence from this project the page is a generic definition.");
  }
  // 순수 학습용이라는 제약은 프롬프트만으로 지켜지지 않는다 (SPIKE_FINDINGS.md §16).
  for (const advice of findAdvice(input.oneLine, input.inThisProject)) {
    warnings.push(`This reads as a judgement, which this page must not make — ${advice}`);
  }

  const page: WikiPage = {
    term: input.term.trim(),
    oneLine: input.oneLine.trim(),
    inThisProject: input.inThisProject.trim(),
    where: input.where ?? [],
    related: input.related ?? [],
    createdAt: new Date().toISOString(),
  };

  const taskId = noteMcpEndpointHit("save_wiki");
  if (taskId) emit({ type: "app.wiki", taskId, page });
  else log("save_wiki arrived with no active task; page stored but not routed to the UI");

  log(`save_wiki: ${page.term} (근거 ${page.where.length}개)`);
  for (const warning of warnings) log(`  ! ${warning}`);

  const projectPath = state.getAppContext().projectPath;
  if (projectPath) void writeWikiPage(projectPath, page).catch((error) => log(`위키 저장 실패: ${asMessage(error)}`));

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
 * 커밋 하나의 diff를 싣는 한계선. 넘으면 자르고 잘렸다는 사실을 함께 넘긴다 —
 * 조용히 자르면 agent가 "diff에 없으니 위반이 없다"고 판단해 버린다.
 */
const MAX_DIFF_CHARS = 20_000;

/** 한 번의 리뷰가 훑을 커밋 수 상한. 넘치면 오래된 쪽을 남기고 최신부터 자른다. */
const MAX_REVIEW_COMMITS = 50;

/** `.project-intel/reviews.json` — 어디까지 봤는지가 남는 곳. */
const REVIEW_LOG = "reviews.json";

/**
 * 설계를 디스크에서 읽는다.
 *
 * 리뷰는 정의상 **인계가 끝나고 한참 뒤에** 돈다. 그때 bridge는 이미 재시작됐고 메모리에
 * 설계가 없다. 인터뷰가 `.project-intel/design.json`에 남겨 둔 것이 유일한 원본이다
 * (SPIKE_FINDINGS.md §13의 "인터뷰 상태의 지속성"이 여기서 필수가 된다).
 */
async function loadDesignFromDisk(projectPath: string): Promise<DesignDoc | null> {
  try {
    const raw = await readFile(join(projectPath, DESIGN_DIR, "design.json"), "utf8");
    return JSON.parse(raw) as DesignDoc;
  } catch {
    return null;
  }
}

/**
 * 리뷰가 대조할 기준 목록. **DEC과 RULE을 한 목록으로 준다** — agent에게는 둘 다
 * "이 프로젝트가 정한 것"이고, 종류를 나눠 주면 한쪽만 보는 일이 생긴다.
 */
function criteriaFrom(design: DesignDoc): ReviewCriterion[] {
  return [
    ...design.decisions.map((d) => ({ id: d.id, text: d.text, why: d.why, source: d.source })),
    ...design.rules.map((r) => ({ id: r.id, text: r.text, source: r.source })),
  ];
}

/** 프로젝트에서 git을 돌리고 stdout을 그대로 돌려준다. */
async function gitOutput(projectPath: string, args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  // diff는 커질 수 있다. execFile 기본 버퍼(1MB)로는 큰 변경에서 터진다.
  const { stdout } = await run("git", args, { cwd: projectPath, maxBuffer: 32 * 1024 * 1024, ...cliSpawnOptions });
  return stdout;
}

async function gitLines(projectPath: string, args: string[]): Promise<string[]> {
  const out = await gitOutput(projectPath, args);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** 파일 이름으로 쓸 수 있게. 대소문자는 버린다 — `JWT`와 `jwt`는 같은 말이다. */
function wikiSlug(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") || "page";
}

/**
 * JSON과 마크다운을 같이 쓴다.
 *
 * JSON이 원본이고 마크다운은 파생물이다 (`design.json` → `app_design.md`와 같은 관계).
 * `.md`가 있으면 Obsidian·GitHub·에디터 미리보기·노션 임포트가 그대로 동작하므로,
 * 우리가 커넥터를 만들 이유가 없어진다.
 */
async function writeWikiPage(projectPath: string, page: WikiPage): Promise<void> {
  const dir = join(projectPath, DESIGN_DIR, "wiki");
  await mkdir(dir, { recursive: true });
  const slug = wikiSlug(page.term);
  await writeFile(join(dir, `${slug}.json`), JSON.stringify(page, null, 2), "utf8");
  await writeFile(join(dir, `${slug}.md`), renderWikiMarkdown(page), "utf8");
}

/** 구조 점검은 이력 배열을 쌓지 않고 현재 snapshot을 덮어쓴다. 추세는 git이 남긴다. */
async function writeArchitectureReport(projectPath: string, report: ArchitectureDebtReport): Promise<void> {
  const dir = join(projectPath, DESIGN_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "architecture.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(join(dir, "architecture.md"), renderArchitectureMarkdown(report), "utf8");
}

/** 이미 만들어 둔 페이지들. 화면이 "이미 있음"을 표시하는 데 쓴다. */
async function listWikiTerms(projectPath: string): Promise<string[]> {
  try {
    const dir = join(projectPath, DESIGN_DIR, "wiki");
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    const terms = await Promise.all(
      files.map(async (name) => {
        try {
          return (JSON.parse(await readFile(join(dir, name), "utf8")) as WikiPage).term;
        } catch {
          return null;
        }
      }),
    );
    return terms.filter((term): term is string => Boolean(term));
  } catch {
    return [];
  }
}

async function readReviewLog(projectPath: string): Promise<ReviewLog> {
  try {
    const raw = await readFile(join(projectPath, DESIGN_DIR, REVIEW_LOG), "utf8");
    return JSON.parse(raw) as ReviewLog;
  } catch {
    return { lastReviewedSha: null, runs: [] };
  }
}

async function writeReviewLog(projectPath: string, log: ReviewLog): Promise<void> {
  const dir = join(projectPath, DESIGN_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, REVIEW_LOG), JSON.stringify(log, null, 2), "utf8");
}

/** ref가 이 저장소에 실제로 있는지. 기록이 있어도 rebase 등으로 사라졌을 수 있다. */
async function commitExists(projectPath: string, ref: string): Promise<boolean> {
  try {
    await gitOutput(projectPath, ["cat-file", "-e", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 어디부터 볼지 정한다.
 *
 * **설계보다 앞선 커밋은 판정 대상이 아니다.** 그때는 아직 기준이 없었으므로, 그것을
 * 지금의 DEC으로 재는 것은 의미가 없다. 그래서 처음 켤 때의 기준점은 임의의 개수가 아니라
 * `design.json`이 들어온 커밋이다.
 */
async function resolveReviewStart(
  projectPath: string,
  since: string | undefined,
): Promise<{ start: ReviewStart; since: string | null }> {
  if (since?.trim()) return { start: "explicit", since: since.trim() };

  const log = await readReviewLog(projectPath);
  if (log.lastReviewedSha && (await commitExists(projectPath, log.lastReviewedSha))) {
    return { start: "last-review", since: log.lastReviewedSha };
  }

  // 인계 커밋 자체는 설계와 하네스만 담고 있어 리뷰할 코드가 없다. 그 **다음**부터 본다.
  try {
    const shas = await gitLines(projectPath, [
      "log", "--format=%H", "--diff-filter=A", "--", `${DESIGN_DIR}/design.json`,
    ]);
    const handover = shas.at(-1);
    if (handover) return { start: "design", since: handover };
  } catch {
    // 저장소가 아니거나 아직 커밋이 없다. 아래 안전판으로 간다.
  }

  return { start: "recent", since: null };
}

/**
 * 리뷰할 커밋들을 모은다. **오래된 것부터** 준다 — 바이브코딩은 앞 커밋이 뒤 커밋의 전제라
 * 순서대로 읽어야 무엇이 왜 들어왔는지 읽힌다.
 */
async function collectCommits(
  projectPath: string,
  since: string | null,
): Promise<{ commits: ReviewCommit[]; skipped: number }> {
  const range = since ? [`${since}..HEAD`] : [`-n`, String(MAX_REVIEW_COMMITS)];
  const SEP = "\u001f";
  const lines = await gitLines(projectPath, [
    "log", "--reverse", "--no-merges", `--format=%H${SEP}%s${SEP}%an${SEP}%aI`, ...range,
  ]);

  // 상한을 넘으면 **오래된 쪽을 남긴다.** 뒤 커밋은 앞 커밋 위에 서 있으므로, 앞을 건너뛰면
  // 뒤를 읽어도 맥락이 없다. 남은 것은 다음 리뷰가 이어서 본다.
  const skipped = Math.max(0, lines.length - MAX_REVIEW_COMMITS);
  const selected = lines.slice(0, MAX_REVIEW_COMMITS);

  const commits: ReviewCommit[] = [];
  for (const line of selected) {
    const [sha, subject = "", author = "", at = ""] = line.split(SEP);
    if (!sha) continue;
    const changedFiles = await gitLines(projectPath, ["show", "--name-only", "--format=", sha]);
    const raw = await gitOutput(projectPath, ["show", "--format=", sha]);
    const truncated = raw.length > MAX_DIFF_CHARS;
    commits.push({
      sha,
      subject,
      author,
      at,
      changedFiles,
      diff: truncated ? `${raw.slice(0, MAX_DIFF_CHARS)}\n... (truncated)` : raw,
      truncated,
    });
  }
  return { commits, skipped };
}

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
