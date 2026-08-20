/**
 * 브라우저 · local bridge · MCP server가 공유하는 wire 타입.
 *
 * 브라우저 번들이 이 모듈을 import 하므로 Node 내장 모듈을 쓰면 안 된다.
 * 파일시스템·설정 관련 헬퍼는 `@byoa/protocol/node`에 둔다.
 */

export const BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 43120;

/** 사용자의 Codex 설정에 이 MCP server가 등록될 이름. */
export const MCP_SERVER_NAME = "byoa-spike";

/** `/internal/*` 요청에 loopback 공유 비밀을 실어 보내는 헤더. */
export const BRIDGE_TOKEN_HEADER = "x-byoa-token";

export type AgentId = "codex" | "claude";

export type SelectedItem = {
  id: string;
  label: string;
};

/**
 * agent가 `get_app_context` MCP tool을 호출했을 때 보게 되는 값.
 * docs/BYOA_MCP_INTEGRATION_SPIKE.md §9의 형태를 따른다.
 */
export type AppContext = {
  projectPath: string;
  prompt: string;
  selectedItem: SelectedItem | null;
  /** 인터뷰 spike용. agent가 지금까지의 문답을 여기서 읽는다. */
  interview: InterviewState;
  metadata: {
    source: "byoa-mcp-spike";
    timestamp: string;
  };
};

/** agent가 `show_result` MCP tool로 앱에 되돌려 보내는 payload (§10). */
export type ShowResultInput = {
  title: string;
  summary: string;
  status: "success" | "warning" | "error";
  filesChanged?: string[];
  details?: string[];
};

export type McpToolName = "get_app_context" | "show_result" | "ask_user";

/**
 * agent가 `ask_user` MCP tool로 던지는 질문 (docs/requirements_flow.md §4.3).
 *
 * 이 tool은 **블로킹하지 않는다.** 질문을 등록만 하고 즉시 반환하며, agent는 곧바로 turn을
 * 끝낸다. MCP tool 호출에는 하드 월클럭 타임아웃이 있어 사람의 답을 기다릴 수 없기 때문이다.
 * 답변은 다음 turn에서 `get_app_context`로 읽는다.
 */
export type AskUserInput = {
  question: string;
  /** 왜 묻는지. 비전공자가 불안해하지 않도록. */
  why?: string;
  /** 선택지가 아니라 **예시**. 백지를 마주하는 부담만 덜어준다. */
  hints?: string[];
  progress?: { step: number; total: number };
};

export type PendingQuestion = AskUserInput & {
  id: string;
  askedAt: string;
};

export type InterviewExchange = {
  question: string;
  answer: string;
  answeredAt: string;
};

/** 인터뷰 진행 상태. `get_app_context`에 실려 agent가 앞선 문답을 확인한다. */
export type InterviewState = {
  pending: PendingQuestion | null;
  exchanges: InterviewExchange[];
};

/**
 * provider에 종속되지 않는 이벤트 모델 (§15). Codex 프로토콜 객체는 bridge에서
 * 이 union으로 정규화되며, raw 상태로 브라우저에 도달하지 않는다.
 */
export type AgentEvent =
  | { type: "task.started"; taskId: string; agent: AgentId; projectPath: string }
  /**
   * 이 task가 어느 세션에서 도는지. `resumed: false`면 새로 만들어진 세션이고,
   * `true`면 같은 프로젝트에서 이전 turn을 이어받은 것이다. 브라우저가 "새 대화인지
   * 이어지는 대화인지"를 보여주는 근거가 된다.
   */
  | { type: "agent.session"; taskId: string; sessionId: string; resumed: boolean }
  | { type: "agent.message.delta"; taskId: string; text: string }
  | { type: "agent.action.started"; taskId: string; name: string; detail?: unknown }
  | { type: "agent.action.completed"; taskId: string; name: string; detail?: unknown }
  | { type: "mcp.tool.called"; taskId: string; tool: McpToolName | string; source: "agent-stream" | "bridge-endpoint" }
  | { type: "app.result"; taskId: string; result: ShowResultInput }
  | { type: "app.question"; taskId: string; question: PendingQuestion }
  | { type: "app.answer"; taskId: string; questionId: string; answer: string }
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
  prompt: string;
  selectedItem: SelectedItem | null;
  threadId?: string;
  turnId?: string;
  status: TaskStatus;
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** 이 task에서 관측된 MCP tool 호출. 두 증거원(agent-stream / bridge-endpoint) 모두 기록한다. */
  mcpCalls: Array<{ tool: string; at: string; source: "agent-stream" | "bridge-endpoint" }>;
  result?: ShowResultInput;
};

export type AgentReadiness = {
  agent: AgentId;
  installed: boolean;
  authenticated: boolean | "unknown";
  version?: string;
  /** agent를 쓸 수 없을 때 사람이 읽을 수 있는 사유. */
  message?: string;
};

// ---------- 브라우저 <-> Bridge HTTP API ----------

export type StartTaskRequest = {
  agent: AgentId;
  projectPath: string;
  prompt: string;
  appContext?: {
    selectedItem?: SelectedItem | null;
  };
  /** 인터뷰 모드로 시작한다. 프롬프트가 ask_user 사용을 지시하는 형태로 감싸진다. */
  mode?: "task" | "interview";
};

/** 브라우저가 대기 중인 질문에 답한다. 답변이 기록되고 다음 turn이 자동으로 시작된다. */
export type AnswerQuestionRequest = {
  agent: AgentId;
  projectPath: string;
  answer: string;
};

export type StartTaskResponse = { taskId: string };

/**
 * 프로젝트에 묶인 세션을 놓아준다. 다음 task는 새 세션에서 시작한다.
 * 세션 자체를 지우는 것이 아니라 bridge가 들고 있던 참조만 버린다 —
 * 이전 세션은 디스크에 그대로 남아 CLI에서 이어받을 수 있다.
 */
export type ResetSessionRequest = {
  agent: AgentId;
  projectPath: string;
};

export type AppContextPatch = {
  projectPath?: string;
  prompt?: string;
  selectedItem?: SelectedItem | null;
};

export type BridgeStateResponse = {
  /** `npm run fixture`가 만드는 fixture 경로. 브라우저 입력창의 초기값으로 쓴다. */
  defaultProjectPath: string;
  appContext: AppContext;
  activeTaskId: string | null;
  tasks: TaskState[];
};

export type ErrorResponse = { error: string };
