/**
 * Bridge — HTTP + WebSocket + agent adapter 오케스트레이션.
 *
 * 3채널 분리 (B1):
 * ```text
 * Browser → Agent       = POST /api/analyze  → adapter.startTask
 * Agent → Browser       = WebSocket /events  (정규화된 AgentEvent 만)
 * Agent → App functions = MCP → loopback /internal/*
 * ```
 *
 * **이 파일은 OS 를 알지 않는다** — 실행 파일 해석과 프로세스 정리는 `./platform.js` 에만 있다.
 */
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SemanticStore, initialProjectState } from "@onto/core";
import { buildWorkSet, carryMissingEvidence, diffEvidence, indexProject } from "@onto/evidence";
import type {
  AgentEvent,
  AgentId,
  AgentReadiness,
  AnalyzeRequest,
  HealthResponse,
  TaskMode,
} from "@onto/protocol";
import { BRIDGE_TOKEN_HEADER } from "@onto/protocol";
import { loadBridgeConfig, protoRootFromModule } from "@onto/protocol/bridge-config";
import express, { type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import { ClaudeAdapter } from "./agents/claude/adapter.js";
import { CodexAdapter } from "./agents/codex/adapter.js";
import type { AgentAdapter } from "./agents/types.js";
import {
  conceptContext,
  isUnavailable,
  loadState,
  memoryDigest,
  queryEvidence,
  scenarioContext,
  searchClaims,
} from "./memory-api.js";
import { onShutdown } from "./platform.js";
import {
  buildFullAnalyzePrompt,
  buildIncrementalAnalyzePrompt,
  buildVerifyPrompt,
} from "./prompt.js";
import { BridgeState } from "./state.js";

const protoRoot = protoRootFromModule(import.meta.url);
const config = loadBridgeConfig(protoRoot);
const mcpServerPath = join(protoRoot, "packages", "mcp-server", "dist", "index.js");

const state = new BridgeState();
const adapters = new Map<AgentId, AgentAdapter>([
  ["codex", new CodexAdapter()],
  [
    "claude",
    new ClaudeAdapter({
      mcpServerPath,
      bridgeUrl: config.baseUrl,
      bridgeToken: config.token,
    }),
  ],
]);

function log(...args: unknown[]): void {
  console.error("[onto-bridge]", ...args);
}

const app = express();
app.use(express.json({ limit: "16mb" }));

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalizeProjectPath(input: string): string {
  const resolved = resolve(input);
  if (!existsSync(resolved)) throw new Error(`프로젝트 경로가 없습니다: ${resolved}`);
  return realpathSync(resolved);
}

// ---------------------------------------------------------------------------
// 브라우저용 API
// ---------------------------------------------------------------------------

app.get("/api/health", async (_req: Request, res: Response) => {
  const readiness: AgentReadiness[] = [];
  for (const adapter of adapters.values()) {
    readiness.push(await adapter.checkReady());
  }
  const payload: HealthResponse = {
    ok: true,
    agents: readiness,
    projectPath: state.getProjectPath(),
  };
  res.json(payload);
});

app.get("/api/models", async (req: Request, res: Response) => {
  const adapter = adapters.get(String(req.query["agent"] ?? "") as AgentId);
  if (!adapter) {
    res.status(400).json({ error: `지원하지 않는 agent: ${String(req.query["agent"])}` });
    return;
  }
  try {
    res.json({ agent: adapter.id, models: await adapter.listModels() });
  } catch (error) {
    res.status(502).json({ error: asMessage(error) });
  }
});

app.get("/api/state", (_req: Request, res: Response) => {
  res.json({
    projectPath: state.getProjectPath(),
    activeTaskId: state.getActiveTaskId(),
    tasks: state.listTasks(),
  });
});

/**
 * 분석 — **generation transition 이 두 번 일어난다** (V1 / plan §6.9).
 *
 * 커밋 1(재인덱싱)이 먼저 HEAD 가 되어야 agent 가 새 인덱스를 읽을 수 있다.
 * 그리고 이렇게 나누면 agent 분석이 실패해도 **최신 Evidence Index 는 남는다.**
 */
/**
 * 프로젝트 선택.
 *
 * 분석과 분리되어 있다 — **Trace 는 Evidence 만 있으면 분석 전에도 동작하므로**(§6.6)
 * 사용자가 프로젝트를 열자마자 코드 구조를 볼 수 있어야 한다.
 */
app.post("/api/project", (req: Request, res: Response) => {
  const body = req.body as { projectPath?: string };
  try {
    const projectPath = canonicalizeProjectPath(String(body?.projectPath ?? ""));
    state.setProjectPath(projectPath);
    const store = new SemanticStore(projectPath);
    res.json({ projectPath, initialized: store.isInitialized() });
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
  }
});

/**
 * 마지막 도달의 결과 종류를 기록한다.
 *
 * **"tool 이 불렸다"와 "tool 이 실제 데이터를 돌려줬다"는 다른 질문이다.** 전자만 보면
 * `memory_unavailable` 을 받은 turn 도 통과한 것처럼 보인다 — 채널은 돌지만 agent 는
 * 아무것도 못 본 상태다.
 */
function recordOutcome(unavailable: boolean): void {
  const outcome = unavailable ? "unavailable" : "data";
  const last = mcpArrivals[mcpArrivals.length - 1];
  if (last) last.outcome = outcome;
  // task 에도 남긴다. acceptance 는 **task 범위**의 기록만 본다.
  state.recordMcpOutcome(outcome);
}

/** MCP server 가 실제로 우리에게 도달했는가. agent 없이도 이 채널을 관측할 수 있다 (B4). */
app.get("/api/mcp-arrivals", (_req: Request, res: Response) => {
  res.json({ arrivals: mcpArrivals });
});

/**
 * 결정론적 재인덱싱만 (agent turn 없음).
 *
 * Trace 는 Evidence 만 있으면 동작하므로(§6.6), agent turn 을 태우지 않고 인덱싱만
 * 하고 싶은 경우가 실제로 있다 — 프로젝트를 열자마자 코드 구조를 보여줄 때다.
 */
app.post("/api/index", async (req: Request, res: Response) => {
  const body = req.body as { projectPath?: string; gitBase?: string };
  let projectPath: string;
  try {
    projectPath = canonicalizeProjectPath(String(body?.projectPath ?? state.getProjectPath() ?? ""));
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }
  state.setProjectPath(projectPath);
  try {
    const prepared = await reindex(projectPath, "index-only", body.gitBase);
    res.json(prepared.summary);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
  }
});

app.post("/api/analyze", async (req: Request, res: Response) => {
  const body = req.body as AnalyzeRequest;
  const adapter = adapters.get(body?.agent);
  if (!adapter) {
    res.status(400).json({ error: `지원하지 않는 agent: ${String(body?.agent)}` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "이미 실행 중인 task 가 있습니다. 먼저 중지하세요." });
    return;
  }

  let projectPath: string;
  try {
    projectPath = canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const ready = await adapter.checkReady();
  if (!ready.installed) {
    res.status(412).json({ error: ready.message ?? "agent 를 쓸 수 없습니다." });
    return;
  }

  state.setProjectPath(projectPath);
  const taskId = randomUUID();

  try {
    const prepared = await reindex(projectPath, taskId, body.gitBase);
    state.createTask({
      taskId,
      agent: adapter.id,
      projectPath,
      mode: "analyze",
      prompt: prepared.prompt,
      status: "starting",
      ...(body.model ? { model: body.model } : {}),
      ...(body.effort ? { effort: body.effort } : {}),
      startedAt: new Date().toISOString(),
      mcpCalls: [],
    });
    res.json({ taskId, ...prepared.summary });
    void runTask(adapter, taskId, projectPath, prepared.prompt, "analyze", body);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
  }
});

/**
 * 커밋 1 — Repository re-index.
 *
 * ```text
 * analysisVersion++
 * semanticVersion 유지
 * semanticReconciledAnalysisVersion:
 *   SemanticWorkSet 이 비어 있으면 → 새 analysisVersion 으로 advance
 *   있으면                        → 기존 값 유지
 * ```
 */
async function reindex(
  projectPath: string,
  taskId: string,
  gitBase: string | undefined,
): Promise<{ prompt: string; summary: Record<string, unknown> }> {
  const store = new SemanticStore(projectPath);
  store.cleanOrphans();
  if (!store.isInitialized()) {
    await store.init(initialProjectState(randomUUID(), projectPath));
  }

  const before = store.load();
  const nextVersion = before.project.analysisVersion + 1;
  const fresh = indexProject(projectPath, {
    analysisVersion: nextVersion,
    ...(gitBase ? { gitBase } : {}),
  });
  const withMissing = carryMissingEvidence(before.evidence, fresh);
  const diffs = diffEvidence(before.evidence, withMissing);
  const work = buildWorkSet(diffs, before.memory, before.grounding);
  const workEmpty =
    work.dirtyEvidence.length === 0 && work.ungroundedAppearedEvidenceIds.length === 0;

  await store.commit("repository re-index", "index", (snapshot) => {
    snapshot.project.analysisVersion = nextVersion;
    // 의미는 아직 아무것도 바뀌지 않았다.
    if (workEmpty) {
      // 포매팅만 바뀐 경우다. agent 를 부르지 않고 reconcile 을 따라잡는다 (V1).
      snapshot.project.semanticReconciledAnalysisVersion = nextVersion;
    }
    snapshot.evidence = withMissing;
    return snapshot;
  });

  state.emit({
    type: "analysis.progress",
    taskId,
    phase: "indexed",
    message: `analysisVersion ${nextVersion} · dirty ${work.dirtyEvidence.length} · 새 근거 ${work.ungroundedAppearedEvidenceIds.length}`,
  });

  const isFirst = before.project.semanticVersion === 0 && before.memory.concepts.length === 0;
  const prompt = isFirst
    ? buildFullAnalyzePrompt(projectPath)
    : buildIncrementalAnalyzePrompt(projectPath, work);

  return {
    prompt,
    summary: {
      analysisVersion: nextVersion,
      semanticVersion: before.project.semanticVersion,
      workSetSize: {
        dirtyEvidence: work.dirtyEvidence.length,
        affectedConcepts: work.affectedConceptIds.length,
        affectedClaims: work.affectedClaimIds.length,
        ungroundedAppearedEvidence: work.ungroundedAppearedEvidenceIds.length,
      },
    },
  };
}

async function runTask(
  adapter: AgentAdapter,
  taskId: string,
  projectPath: string,
  prompt: string,
  mode: TaskMode,
  body: AnalyzeRequest,
): Promise<void> {
  const emit = (event: AgentEvent): void => {
    if (event.type === "mcp.tool.called") {
      state.recordMcpCall(taskId, event.tool, event.source);
    }
    state.emit(event);
  };

  state.updateTask(taskId, { status: "running" });
  state.emit({ type: "task.started", taskId, agent: adapter.id, projectPath, mode });

  try {
    const outcome = await adapter.startTask(
      {
        taskId,
        projectPath,
        prompt,
        mode,
        ...(body.model ? { model: body.model } : {}),
        ...(body.effort ? { effort: body.effort } : {}),
      },
      emit,
    );
    state.updateTask(taskId, { status: outcome, endedAt: new Date().toISOString() });
    state.emit(
      outcome === "interrupted" ? { type: "task.interrupted", taskId } : { type: "task.completed", taskId },
    );
  } catch (error) {
    const message = asMessage(error);
    state.updateTask(taskId, { status: "error", error: message, endedAt: new Date().toISOString() });
    state.emit({ type: "task.error", taskId, message });
  }
}

/**
 * MCP 채널 검증 (acceptance 2·3).
 *
 * 분석과 분리한다 — 이것이 증명하려는 것은 **의미 품질이 아니라 배선**이다.
 * agent 가 tool 을 실제로 부르고(`agent-stream`), 그 호출이 우리에게 도달하는지
 * (`bridge-endpoint`)만 본다.
 */
app.post("/api/verify", async (req: Request, res: Response) => {
  const body = req.body as { agent: AgentId; projectPath?: string; model?: string; effort?: string };
  const adapter = adapters.get(body?.agent);
  if (!adapter) {
    res.status(400).json({ error: `지원하지 않는 agent: ${String(body?.agent)}` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "이미 실행 중인 task 가 있습니다." });
    return;
  }

  let projectPath: string;
  try {
    projectPath = canonicalizeProjectPath(String(body.projectPath ?? state.getProjectPath() ?? ""));
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const ready = await adapter.checkReady();
  if (!ready.installed) {
    res.status(412).json({ error: ready.message ?? "agent 를 쓸 수 없습니다." });
    return;
  }

  state.setProjectPath(projectPath);
  const taskId = randomUUID();
  const prompt = buildVerifyPrompt(projectPath);

  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    mode: "chat",
    prompt,
    status: "starting",
    ...(body.model ? { model: body.model } : {}),
    ...(body.effort ? { effort: body.effort } : {}),
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId });
  void runTask(adapter, taskId, projectPath, prompt, "chat", body as AnalyzeRequest);
});

app.post("/api/tasks/:taskId/stop", async (req: Request, res: Response) => {
  const taskId = String(req.params["taskId"]);
  const task = state.getTask(taskId);
  if (!task) {
    res.status(404).json({ error: `task 를 찾을 수 없습니다: ${taskId}` });
    return;
  }
  await adapters.get(task.agent)?.stopTask(taskId);
  res.json({ ok: true });
});

app.get("/api/sessions", async (req: Request, res: Response) => {
  const adapter = adapters.get(String(req.query["agent"] ?? "") as AgentId);
  const projectPath = String(req.query["projectPath"] ?? state.getProjectPath() ?? "");
  if (!adapter || !projectPath) {
    res.status(400).json({ error: "agent 와 projectPath 가 필요합니다." });
    return;
  }
  res.json({ agent: adapter.id, projectPath, sessions: await adapter.listSessions(projectPath) });
});

app.post("/api/sessions/reset", (req: Request, res: Response) => {
  const body = req.body as { agent: AgentId; projectPath: string };
  const adapter = adapters.get(body?.agent);
  if (!adapter) {
    res.status(400).json({ error: `지원하지 않는 agent: ${String(body?.agent)}` });
    return;
  }
  // 세션 파일을 지우지 않는다. bridge 가 들고 있던 참조만 버린다.
  adapter.resetSession(body.projectPath);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// MCP server 전용 — 토큰 가드 (B1)
// ---------------------------------------------------------------------------

function requireToken(req: Request, res: Response, next: () => void): void {
  if (req.header(BRIDGE_TOKEN_HEADER) !== config.token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

/**
 * **bridge-endpoint 증거원** (B4).
 *
 * agent 가 spawn 한 별도 프로세스가 실제로 우리에게 도달한 사실이다. agent 의 자기 보고
 * (`agent-stream`)와 **독립적인** 증거이고, 한쪽만 관측되는 것은 실패로 취급한다 —
 * spike 에서 실제로 `agent-stream` 만 잡히고 tool 이 돌지 않은 적이 있다 (Finding 4).
 */
/**
 * 최근 도달 기록. task 가 없을 때도 남는다.
 *
 * task 에 묶어서만 기록하면 **agent 없이는 이 채널을 검증할 수 없다.** 채널이 도는지와
 * agent 가 그것을 부르는지는 다른 질문이므로 따로 관측할 수 있어야 한다.
 */
const mcpArrivals: Array<{ tool: string; at: string; outcome?: "data" | "unavailable" }> = [];

function recordArrival(tool: string): void {
  mcpArrivals.push({ tool, at: new Date().toISOString() });
  if (mcpArrivals.length > 200) mcpArrivals.shift();
  state.recordMcpCall(null, tool, "bridge-endpoint");
  const taskId = state.getActiveTaskId();
  if (taskId) state.emit({ type: "mcp.tool.called", taskId, tool, source: "bridge-endpoint" });
}

app.get("/internal/memory", requireToken, (req: Request, res: Response) => {
  recordArrival("get_project_semantic_memory");
  const loaded = loadState(state.getProjectPath());
  recordOutcome(isUnavailable(loaded));
  if (isUnavailable(loaded)) {
    res.json(loaded);
    return;
  }
  res.json(req.query["detail"] === "full" ? loaded : memoryDigest(loaded));
});

app.post("/internal/evidence", requireToken, (req: Request, res: Response) => {
  recordArrival("get_evidence");
  const projectPath = state.getProjectPath();
  const loaded = loadState(projectPath);
  recordOutcome(isUnavailable(loaded));
  if (isUnavailable(loaded)) {
    res.json(loaded);
    return;
  }
  res.json(queryEvidence(loaded, projectPath!, req.body ?? {}));
});

app.get("/internal/concepts", requireToken, (req: Request, res: Response) => {
  recordArrival("get_concept_context");
  const loaded = loadState(state.getProjectPath());
  if (isUnavailable(loaded)) {
    res.json(loaded);
    return;
  }
  res.json(
    conceptContext(loaded, {
      ...(req.query["conceptId"] ? { conceptId: String(req.query["conceptId"]) } : {}),
      ...(req.query["name"] ? { name: String(req.query["name"]) } : {}),
    }),
  );
});

app.get("/internal/claims", requireToken, (req: Request, res: Response) => {
  recordArrival("search_claims");
  const loaded = loadState(state.getProjectPath());
  if (isUnavailable(loaded)) {
    res.json(loaded);
    return;
  }
  res.json(
    searchClaims(loaded, {
      q: String(req.query["q"] ?? ""),
      ...(req.query["conceptId"] ? { conceptId: String(req.query["conceptId"]) } : {}),
      ...(req.query["limit"] ? { limit: Number(req.query["limit"]) } : {}),
    }),
  );
});

app.get("/internal/scenario-context", requireToken, (req: Request, res: Response) => {
  recordArrival("get_scenario_context");
  const loaded = loadState(state.getProjectPath());
  if (isUnavailable(loaded)) {
    res.json(loaded);
    return;
  }
  res.json(
    scenarioContext(loaded, {
      anchor: String(req.query["anchor"] ?? ""),
      ...(req.query["hops"] ? { hops: Number(req.query["hops"]) } : {}),
    }),
  );
});

/** 시험과 진단용 — 이 task 에서 두 증거원이 모두 관측된 tool 들 (B4). */
app.get("/api/tasks/:taskId/mcp-evidence", (req: Request, res: Response) => {
  const taskId = String(req.params["taskId"]);
  const task = state.getTask(taskId);
  if (!task) {
    res.status(404).json({ error: `task 를 찾을 수 없습니다: ${taskId}` });
    return;
  }
  res.json({
    taskId,
    calls: task.mcpCalls,
    toolsWithBothSources: state.toolsWithBothSources(taskId),
  });
});

// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/events" });

wss.on("connection", (socket) => {
  const unsubscribe = state.subscribe((envelope) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(envelope));
  });
  socket.on("close", unsubscribe);
});

server.listen(config.port, "127.0.0.1", () => {
  log(`listening on ${config.baseUrl}`);
  log(`mcp server = ${mcpServerPath}`);
});

onShutdown(async () => {
  log("shutting down");
  for (const adapter of adapters.values()) await adapter.dispose();
  server.close();
  process.exit(0);
});

export { app, config, state };
