import type { AgentEvent, AgentReadiness, ModelOption, SessionSummary, TranscriptMessage } from "@byoa/protocol";

export type TaskOutcome = "completed" | "interrupted";

export type StartTaskInput = {
  taskId: string;
  projectPath: string;
  /** spike instruction(문서 §12)으로 이미 감싼 프롬프트. */
  prompt: string;
  /**
   * 이 turn이 무엇인지. adapter가 **격리 수준을 다르게** 잡는 데 쓴다.
   *
   * 인터뷰는 대화지 작업이 아니다. 파일을 읽을 일도, 고칠 일도, 하위 에이전트를 띄울 일도
   * 없다. 특히 프로젝트에 이미 놓여 있는 AGENTS.md / CLAUDE.md는 **[4] 인계 산출물**이지
   * 인터뷰의 규칙이 아니다 — 그것이 자동으로 실려 들어오면 인터뷰 중인 agent가
   * "앱을 끝까지 만들어라"는 지시를 따르기 시작한다 (SPIKE_FINDINGS.md §14).
   *
   * 리뷰도 같은 이유로 격리한다. harness에는 "한 번에 끝까지 만드세요"가 들어 있어서,
   * 그것이 실린 리뷰어는 어긋난 것을 보고하는 대신 고치기 시작한다.
   */
  mode: TaskMode;
  /** 모델·effort 오버라이드. undefined면 provider 기본값을 그대로 쓴다. */
  model?: string;
  effort?: string;
};

/**
 * `task`만 코드를 쓴다. 나머지는 읽기 전용이고 프로젝트 문서를 싣지 않는다.
 *
 * - `interview` — 무엇을 만들지 정하는 대화 (docs/requirements_flow.md §4)
 * - `task`      — **acceptance 검증 장치.** 제품 경로가 아니다 (아래)
 * - `review`    — 저장된 DEC/RULE과 diff를 대조한다 (§3.3). 고치지 않고 보고만 한다
 * - `wiki`      — 대화에 나온 말을 이 프로젝트 기준으로 설명한다 (§3.5). **읽되 쓰지 않는다**
 * - `architecture` — 코드가 준비한 구조 신호를 판단하고 근거 파일만 확인한다. **읽되 쓰지 않는다**
 *
 * `task`는 Phase A/B가 "브라우저 프롬프트가 로컬 agent의 turn이 되고 agent가 지정된
 * 디렉터리에서 실제로 파일을 고치는가"를 확인하려고 만든 것이다. 제품에서 코드를 쓰는
 * 주체는 사용자가 옆 창에서 돌리는 자기 agent이고, 이 앱은 그 프롬프트를 건넬 뿐이다
 * (docs/BYOA_MCP_INTEGRATION_SPIKE.md §1.2). **이 mode 위에 제품 기능을 쌓지 않는다.**
 */
export type TaskMode = "task" | "interview" | "review" | "wiki" | "architecture";

/** 코드를 쓰지 않는 mode인가. 격리 수준을 가르는 유일한 기준이다. */
export function isReadOnlyMode(mode: TaskMode): boolean {
  return mode !== "task";
}

/**
 * 코드를 **읽어야** 하는 mode인가.
 *
 * 인터뷰와 리뷰는 필요한 것을 우리가 전부 먹여 준다(문답, diff). 위키와 architecture는 다르다 —
 * "이 앱에서 JWT는 `src/auth/token.js`가 만든다"를 쓰려면 코드를 봐야 하는데, 어느 파일을
 * 볼지 우리가 미리 알 수 없다. architecture도 준비된 후보가 실제로 같은 책임인지 확인해야
 * 한다. 그래서 두 mode에 읽기 도구만 열어 준다.
 */
export function needsReadTools(mode: TaskMode): boolean {
  return mode === "wiki" || mode === "architecture";
}

/** 위키 turn에 허용하는 Claude 내장 도구. 쓰기 도구는 하나도 없다. */
export const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"] as const;

/**
 * provider에 종속되지 않는 adapter 인터페이스 (문서 §21). 이 선 위쪽 — HTTP API,
 * WebSocket 스트림, 브라우저 — 는 전부 provider를 알지 못한다.
 */
export interface AgentAdapter {
  readonly id: "codex" | "claude";
  checkReady(): Promise<AgentReadiness>;
  /**
   * provider에게 직접 물어본 모델 목록. 하드코딩하지 않는다 — CLI를 업데이트하면
   * 목록도 effort 집합도 바뀐다.
   */
  listModels(): Promise<ModelOption[]>;
  /** turn이 어떻게 끝났는지를 resolve로 알린다. 실제 실패일 때만 throw 한다. */
  startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome>;
  stopTask(taskId: string): Promise<void>;
  /**
   * 이 프로젝트에 묶어 둔 세션 참조를 버린다. 다음 startTask는 새 세션을 만든다.
   * 이미 만들어진 세션은 디스크에 그대로 남는다 (CLI에서 이어받을 수 있다).
   */
  resetSession(projectPath: string, mode?: TaskMode): void;
  /**
   * 이 프로젝트에서 이어받을 수 있는 기존 세션들. bridge를 재시작했거나 CLI에서 만든
   * 세션도 여기서 보인다 — 세션은 디스크에 남기 때문이다.
   */
  listSessions(projectPath: string): Promise<SessionSummary[]>;
  /** 기존 세션에 붙는다. 다음 startTask가 이 세션을 이어받는다. */
  resumeSession(projectPath: string, sessionId: string): Promise<void>;
  /**
   * 이 프로젝트에서 오간 대화 전문. **우리 앱이 시작한 것만이 아니다** — 사용자가 옆 창에서
   * 바이브코딩한 대화도 같은 곳에 남으므로 같이 읽힌다. 위키 키워드가 여기서 나온다 (§3.5).
   */
  readTranscript(projectPath: string): Promise<TranscriptMessage[]>;
  dispose(): Promise<void>;
}
