// Minimal shared vocabulary for the agent/task layer that apps/bridge will
// build on later. This just defines the shapes so downstream packages have
// something stable to import against.

export type AgentId = "claude" | "codex";

export type TaskMode = "architecture";

export type ModelOption = { id: string; label: string };

export type AgentEvent =
  | { type: "task.started"; taskId: string }
  | { type: "agent.message.delta"; taskId: string; text: string }
  | { type: "agent.file.explored"; taskId: string; path: string }
  | { type: "mcp.tool.called"; taskId: string; tool: string }
  | {
      type: "agent.usage";
      taskId: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  | { type: "task.completed"; taskId: string }
  | { type: "task.error"; taskId: string; message: string }
  // Distinct from "task.completed": that marks the end of the agent's own
  // turn (it may finish without ever successfully submitting a document).
  // This marks the moment a document actually passed re-validation and was
  // committed to `<projectPath>/.vibee/`, i.e. there is now something new
  // for a client to fetch from `GET /api/architecture-view`.
  | { type: "architecture-view.committed"; taskId: string };
