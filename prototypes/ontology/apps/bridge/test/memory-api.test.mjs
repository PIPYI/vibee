/**
 * `impactContext` (schema2 §6, M12) — `get_impact_context`가 실제로 호출하는 함수.
 *
 * anchor 문자열 해석(Concept id/name 우선, symbolId, file)과 authored reachability
 * 계산을 이어 붙인 얇은 층이다. reachability 계산 자체는 `packages/core/test/reachability.test.mjs`가
 * 이미 결정론·mutation check까지 검증했다 — 여기서는 **이 층이 잘못 잇지 않는지**만 본다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { impactContext } from "../dist/memory-api.js";

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
