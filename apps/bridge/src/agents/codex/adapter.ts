// Interface-conforming stub for the "codex" agent. This exists purely so the
// rest of the bridge (agent selection, request typing) can treat
// "claude"|"codex" uniformly without special-casing -- per docs/v1_plan.md
// this round's explicit MVP scope excludes a real Codex CLI integration.

import type { AgentEvent } from "@vibee/protocol";
import type { AgentAdapter, StartTaskInput } from "../types.js";
import { NotImplementedError } from "../types.js";

export const codexAdapter: AgentAdapter = {
  id: "codex",

  async checkReady() {
    return {
      installed: false,
      authenticated: "unknown",
      message: "Codex support is not implemented yet.",
    };
  },

  async listModels() {
    throw new NotImplementedError();
  },

  async startTask(_input: StartTaskInput, _emit: (event: AgentEvent) => void): Promise<"completed" | "interrupted" | "error"> {
    throw new NotImplementedError();
  },

  async stopTask(_taskId: string) {
    // no-op: no real task can ever be running for this stub adapter.
  },

  resetSession(_projectPath: string) {
    // no-op: no real session exists for this stub adapter.
  },
};
