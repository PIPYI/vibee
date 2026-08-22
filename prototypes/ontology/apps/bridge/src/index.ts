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
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AnalyzeSession,
  SemanticStore,
  commitPatch,
  hasError,
  initialProjectState,
  projectTrace,
  validateViewIR,
  type LoadedState,
} from "@onto/core";
import {
  buildWorkSet,
  carryAgentEvidence,
  carryMissingEvidence,
  diffEvidence,
  indexProject,
  type AgentCarryReport,
} from "@onto/evidence";
import type {
  AgentEvent,
  AgentId,
  AgentReadiness,
  AnalyzeRequest,
  CachedView,
  EvidenceProposal,
  HealthResponse,
  OverviewIR,
  ScenarioIR,
  SemanticPatch,
  SemanticWorkSet,
  TaskMode,
  ViewKind,
  ViewRequest,
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
  buildEvidenceBundle,
  buildOverviewPrompt,
  buildScenarioPrompt,
  buildVerifyPrompt,
  selectAnalyzePrompt,
} from "./prompt.js";
import { BridgeState } from "./state.js";
import { hashViewRequest, viewCacheKeyString, VIEW_PLANNER_VERSION } from "./view.js";

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
 * 브라우저용 Semantic Memory 읽기 (§6.10 apps/web).
 *
 * `/internal/memory`와 같은 데이터를 쓰지만 **토큰 가드가 없다** — 그것은 MCP server
 * 전용 경계(B1)이지 브라우저를 막으려는 것이 아니다. 브라우저는 bridge의 첫째 클라이언트다.
 */
app.get("/api/memory", (req: Request, res: Response) => {
  const loaded = loadState(state.getProjectPath());
  if (isUnavailable(loaded)) {
    res.json(loaded);
    return;
  }
  res.json(req.query["detail"] === "full" ? loaded : memoryDigest(loaded));
});

/**
 * 브라우저용 Evidence 조회 — hover/click 시 `file:line`·소스 발췌를 렌더 시점에 resolve한다
 * (§6.4 V2, §6.10 "View IR에 굳어 있지 않고 렌더 시점에 Evidence Store에서 resolve된다").
 *
 * `relocated`/`contentChange`는 `evidence.json`에 남지 않는 순간의 판정이므로(§6.2 T1)
 * **가장 최근 재인덱싱의 결과에서만** 붙는다 — bridge 가 재시작되었거나 그 evidence가
 * 이번 재인덱싱에서 다뤄지지 않았으면 없다. 없다고 "안 바뀌었다"는 뜻은 아니다.
 */
app.get("/api/evidence", (req: Request, res: Response) => {
  const projectPath = state.getProjectPath();
  const loaded = loadState(projectPath);
  if (isUnavailable(loaded)) {
    res.json(loaded);
    return;
  }
  const idsParam = req.query["ids"];
  const ids = typeof idsParam === "string" ? idsParam.split(",").filter(Boolean) : undefined;
  const result = queryEvidence(loaded, projectPath!, {
    ...(ids ? { ids } : {}),
    ...(req.query["filePath"] ? { filePath: String(req.query["filePath"]) } : {}),
    ...(req.query["kind"] ? { kind: String(req.query["kind"]) } : {}),
    ...(req.query["symbolId"] ? { symbolId: String(req.query["symbolId"]) } : {}),
    includeSource: req.query["includeSource"] === "true",
    ...(req.query["limit"] ? { limit: Number(req.query["limit"]) } : {}),
  });
  const evidenceList = result["evidence"] as Array<Record<string, unknown>>;
  for (const item of evidenceList) {
    const diff = state.getLastEvidenceDiff(String(item["id"]));
    if (diff) {
      item["relocated"] = diff.relocated;
      item["contentChange"] = diff.contentChange;
    }
  }
  res.json(result);
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
    // **세션을 열지 않는다** — agent turn 이 없으므로 AnalyzeTransaction 이 필요 없다.
    // `reindex()` 를 쓰면 존재하지 않는 task 에 세션이 묶여 정리되지 않고 남는다.
    const store = new SemanticStore(projectPath);
    const { after, nextVersion, work } = await performReindex(store, projectPath, body.gitBase);
    res.json({
      analysisVersion: nextVersion,
      semanticVersion: after.project.semanticVersion,
      workSetSize: {
        dirtyEvidence: work.dirtyEvidence.length,
        affectedConcepts: work.affectedConceptIds.length,
        affectedClaims: work.affectedClaimIds.length,
        ungroundedAppearedEvidence: work.ungroundedAppearedEvidenceIds.length,
      },
    });
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
    const prepared = await reindex(projectPath, taskId, body.gitBase, body.mode);
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
      exploredFiles: [],
    });
    res.json({ taskId, ...prepared.summary });
    void runTask(adapter, taskId, projectPath, prepared.prompt, "analyze", body);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
  }
});

/** 참조된 파일만 읽는다 (S1 relocation의 창 검색 대상). 실패는 null — carryAgentEvidence가 missing 으로 접는다 */
function readProjectFile(projectPath: string): (relPath: string) => string | null {
  return (relPath) => {
    try {
      return readFileSync(join(projectPath, relPath), "utf8");
    } catch {
      return null;
    }
  };
}

type ReindexOutcome = {
  after: LoadedState;
  nextVersion: number;
  work: SemanticWorkSet;
  agentCarry: AgentCarryReport;
};

/**
 * 커밋 1 — Repository re-index (§6.9).
 *
 * ```text
 * analysisVersion++
 * semanticVersion 유지
 * semanticReconciledAnalysisVersion:
 *   SemanticWorkSet 이 비어 있으면 → 새 analysisVersion 으로 advance
 *   있으면                        → 기존 값 유지
 * ```
 *
 * **순서가 중요하다** (S1 · T1) — diff 는 "지금 실제로 있는 것"과 비교해야 한다.
 * `carryAgentEvidence` 가 먼저 agent evidence 를 relocate 하고, 그 결과를 `diffEvidence` 가
 * 보고, **그 다음에** `carryMissingEvidence` 가 사라진 것을 `missing` 으로 채운다. 순서를
 * 바꾸면 사라진 근거가 `unchanged` 로 분류되는 조용한 부패가 생긴다 — M4 시험이 실제로
 * 이 순서를 걸고 있다.
 *
 * `AnalyzeSession`을 열지 않는다 — 그것은 agent turn 을 태우는 `reindex()` 의 몫이다.
 * `/api/index`(index-only) 는 세션이 필요 없다.
 */
async function performReindex(
  store: SemanticStore,
  projectPath: string,
  gitBase: string | undefined,
): Promise<ReindexOutcome> {
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
  const { index: withAgent, report: agentCarry } = carryAgentEvidence(
    before.evidence,
    fresh,
    readProjectFile(projectPath),
  );
  const diffs = diffEvidence(before.evidence, withAgent);
  const withMissing = carryMissingEvidence(before.evidence, withAgent);
  const work = buildWorkSet(diffs, before.memory, before.grounding);
  const workEmpty =
    work.dirtyEvidence.length === 0 && work.ungroundedAppearedEvidenceIds.length === 0;

  const after = await store.commit("repository re-index", "index", (snapshot) => {
    snapshot.project.analysisVersion = nextVersion;
    // 의미는 아직 아무것도 바뀌지 않았다.
    if (workEmpty) {
      // 포매팅만 바뀐 경우다. agent 를 부르지 않고 reconcile 을 따라잡는다 (V1).
      snapshot.project.semanticReconciledAnalysisVersion = nextVersion;
    }
    snapshot.evidence = withMissing;
    return snapshot;
  });

  // 뷰어의 grounding 배지가 본다 — evidence.json 에는 이 분류가 남지 않는다(§6.2 T1).
  state.setLastEvidenceDiffs(diffs);

  return { after, nextVersion, work, agentCarry };
}

/**
 * 프로젝트를 재인덱싱하고, agent turn 을 위한 프롬프트와 **새 AnalyzeSession** 을 연다.
 *
 * 세션은 `taskId` 에 묶여 `state` 에 저장된다 — `/internal/propose-evidence` ·
 * `/internal/semantic-patch` 가 `state.getActiveTaskId()` 로 이것을 찾는다.
 */
async function reindex(
  projectPath: string,
  taskId: string,
  gitBase: string | undefined,
  mode?: AnalyzeRequest["mode"],
): Promise<{ prompt: string; summary: Record<string, unknown> }> {
  const store = new SemanticStore(projectPath);
  const before = store.isInitialized() ? store.load() : undefined;
  const { after, nextVersion, work, agentCarry } = await performReindex(store, projectPath, gitBase);

  state.setAnalyzeSession(
    taskId,
    new AnalyzeSession(taskId, projectPath, { baseAnalysisVersion: nextVersion, index: after.evidence }),
  );
  state.setDirtyEvidenceCount(taskId, work.dirtyEvidence.length);

  state.emit({
    type: "analysis.progress",
    taskId,
    phase: "indexed",
    message:
      `analysisVersion ${nextVersion} · dirty ${work.dirtyEvidence.length} · ` +
      `새 근거 ${work.ungroundedAppearedEvidenceIds.length} · ` +
      `agent evidence relocate ${agentCarry.relocated.length} (missing ${agentCarry.missing.length})`,
  });

  const isFirst = (before?.project.semanticVersion ?? 0) === 0 && (before?.memory.concepts.length ?? 0) === 0;
  const prompt = selectAnalyzePrompt(mode, isFirst, projectPath, work, buildEvidenceBundle(after.evidence));

  return {
    prompt,
    summary: {
      analysisVersion: nextVersion,
      semanticVersion: after.project.semanticVersion,
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
    if (event.type === "agent.file.explored") {
      state.recordExploredFile(taskId, event.path);
    }
    if (event.type === "agent.usage") {
      state.setTokenUsage(taskId, event.totalTokens);
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
  } finally {
    // **turn이 어떻게 끝났든** transaction을 버린다 (§6.5 S2) — 반쯤 쓰인 evidence는 없다.
    // 이미 `/api/tasks/:id/stop`이 지웠다면 여기서는 아무것도 하지 않는다(idempotent).
    state.disposeAnalyzeSession(taskId, `task ${mode} ended`);
    // view turn 이 무엇을 만들려 했는지도 마찬가지로 정리한다. 성공한 제출은 이미
    // `viewResultsByTask`에 별도로 남아 있으므로 여기서 지워도 결과는 사라지지 않는다.
    state.clearPendingViewRequest(taskId);
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
    exploredFiles: [],
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
  // **stop이 transaction을 폐기한다** (§6.5 S2) — adapter가 실제로 멈추는 것을 기다리지
  // 않는다. `runTask`의 `finally`가 나중에 같은 것을 다시 부르지만 idempotent라 안전하다.
  state.disposeAnalyzeSession(taskId, "stopped by user");
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

type ViewsRequestBody = ViewRequest & {
  agent?: AgentId;
  projectPath?: string;
  model?: string;
  effort?: string;
};

/**
 * 캐시된 View의 freshness는 **읽는 시점에 다시 계산한다** — 캐시에 써 둔 값을 그대로
 * 믿지 않는다. 코드가 그 사이에 더 바뀌었을 수 있고, `reconcile` 상태는 언제든 최신이어야
 * 한다(§6.4 V2).
 */
function withCurrentFreshness(
  cached: CachedView<OverviewIR | ScenarioIR>,
  head: LoadedState,
): CachedView<OverviewIR | ScenarioIR> {
  const freshness =
    head.project.semanticReconciledAnalysisVersion >= head.project.analysisVersion ? "current" : "needs_review";
  return { ...cached, freshness };
}

/**
 * `POST /api/views` — Trace는 동기(§6.6 R4), Overview/Scenario는 캐시 우선(§6.4 V2),
 * 캐시가 없으면 view turn을 연다(§6.9 [C]).
 */
app.post("/api/views", async (req: Request, res: Response) => {
  const body = req.body as ViewsRequestBody;
  if (body?.viewKind !== "trace" && body?.viewKind !== "overview" && body?.viewKind !== "scenario") {
    res.status(400).json({ error: `지원하지 않는 viewKind: ${String(body?.viewKind)}` });
    return;
  }

  let projectPath: string;
  try {
    projectPath = canonicalizeProjectPath(String(body.projectPath ?? state.getProjectPath() ?? ""));
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const store = new SemanticStore(projectPath);
  if (!store.isInitialized()) {
    res.status(412).json({ error: "프로젝트가 아직 인덱싱되지 않았습니다. 먼저 분석을 실행하세요." });
    return;
  }
  const head = store.load();

  // --- Trace — Core가 동기로 투영한다. agent turn이 없다 (§6.6 R4) --------------
  if (body.viewKind === "trace") {
    if (!body.anchor) {
      res.status(400).json({ error: "viewKind \"trace\" 는 anchor 가 필요합니다." });
      return;
    }
    const ir = projectTrace(head.evidence, body.anchor, {
      ...(body.scope?.hops !== undefined ? { hops: body.scope.hops } : {}),
      ...(body.scope?.direction ? { direction: body.scope.direction } : {}),
      memory: head.memory,
      grounding: head.grounding,
    });
    res.json({ viewKind: "trace", ir });
    return;
  }

  // --- Overview/Scenario — 캐시 우선, 없으면 turn (§6.4 V2) --------------------
  const requestHash = hashViewRequest(body);
  const cacheKey = viewCacheKeyString(body.viewKind, head.project.semanticVersion, requestHash);
  const cached = state.getViewCache(cacheKey);
  if (cached) {
    res.json({ viewKind: body.viewKind, cached: true, view: withCurrentFreshness(cached, head) });
    return;
  }

  const adapter = adapters.get(body.agent as AgentId);
  if (!adapter) {
    res.status(400).json({ error: `지원하지 않는 agent: ${String(body.agent)}` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "이미 실행 중인 task 가 있습니다. 먼저 중지하세요." });
    return;
  }
  const ready = await adapter.checkReady();
  if (!ready.installed) {
    res.status(412).json({ error: ready.message ?? "agent 를 쓸 수 없습니다." });
    return;
  }

  state.setProjectPath(projectPath);
  const taskId = randomUUID();
  const prompt =
    body.viewKind === "overview" ? buildOverviewPrompt(projectPath, body) : buildScenarioPrompt(projectPath, body);

  state.setPendingViewRequest(taskId, {
    viewKind: body.viewKind,
    semanticVersion: head.project.semanticVersion,
    requestHash,
  });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    mode: "view",
    prompt,
    status: "starting",
    ...(body.model ? { model: body.model } : {}),
    ...(body.effort ? { effort: body.effort } : {}),
    startedAt: new Date().toISOString(),
    mcpCalls: [],
    exploredFiles: [],
  });
  res.json({ viewKind: body.viewKind, taskId });
  void runTask(adapter, taskId, projectPath, prompt, "view", body as AnalyzeRequest);
});

/**
 * view turn이 끝난 뒤 결과를 가져온다. **taskId로 찾는다** — `POST /api/views`가 turn을
 * 열면서 돌려준 `taskId`를 그대로 쓴다(B8과 같은 이유로, 다른 turn의 결과를 오인하지 않는다).
 */
app.get("/api/views/:id", (req: Request, res: Response) => {
  const taskId = String(req.params["id"]);
  const task = state.getTask(taskId);
  if (!task) {
    res.status(404).json({ error: `task 를 찾을 수 없습니다: ${taskId}` });
    return;
  }
  if (task.status === "starting" || task.status === "running") {
    res.json({ status: task.status });
    return;
  }
  const cached = state.getViewResultForTask(taskId);
  if (!cached) {
    res.status(404).json({
      status: task.status,
      error:
        task.status === "completed"
          ? "이 turn 은 view 를 제출하지 않고 끝났습니다."
          : (task.error ?? "이 turn 은 view 를 만들지 못했습니다."),
    });
    return;
  }
  const head = new SemanticStore(task.projectPath).load();
  res.json({ status: task.status, view: withCurrentFreshness(cached, head) });
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
  // **transaction 의 pendingEvidence 도 보인다** (§6.5) — 검증된 제안은 이 task 안에서
  // 즉시 grounding 할 수 있어야 self-deadlock 이 생기지 않는다.
  const taskId = state.getActiveTaskId();
  const pending = taskId ? state.getAnalyzeSession(taskId)?.transaction.pendingEvidence ?? [] : [];
  res.json(queryEvidence(loaded, projectPath!, req.body ?? {}, pending));
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

/**
 * `propose_evidence` (§6.5 R2 · S1). Core 가 검증하고 id 를 발급한다 — agent 는 id 를 직접
 * 쓰지 않는다. **transaction 이 없으면 lazy/degraded 로 답한다** (C5) — analyze turn 밖에서
 * 부르면 실패가 아니라 무엇을 해야 하는지 말해 준다.
 */
app.post("/internal/propose-evidence", requireToken, (req: Request, res: Response) => {
  recordArrival("propose_evidence");
  const taskId = state.getActiveTaskId();
  const session = taskId ? state.getAnalyzeSession(taskId) : undefined;
  if (!taskId || !session) {
    res.json({
      error: "no_active_transaction",
      next_step: "analyze turn 이 진행 중일 때만 propose_evidence 를 쓸 수 있습니다.",
    });
    return;
  }

  const outcome = session.transaction.propose(req.body as EvidenceProposal);
  if (!outcome.ok) {
    state.emit({ type: "validation.failed", taskId, tool: "propose_evidence", diagnostics: outcome.diagnostics });
    res.json({ ok: false, diagnostics: outcome.diagnostics });
    return;
  }
  res.json({ ok: true, evidence: outcome.value, diagnostics: outcome.diagnostics });
});

/**
 * `submit_semantic_patch` (§6.3 Validator ⓪~⑤). 실패하면 `{ok:false, diagnostics}` —
 * 같은 turn 에서 고쳐 다시 제출할 수 있다.
 *
 * **T3** — `evidence/file-changed-during-turn` 이 나면 여기서 재인덱싱하고 같은 session 에
 * 새 transaction 을 연다. `performReindex` 는 비동기이므로 **먼저 실행해 결과를 만들고**,
 * `AnalyzeSession.restartAfterRace` 에는 이미 계산된 값을 동기로 돌려주는 클로저만 넘긴다 —
 * Core 의 동기 API 를 바꾸지 않고 T3 를 완성하는 최소 변경이다.
 */
app.post("/internal/semantic-patch", requireToken, async (req: Request, res: Response) => {
  recordArrival("submit_semantic_patch");
  const projectPath = state.getProjectPath();
  const taskId = state.getActiveTaskId();
  const session = taskId ? state.getAnalyzeSession(taskId) : undefined;
  if (!projectPath || !taskId || !session) {
    res.json({
      error: "no_active_transaction",
      next_step: "analyze turn 이 진행 중일 때만 submit_semantic_patch 를 쓸 수 있습니다.",
    });
    return;
  }

  const store = new SemanticStore(projectPath);
  const head = store.load();
  const dirtyEvidenceCount = state.getDirtyEvidenceCount(taskId);

  const outcome = await commitPatch(store, {
    head,
    transaction: session.transaction,
    patch: req.body as SemanticPatch,
    ...(dirtyEvidenceCount !== undefined ? { dirtyEvidenceCount } : {}),
  });

  if (outcome.ok) {
    state.emit({
      type: "memory.patched",
      taskId,
      semanticVersion: outcome.value.semanticVersion,
      summary: `concept +${outcome.value.diffSummary.conceptsAdded.length} · claim +${outcome.value.diffSummary.claimsAdded.length}`,
    });
    res.json({ ok: true, ...outcome.value, diagnostics: outcome.diagnostics });
    return;
  }

  const raceDiagnostic = outcome.diagnostics.find(
    (item) => item.code === "evidence/file-changed-during-turn",
  );
  if (raceDiagnostic) {
    const changedFiles = (raceDiagnostic.evidence["changedFiles"] as string[] | undefined) ?? [];
    // performReindex 는 비동기다 — **먼저 실행하고** 결과만 동기 클로저로 넘긴다.
    const reindexed = await performReindex(store, projectPath, undefined);
    state.setDirtyEvidenceCount(taskId, reindexed.work.dirtyEvidence.length);

    const restarted = session.restartAfterRace(changedFiles, () => ({
      baseAnalysisVersion: reindexed.nextVersion,
      index: reindexed.after.evidence,
    }));
    state.emit({
      type: "validation.failed",
      taskId,
      tool: "submit_semantic_patch",
      diagnostics: restarted.diagnostics,
    });
    res.json({
      ok: false,
      diagnostics: restarted.diagnostics,
      ...(restarted.ok ? { baseAnalysisVersion: restarted.value.baseAnalysisVersion } : {}),
      discardedProposals: session.lastDiscarded,
    });
    return;
  }

  state.emit({ type: "validation.failed", taskId, tool: "submit_semantic_patch", diagnostics: outcome.diagnostics });
  res.json({ ok: false, diagnostics: outcome.diagnostics });
});

/**
 * `submit_view_ir` (§6.6~§6.8). Trace는 여기로 오지 않는다 — Core가 동기로 투영하고
 * `submit_view_ir`을 받지 않는다(§6.6). `SemanticStore`에 커밋하지 않는다 — View는
 * cache일 뿐이다(§6.4). **transaction이 없으면 lazy/degraded로 답한다** (C5) — view turn
 * 밖에서 부르면 실패가 아니라 무엇을 해야 하는지 말해 준다.
 */
app.post("/internal/submit-view-ir", requireToken, (req: Request, res: Response) => {
  recordArrival("submit_view_ir");
  const projectPath = state.getProjectPath();
  const taskId = state.getActiveTaskId();
  const pending = taskId ? state.getPendingViewRequest(taskId) : undefined;
  if (!projectPath || !taskId || !pending) {
    res.json({
      error: "no_active_transaction",
      next_step: "view turn 이 진행 중일 때만 submit_view_ir 를 쓸 수 있습니다.",
    });
    return;
  }

  const body = req.body as { viewKind?: ViewKind; ir?: unknown };
  if (body.viewKind !== pending.viewKind) {
    res.json({
      ok: false,
      diagnostics: [
        {
          code: "view/wrong-kind",
          severity: "error",
          message: `이 turn 은 "${pending.viewKind}" 를 요청받았는데 "${String(body.viewKind)}" 를 제출했습니다.`,
          subject: {},
          evidence: { expected: pending.viewKind, got: body.viewKind },
          supportedFixes: [`viewKind 를 "${pending.viewKind}" 로 맞춘다`],
        },
      ],
    });
    return;
  }

  const head = new SemanticStore(projectPath).load();
  const result =
    pending.viewKind === "overview"
      ? validateViewIR({ viewKind: "overview", ir: body.ir, memory: head.memory })
      : validateViewIR({ viewKind: "scenario", ir: body.ir, memory: head.memory, evidence: head.evidence });

  if (hasError(result.diagnostics) || !result.ir) {
    state.emit({ type: "validation.failed", taskId, tool: "submit_view_ir", diagnostics: result.diagnostics });
    res.json({ ok: false, diagnostics: result.diagnostics });
    return;
  }

  const cacheKey = viewCacheKeyString(pending.viewKind, pending.semanticVersion, pending.requestHash);
  const cached: CachedView<OverviewIR | ScenarioIR> = {
    key: {
      viewKind: pending.viewKind,
      semanticVersion: pending.semanticVersion,
      plannerVersion: VIEW_PLANNER_VERSION,
      requestHash: pending.requestHash,
    },
    freshness:
      head.project.semanticReconciledAnalysisVersion >= head.project.analysisVersion ? "current" : "needs_review",
    builtAt: new Date().toISOString(),
    ir: result.ir,
  };
  state.setViewCache(cacheKey, cached);
  state.setViewResultForTask(taskId, cacheKey);
  state.emit({ type: "view.ready", taskId, viewKind: pending.viewKind, requestId: cacheKey });
  res.json({ ok: true, diagnostics: result.diagnostics });
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

/**
 * `node dist/index.js` 로 직접 실행될 때만 듣기 시작한다.
 *
 * 이 모듈을 **import** 만 하는 시험(예: 실제 route handler 를 검증하는 M4 wiring 시험)이
 * side effect 로 포트를 물게 되면, 그 listener 는 시험이 끝난 뒤에도 살아남아 이벤트 루프를
 * 막는다 — `server`·`wss` 는 여기서만 만들어지므로 밖에서 닫을 방법도 없다. 표준적인
 * "entrypoint side effect 를 진입점 검사로 가드한다" 패턴이고, `npm start`/`npm run bridge`
 * 로 실행하는 정상 경로의 동작은 바뀌지 않는다.
 */
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  // 이전 bridge가 아직 그 포트를 물고 있는 흔한 경우를 **읽을 수 있는 오류**로 바꾼다.
  // 그러지 않으면 Node가 처리되지 않은 'error' 이벤트로 스택트레이스를 던지고 죽는다 —
  // 원인(포트 충돌)도 다음 행동(`npm run bridge:stop`)도 그 안에서 알 수 없다.
  //
  // **`server`와 `wss` 양쪽에 건다.** `ws`가 기존 `server`에 붙을 때 자신도 그 오류를
  // 따로 재발행한다 — `server`에만 걸면 `wss`가 "처리되지 않은 'error' 이벤트"로 여전히
  // 죽는다(둘 다 EventEmitter라 리스너가 없는 쪽이 각자 예외를 던진다).
  const onListenError = (error: NodeJS.ErrnoException): void => {
    if (error.code === "EADDRINUSE") {
      log(`포트 ${config.port}을 이미 다른 프로세스가 쓰고 있습니다.`);
      log("이전 bridge가 완전히 종료되지 않았을 수 있습니다 (npm의 중첩 스크립트에서");
      log("Ctrl+C가 안쪽 프로세스까지 전달되지 않는 경우가 있습니다).");
      log("`npm run bridge:stop`으로 정리한 뒤 다시 시도하세요.");
      process.exit(1);
    }
    throw error;
  };
  server.once("error", onListenError);
  wss.once("error", onListenError);

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
}

export { app, config, server, state };
