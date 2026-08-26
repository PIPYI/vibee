/**
 * Local bridge. HTTP API + WebSocket 이벤트 허브 + agent adapter.
 * loopback에만 bind 한다. 기능별 라우트는 각 기능을 이식하는 단계에서 이 파일에 추가한다.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import { BRIDGE_HOST, BRIDGE_TOKEN_HEADER, type AgentReadiness, type ModelOption } from "@vci/protocol";
import type { AskUserInput, DesignDoc, ExportDesignRequest, InterviewMessageRequest } from "@vci/protocol";
import { appRootFromModule, loadBridgeConfig } from "@vci/protocol/node";

import { ClaudeAdapter } from "./agents/claude/adapter.js";
import { CodexAdapter } from "./agents/codex/adapter.js";
import type { AgentAdapter, TaskMode } from "./agents/types.js";
import { BridgeState } from "./state.js";
import {
  HARNESS_MARKER,
  designGaps,
  renderAppDesign,
  renderHarness,
  renderNarrative,
  suggestFirstPrompt,
  validateDesign,
} from "./design.js";
import { buildInterviewPrompt } from "./prompt.js";
import { cliSpawnOptions } from "./platform.js";

const log = (...args: unknown[]): void => console.log("[vci-bridge]", ...args);

const appRoot = appRootFromModule(import.meta.url);
const config = loadBridgeConfig(appRoot);
const state = new BridgeState();

const codex = new CodexAdapter(log);
const claude = new ClaudeAdapter(log, {
  mcpServerEntry: join(appRoot, "packages", "mcp-server", "dist", "index.js"),
  bridgeUrl: config.baseUrl,
  bridgeToken: config.token,
});
const adapters = new Map<string, AgentAdapter>([
  ["codex", codex],
  ["claude", claude],
]);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req: Request, res: Response) => {
  const readiness: AgentReadiness[] = [await codex.checkReady(), await claude.checkReady()];
  res.json({ ok: true, agents: readiness });
});

app.get("/api/state", (_req: Request, res: Response) => {
  res.json({
    appContext: state.getAppContext(),
    activeTaskId: state.getActiveTaskId(),
    tasks: state.listTasks(),
  });
});

const MODEL_CACHE_MS = 5 * 60 * 1000;
const modelCache = new Map<string, { at: number; models: ModelOption[] }>();

app.get("/api/models", async (req: Request, res: Response) => {
  const agentId = String(req.query["agent"] ?? "");
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
    res.status(502).json({ error: asMessage(error) });
  }
});

app.post("/api/app-context", (req: Request, res: Response) => {
  res.json(state.patchAppContext(req.body ?? {}));
});

app.post("/api/tasks/:taskId/stop", async (req: Request, res: Response) => {
  const taskId = String(req.params["taskId"]);
  const task = state.getTask(taskId);
  if (!task) {
    res.status(404).json({ error: `Task not found: ${taskId}` });
    return;
  }
  await adapters.get(task.agent)?.stopTask(taskId);
  res.json({ ok: true });
});

function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (req.get(BRIDGE_TOKEN_HEADER) !== config.token) {
    res.status(401).json({ error: "invalid bridge token" });
    return;
  }
  next();
}

app.get("/internal/app-context", requireToken, (req: Request, res: Response) => {
  res.json(state.getAppContext(req.query["design"] === "full"));
});

/** 새 인터뷰를 시작한다. */
app.post("/api/interview", async (req: Request, res: Response) => {
  const body = req.body as { agent?: string; projectPath?: string; model?: string; effort?: string };
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
  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body?.projectPath ?? "");
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const ready = await adapter.checkReady();
  if (!ready.installed || ready.authenticated === false) {
    res.status(412).json({ error: ready.message ?? "Agent is not ready." });
    return;
  }

  // 새 인터뷰는 새 프로젝트다. 지난 인터뷰의 흔적을 세 곳에서 모두 지운다.
  state.resetInterview();
  adapter.resetSession(projectPath);
  let cleared: string[] = [];
  try {
    cleared = await clearGeneratedArtifacts(projectPath);
    if (cleared.length > 0) log(`이전 인터뷰 산출물 제거: ${cleared.join(", ")}`);
  } catch (error) {
    log(`이전 인터뷰 산출물 제거 실패: ${asMessage(error)}`);
  }

  const taskId = randomUUID();
  state.patchAppContext({ projectPath, prompt: "" });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: "",
    selectedItem: null,
    status: "starting",
    model: body?.model || undefined,
    effort: body?.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId, ...(cleared.length > 0 ? { cleared } : {}) });
  void runTask(adapter, taskId, projectPath, buildInterviewPrompt(null), "interview", {
    model: body?.model || undefined,
    effort: body?.effort || undefined,
  });
});

/** 인터뷰에 말을 건다. 발화를 기록하고 다음 turn을 자동으로 시작한다. */
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

  state.emit({ type: "app.answer", taskId, questionId: recorded.question?.id ?? "", answer: body.message });
  res.json({ taskId });

  void runTask(adapter, taskId, projectPath, buildInterviewPrompt(body.message), "interview", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/** 설계 초안을 프로젝트에 app_design.md + harness로 내보낸다. */
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
    projectPath = await canonicalizeProjectPath(body?.projectPath ?? "");
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

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
    const intelDir = join(projectPath, DESIGN_DIR);
    await mkdir(intelDir, { recursive: true });
    await writeFile(join(intelDir, "design.json"), JSON.stringify(design, null, 2), "utf8");
    written.push(`${DESIGN_DIR}/design.json`);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
    return;
  }

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

/** 사람용 설명. 브라우저가 초안을 보여줄 때 쓴다. */
app.get("/api/design/narrative", (_req: Request, res: Response) => {
  const design = state.getDesign();
  if (!design) {
    res.status(404).json({ error: "No design yet." });
    return;
  }
  res.json({ markdown: renderNarrative(design), gaps: designGaps(design) });
});

app.post("/internal/results", requireToken, (req: Request, res: Response) => {
  const result = req.body;
  if (!result?.title || !result?.summary || !result?.status) {
    res.status(400).json({ error: "title, summary and status are required" });
    return;
  }
  const taskId = noteMcpEndpointHit("show_result");
  if (taskId) state.emit({ type: "app.result", taskId, result });
  else log("show_result arrived with no active task; ignoring for UI routing");
  res.json({ taskId });
});

app.post("/internal/questions", requireToken, (req: Request, res: Response) => {
  const input = req.body as AskUserInput;
  if (!input?.question?.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  const question = state.askQuestion(input);
  const taskId = noteMcpEndpointHit("ask_user");
  if (taskId) state.emit({ type: "app.question", taskId, question });
  else log("ask_user arrived with no active task; question stored but not routed to the UI");
  res.json({ questionId: question.id });
});

app.post("/internal/design", requireToken, (req: Request, res: Response) => {
  const design = req.body as DesignDoc;
  if (!design?.title?.trim() || !Array.isArray(design.reqs)) {
    res.status(400).json({ error: "title and the seven unit arrays are required" });
    return;
  }
  const warnings = validateDesign(design);
  state.saveDesign(design);
  const taskId = noteMcpEndpointHit("save_design");
  if (taskId) state.emit({ type: "app.design", taskId, design });
  else log("save_design arrived with no active task; design stored but not routed to the UI");
  log(`save_design: ${design.title} (reqs ${design.reqs.length}, flows ${design.flows.length})`);
  for (const warning of warnings) log(`  ! ${warning}`);
  res.json({ taskId, warnings });
});

/** 존재하는 디렉터리가 아니면 거부하고, 심볼릭 링크는 해소한다. */
export async function canonicalizeProjectPath(input: string): Promise<string> {
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

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 존재하는 파일이 사람이 쓴 것인지. 우리 표식이 없으면 사람이 쓴 것으로 본다. */
async function isHandWritten(path: string): Promise<boolean> {
  try {
    const existing = await readFile(path, "utf8");
    return !existing.includes(HARNESS_MARKER);
  } catch {
    return false;
  }
}

const GENERATED_DOCS = ["app_design.md", "AGENTS.md", "CLAUDE.md"] as const;
const DESIGN_DIR = ".project-intel";

/** 설계를 디스크에서 읽는다. bridge가 재시작돼도 인터뷰가 남긴 것이 유일한 원본이다. */
async function loadDesignFromDisk(projectPath: string): Promise<DesignDoc | null> {
  try {
    const raw = await readFile(join(projectPath, DESIGN_DIR, "design.json"), "utf8");
    return JSON.parse(raw) as DesignDoc;
  } catch {
    return null;
  }
}

/** 프로젝트가 git 저장소가 아니면 만들고 첫 커밋을 남긴다. 원격은 건드리지 않는다. */
async function ensureGitRepo(projectPath: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const opts = { cwd: projectPath, ...cliSpawnOptions };
  try {
    await run("git", ["rev-parse", "--git-dir"], opts);
    return false;
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

/** 인터뷰를 새로 시작할 때 프로젝트에 남은 지난 산출물을 지운다. */
async function clearGeneratedArtifacts(projectPath: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of GENERATED_DOCS) {
    const path = join(projectPath, name);
    try {
      await stat(path);
    } catch {
      continue;
    }
    if (await isHandWritten(path)) continue;
    await rm(path, { force: true });
    removed.push(name);
  }
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

async function runTask(
  adapter: AgentAdapter,
  taskId: string,
  projectPath: string,
  prompt: string,
  mode: TaskMode,
  overrides: { model?: string; effort?: string } = {},
): Promise<void> {
  state.updateTask(taskId, { status: "running" });
  state.emit({ type: "task.started", taskId, agent: adapter.id, projectPath });
  try {
    const outcome = await adapter.startTask({ taskId, projectPath, prompt, mode, ...overrides }, (event) => {
      if (event.type === "mcp.tool.called") state.recordMcpCall(taskId, event.tool, event.source);
      state.emit(event);
    });
    state.updateTask(taskId, { status: outcome, endedAt: new Date().toISOString() });
    state.emit(outcome === "interrupted" ? { type: "task.interrupted", taskId } : { type: "task.completed", taskId });
  } catch (error) {
    const message = asMessage(error);
    state.updateTask(taskId, { status: "error", endedAt: new Date().toISOString(), error: message });
    state.emit({ type: "task.error", taskId, message });
  }
}

function noteMcpEndpointHit(tool: string): string | null {
  const taskId = state.getActiveTaskId();
  if (!taskId) return null;
  state.recordMcpCall(taskId, tool, "bridge-endpoint");
  state.emit({ type: "mcp.tool.called", taskId, tool, source: "bridge-endpoint" });
  return taskId;
}

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
