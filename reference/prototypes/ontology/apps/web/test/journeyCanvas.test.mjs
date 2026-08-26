import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJourneyCanvasLayout } from "../src/layout/journeyCanvas.ts";

const step = (id) => ({ id, label: id, conceptRefs: [], evidenceRefs: [`ev:${id}`] });

function scenario(overrides = {}) {
  return {
    id: "journey",
    name: "미션 수행",
    type: "user",
    participants: [],
    entryStepId: "enter",
    outcomeStepIds: ["reward"],
    steps: [step("enter"), step("mission"), step("verify"), step("reward"), step("retry"), step("cancel")],
    transitions: [
      { fromStepId: "enter", toStepId: "mission", evidenceRefs: ["ev:1"] },
      { fromStepId: "mission", toStepId: "verify", evidenceRefs: ["ev:2"] },
      { fromStepId: "verify", toStepId: "reward", evidenceRefs: ["ev:3"] },
      { fromStepId: "verify", toStepId: "retry", condition: "실패", evidenceRefs: ["ev:4"] },
      { fromStepId: "retry", toStepId: "verify", condition: "다시 인증", loop: true, evidenceRefs: ["ev:5"] },
    ],
    branches: [{
      sourceStepId: "mission",
      conditionLabel: "계속할지 선택",
      evidenceRefs: ["ev:6"],
      paths: [{ label: "취소", nextStepId: "cancel" }],
    }],
    ...overrides,
  };
}

test("대표 단계와 바깥 단계를 하나의 열·층 좌표계에 배치한다", () => {
  const layout = buildJourneyCanvasLayout(scenario(), ["enter", "mission", "verify", "reward"]);
  const nodes = new Map(layout.nodes.map((node) => [node.stepId, node]));

  assert.deepEqual([nodes.get("enter").lane, nodes.get("mission").lane, nodes.get("verify").lane, nodes.get("reward").lane], [0, 0, 0, 0]);
  assert.equal(nodes.get("retry").lane > 0, true);
  assert.equal(nodes.get("cancel").lane > 0, true);
  assert.equal(layout.laneCount > 1, true);
});

test("대표·분기·재시도 연결을 각각 보존하고 decision 경로도 실제 edge로 만든다", () => {
  const layout = buildJourneyCanvasLayout(scenario(), ["enter", "mission", "verify", "reward"]);
  const kinds = layout.edges.map((edge) => edge.kind);

  assert.equal(kinds.filter((kind) => kind === "primary").length, 3);
  assert.equal(kinds.includes("branch"), true);
  assert.equal(kinds.includes("loop"), true);
  assert.equal(layout.edges.some((edge) => edge.fromStepId === "mission" && edge.toStepId === "cancel" && edge.condition?.includes("취소")), true);
});

test("대표 경로가 비어도 진입 단계를 1층 기준점으로 유지한다", () => {
  const layout = buildJourneyCanvasLayout(scenario({ transitions: [], branches: [] }), []);
  assert.equal(layout.nodes.find((node) => node.stepId === "enter")?.lane, 0);
});
