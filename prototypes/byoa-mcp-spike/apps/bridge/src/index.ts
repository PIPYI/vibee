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
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import {
  BRIDGE_HOST,
  BRIDGE_TOKEN_HEADER,
  type AgentEvent,
  type AgentReadiness,
  type ResetSessionRequest,
  type ShowResultInput,
  type StartTaskRequest,
} from "@byoa/protocol";
import { fixturePath, loadBridgeConfig, spikeRootFromModule } from "@byoa/protocol/node";

import { ClaudeAdapter } from "./agents/claude/adapter.js";
import { CodexAdapter } from "./agents/codex/adapter.js";
import type { AgentAdapter } from "./agents/types.js";
import { buildSpikePrompt } from "./prompt.js";
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
  res.json({ ok: true, agents: readiness });
});

app.get("/api/state", (_req: Request, res: Response) => {
  res.json({
    defaultProjectPath,
    appContext: state.getAppContext(),
    activeTaskId: state.getActiveTaskId(),
    tasks: state.listTasks(),
  });
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
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId });

  void runTask(adapter, taskId, projectPath, body.prompt);
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

app.get("/internal/app-context", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_app_context");
  res.json(state.getAppContext());
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

async function runTask(adapter: AgentAdapter, taskId: string, projectPath: string, prompt: string): Promise<void> {
  state.updateTask(taskId, { status: "running" });
  emit({ type: "task.started", taskId, agent: adapter.id, projectPath });

  try {
    const outcome = await adapter.startTask({ taskId, projectPath, prompt: buildSpikePrompt(prompt) }, (event) => {
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
