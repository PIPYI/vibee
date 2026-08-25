/**
 * 성공한 Semantic Patch는 provider를 "사용자 중단"으로 끝내면 안 된다. 그 경우 pipeline이
 * Stage 3로 넘어가지 못한다. 반대로 일반 Stop은 여전히 interrupted여야 한다.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import { ClaudeAdapter } from "../dist/agents/claude/adapter.js";
import { CodexAdapter } from "../dist/agents/codex/adapter.js";
import { completeSemanticTurnAfterResponse } from "../dist/stage-completion.js";

const INPUT = {
  taskId: "semantic-stage",
  projectPath: "/tmp/project",
  prompt: "semantic",
  mode: "analyze",
};

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function claudeOutcome(outcome, endsNormally = false) {
  const adapter = new ClaudeAdapter({ mcpServerPath: "/tmp/mcp", bridgeUrl: "http://bridge", bridgeToken: "token" });
  adapter.sdk = {
    query: ({ options }) => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "claude-turn" };
        await new Promise((resolve, reject) => {
          options.abortController.signal.addEventListener("abort", () => {
            if (endsNormally) resolve();
            else reject(new Error("aborted"));
          }, { once: true });
        });
      },
      supportedModels: async () => [],
    }),
  };

  const running = adapter.startTask(INPUT, () => undefined);
  await nextTurn();
  await adapter.stopTask(INPUT.taskId, outcome);
  const result = await running;
  assert.equal(adapter.stopOutcomes.size, 0, "완료 이유가 다음 task로 누수되면 안 된다");
  return result;
}

async function codexOutcome(outcome) {
  const adapter = new CodexAdapter();
  adapter.initialized = true;
  adapter.client = {
    async call(method, params) {
      if (method === "thread/start") return { thread: { id: "codex-thread" } };
      if (method === "turn/start") return { turn: { id: "codex-turn" } };
      if (method === "turn/interrupt") {
        queueMicrotask(() => {
          adapter.handleNotification({
            method: "turn/completed",
            params: { threadId: params.threadId, turnId: params.turnId, turn: { status: "interrupted" } },
          });
        });
        return {};
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  const running = adapter.startTask(INPUT, () => undefined);
  await nextTurn();
  await adapter.stopTask(INPUT.taskId, outcome);
  const result = await running;
  assert.equal(adapter.stopOutcomes.size, 0, "완료 이유가 다음 task로 누수되면 안 된다");
  return result;
}

test("Semantic Patch의 프로그램 완료만 Claude turn을 completed로 바꾼다", async () => {
  assert.equal(await claudeOutcome("completed"), "completed");
  assert.equal(await claudeOutcome("completed", true), "completed", "abort 뒤 정상 종료해도 완료 이유를 잃지 않는다");
  assert.equal(await claudeOutcome(undefined), "interrupted");
});

test("Semantic Patch의 프로그램 완료만 Codex turn을 completed로 바꾼다", async () => {
  assert.equal(await codexOutcome("completed"), "completed");
  assert.equal(await codexOutcome(undefined), "interrupted");
});

test("Semantic 성공 종료는 HTTP 응답을 socket에 쓴 뒤에만 provider를 중단한다", async () => {
  const response = new EventEmitter();
  const calls = [];
  const adapter = { stopTask: async (...args) => calls.push(args) };

  completeSemanticTurnAfterResponse(response, adapter, "semantic-stage", () => undefined);
  assert.deepEqual(calls, []);
  response.emit("finish");
  await nextTurn();
  assert.deepEqual(calls, [["semantic-stage", "completed"]]);
});
