/**
 * Agent · Bridge · 브라우저가 공유하는 wire 타입 (implementation_plan §6.9, B1~B8).
 *
 * byoa-mcp-spike가 검증한 3채널 분리를 그대로 따른다.
 *
 * ```text
 * Browser → Agent       = Agent Control   (HTTP → provider RPC)
 * Agent → Browser       = Event Streaming (provider 알림 → 정규화 → WebSocket)
 * Agent → App functions = MCP             (stdio MCP server → loopback HTTP → Bridge)
 * ```
 *
 * **이 파일은 OS를 알지 않는다.** 실행 파일 해석은 bridge의 platform 계층에만 있다.
 */

import type { SystemIntelligenceV4Mode, V4RolloutReport } from "./index.js";

export const BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 43220;

/**
 * Web과 Bridge가 같은 wire contract를 말하는지 확인하는 V4 handshake.
 *
 * `buildId`는 제품 버전 표기가 아니라 **실행 호환성 표식**이다. Web dev server는 소스를
 * hot reload하지만 Bridge 프로세스는 재시작 전까지 이전 모듈을 계속 들고 있을 수 있다.
 * 프로토콜 모양이 바뀌는 릴리스에서 이 값을 함께 올리면 그 조합을 분석 시작 전에 막는다.
 */
export const ONTO_PROTOCOL_VERSION = "4.0";
export const ONTO_BUILD_ID = "v4-system-intelligence-final-1";

export type RuntimeIdentity = {
  protocolVersion: string;
  buildId: string;
};

export type RuntimeCompatibility = RuntimeIdentity & {
  serverStartedAt: string;
  capabilities: string[];
};

/** 사용자의 Codex 설정에 이 MCP server가 등록될 이름. */
export const MCP_SERVER_NAME = "onto";

/** `/internal/*` 요청에 loopback 공유 비밀을 실어 보내는 헤더. */
export const BRIDGE_TOKEN_HEADER = "x-onto-token";

export type AgentId = "codex" | "claude";

/**
 * 이 turn이 무엇인지. adapter가 **격리 수준을 다르게** 잡는 데 쓴다 (B5).
 *
 * `analyze`는 프로젝트의 `AGENTS.md`/`CLAUDE.md`를 로드하지 않는다 — 그것은 기능1의 인계
 * 산출물이지 분석 turn의 규칙이 아니다. spike가 정확히 이 문제로 깨졌다(§14).
 *
 * `assembly`는 schema3 §5.2 Stage 3다 — `analyze`(Stage 2)가 끝난 뒤 같은 taskId 아래서
 * 이어진다(`runAnalyzePipeline`). `analyze`와 같은 이유로 `AGENTS.md`/`CLAUDE.md`를
 * 로드하지 않는다.
 */
export type TaskMode = "analyze" | "view" | "chat" | "assembly";

export type McpToolName =
  | "get_project_semantic_memory"
  | "get_concept_context"
  | "search_claims"
  | "get_evidence"
  | "get_scenario_context"
  | "get_impact_context"
  | "get_impact_context_batch"
  | "get_system_facts"
  | "get_incremental_analysis_context"
  | "propose_evidence"
  | "propose_system_facts"
  | "submit_semantic_patch"
  | "submit_view_ir"
  | "submit_analysis_bundle"
  | "patch_analysis_bundle";

/** MCP 호출이 관측된 경로. **두 증거원이 모두 있어야** 통과다 (B4). */
export type McpCallSource = "agent-stream" | "bridge-endpoint";

export type McpCallRecord = {
  tool: string;
  at: string;
  source: McpCallSource;
  /**
   * `bridge-endpoint` 호출에만 붙는다. **"불렸다"와 "데이터를 돌려줬다"는 다른 질문이다** —
   * 전자만 보면 `memory_unavailable` 을 받은 turn 도 통과한 것처럼 보인다.
   */
  outcome?: "data" | "unavailable";
};

export type AnalysisStage = "semantic" | "assembly" | "view" | "chat";

export type AnalysisPipelineStage = "indexing" | "semantic" | "retrieval" | "assembly" | "validation" | "commit";
export type AnalysisStageStatus = "pending" | "running" | "completed" | "correcting" | "failed";

export type AnalysisStageState = {
  stage: AnalysisPipelineStage;
  status: AnalysisStageStatus;
  startedAt?: string;
  endedAt?: string;
  /** heartbeat가 아니라 실제 provider/tool/validator 활동 시각이다. */
  lastActivityAt?: string;
  completedUnits?: number;
  totalUnits?: number;
  message?: string;
};

export type StageSessionRecord = {
  stage: AnalysisStage;
  sessionId: string;
  resumed: boolean;
  startedAt: string;
};

/**
 * 한 provider turn의 사용량. provider가 보고하지 않은 필드는 생략한다. 0으로 채우면
 * "사용하지 않음"과 "알 수 없음"을 구분할 수 없기 때문이다.
 */
export type StageUsage = {
  stage: AnalysisStage;
  turnId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  model?: string;
};

/**
 * provider에 종속되지 않는 이벤트 모델. Codex/Claude 프로토콜 객체는 bridge에서 이 union으로
 * 정규화되며 raw 상태로 브라우저에 도달하지 않는다.
 */
export type AgentEvent =
  | { type: "task.started"; taskId: string; agent: AgentId; projectPath: string; mode: TaskMode }
  | { type: "agent.session"; taskId: string; sessionId: string; resumed: boolean }
  | { type: "agent.message.delta"; taskId: string; text: string }
  | { type: "agent.action.started"; taskId: string; name: string; detail?: unknown }
  | { type: "agent.action.completed"; taskId: string; name: string; detail?: unknown }
  | { type: "mcp.tool.called"; taskId: string; tool: string; source: McpCallSource }
  /**
   * agent가 MCP가 아니라 **자기 native 도구**(shell/Read)로 파일을 직접 읽었다 (§7.3 index-only arm).
   * 강제로 막지 않고 관측만 한다 — Codex/Claude 양쪽에 파일 도구를 확실히 끊을 방법이 없다.
   */
  | { type: "agent.file.explored"; taskId: string; path: string }
  /** turn이 소비한 사용량. 같은 stage+turnId 이벤트는 최신 누적값으로 대체한다. */
  | ({ type: "agent.usage"; taskId: string } & StageUsage)
  | { type: "analysis.progress"; taskId: string; phase: string; message: string }
  | { type: "analysis.stage.updated"; taskId: string; state: AnalysisStageState }
  | {
      type: "analysis.heartbeat";
      taskId: string;
      stage: AnalysisPipelineStage;
      elapsedSeconds: number;
      idleSeconds: number;
    }
  | { type: "memory.patched"; taskId: string; semanticVersion: number; summary: string }
  | { type: "view.ready"; taskId: string; viewKind: string; requestId: string }
  /** schema3 §5.2 Stage 4 — AnalysisBundle이 검증을 통과해 generation에 커밋되었다. */
  | { type: "bundle.ready"; taskId: string; generation: number; correctedAttempts?: number }
  | {
      type: "validation.retrying";
      taskId: string;
      tool: string;
      attempt: number;
      maxAttempts: number;
      diagnostics: unknown[];
    }
  | { type: "validation.failed"; taskId: string; tool: string; diagnostics: unknown[] }
  | { type: "task.completed"; taskId: string }
  | { type: "task.interrupted"; taskId: string }
  | { type: "task.error"; taskId: string; message: string };

/** 전송되는 모든 이벤트는 단조 증가하는 seq와 타임스탬프를 함께 갖는다. */
export type AgentEventEnvelope = {
  seq: number;
  at: string;
  event: AgentEvent;
};

export type TaskStatus = "starting" | "running" | "completed" | "interrupted" | "error";

export type TaskState = {
  taskId: string;
  agent: AgentId;
  projectPath: string;
  mode: TaskMode;
  prompt: string;
  status: TaskStatus;
  model?: string;
  effort?: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** 이 task에서 관측된 MCP 호출. **두 증거원을 따로 기록한다** (B4) */
  mcpCalls: McpCallRecord[];
  /** native 도구(shell/Read)로 직접 읽은 파일 경로 (중복 없음). §7.3 index-only arm이 "탐색했는가"를 여기서 잰다 */
  exploredFiles: string[];
  /** 호환용 task 합계. StageUsage 중 provider가 보고한 total만 합산한다. */
  tokenUsage?: number;
  /** V3: Semantic/Assembly/View turn을 덮어쓰지 않고 별도로 보존한다. */
  stageUsages?: StageUsage[];
  /** V3.2: 새로고침 뒤에도 분석 진행 화면을 복원하는 Stage ledger. */
  stageStates?: AnalysisStageState[];
  /** 실제 provider session을 Stage별로 남겨 세션 분리를 런타임에서 검증한다. */
  stageSessions?: StageSessionRecord[];
  /** AnalysisBundle 제출이 Core 검증으로 자동 보정된 횟수. */
  validationCorrections?: number;
  /** 최초 제출을 포함해 Core validator가 실제로 받은 Bundle 제출 횟수. */
  validationAttempts?: number;
  /** 이 task에서 실제 커밋된 generation. 없으면 Assembly 성공으로 간주하지 않는다. */
  bundleGeneration?: number;
  /** V4 Phase 8 — 완료된 분석의 비용·coverage·shadow 비교. */
  rolloutReport?: V4RolloutReport;
};

/**
 * reasoning effort 하나. id는 provider가 쓰는 원문 값이다.
 *
 * **화이트리스트를 두지 않는다** — provider가 새 단계를 추가하면 우리 목록이 먼저 낡고,
 * 걸러진 값은 조용히 무시되어 원인을 찾기 어렵다. 잘못된 값은 provider가 거부하게 둔다.
 */
export type EffortOption = { id: string; description?: string };

export type ModelOption = {
  id: string;
  label: string;
  description?: string;
  efforts: EffortOption[];
  defaultEffort?: string;
  isDefault: boolean;
};

export type AgentReadiness = {
  agent: AgentId;
  installed: boolean;
  authenticated: boolean | "unknown";
  version?: string;
  /** 쓸 수 없을 때 사람이 읽을 수 있는 사유 */
  message?: string;
};

export type SessionSummary = {
  id: string;
  preview: string;
  updatedAt: string;
  /** bridge가 지금 이 세션을 물고 있는지 */
  active: boolean;
};

export type HealthResponse = {
  ok: boolean;
  agents: AgentReadiness[];
  projectPath: string | null;
  runtime: RuntimeCompatibility;
  features?: { systemIntelligenceV4: SystemIntelligenceV4Mode };
};

// ---------------------------------------------------------------------------
// 브라우저 <-> Bridge HTTP API
// ---------------------------------------------------------------------------

export type AnalyzeRequest = {
  agent: AgentId;
  projectPath: string;
  /** Web과 Bridge가 같은 wire contract인지 server가 요청 시점에 다시 검증한다. */
  clientRuntime?: RuntimeIdentity;
  /** `index-only`는 §7.3의 비교 arm이다. 저장소 탐색 없이 evidence 요약만 준다 */
  mode?: "full" | "incremental" | "index-only";
  gitBase?: string;
  model?: string;
  effort?: string;
};

export type ErrorResponse = { error: string };
