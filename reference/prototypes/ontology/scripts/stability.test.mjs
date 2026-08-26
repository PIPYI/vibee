/**
 * §46 False Semantic Churn — identity preservation · name-only churn · split · merge.
 *
 * `checkCoverage`의 시험과 같은 스타일이다 — live agent 출력에 의존하지 않고 판정 로직
 * 자체만 본다. 실제 agent turn으로 하는 측정은 `npm run eval`의 몫이다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeEvidenceOriginStats, computeStabilityMetrics } from "./stability.mjs";

function concept(id, evidenceRefs) {
  return { id, name: id, evidenceRefs, status: "active", createdAtVersion: 1, updatedAtVersion: 1 };
}

function state({ concepts = [], claims = [], canonicalScenarios = [] }) {
  return { memory: { semanticVersion: 1, concepts, claims, canonicalScenarios } };
}

test("아무것도 바뀌지 않으면 identity preservation은 1이고 churn은 0이다", () => {
  const before = state({ concepts: [concept("cpt-1", ["ev-1"]), concept("cpt-2", ["ev-2"])] });
  const after = state({ concepts: [concept("cpt-1", ["ev-1"]), concept("cpt-2", ["ev-2"])] });
  const result = computeStabilityMetrics(before, after);
  assert.equal(result.conceptIdentityPreservation, 1);
  assert.equal(result.concepts.nameOnlyChurn, 0);
  assert.equal(result.concepts.unnecessarySplit, 0);
  assert.equal(result.concepts.unnecessaryMerge, 0);
});

test("같은 grounding인데 id만 바뀌면 name-only churn으로 잡힌다", () => {
  const before = state({ concepts: [concept("cpt-old", ["ev-1", "ev-2", "ev-3"])] });
  const after = state({ concepts: [concept("cpt-new", ["ev-1", "ev-2", "ev-3"])] });
  const result = computeStabilityMetrics(before, after);
  assert.equal(result.conceptIdentityPreservation, 0);
  assert.equal(result.concepts.nameOnlyChurn, 1);
  assert.equal(result.concepts.unnecessarySplit, 0);
  assert.equal(result.concepts.unnecessaryMerge, 0);
});

test("완전히 무관한 grounding으로 바뀌면 name-only churn이 아니다 (진짜 다른 의미일 수 있다)", () => {
  const before = state({ concepts: [concept("cpt-old", ["ev-1", "ev-2"])] });
  const after = state({ concepts: [concept("cpt-new", ["ev-9", "ev-10"])] });
  const result = computeStabilityMetrics(before, after);
  assert.equal(result.concepts.nameOnlyChurn, 0);
  assert.equal(result.concepts.disappeared, 1);
  assert.equal(result.concepts.appeared, 1);
});

test("하나가 겹치는 여럿으로 쪼개지면 unnecessary split이다", () => {
  const before = state({ concepts: [concept("cpt-old", ["ev-1", "ev-2", "ev-3", "ev-4"])] });
  const after = state({
    concepts: [concept("cpt-a", ["ev-1", "ev-2"]), concept("cpt-b", ["ev-3", "ev-4"])],
  });
  const result = computeStabilityMetrics(before, after);
  assert.equal(result.concepts.unnecessarySplit, 1);
});

test("여럿이 겹치는 하나로 합쳐지면 unnecessary merge다", () => {
  const before = state({
    concepts: [concept("cpt-a", ["ev-1", "ev-2"]), concept("cpt-b", ["ev-3", "ev-4"])],
  });
  const after = state({ concepts: [concept("cpt-merged", ["ev-1", "ev-2", "ev-3", "ev-4"])] });
  const result = computeStabilityMetrics(before, after);
  assert.equal(result.concepts.unnecessaryMerge, 1);
});

test("v1이 비어 있으면 identity preservation은 측정 불가(null)다", () => {
  const before = state({});
  const after = state({ concepts: [concept("cpt-1", ["ev-1"])] });
  const result = computeStabilityMetrics(before, after);
  assert.equal(result.conceptIdentityPreservation, null);
});

function evidence(overrides) {
  return {
    id: overrides.id,
    kind: "symbol",
    origin: overrides.origin,
    status: overrides.status ?? "present",
    ...(overrides.relocationConfidence ? { relocationConfidence: overrides.relocationConfidence } : {}),
  };
}

test("agent evidence의 relocation은 exact/degraded/missing/미상(notYetRelocated)으로 나뉜다", () => {
  const stats = computeEvidenceOriginStats({
    evidence: [
      evidence({ id: "e1", origin: "engine" }),
      evidence({ id: "e2", origin: "agent", relocationConfidence: "exact" }),
      evidence({ id: "e3", origin: "agent", relocationConfidence: "degraded" }),
      evidence({ id: "e4", origin: "agent", status: "missing" }),
      evidence({ id: "e5", origin: "agent" }), // 아직 재인덱싱을 안 거친 것
    ],
  });
  assert.deepEqual(stats.byOrigin, { engine: 1, agent: 3 }); // e4는 missing이라 present count에서 빠진다
  assert.deepEqual(stats.agentRelocation, { exact: 1, degraded: 1, missing: 1, notYetRelocated: 1 });
});
