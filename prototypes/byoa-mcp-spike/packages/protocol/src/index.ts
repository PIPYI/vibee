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
  /**
   * 지금까지 저장된 설계 초안. **기본으로는 비어 있다** — `get_app_context`를
   * `includeDesign: true`로 부를 때만 채워진다.
   *
   * 초안은 다 자란 것이 12,000자가 넘는다. 그런데 그것을 써낸 agent는 같은 대화 안에
   * 이미 그 내용을 갖고 있다. 매 turn 돌려주면 자기가 방금 쓴 문서를 다시 받아 문맥에
   * 쌓는 셈이고, turn 수만큼 중복이 곱해진다 (SPIKE_FINDINGS.md §14).
   *
   * 정말 필요한 경우는 하나다 — 다른 곳에서 시작한 세션을 이어받아 초안을 고칠 때.
   * 그때만 `includeDesign`으로 지불한다.
   */
  design: DesignDoc | null;
  /**
   * 초안이 있는지, 무엇으로 이루어져 있는지만 알려주는 요약. 항상 채워진다.
   * agent는 이것을 보고 초안 전체가 필요한지 스스로 판단한다.
   */
  designDigest: DesignDigest | null;
  metadata: {
    source: "byoa-mcp-spike";
    timestamp: string;
  };
};

/** `DesignDoc`을 통째로 싣지 않고도 "무엇이 있는지"를 알려주는 요약. */
export type DesignDigest = {
  title: string;
  summary: string;
  counts: {
    actors: number;
    reqs: number;
    surfaces: number;
    entities: number;
    flows: number;
    rules: number;
    decisions: number;
  };
  /** 이미 쓰인 id들. 새 단위를 붙일 때 번호가 겹치지 않게 하는 용도다. */
  ids: string[];
};

/** agent가 `show_result` MCP tool로 앱에 되돌려 보내는 payload (§10). */
export type ShowResultInput = {
  title: string;
  summary: string;
  status: "success" | "warning" | "error";
  filesChanged?: string[];
  details?: string[];
};

// ---------- 설계 산출물 (docs/requirements_flow.md §4.1, §4.11) ----------

/**
 * 이 항목이 사용자의 말에서 나온 것인지, agent가 대신 채운 것인지 (§4.8).
 * 비전공자에게 "제가 정한 것"을 표시해 주기 위한 정보이며, 나중에 DEC의 근거가 된다.
 */
export type DesignSource = "user" | "ai";

export type DesignActor = { id: string; name: string; note?: string };

/** 무엇을 할 수 있는가 (= 유스케이스). */
export type DesignReq = { id: string; name: string; source: DesignSource; note?: string };

/** 어디서 하는가 (= 화면). REQ에서 도출되며 사용자에게 직접 묻지 않는다 (§4.7). */
export type DesignSurface = {
  id: string;
  name: string;
  /** 이 화면에서 할 수 있는 REQ id들. */
  shows: string[];
  source: DesignSource;
  note?: string;
};

/** 무엇이 저장되는가 + 관계 + 가질 수 있는 상태. */
export type DesignEntity = {
  id: string;
  name: string;
  /** 다른 ENTITY와의 관계를 사람이 읽는 문장으로. 예: "E2에 속한다". */
  relations: string[];
  states: string[];
  source: DesignSource;
};

/**
 * FLOW의 한 단계. **순서가 의미를 갖는다** — 관계(edge)로 흩어 놓으면 순서가 흐릿해지므로
 * 순서 있는 목록으로 둔다 (§4.1).
 */
export type DesignFlowStep = {
  /** 누가 (ACTOR id) */
  actor?: string;
  /** 어디서 (SURFACE id) */
  surface?: string;
  /** 무엇을 */
  action: string;
  /** 어떤 정보에 (ENTITY id) */
  entity?: string;
  /** 그 정보가 어떻게 되는가. 예: "생성", "상태 = 공개" */
  effect?: string;
  /** 이 단계에 걸리는 RULE id */
  rule?: string;
};

export type DesignFlow = { id: string; name: string; steps: DesignFlowStep[]; source: DesignSource };

/** 조건 · 제약. */
export type DesignRule = {
  id: string;
  text: string;
  /** 이 규칙이 제약하는 REQ id들. */
  constrains: string[];
  source: DesignSource;
};

/**
 * 왜 그렇게 정했는가 / 무엇을 안 하기로 했는가.
 * 이 단위가 이 기능의 차별점이다 (§4.1) — 설계 의도는 DEC 없이 보존되지 않는다.
 */
export type DesignDecision = { id: string; text: string; why: string; source: DesignSource };

/**
 * 인터뷰 산출물. **사람용 설명과 harness는 모두 이 데이터에서 렌더된다** (§5, §6).
 * 산문이 원본이고 데이터가 파생물인 것이 아니라, 그 반대다.
 */
export type DesignDoc = {
  title: string;
  /** 한 문단짜리 한 줄 요약. 무엇을 만드는 앱인지. */
  summary: string;
  actors: DesignActor[];
  reqs: DesignReq[];
  surfaces: DesignSurface[];
  entities: DesignEntity[];
  flows: DesignFlow[];
  rules: DesignRule[];
  decisions: DesignDecision[];
};

export type McpToolName = "get_app_context" | "show_result" | "ask_user" | "save_design";

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
  /** 대기 중인 질문에 답한 것이면 그 질문. 사용자가 먼저 꺼낸 말이면 빈 문자열. */
  question: string;
  answer: string;
  answeredAt: string;
};

/**
 * 인터뷰에 말을 건다 (docs/requirements_flow.md §4.5, §4.10 3단계).
 *
 * **질문이 대기 중이 아니어도 보낼 수 있다.** 초안이 나온 뒤 "이건 아닌데", "이것도 필요해"
 * 라고 말하는 것이 인터뷰의 3단계이며, 자유 채팅은 항상 열려 있어야 한다.
 */
export type InterviewMessageRequest = {
  agent: AgentId;
  projectPath: string;
  message: string;
  model?: string;
  effort?: string;
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
  | { type: "app.design"; taskId: string; design: DesignDoc }
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
  /** 이 task에 적용된 오버라이드. 생략되면 provider 기본값으로 돈 것이다. */
  model?: string;
  effort?: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** 이 task에서 관측된 MCP tool 호출. 두 증거원(agent-stream / bridge-endpoint) 모두 기록한다. */
  mcpCalls: Array<{ tool: string; at: string; source: "agent-stream" | "bridge-endpoint" }>;
  result?: ShowResultInput;
  design?: DesignDoc;
};

/**
 * reasoning effort 하나. id는 provider가 쓰는 원문 값이다 — Codex에는 `ultra`가 있고
 * Claude에는 없으므로 공용 enum으로 고정하지 않는다.
 */
export type EffortOption = {
  id: string;
  description?: string;
};

/**
 * agent가 쓸 수 있는 모델 하나.
 *
 * 이 목록은 **provider가 스스로 신고한 것**을 bridge가 정규화한 결과다
 * (Codex는 `model/list` RPC, Claude는 `Query.supportedModels()`). 하드코딩하지 않는 이유는
 * CLI를 업데이트하면 목록이 바뀌기 때문이다. 브라우저는 이 배열을 그대로 렌더링할 뿐
 * 어느 provider인지 알지 못한다.
 */
export type ModelOption = {
  id: string;
  label: string;
  description?: string;
  /** 이 모델이 지원하는 effort. 빈 배열이면 effort 개념이 없는 모델이다 (예: Claude haiku). */
  efforts: EffortOption[];
  /** provider가 기본으로 쓰는 effort. 모르면 생략된다 (Claude는 알려주지 않는다). */
  defaultEffort?: string;
  /** provider가 기본으로 고르는 모델인지. 브라우저의 초기 선택값이 된다. */
  isDefault: boolean;
};

/**
 * 이어받을 수 있는 기존 세션 하나 (docs/requirements_flow.md §7).
 *
 * provider마다 부르는 이름이 다르다 — Codex는 thread, Claude는 session. 브라우저는
 * 그 차이를 알 필요가 없으므로 여기서 하나로 맞춘다.
 */
export type SessionSummary = {
  id: string;
  /** 첫 사용자 메시지. 어떤 대화였는지 알아보게 한다. */
  preview: string;
  updatedAt: string;
  /** bridge가 지금 이 세션을 물고 있는지. 물고 있으면 이어받기가 아니라 이미 이어져 있다. */
  active: boolean;
};

export type AgentSessionsResponse = {
  agent: AgentId;
  projectPath: string;
  sessions: SessionSummary[];
};

/** 기존 세션에 붙는다. 다음 turn부터 그 대화를 이어받는다. */
export type ResumeSessionRequest = {
  agent: AgentId;
  projectPath: string;
  sessionId: string;
};

/**
 * agent 말고 앱이 기대는 외부 도구 (지금은 git 하나).
 *
 * **원격 저장소는 쓰지 않는다.** git이 필요한 이유는 사용자가 되돌릴 지점을 갖기 위해서다 —
 * 비전공자는 무언가 잘못됐을 때 되돌리는 법을 모른다 (docs/requirements_flow.md §6).
 */
export type ToolReadiness = {
  tool: "git";
  installed: boolean;
  version?: string;
  /** 없을 때 사람이 읽을 안내. */
  message?: string;
};

export type HealthResponse = {
  ok: boolean;
  agents: AgentReadiness[];
  tools: ToolReadiness[];
};

export type AgentModelsResponse = {
  agent: AgentId;
  models: ModelOption[];
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
  /**
   * 모델·effort 오버라이드. 생략하면 provider가 자기 기본값을 쓴다.
   * 값의 유효 범위는 provider마다 다르므로 여기서는 문자열로만 다루고, 검증은 adapter가 한다.
   */
  model?: string;
  effort?: string;
};

export type StartTaskResponse = {
  taskId: string;
  /**
   * 인터뷰를 새로 시작하면서 프로젝트에서 지운 지난 산출물. 새 인터뷰는 새 프로젝트이므로
   * 지난 설계와 하네스를 남겨 두지 않는다. 사용자 파일이 사라진 것을 조용히 넘기지 않기 위해
   * 무엇을 지웠는지 그대로 올려 보낸다.
   */
  cleared?: string[];
};

/**
 * 프로젝트에 묶인 세션을 놓아준다. 다음 task는 새 세션에서 시작한다.
 * 세션 자체를 지우는 것이 아니라 bridge가 들고 있던 참조만 버린다 —
 * 이전 세션은 디스크에 그대로 남아 CLI에서 이어받을 수 있다.
 */
export type ResetSessionRequest = {
  agent: AgentId;
  projectPath: string;
};

/**
 * 인계 (docs/requirements_flow.md §7).
 *
 * `agent`는 사용자가 실제로 쓰는 도구다. **그 도구의 harness만 만든다** —
 * Codex면 `AGENTS.md`, Claude Code면 `CLAUDE.md`. 둘 다 깔아 두면 어긋났을 때
 * 무엇이 맞는지 알 수 없다.
 */
export type ExportDesignRequest = {
  agent: AgentId;
  projectPath: string;
};

export type ExportDesignResponse = {
  projectPath: string;
  written: string[];
  /** 저장소가 없어서 새로 만들었다면 true. 되돌릴 지점을 확보하기 위한 것이다. */
  gitInitialized: boolean;
  /** 사람이 쓴 파일이라 건너뛴 것. 말없이 덮어쓰지 않는다. */
  skipped: string[];
  /** 비전공자가 빈 창을 마주하지 않도록 (§7). */
  firstPrompt: string;
  gaps: string[];
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
  design: DesignDoc | null;
  /** 비어 있는 단위에 대한 안내. 진행을 막지 않는다 (§4.10). */
  designGaps: string[];
};

export type ErrorResponse = { error: string };
