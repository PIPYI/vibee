/**
 * bridge REST API 클라이언트 (implementation_plan §6.9 · §6.10).
 *
 * fetch 를 감싸기만 한다 — 상태는 여기 두지 않는다. Vite dev server 가 `/api`·`/events` 를
 * bridge 로 proxy 한다(vite.config.ts).
 */
import type {
  AgentId,
  AgentReadiness,
  CachedView,
  EvidenceIndex,
  GroundingStore,
  HealthResponse,
  McpCallRecord,
  OverviewIR,
  ProjectState,
  ReachabilityIR,
  ScenarioIR,
  SemanticMemory,
  SemanticVersion,
  TaskState,
  TraceIR,
  ViewAnchor,
  ViewKind,
} from "@onto/protocol";

export type Unavailable = { error: "memory_unavailable"; reason: string; next_step: string };

export function isUnavailable(value: unknown): value is Unavailable {
  return typeof value === "object" && value !== null && "error" in value;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

export function health(): Promise<HealthResponse> {
  return getJson("/api/health");
}

export type StateResponse = { projectPath: string | null; activeTaskId: string | null; tasks: TaskState[] };
export function bridgeState(): Promise<StateResponse> {
  return getJson("/api/state");
}

export function selectProject(projectPath: string): Promise<{ projectPath: string; initialized: boolean } | { error: string }> {
  return postJson("/api/project", { projectPath });
}

export type IndexResponse = {
  analysisVersion: number;
  semanticVersion: number;
  workSetSize: { dirtyEvidence: number; affectedConcepts: number; affectedClaims: number; ungroundedAppearedEvidence: number };
};
/** 결정론적 재인덱싱만. agent turn 없이 Trace를 바로 보여줄 때 쓴다(§6.6). */
export function indexOnly(projectPath: string): Promise<IndexResponse | { error: string }> {
  return postJson("/api/index", { projectPath });
}

export type AnalyzeResponse = { taskId: string } & IndexResponse;
export function analyze(
  agent: AgentId,
  projectPath: string,
  extra: { model?: string; effort?: string } = {},
): Promise<AnalyzeResponse | { error: string }> {
  return postJson("/api/analyze", { agent, projectPath, ...extra });
}

export function stopTask(taskId: string): Promise<{ ok: true } | { error: string }> {
  return postJson(`/api/tasks/${taskId}/stop`, {});
}

export type MemoryDigest = {
  generation: number;
  analysisVersion: number;
  semanticVersion: number;
  semanticReconciledAnalysisVersion: number;
  reconcileCurrent: boolean;
  counts: { concepts: number; claims: number; canonicalScenarios: number; evidence: number };
  evidenceByKind: Record<string, number>;
  topConcepts: Array<{ id: string; name: string; status: string; evidenceCount: number }>;
  canonicalScenarios: Array<{ id: string; name: string; type: "user" | "system" }>;
};
export function memoryDigest(): Promise<MemoryDigest | Unavailable> {
  return getJson("/api/memory");
}

export type FullMemory = {
  generation: number;
  project: ProjectState;
  memory: SemanticMemory;
  evidence: EvidenceIndex;
  grounding: GroundingStore;
  /** M13 Runtime Console — generation 이력. store가 이미 들고 있는 것을 그대로 내보낸다. */
  versions: SemanticVersion[];
};
export function fullMemory(): Promise<FullMemory | Unavailable> {
  return getJson("/api/memory?detail=full");
}

/** `describeEvidence`(bridge)가 만드는 모양. 실재 `Evidence`의 부분집합 + 렌더용 파생 필드. */
export type EvidenceView = {
  id: string;
  kind: string;
  origin: "engine" | "agent";
  status: "present" | "missing";
  filePath?: string;
  symbolId?: string;
  location?: { startLine: number; endLine?: number };
  summary?: string;
  confidence?: number;
  relocationConfidence?: "exact" | "degraded";
  missingSinceVersion?: number;
  /** 가장 최근 재인덱싱에서만 채워진다 — 없다고 "안 바뀌었다"는 뜻은 아니다 */
  relocated?: boolean;
  contentChange?: "unchanged" | "cosmetic" | "modified" | "appeared" | "missing";
  source?: string;
  sourceError?: string;
};
export type EvidenceQueryResponse = { total: number; returned: number; truncated: boolean; evidence: EvidenceView[] };

export function queryEvidence(query: {
  ids?: string[];
  filePath?: string;
  kind?: string;
  symbolId?: string;
  includeSource?: boolean;
  limit?: number;
}): Promise<EvidenceQueryResponse | Unavailable> {
  const params = new URLSearchParams();
  if (query.ids?.length) params.set("ids", query.ids.join(","));
  if (query.filePath) params.set("filePath", query.filePath);
  if (query.kind) params.set("kind", query.kind);
  if (query.symbolId) params.set("symbolId", query.symbolId);
  if (query.includeSource) params.set("includeSource", "true");
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return getJson(`/api/evidence${qs ? `?${qs}` : ""}`);
}

// ---------------------------------------------------------------------------
// Views (§6.4 · §6.6 · §6.9 [C])
// ---------------------------------------------------------------------------

export type ViewsRequest = {
  viewKind: ViewKind;
  anchor?: ViewAnchor;
  question?: string;
  scope?: { hops?: number; direction?: "both" | "outgoing" | "incoming" };
  /** schema2 §6 — viewKind가 "reachability"일 때만 쓴다. */
  reachDirection?: "upstream" | "downstream";
  agent?: AgentId;
  projectPath?: string;
};

export type ViewsPostResponse =
  | { viewKind: "trace"; ir: TraceIR }
  | { viewKind: "reachability"; ir: ReachabilityIR }
  | { viewKind: "overview" | "scenario"; cached: true; view: CachedView<OverviewIR | ScenarioIR> }
  | { viewKind: "overview" | "scenario"; taskId: string }
  | { error: string };

export function requestView(request: ViewsRequest): Promise<ViewsPostResponse> {
  return postJson("/api/views", request);
}

export type ViewsGetResponse =
  | { status: "starting" | "running" }
  | { status: "completed" | "interrupted" | "error"; view: CachedView<OverviewIR | ScenarioIR> }
  | { status: string; error: string };

export function fetchView(taskId: string): Promise<ViewsGetResponse> {
  return getJson(`/api/views/${taskId}`);
}

export function isTerminal(status: string): boolean {
  return status !== "starting" && status !== "running";
}

/** view turn 이 끝날 때까지 짧은 간격으로 다시 묻는다. bridge 는 이미 taskId 로 상태를 노출한다. */
export async function pollView(taskId: string, intervalMs = 800): Promise<ViewsGetResponse> {
  for (;;) {
    const result = await fetchView(taskId);
    if (isTerminal(result.status)) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Runtime Console (schema2 §3, M13) — onto 자신의 telemetry. Project Reader와
// 화면을 공유하지 않는다(I17)지만 API는 같은 bridge를 쓴다.
// ---------------------------------------------------------------------------

export type TaskMcpEvidence = { taskId: string; calls: McpCallRecord[]; toolsWithBothSources: string[] };
export function taskMcpEvidence(taskId: string): Promise<TaskMcpEvidence | { error: string }> {
  return getJson(`/api/tasks/${taskId}/mcp-evidence`);
}

export type { AgentReadiness };
