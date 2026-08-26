/**
 * `impactContext` (schema2 §6, M12) — `get_impact_context`가 실제로 호출하는 함수.
 *
 * anchor 문자열 해석(Concept id/name 우선, symbolId, file)과 authored reachability
 * 계산을 이어 붙인 얇은 층이다. reachability 계산 자체는 `packages/core/test/reachability.test.mjs`가
 * 이미 결정론·mutation check까지 검증했다 — 여기서는 **이 층이 잘못 잇지 않는지**만 본다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ASSEMBLY_CONTEXT_LIMIT,
  MAX_ASSEMBLY_CONTEXT_LIMIT,
  assemblyContext,
  impactContext,
  resolveAssemblyContextLimit,
} from "../dist/memory-api.js";

function symbolEntity(id, name) {
  return {
    id,
    kind: "symbol",
    origin: "engine",
    filePath: "src/x.ts",
    symbolId: name,
    rawHash: `raw-${id}`,
    normalizedFingerprint: `fp-${id}`,
    normalizationProfile: "code",
    graph: { role: "entity", entity: { kind: "symbol", symbolId: name }, label: name },
    fileContentHash: "file-hash",
    observedAtVersion: 1,
    status: "present",
  };
}

function fileEntity(id, filePath) {
  return {
    id,
    kind: "file",
    origin: "engine",
    filePath,
    rawHash: `raw-${id}`,
    normalizedFingerprint: `fp-${id}`,
    normalizationProfile: "code",
    graph: { role: "entity", entity: { kind: "file", filePath }, label: filePath },
    fileContentHash: "file-hash",
    observedAtVersion: 1,
    status: "present",
  };
}

function containsLink(id, filePath, symbolId) {
  return {
    id,
    kind: "contains",
    origin: "engine",
    filePath,
    rawHash: `raw-${id}`,
    normalizedFingerprint: `fp-${id}`,
    normalizationProfile: "code",
    graph: {
      role: "link",
      from: { kind: "file", filePath },
      to: { kind: "symbol", symbolId },
      linkKind: "contains",
    },
    fileContentHash: "file-hash",
    observedAtVersion: 1,
    status: "present",
  };
}

function callLink(id, from, to) {
  return {
    id,
    kind: "call",
    origin: "engine",
    filePath: "src/x.ts",
    rawHash: `raw-${id}`,
    normalizedFingerprint: `fp-${id}`,
    normalizationProfile: "code",
    graph: { role: "link", from: { kind: "symbol", symbolId: from }, to: { kind: "symbol", symbolId: to }, linkKind: "call" },
    fileContentHash: "file-hash",
    observedAtVersion: 1,
    status: "present",
  };
}

function stateOf({ concepts = [] } = {}) {
  return {
    generation: 1,
    project: { projectId: "p", name: "p", analysisVersion: 1, semanticVersion: 1, semanticReconciledAnalysisVersion: 1 },
    evidence: {
      analysisVersion: 1,
      fileHashes: { "src/x.ts": "file-hash" },
      evidence: [
        fileEntity("ev0", "src/x.ts"),
        symbolEntity("ev1", "src/x.ts#a"),
        symbolEntity("ev2", "src/x.ts#b"),
        symbolEntity("ev3", "src/x.ts#c"),
        containsLink("ev0c", "src/x.ts", "src/x.ts#a"),
        callLink("ev4", "src/x.ts#a", "src/x.ts#b"),
        callLink("ev5", "src/x.ts#b", "src/x.ts#c"),
      ],
      adapterReport: [],
    },
    memory: { semanticVersion: 1, concepts, claims: [], canonicalScenarios: [] },
    grounding: { conceptGroundings: [], claimGroundings: [] },
  };
}

test("symbolId(# 포함)는 symbol anchor로 해석된다", () => {
  const result = impactContext(stateOf(), { anchor: "src/x.ts#a", direction: "downstream" });
  assert.equal(result.found, true);
  assert.equal(result.anchor, "symbol:src/x.ts#a");
  assert.deepEqual(
    result.nodes.map((n) => n.id).sort(),
    ["symbol:src/x.ts#a", "symbol:src/x.ts#b", "symbol:src/x.ts#c"],
  );
});

test("Concept id/name이 symbolId보다 먼저 시도된다 (scenarioContext와 같은 우선순위)", () => {
  const concepts = [
    { id: "cpt-1", name: "A", evidenceRefs: ["ev1"], status: "active", createdAtVersion: 1, updatedAtVersion: 1 },
  ];
  const result = impactContext(stateOf({ concepts }), { anchor: "A", direction: "downstream" });
  assert.equal(result.found, true);
  assert.equal(result.anchor, "concept:cpt-1");
});

test("#가 없는 문자열은 file anchor로 해석된다", () => {
  const result = impactContext(stateOf(), { anchor: "src/x.ts", direction: "downstream" });
  assert.equal(result.found, true);
  assert.equal(result.anchor, "file:src/x.ts");
  // file -> a(contains) -> b(call) -> c(call) 로 downstream이 이어진다.
  assert.ok(result.nodes.some((n) => n.id === "symbol:src/x.ts#c"));
});

test("direction을 넘긴 그대로 reachability에 전달한다 — upstream/downstream이 바뀌지 않는다", () => {
  const down = impactContext(stateOf(), { anchor: "src/x.ts#b", direction: "downstream" });
  const up = impactContext(stateOf(), { anchor: "src/x.ts#b", direction: "upstream" });
  assert.deepEqual(down.nodes.map((n) => n.id).sort(), ["symbol:src/x.ts#b", "symbol:src/x.ts#c"]);
  // b의 upstream은 a, 그리고 a를 담고 있는 file(contains)까지 이어진다.
  assert.deepEqual(up.nodes.map((n) => n.id).sort(), ["file:src/x.ts", "symbol:src/x.ts#a", "symbol:src/x.ts#b"]);
});

test("빈 anchor 문자열은 found:false다", () => {
  const result = impactContext(stateOf(), { anchor: "  ", direction: "downstream" });
  assert.equal(result.found, false);
});

test("존재하지 않는 symbol을 가리키면 found:false다 (아무것도 안 지어낸다)", () => {
  const result = impactContext(stateOf(), { anchor: "src/x.ts#없음", direction: "downstream" });
  assert.equal(result.found, false);
});

test("응답에 authored reachability임을 밝히는 note가 있다 — impact/인과를 주장하지 않는다", () => {
  const result = impactContext(stateOf(), { anchor: "src/x.ts#a", direction: "downstream" });
  assert.match(result.note, /authored reachability/);
});

test("assemblyContext는 참조 후보를 보존하고 lifecycle 중복 필드를 제거한다", () => {
  const base = stateOf();
  const result = assemblyContext({
    ...base,
    generation: 7,
    project: {
      ...base.project,
      analysisVersion: 5,
      semanticVersion: 4,
      semanticReconciledAnalysisVersion: 5,
    },
    memory: {
      semanticVersion: 4,
      concepts: [
        {
          id: "concept-1", name: "승인", description: "승인 처리", aliases: ["허가"],
          evidenceRefs: ["ev-concept"], confidence: 0.9, status: "active",
          createdAtVersion: 1, updatedAtVersion: 4,
        },
        {
          id: "concept-old", name: "이전 승인", evidenceRefs: ["ev-old"], status: "deprecated",
          createdAtVersion: 1, updatedAtVersion: 2,
        },
      ],
      claims: [{
        id: "claim-1", subjectConceptId: "concept-1", predicate: "저장한다",
        object: { conceptId: "concept-old" }, evidenceRefs: ["ev-claim"], status: "active",
        createdAtVersion: 2, updatedAtVersion: 4,
      }],
      canonicalScenarios: [{
        id: "scenario-1", name: "승인 완료", type: "user", goal: "승인을 저장한다",
        anchorConceptIds: ["concept-1"], status: "active", createdAtVersion: 2, updatedAtVersion: 4,
      }],
    },
    grounding: {
      conceptGroundings: [{ conceptId: "concept-1", evidenceRefs: ["ev-concept-grounding"], confidence: 0.9 }],
      claimGroundings: [{ claimId: "claim-1", evidenceRefs: ["ev-claim-grounding"], confidence: 0.8 }],
    },
    systemFacts: {
      schemaVersion: 4,
      analysisVersion: 5,
      entities: [{
        id: "symbol:src/a.ts#save", ref: { kind: "symbol", symbolId: "src/a.ts#save" }, kind: "symbol",
        origin: "engine", certainty: "confirmed", evidenceRefs: ["ev-entity"],
        dependsOnEvidenceRefs: ["ev-entity", "ev-dependency"], status: "valid",
        firstSeenVersion: 1, lastValidatedVersion: 5,
      }],
      links: [
        {
          id: "link-valid", from: { kind: "symbol", symbolId: "src/a.ts#save" },
          to: { kind: "resource", namespace: "storage", key: "approvals" }, kind: "writes",
          mechanism: "writeFile", origin: "engine", certainty: "confirmed", evidenceRefs: ["ev-link"],
          dependsOnEvidenceRefs: ["ev-link", "ev-dependency"], status: "relocated",
          firstSeenVersion: 1, lastValidatedVersion: 5,
        },
        {
          id: "link-stale", from: { kind: "symbol", symbolId: "src/a.ts#save" },
          to: { kind: "resource", namespace: "storage", key: "old" }, kind: "writes",
          origin: "engine", certainty: "confirmed", evidenceRefs: ["ev-stale"],
          dependsOnEvidenceRefs: ["ev-stale"], status: "stale",
          firstSeenVersion: 1, lastValidatedVersion: 4,
        },
        {
          id: "link-missing", from: { kind: "symbol", symbolId: "src/a.ts#save" },
          to: { kind: "resource", namespace: "storage", key: "gone" }, kind: "writes",
          origin: "engine", certainty: "confirmed", evidenceRefs: ["ev-missing"],
          dependsOnEvidenceRefs: ["ev-missing"], status: "missing",
          firstSeenVersion: 1, lastValidatedVersion: 4,
        },
      ],
      diagnostics: [{ code: "not-for-assembly", severity: "warning", message: "omit" }],
    },
  });

  assert.equal(result.generation, 7);
  assert.deepEqual(result.semantic.counts.concepts, { total: 2, eligible: 1, truncated: false });
  assert.deepEqual(result.semantic.concepts.map((item) => item.id), ["concept-1", "concept-old"]);
  assert.deepEqual(result.semantic.concepts[0].aliases, ["허가"]);
  assert.deepEqual(result.semantic.concepts[0].evidenceRefs, ["ev-concept-grounding"]);
  assert.equal(result.semantic.concepts[0].groundingConfidence, 0.9);
  assert.deepEqual(result.semantic.claims[0].object, { conceptId: "concept-old" });
  assert.deepEqual(result.semantic.claims[0].evidenceRefs, ["ev-claim-grounding"]);
  assert.equal(result.semantic.claims[0].groundingConfidence, 0.8);
  assert.deepEqual(result.semantic.canonicalScenarios[0].anchorConceptIds, ["concept-1"]);
  assert.deepEqual(result.systemFacts.counts.links, { total: 3, eligible: 1, truncated: false });
  assert.deepEqual(result.systemFacts.entities[0], {
    id: "symbol:src/a.ts#save", kind: "symbol", certainty: "confirmed",
    evidenceRefs: ["ev-entity"], status: "valid",
  });
  assert.deepEqual(result.systemFacts.links, [{
    id: "link-valid", from: "symbol:src/a.ts#save", to: "resource:storage:approvals",
    kind: "writes", mechanism: "writeFile", certainty: "confirmed",
    evidenceRefs: ["ev-link"], status: "relocated",
  }]);

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /createdAtVersion|updatedAtVersion|firstSeenVersion|lastValidatedVersion/);
  assert.doesNotMatch(serialized, /dependsOnEvidenceRefs|diagnostics|"origin"|"ref"|"endpoint"/);
});

test("assemblyContext는 대형 저장소에서 목록마다 독립적으로 limit을 적용하고 잘렸는지 알려준다", () => {
  const concepts = Array.from({ length: 5 }, (_, i) => ({
    id: `concept-${i}`, name: `concept ${i}`, evidenceRefs: [], status: "active",
    createdAtVersion: 1, updatedAtVersion: 1,
  }));
  const base = stateOf({ concepts });
  const result = assemblyContext(
    { ...base, systemFacts: { schemaVersion: 4, analysisVersion: 1, entities: [], links: [], diagnostics: [] } },
    2,
  );
  assert.equal(result.semantic.concepts.length, 2, "limit을 넘는 목록은 잘린다");
  assert.deepEqual(result.semantic.counts.concepts, { total: 5, eligible: 5, truncated: true });
  // claims는 원래 비어 있으므로 limit보다 작을 때는 잘리지 않는다.
  assert.deepEqual(result.semantic.counts.claims, { total: 0, eligible: 0, truncated: false });
  assert.equal(
    resolveAssemblyContextLimit(undefined),
    DEFAULT_ASSEMBLY_CONTEXT_LIMIT,
    "값이 없으면 기본 500을 쓴다",
  );
  assert.equal(resolveAssemblyContextLimit("999999"), MAX_ASSEMBLY_CONTEXT_LIMIT, "상한 2000을 넘지 않는다");
  assert.equal(resolveAssemblyContextLimit("not-a-number"), DEFAULT_ASSEMBLY_CONTEXT_LIMIT);
});
