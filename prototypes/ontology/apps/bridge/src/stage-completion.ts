import type { Response } from "express";

import type { AgentAdapter } from "./agents/types.js";

/** 성공한 Semantic Patch 응답을 socket에 쓴 뒤 provider turn을 성공으로 끝낸다. */
export function completeSemanticTurnAfterResponse(
  res: Response,
  adapter: AgentAdapter,
  taskId: string,
  onError: (error: unknown) => void,
): void {
  res.once("finish", () => {
    void adapter.stopTask(taskId, "completed").catch(onError);
  });
}
