import type { AgentEvent, AgentReadiness, ModelOption, SessionSummary, TranscriptMessage } from "@vci/protocol";

export type TaskOutcome = "completed" | "interrupted";

export type StartTaskInput = {
  taskId: string;
  projectPath: string;
  prompt: string;
  mode: TaskMode;
  model?: string;
  effort?: string;
};

/**
 * 이 앱은 처음부터 끝까지 "보는 곳"이다 — 코드를 쓰는 mode가 없다 (byoa-mcp-spike의
 * `task` mode는 acceptance 검증 장치였을 뿐 제품 경로가 아니었으므로 가져오지 않는다).
 *
 * - `interview`    — 무엇을 만들지 정하는 대화
 * - `review`       — 저장된 DEC/RULE과 diff를 대조한다. 고치지 않고 보고만 한다
 * - `wiki`         — 대화에 나온 말을 이 프로젝트 기준으로 설명한다
 * - `architecture` — 코드가 준비한 구조 신호를 판단한다 (오버사이즈드 모듈/중복 로직/임시조치)
 * - `analyze`      — 코드베이스 의미 분석(Semantic). AnalysisBundle의 재료를 만든다
 * - `assembly`     — Semantic 결과를 Architecture/Workflow/UserMap/Sequence로 조립한다
 */
export type TaskMode = "interview" | "review" | "wiki" | "architecture" | "analyze" | "assembly";

/**
 * 코드를 읽어야 하는 mode인가.
 *
 * 인터뷰와 리뷰는 필요한 것을 우리가 전부 먹여 준다(문답, diff). 위키·architecture·analyze·
 * assembly는 다르다 — 코드를 직접 봐야 판단할 수 있는 것들이라 읽기 도구만 열어 준다.
 */
export function needsReadTools(mode: TaskMode): boolean {
  return mode === "wiki" || mode === "architecture" || mode === "analyze" || mode === "assembly";
}

/** 모든 mode에 허용하는 Claude 내장 도구. 쓰기 도구는 하나도 없다 — 이 앱에 쓰는 mode가 없다. */
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

/**
 * provider에 종속되지 않는 adapter 인터페이스. 이 선 위쪽 — HTTP API, WebSocket 스트림,
 * 브라우저 — 는 전부 provider를 알지 못한다.
 */
export interface AgentAdapter {
  readonly id: "codex" | "claude";
  checkReady(): Promise<AgentReadiness>;
  listModels(): Promise<ModelOption[]>;
  startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome>;
  stopTask(taskId: string): Promise<void>;
  resetSession(projectPath: string, mode?: TaskMode): void;
  listSessions(projectPath: string): Promise<SessionSummary[]>;
  resumeSession(projectPath: string, sessionId: string): Promise<void>;
  readTranscript(projectPath: string): Promise<TranscriptMessage[]>;
  dispose(): Promise<void>;
}
