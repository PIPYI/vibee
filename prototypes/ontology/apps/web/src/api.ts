/**
 * bridge REST API 클라이언트 (implementation_plan §6.9 · §6.10).
 *
 * fetch 를 감싸기만 한다 — 상태는 여기 두지 않는다. Vite dev server 가 `/api`·`/events` 를
 * bridge 로 proxy 한다(vite.config.ts).
 */
import type {
  AgentId,
  AgentReadiness,
  AnalysisBundle,
  CachedView,
  HealthResponse,
  OverviewIR,
  ReachabilityIR,
  ScenarioIR,
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

/**
 * schema3 §6.2 — Overview/Scenario 경로는 웹 UI가 더 이상 부르지 않는다(§9). Reachability는
 * `Passport.tsx`의 온디맨드 drill-down으로 여전히 쓰인다(§7). Trace는 아직 프론트에서
 * 쓰지 않지만 엔드포인트는 살아 있다.
 */
export function requestView(request: ViewsRequest): Promise<ViewsPostResponse> {
  return postJson("/api/views", request);
}

// ---------------------------------------------------------------------------
// AnalysisBundle (schema3 §5.4) — 아키텍처/워크플로우/시퀀스 한 벌.
// ---------------------------------------------------------------------------

export type AnalysisBundleResponse = { bundle: AnalysisBundle } | { error: string };

/**
 * HEAD generation의 `analysis-bundle.json`을 읽기만 한다 — **LLM turn을 절대 열지 않는다**.
 * 탭 전환(아키텍처 ↔ 워크플로우)마다 이걸 다시 불러도 재분석이 일어나지 않는다.
 */
export function fetchAnalysisBundle(projectPath?: string): Promise<AnalysisBundleResponse> {
  const qs = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : "";
  return getJson(`/api/analysis-bundle${qs}`);
}

export type { AgentReadiness };
