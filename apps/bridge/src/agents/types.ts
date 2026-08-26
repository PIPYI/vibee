import type { AgentEvent, AgentId, ModelOption, TaskMode } from "@vibee/protocol";

export interface StartTaskInput {
  taskId: string;
  projectPath: string;
  prompt: string;
  mode: TaskMode; // from @vibee/protocol, currently only "architecture"
  model?: string;
}

export interface AgentAdapter {
  readonly id: AgentId; // "claude" | "codex"
  checkReady(): Promise<{
    installed: boolean;
    authenticated: "unknown" | boolean;
    version?: string;
    message?: string;
  }>;
  listModels(): Promise<ModelOption[]>;
  startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<"completed" | "interrupted" | "error">;
  stopTask(taskId: string): Promise<void>;
  resetSession(projectPath: string): void;
}

/** Thrown by the codex stub adapter for any method that has no real implementation yet. */
export class NotImplementedError extends Error {
  constructor(message = "Codex support is not implemented yet.") {
    super(message);
    this.name = "NotImplementedError";
  }
}
