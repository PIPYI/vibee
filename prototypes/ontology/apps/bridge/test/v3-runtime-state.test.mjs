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

test("V3.2 Bundle 검증 budget은 네 번째 제출을 실제로 거절한다", () => {
  const state = new BridgeState();
  state.createTask(runningTask());

  assert.deepEqual(state.recordValidationAttempt("task-v3", 3), { attempt: 1, allowed: true });
  assert.deepEqual(state.recordValidationAttempt("task-v3", 3), { attempt: 2, allowed: true });
  assert.deepEqual(state.recordValidationAttempt("task-v3", 3), { attempt: 3, allowed: true });
  assert.deepEqual(state.recordValidationAttempt("task-v3", 3), { attempt: 4, allowed: false });
  assert.equal(state.getTask("task-v3").validationAttempts, 4);
});

test("V3.2 Stage ledger와 provider session을 재접속 가능한 task 상태에 남긴다", () => {
  const state = new BridgeState();
  state.createTask(runningTask());
  state.recordStageState("task-v3", {
    stage: "semantic",
    status: "running",
    startedAt: new Date(0).toISOString(),
    lastActivityAt: new Date(0).toISOString(),
    message: "의미 이해 중",
  });
  state.touchStage("task-v3", "semantic", new Date(1_000).toISOString());
  state.recordStageSession("task-v3", "semantic", "session-semantic", false);
  state.recordStageSession("task-v3", "assembly", "session-assembly", false);

  const task = state.getTask("task-v3");
  assert.equal(task.stageStates[0].lastActivityAt, new Date(1_000).toISOString());
  assert.deepEqual(task.stageSessions.map((item) => item.stage), ["semantic", "assembly"]);
  assert.notEqual(task.stageSessions[0].sessionId, task.stageSessions[1].sessionId);
});

test("V3.2 task-local retrieval cache는 같은 조회 결과를 재사용한다", () => {
  const state = new BridgeState();
  state.createTask(runningTask());
  const value = { nodes: ["one"] };
  state.setRetrievalCache("task-v3", "anchor|downstream|2", value);

  assert.equal(state.getRetrievalCache("task-v3", "anchor|downstream|2"), value);
  assert.equal(state.getRetrievalCache("task-v3", "different"), undefined);
});
