import type { AgentEvent, AgentReadiness } from "@byoa/protocol";

export type TaskOutcome = "completed" | "interrupted";

export type StartTaskInput = {
  taskId: string;
  projectPath: string;
  /** spike instruction(문서 §12)으로 이미 감싼 프롬프트. */
  prompt: string;
};

/**
 * provider에 종속되지 않는 adapter 인터페이스 (문서 §21). 이 선 위쪽 — HTTP API,
 * WebSocket 스트림, 브라우저 — 는 전부 provider를 알지 못한다.
 */
export interface AgentAdapter {
  readonly id: "codex" | "claude";
  checkReady(): Promise<AgentReadiness>;
  /** turn이 어떻게 끝났는지를 resolve로 알린다. 실제 실패일 때만 throw 한다. */
  startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome>;
  stopTask(taskId: string): Promise<void>;
  dispose(): Promise<void>;
}
