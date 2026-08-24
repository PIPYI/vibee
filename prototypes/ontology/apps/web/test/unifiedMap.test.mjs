import assert from "node:assert/strict";
import { test } from "node:test";

import {
  componentReferenceSet,
  journeyReferenceSet,
  referencesIntersect,
  relatedComponentIds,
  stepReferenceSet,
} from "../src/layout/unifiedMap.ts";

const component = {
  id: "service",
  label: "예약 서비스",
  presentationType: "backend",
  conceptRefs: ["concept:booking"],
  entityRefs: ["symbol:booking#create"],
  evidenceRefs: ["ev:create"],
};

const step = {
  id: "step:create",
  participantId: "traveler",
  label: "예약 요청",
  conceptRefs: ["concept:booking"],
  evidenceRefs: ["ev:screen"],
};

test("통합 지도는 exact evidence/concept/entity ref만 교차 강조에 사용한다", () => {
  assert.deepEqual([...componentReferenceSet(component)].sort(), ["concept:booking", "ev:create", "symbol:booking#create"]);
  assert.deepEqual([...stepReferenceSet(step)].sort(), ["concept:booking", "ev:screen"]);
  assert.equal(referencesIntersect(stepReferenceSet(step), componentReferenceSet(component)), true);
  assert.deepEqual([...relatedComponentIds([component], stepReferenceSet(step))], ["service"]);
});

test("라벨이 같아도 ref 교집합이 없으면 관련 항목을 만들지 않는다", () => {
  const sameLabel = { ...component, id: "other", conceptRefs: [], entityRefs: ["symbol:other"], evidenceRefs: ["ev:other"] };
  assert.deepEqual([...relatedComponentIds([sameLabel], stepReferenceSet(step))], []);
});

test("journey ref는 단계와 transition의 근거를 결정적으로 합친다", () => {
  const journey = {
    id: "journey",
    name: "예약",
    type: "user",
    participants: [],
    entryStepId: step.id,
    outcomeStepIds: [step.id],
    steps: [step],
    transitions: [{ fromStepId: step.id, toStepId: step.id, loop: true, condition: "재시도", evidenceRefs: ["ev:retry"] }],
    evidenceRefs: ["ev:journey"],
  };
  assert.deepEqual(
    [...journeyReferenceSet(journey)].sort(),
    ["concept:booking", "ev:journey", "ev:retry", "ev:screen"],
  );
});
