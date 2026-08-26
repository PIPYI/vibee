/**
 * Local bridge. HTTP API + WebSocket 이벤트 허브 + agent adapter.
 * loopback에만 bind 한다. 기능별 라우트는 각 기능을 이식하는 단계에서 이 파일에 추가한다.
 */
import { createServer } from "node:http";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import { BRIDGE_HOST, BRIDGE_TOKEN_HEADER, type AgentReadiness, type ModelOption } from "@vci/protocol";
import { appRootFromModule, loadBridgeConfig } from "@vci/protocol/node";

import { ClaudeAdapter } from "./agents/claude/adapter.js";
import { CodexAdapter } from "./agents/codex/adapter.js";
import type { AgentAdapter } from "./agents/types.js";
import { BridgeState } from "./state.js";

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

app.get("/internal/app-context", requireToken, (_req: Request, res: Response) => {
  res.json(state.getAppContext());
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
