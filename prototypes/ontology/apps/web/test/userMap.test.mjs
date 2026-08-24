import assert from "node:assert/strict";
import { test } from "node:test";

import { buildUserJourneys, primaryJourneyPath, sequenceForTransition } from "../src/layout/userMap.ts";

const node = (id, label = id) => ({
  id,
  laneId: "actor",
  label,
  presentationType: "frontend",
  entityRefs: [`symbol:${id}`],
  evidenceRefs: [`ev:${id}`],
});

function workflow() {
  return {
    title: "핵심 목표",
    lanes: [{ id: "actor", label: "사용자", kind: "actor" }],
    mainPath: ["start", "work", "done"],
    nodes: [node("start"), node("work"), node("done"), node("extra")],
    edges: [
      { id: "e1", from: "start", to: "work", role: "main", label: "시작", evidenceRefs: ["ev:e1"] },
      { id: "e2", from: "work", to: "done", role: "main", label: "완료", evidenceRefs: ["ev:e2"], sequenceRef: "seq:e2" },
      { id: "e3", from: "extra", to: "work", role: "async", label: "다른 진입", evidenceRefs: ["ev:e3"] },
    ],
  };
}

test("레거시 WorkflowIR은 대표 여정과 주변 여정으로 분리된다", () => {
  const journeys = buildUserJourneys(undefined, workflow());
  assert.equal(journeys.length, 2);
  assert.deepEqual(journeys[0].ir.steps.map((step) => step.id), ["start", "work", "done"]);
  assert.deepEqual(journeys[1].ir.steps.map((step) => step.id), ["extra", "work"]);
});

test("primaryJourneyPath는 loop를 제외하고 outcome까지의 핵심 경로를 고른다", () => {
  const journey = buildUserJourneys(undefined, workflow())[0];
  journey.ir.transitions.push({ fromStepId: "work", toStepId: "start", loop: true, condition: "재시도", evidenceRefs: ["ev:loop"] });
  assert.deepEqual(primaryJourneyPath(journey.ir), ["start", "work", "done"]);
});

test("레거시 transition의 명시 sequenceRef를 우선 연결한다", () => {
  const journey = buildUserJourneys(undefined, workflow())[0];
  const transition = journey.ir.transitions.find((item) => item.fromStepId === "work" && item.toStepId === "done");
  const sequences = [{
    id: "seq:e2",
    title: "완료 호출",
    triggeredByEdgeId: "e2",
    participants: [],
    messages: [],
    evidenceRefs: [],
  }];
  assert.equal(sequenceForTransition(journey, transition, sequences)?.id, "seq:e2");
});

test("새 Scenario transition은 exact evidence가 겹치는 sequence만 연결한다", () => {
  const userMap = {
    title: "사용자 지도",
    journeys: [{
      id: "scenario:a",
      name: "A",
      type: "user",
      participants: [],
      steps: [
        { id: "a", label: "A", conceptRefs: [], evidenceRefs: ["ev:a"] },
        { id: "b", label: "B", conceptRefs: [], evidenceRefs: ["ev:b"] },
      ],
      transitions: [{ fromStepId: "a", toStepId: "b", evidenceRefs: ["ev:shared"] }],
      entryStepId: "a",
      outcomeStepIds: ["b"],
    }],
  };
  const journey = buildUserJourneys(userMap, workflow())[0];
  const sequences = [
    { id: "wrong", title: "same label", triggeredByEdgeId: "x", participants: [], messages: [], evidenceRefs: ["ev:other"] },
    { id: "right", title: "exact", triggeredByEdgeId: "y", participants: [], messages: [], evidenceRefs: ["ev:shared"] },
  ];
  assert.equal(sequenceForTransition(journey, journey.ir.transitions[0], sequences)?.id, "right");
});
