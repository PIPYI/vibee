/**
 * provider 중립 adapter 인터페이스 (B2).
 *
 * 이 선 위쪽 — HTTP API, WebSocket 스트림, MCP server, 브라우저 — 는 전부 provider를 알지
 * 못한다. spike에서 Claude adapter를 추가할 때 bridge·protocol·MCP server를 **한 줄도**
 * 바꾸지 않고 통과했다.
 *
 * **OS도 알지 못한다** — 실행 파일 해석은 `../platform.js`에만 있다.
 */
import type { AgentEvent, AgentId, AgentReadiness, ModelOption, SessionSummary, TaskMode } from "@onto/protocol";

export type TaskOutcome = "completed" | "interrupted";

export type StartTaskInput = {
  taskId: string;
  projectPath: string;
  /** 이미 감싸진 프롬프트. adapter는 이것을 그대로 보낸다 */
  prompt: string;
  mode: TaskMode;
  /** 생략하면 provider 기본값을 그대로 쓴다. **화이트리스트를 두지 않는다** */
  model?: string;
  effort?: string;
};

export interface AgentAdapter {
  readonly id: AgentId;
  checkReady(): Promise<AgentReadiness>;
  /** provider에게 직접 물어본 모델 목록. 하드코딩하지 않는다 — CLI를 올리면 목록이 바뀐다 */
  listModels(): Promise<ModelOption[]>;
  /** turn이 어떻게 끝났는지를 resolve로 알린다. **실제 실패일 때만 throw 한다** */
  startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome>;
  /**
   * 기본 Stop은 사용자 취소라 `interrupted`다. Semantic Patch가 커밋된 뒤의 내부 Stop만
   * `completed`를 요청해 다음 pipeline stage로 넘긴다.
   */
  stopTask(taskId: string, outcome?: "completed"): Promise<void>;
  /** 프로젝트에 묶어 둔 세션 참조를 버린다. 세션 파일은 디스크에 그대로 남는다 */
  resetSession(projectPath: string): void;
  listSessions(projectPath: string): Promise<SessionSummary[]>;
  resumeSession(projectPath: string, sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
