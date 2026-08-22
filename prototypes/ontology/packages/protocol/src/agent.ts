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

export const BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 43220;

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
 */
export type TaskMode = "analyze" | "view" | "chat";

export type McpToolName =
  | "get_project_semantic_memory"
  | "get_concept_context"
  | "search_claims"
  | "get_evidence"
  | "get_scenario_context"
  | "get_impact_context"
  | "propose_evidence"
  | "submit_semantic_patch"
  | "submit_view_ir";

/** MCP 호출이 관측된 경로. **두 증거원이 모두 있어야** 통과다 (B4). */
export type McpCallSource = "agent-stream" | "bridge-endpoint";

export type McpCallRecord = {
  tool: string;
  at: string;
  source: McpCallSource;
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
  | { type: "analysis.progress"; taskId: string; phase: string; message: string }
  | { type: "memory.patched"; taskId: string; semanticVersion: number; summary: string }
  | { type: "view.ready"; taskId: string; viewKind: string; requestId: string }
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
};

// ---------------------------------------------------------------------------
// 브라우저 <-> Bridge HTTP API
// ---------------------------------------------------------------------------

export type AnalyzeRequest = {
  agent: AgentId;
  projectPath: string;
  /** `index-only`는 §7.3의 비교 arm이다. 저장소 탐색 없이 evidence 요약만 준다 */
  mode?: "full" | "incremental" | "index-only";
  gitBase?: string;
  model?: string;
  effort?: string;
};

export type ErrorResponse = { error: string };
