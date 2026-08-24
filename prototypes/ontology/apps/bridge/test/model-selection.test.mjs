import assert from "node:assert/strict";
import { test } from "node:test";

import { parseClaudeModels } from "../dist/agents/claude/adapter.js";
import { parseCodexModelPage } from "../dist/agents/codex/adapter.js";
import { modelSelectionError } from "../dist/model-selection.js";

test("Codex model/list의 data와 객체형 reasoning effort를 그대로 정규화한다", () => {
  const page = parseCodexModelPage({
    data: [
      {
        id: "gpt-next",
        displayName: "GPT Next",
        description: "provider description",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "fast" },
          { reasoningEffort: "ultra", description: "deep" },
        ],
        defaultReasoningEffort: "low",
        isDefault: true,
      },
      { id: "hidden-model", displayName: "Hidden", hidden: true },
    ],
    nextCursor: "page-2",
  });

  assert.equal(page.nextCursor, "page-2");
  assert.deepEqual(page.models, [{
    id: "gpt-next",
    label: "GPT Next",
    description: "provider description",
    efforts: [
      { id: "low", description: "fast" },
      { id: "ultra", description: "deep" },
    ],
    defaultEffort: "low",
    isDefault: true,
  }]);
});

test("Codex의 과거 models/문자열 effort 응답도 호환한다", () => {
  const page = parseCodexModelPage({
    models: [{ id: "legacy", supportedReasoningEfforts: ["medium"] }],
  });
  assert.deepEqual(page.models[0].efforts, [{ id: "medium" }]);
});

test("Claude ModelInfo의 value를 실제 선택 ID로 쓰고 default alias를 추천으로 표시한다", () => {
  const models = parseClaudeModels([
    {
      value: "default",
      resolvedModel: "claude-sonnet-next",
      displayName: "Default (recommended)",
      description: "provider description",
      supportsEffort: true,
      supportedEffortLevels: ["low", "high"],
    },
    { value: "haiku", displayName: "Haiku", description: "fast" },
  ]);

  assert.equal(models[0].id, "default");
  assert.equal(models[0].isDefault, true);
  assert.deepEqual(models[0].efforts, [{ id: "low" }, { id: "high" }]);
  assert.deepEqual(models[1].efforts, []);
});

test("분석 시작 전 모델과 사고 수준을 현재 provider 목록으로 검증한다", () => {
  const models = [{
    id: "provider-model",
    label: "Provider Model",
    efforts: [{ id: "low" }, { id: "high" }],
    isDefault: true,
  }];

  assert.equal(modelSelectionError(models, "provider-model", "high"), undefined);
  assert.match(modelSelectionError(models, "stale-model", "high"), /현재 제공자 목록/u);
  assert.match(modelSelectionError(models, "provider-model", "invented"), /사고 수준/u);
  assert.match(modelSelectionError(models, undefined, "high"), /모델도 선택/u);
});
