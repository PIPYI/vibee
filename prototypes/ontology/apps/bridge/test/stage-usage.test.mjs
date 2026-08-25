import assert from "node:assert/strict";
import { test } from "node:test";

import { ClaudeAdapter } from "../dist/agents/claude/adapter.js";
import { CodexAdapter } from "../dist/agents/codex/adapter.js";
import { normalizeStageUsage } from "../dist/agents/usage.js";

test("Claude usage는 cache read/write를 포함한 전체 처리량으로 기록한다", () => {
  assert.deepEqual(
    normalizeStageUsage({
      inputTokens: 20,
      outputTokens: 34_243,
      cacheReadTokens: 444_338,
      cacheWriteTokens: 91_421,
    }, { inputIncludesCacheRead: false }),
    {
      inputTokens: 20,
      outputTokens: 34_243,
      cacheReadTokens: 444_338,
      cacheWriteTokens: 91_421,
      totalTokens: 570_022,
    },
  );
});

test("Codex usage는 cached input을 inputTokens에서 빼고 전체 처리량은 보존한다", () => {
  assert.deepEqual(
    normalizeStageUsage({
      inputTokens: 363_843,
      outputTokens: 8_735,
      cacheReadTokens: 314_112,
    }, { inputIncludesCacheRead: true }),
    {
      inputTokens: 49_731,
      outputTokens: 8_735,
      cacheReadTokens: 314_112,
      totalTokens: 372_578,
    },
  );
});

test("Codex cache read가 raw input보다 커도 음수 입력을 기록하지 않는다", () => {
  assert.deepEqual(
    normalizeStageUsage({ inputTokens: 3, cacheReadTokens: 5 }, { inputIncludesCacheRead: true }),
    { inputTokens: 0, cacheReadTokens: 5, totalTokens: 5 },
  );
});

test("Claude adapter는 정규화한 usage event를 내보낸다", async () => {
  const adapter = new ClaudeAdapter({ mcpServerPath: "/tmp/mcp", bridgeUrl: "http://bridge", bridgeToken: "token" });
  adapter.sdk = {
    query: () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "result",
          session_id: "claude-turn",
          usage: { input_tokens: 20, output_tokens: 34_243, cache_read_input_tokens: 444_338, cache_creation_input_tokens: 91_421 },
        };
      },
      supportedModels: async () => [],
    }),
  };
  const events = [];
  await adapter.startTask({ taskId: "claude-task", projectPath: "/tmp/project", prompt: "test", mode: "analyze" }, (event) => events.push(event));
  assert.deepEqual(events.find((event) => event.type === "agent.usage"), {
    type: "agent.usage",
    taskId: "claude-task",
    stage: "semantic",
    turnId: "claude-turn",
    inputTokens: 20,
    outputTokens: 34_243,
    cacheReadTokens: 444_338,
    cacheWriteTokens: 91_421,
    totalTokens: 570_022,
  });
});

test("Codex adapter는 cache 포함 raw input을 정규화해 usage event를 내보낸다", () => {
  const adapter = new CodexAdapter();
  const events = [];
  adapter.activeTurns.set("codex-task", { threadId: "thread", turnId: "turn", mode: "assembly" });
  adapter.emitters.set("codex-task", (event) => events.push(event));

  adapter.handleNotification({
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "thread",
      turnId: "turn",
      tokenUsage: { total: { totalTokens: 372_578, inputTokens: 363_843, outputTokens: 8_735, cachedInputTokens: 314_112 } },
    },
  });

  assert.deepEqual(events, [{
    type: "agent.usage",
    taskId: "codex-task",
    stage: "assembly",
    turnId: "turn",
    inputTokens: 49_731,
    outputTokens: 8_735,
    cacheReadTokens: 314_112,
    totalTokens: 372_578,
  }]);
});
