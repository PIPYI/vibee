/**
 * `computeScenarioLayout` — implementation_plan §6.8 rank/lane 계산.
 *
 * Node 24가 `.ts`를 그대로 실행할 수 있어(native type stripping) 컴파일 없이 소스를
 * 직접 import한다 — apps/web은 tsc로 빌드하는 패키지가 아니라 Vite 앱이다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeScenarioLayout, edgeKey } from "../src/layout/scenarioLayout.ts";

function step(id, overrides = {}) {
  return { id, label: id, conceptRefs: [], evidenceRefs: ["ev-1"], ...overrides };
}

function baseIr(overrides = {}) {
  return {
    id: "scn-1",
    name: "시나리오",
    type: "user",
    participants: [{ id: "p1", label: "참여자1" }, { id: "p2", label: "참여자2" }],
    steps: [step("s1"), step("s2"), step("s3")],
    transitions: [
      { fromStepId: "s1", toStepId: "s2", evidenceRefs: [] },
      { fromStepId: "s2", toStepId: "s3", evidenceRefs: [] },
    ],
    entryStepId: "s1",
    outcomeStepIds: ["s3"],
    ...overrides,
  };
}

test("선형 흐름 — rank가 순서대로 증가하고 back edge가 없다", () => {
  const layout = computeScenarioLayout(baseIr());
  assert.equal(layout.positions.get("s1").rank, 0);
  assert.equal(layout.positions.get("s2").rank, 1);
  assert.equal(layout.positions.get("s3").rank, 2);
  assert.equal(layout.backEdgeKeys.size, 0);
  assert.equal(layout.maxRank, 2);
});

test("participantId → lane. 없으면 마지막 lane(unassigned)으로 간다", () => {
  const ir = baseIr({
    steps: [step("s1", { participantId: "p2" }), step("s2", { participantId: "p1" }), step("s3")],
  });
  const layout = computeScenarioLayout(ir);
  assert.equal(layout.lanes[0], "p1");
  assert.equal(layout.lanes[1], "p2");
  assert.equal(layout.positions.get("s1").laneIndex, 1); // p2
  assert.equal(layout.positions.get("s2").laneIndex, 0); // p1
  assert.equal(layout.positions.get("s3").laneIndex, layout.lanes.length - 1); // unassigned
});

test("§6.8 — loop:true back edge는 rank 계산에서 제외되고 backEdgeKeys에 들어간다", () => {
  const ir = baseIr({
    transitions: [
      { fromStepId: "s1", toStepId: "s2", evidenceRefs: [] },
      { fromStepId: "s2", toStepId: "s3", evidenceRefs: [] },
      { fromStepId: "s3", toStepId: "s1", loop: true, condition: "재시도", evidenceRefs: [] },
    ],
  });
  const layout = computeScenarioLayout(ir);
  assert.ok(layout.backEdgeKeys.has(edgeKey("s3", "s1")));
  // back edge를 랭크 계산에 넣었다면 s1의 rank가 이상해졌을 것이다 — 여전히 0이어야 한다.
  assert.equal(layout.positions.get("s1").rank, 0);
  assert.equal(layout.positions.get("s3").rank, 2);
});

test("agent가 loop:true를 빠뜨려도 DFS가 구조적 cycle을 잡아 무한 루프에 빠지지 않는다", () => {
  const ir = baseIr({
    transitions: [
      { fromStepId: "s1", toStepId: "s2", evidenceRefs: [] },
      { fromStepId: "s2", toStepId: "s3", evidenceRefs: [] },
      { fromStepId: "s3", toStepId: "s1", evidenceRefs: [] }, // loop 표시가 없다
    ],
  });
  const layout = computeScenarioLayout(ir);
  assert.ok(layout.backEdgeKeys.has(edgeKey("s3", "s1")), "DFS가 구조적 back edge를 잡아야 한다");
  assert.equal(layout.positions.size, 3);
});

test("branch의 paths[]도 rank 계산에 들어간다 — 새 lane을 만들지 않는다", () => {
  const ir = baseIr({
    steps: [step("s1"), step("s2"), step("s3")],
    transitions: [],
    branches: [
      {
        sourceStepId: "s1",
        conditionLabel: "분기",
        evidenceRefs: [],
        paths: [
          { label: "a", nextStepId: "s2" },
          { label: "b", nextStepId: "s3" },
        ],
      },
    ],
    outcomeStepIds: ["s2", "s3"],
  });
  const layout = computeScenarioLayout(ir);
  assert.equal(layout.positions.get("s2").rank, 1);
  assert.equal(layout.positions.get("s3").rank, 1);
  assert.equal(layout.lanes.length, 3); // p1, p2, unassigned — branch가 lane을 늘리지 않는다
});
