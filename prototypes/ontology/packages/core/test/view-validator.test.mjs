/**
 * `validateViewIR` — **acceptance 11 · 15** (implementation_plan §6.6~§6.8, §22, §28~§33).
 *
 * > 11. OverviewIR / ScenarioIR이 schema를 통과한다
 * > 15. Scenario의 모든 step이 evidenceRef ≥ 1이고 entry에서 전부 도달 가능하다
 *
 * 필요한 상태(memory/evidence)는 전부 합성한다 — view-validator는 디스크를 건드리지 않는
 * 순수 함수라 실제 프로젝트 인덱싱이 필요 없다(§6.9 S3 재확인은 patch에만 있다).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateViewIR } from "@onto/core";

function codesOf(diagnostics) {
  return diagnostics.map((item) => item.code).sort();
}

function evidenceItem(id, overrides = {}) {
  return {
    id,
    kind: "symbol",
    origin: "engine",
    rawHash: "h",
    normalizedFingerprint: "f",
    normalizationProfile: "code",
    fileContentHash: "fc",
    observedAtVersion: 1,
    status: "present",
    ...overrides,
  };
}

const EV1 = evidenceItem("ev-1");
const EV2 = evidenceItem("ev-2");
const EV_MISSING = evidenceItem("ev-missing", { status: "missing", missingSinceVersion: 2 });

const EMPTY_MEMORY = { semanticVersion: 1, concepts: [], claims: [], canonicalScenarios: [] };
const EVIDENCE_INDEX = { analysisVersion: 1, fileHashes: {}, evidence: [EV1, EV2, EV_MISSING], adapterReport: [] };

function memoryWith(concepts = [], claims = [], canonicalScenarios = []) {
  return { semanticVersion: 1, concepts, claims, canonicalScenarios };
}

function conceptOf(id, name = id) {
  return { id, name, evidenceRefs: [EV1.id], status: "active", createdAtVersion: 1, updatedAtVersion: 1 };
}

// ---------------------------------------------------------------------------
// Overview — acceptance 11
// ---------------------------------------------------------------------------

test("acceptance 11 — 유효한 OverviewIR은 schema를 통과한다", () => {
  const memory = memoryWith([conceptOf("cpt-1")]);
  const ir = {
    title: "제품 개요",
    areas: [{ id: "area-1", label: "팔로우", items: [{ id: "item-1", label: "팔로우 요청", conceptRefs: ["cpt-1"] }] }],
  };
  const result = validateViewIR({ viewKind: "overview", ir, memory });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.ir, ir);
});

test("acceptance 11 — 필수 필드가 없으면 schema 오류다", () => {
  const result = validateViewIR({ viewKind: "overview", ir: { title: "x" }, memory: EMPTY_MEMORY });
  assert.ok(codesOf(result.diagnostics).includes("view/schema"));
});

test("Overview — 실재하지 않는 conceptRefs는 거절된다 (I9)", () => {
  const ir = {
    title: "t",
    areas: [{ id: "a", label: "a", items: [{ id: "i", label: "i", conceptRefs: ["cpt-없음"] }] }],
  };
  const result = validateViewIR({ viewKind: "overview", ir, memory: EMPTY_MEMORY });
  assert.ok(codesOf(result.diagnostics).includes("view/unknown-concept"));
});

test("Overview — importantConnections은 이 Overview 안의 item만 가리킬 수 있다", () => {
  const ir = {
    title: "t",
    areas: [{ id: "a", label: "a", items: [{ id: "i1", label: "i1" }] }],
    importantConnections: [{ from: "i1", to: "존재하지-않음" }],
  };
  const result = validateViewIR({ viewKind: "overview", ir, memory: EMPTY_MEMORY });
  assert.ok(codesOf(result.diagnostics).includes("view/unknown-item"));
});

test("Overview — soft budget 초과는 warning일 뿐 제출은 성공한다 (§6.7)", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}`, label: `item ${i}` }));
  const ir = { title: "t", areas: [{ id: "a", label: "a", items }] };
  const result = validateViewIR({ viewKind: "overview", ir, memory: EMPTY_MEMORY });
  assert.ok(result.ir, "budget 초과만으로 제출이 실패하면 안 된다");
  assert.ok(codesOf(result.diagnostics).includes("view/over-budget"));
  assert.ok(result.diagnostics.every((d) => d.severity === "warning"));
});

// ---------------------------------------------------------------------------
// Scenario — acceptance 15 · §6.8
// ---------------------------------------------------------------------------

function baseScenario(overrides = {}) {
  return {
    id: "scn-1",
    name: "팔로우하기",
    type: "user",
    participants: [{ id: "p1", label: "사용자" }],
    steps: [
      { id: "s1", label: "요청한다", conceptRefs: ["cpt-1"], evidenceRefs: [EV1.id] },
      { id: "s2", label: "승인된다", conceptRefs: ["cpt-2"], evidenceRefs: [EV2.id] },
    ],
    transitions: [{ fromStepId: "s1", toStepId: "s2", evidenceRefs: [] }],
    entryStepId: "s1",
    outcomeStepIds: ["s2"],
    ...overrides,
  };
}

const SCENARIO_MEMORY = memoryWith([conceptOf("cpt-1"), conceptOf("cpt-2")]);

test("acceptance 11 · 15 — 유효한 ScenarioIR은 schema와 구조 검사를 모두 통과한다", () => {
  const ir = baseScenario();
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.ir, ir);
});

test("acceptance 15 — evidenceRefs가 없는 step은 거절된다", () => {
  const ir = baseScenario({
    steps: [
      { id: "s1", label: "요청한다", conceptRefs: ["cpt-1"], evidenceRefs: [] },
      { id: "s2", label: "승인된다", conceptRefs: ["cpt-2"], evidenceRefs: [EV2.id] },
    ],
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(codesOf(result.diagnostics).includes("scenario/step-ungrounded"));
});

test("acceptance 15 — entry에서 도달 불가능한 step은 거절된다", () => {
  const ir = baseScenario({
    steps: [
      { id: "s1", label: "요청한다", conceptRefs: ["cpt-1"], evidenceRefs: [EV1.id] },
      { id: "s2", label: "승인된다", conceptRefs: ["cpt-2"], evidenceRefs: [EV2.id] },
      { id: "s3", label: "고립된 step", conceptRefs: [], evidenceRefs: [EV1.id] },
    ],
    // s3로 가는 transition이 없다 — entry(s1)에서 도달할 수 없다.
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(codesOf(result.diagnostics).includes("scenario/unreachable-step"));
});

test("acceptance 15 — branch path로 도달하면 unreachable이 아니다", () => {
  const ir = baseScenario({
    steps: [
      { id: "s1", label: "요청한다", conceptRefs: ["cpt-1"], evidenceRefs: [EV1.id] },
      { id: "s2", label: "승인된다", conceptRefs: ["cpt-2"], evidenceRefs: [EV2.id] },
      { id: "s3", label: "거절된다", conceptRefs: [], evidenceRefs: [EV1.id] },
    ],
    transitions: [],
    branches: [
      {
        sourceStepId: "s1",
        conditionLabel: "승인 여부",
        evidenceRefs: [],
        paths: [
          { label: "승인", nextStepId: "s2" },
          { label: "거절", nextStepId: "s3" },
        ],
      },
    ],
    outcomeStepIds: ["s2", "s3"],
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.deepEqual(result.diagnostics, []);
});

test("§6.8 — back edge(loop:true)는 합법이지만 condition이 반드시 있어야 한다", () => {
  const ir = baseScenario({
    transitions: [
      { fromStepId: "s1", toStepId: "s2", evidenceRefs: [] },
      { fromStepId: "s2", toStepId: "s1", loop: true, evidenceRefs: [] }, // condition 없음
    ],
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(codesOf(result.diagnostics).includes("scenario/loop-without-condition"));
});

test("§6.8 — condition이 있는 back edge는 DAG가 아니어도 통과한다 (R5)", () => {
  const ir = baseScenario({
    transitions: [
      { fromStepId: "s1", toStepId: "s2", evidenceRefs: [] },
      { fromStepId: "s2", toStepId: "s1", loop: true, condition: "재신청", evidenceRefs: [] },
    ],
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.deepEqual(result.diagnostics, []);
});

test("§6.8 — 같은 conceptRefs·비슷한 label의 step 쌍은 loop-unrolled warning이다 (제출은 성공)", () => {
  const ir = baseScenario({
    steps: [
      { id: "s1", label: "재신청한다", conceptRefs: ["cpt-1"], evidenceRefs: [EV1.id] },
      { id: "s2", label: "  재신청한다  ", conceptRefs: ["cpt-1"], evidenceRefs: [EV2.id] },
    ],
    transitions: [{ fromStepId: "s1", toStepId: "s2", evidenceRefs: [] }],
    outcomeStepIds: ["s2"],
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(result.ir, "warning만으로 제출이 실패하면 안 된다");
  assert.ok(codesOf(result.diagnostics).includes("scenario/loop-unrolled"));
  assert.ok(result.diagnostics.every((d) => d.severity === "warning"));
});

test("I9 — 실재하지 않는 evidence id를 가리키는 step은 거절된다 (허구 Grounding 0)", () => {
  const ir = baseScenario({
    steps: [
      { id: "s1", label: "s1", conceptRefs: [], evidenceRefs: ["ev-지어냄"] },
      { id: "s2", label: "s2", conceptRefs: [], evidenceRefs: [EV2.id] },
    ],
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(codesOf(result.diagnostics).includes("evidence/unknown-id"));
});

test("I9 — missing 상태가 된 evidence를 가리키는 step은 거절된다", () => {
  const ir = baseScenario({
    steps: [
      { id: "s1", label: "s1", conceptRefs: [], evidenceRefs: [EV_MISSING.id] },
      { id: "s2", label: "s2", conceptRefs: [], evidenceRefs: [EV2.id] },
    ],
  });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(codesOf(result.diagnostics).includes("evidence/not-present"));
});

test("Scenario — outcomeStepIds가 비어 있으면 거절된다", () => {
  const ir = baseScenario({ outcomeStepIds: [] });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(codesOf(result.diagnostics).includes("scenario/no-outcome"));
});

test("Scenario — entryStepId가 steps에 없으면 거절된다", () => {
  const ir = baseScenario({ entryStepId: "s-없음" });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(codesOf(result.diagnostics).includes("scenario/unknown-entry"));
});

test("Scenario — soft budget(steps) 초과는 warning일 뿐 제출은 성공한다", () => {
  const steps = Array.from({ length: 25 }, (_, i) => ({
    id: `s${i}`,
    label: `step ${i}`,
    conceptRefs: [],
    evidenceRefs: [EV1.id],
  }));
  const transitions = steps.slice(1).map((step, i) => ({
    fromStepId: steps[i].id,
    toStepId: step.id,
    evidenceRefs: [],
  }));
  const ir = baseScenario({ steps, transitions, entryStepId: "s0", outcomeStepIds: ["s24"] });
  const result = validateViewIR({ viewKind: "scenario", ir, memory: SCENARIO_MEMORY, evidence: EVIDENCE_INDEX });
  assert.ok(result.ir);
  assert.ok(codesOf(result.diagnostics).includes("view/over-budget"));
});
