import assert from "node:assert/strict";
import { test } from "node:test";

import { BridgeState } from "../dist/state.js";

function runningTask() {
  return {
    taskId: "task-v3",
    agent: "claude",
    projectPath: "/tmp/project",
    mode: "analyze",
    prompt: "analyze",
    status: "running",
    startedAt: new Date(0).toISOString(),
    mcpCalls: [],
    exploredFiles: [],
  };
}

test("V3 사용량은 같은 turn을 대체하고 Semantic/Assembly를 합산한다", () => {
  const state = new BridgeState();
  state.createTask(runningTask());

  state.recordStageUsage("task-v3", { stage: "semantic", turnId: "turn-1", totalTokens: 100 });
  state.recordStageUsage("task-v3", { stage: "semantic", turnId: "turn-1", totalTokens: 140 });
  state.recordStageUsage("task-v3", { stage: "assembly", turnId: "turn-2", totalTokens: 60 });

  const task = state.getTask("task-v3");
  assert.equal(task.stageUsages.length, 2);
  assert.equal(task.tokenUsage, 200);
  assert.deepEqual(task.stageUsages.map((usage) => usage.stage), ["semantic", "assembly"]);
});

test("V3 Bundle 검증 재시도와 최종 커밋을 task에 함께 남긴다", () => {
  const state = new BridgeState();
  state.createTask(runningTask());

  assert.equal(state.recordValidationRetry("task-v3"), 1);
  assert.equal(state.recordValidationRetry("task-v3"), 2);
  state.recordBundleCommit("task-v3", 36);

  const task = state.getTask("task-v3");
  assert.equal(task.validationCorrections, 2);
  assert.equal(task.bundleGeneration, 36);
});
