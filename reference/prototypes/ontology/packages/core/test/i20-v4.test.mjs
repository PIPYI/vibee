import assert from "node:assert/strict";
import { test } from "node:test";

import { systemLinkId, validateAnalysisBundle } from "@onto/core";

function evidence(id) {
  return {
    id,
    kind: "source-anchor",
    origin: "agent",
    rawHash: id,
    normalizedFingerprint: id,
    normalizationProfile: "code",
    fileContentHash: "file",
    observedAtVersion: 1,
    status: "present",
  };
}

const A = { kind: "resource", namespace: "service", key: "a" };
const B = { kind: "resource", namespace: "service", key: "b" };
const C = { kind: "resource", namespace: "external", key: "c" };
const EV_A = evidence("ev-a");
const EV_B = evidence("ev-b");
const EV_C = evidence("ev-c");
const EV_AB = evidence("ev-ab");
const EV_BC = evidence("ev-bc");

const EVIDENCE = {
  analysisVersion: 1,
  fileHashes: {},
  evidence: [EV_A, EV_B, EV_C, EV_AB, EV_BC],
  adapterReport: [],
};

function entity(id, ref, evidenceRef) {
  return {
    id,
    ref,
    kind: ref.namespace,
    origin: "vibee",
    certainty: "grounded",
    evidenceRefs: [evidenceRef],
    dependsOnEvidenceRefs: [evidenceRef],
    status: "valid",
    firstSeenVersion: 1,
    lastValidatedVersion: 1,
  };
}

function link(from, to, evidenceRef, overrides = {}) {
  const kind = "call";
  return {
    id: systemLinkId({ kind, from, to }),
    from,
    to,
    kind,
    origin: "vibee",
    certainty: "grounded",
    evidenceRefs: [evidenceRef],
    dependsOnEvidenceRefs: [evidenceRef],
    status: "valid",
    firstSeenVersion: 1,
    lastValidatedVersion: 1,
    ...overrides,
  };
}

const AB = link(A, B, EV_AB.id);
const BC = link(B, C, EV_BC.id);

function store(links = [AB, BC]) {
  return {
    schemaVersion: 4,
    analysisVersion: 1,
    entities: [
      entity("resource:service:a", A, EV_A.id),
      entity("resource:service:b", B, EV_B.id),
      entity("resource:external:c", C, EV_C.id),
    ],
    links,
    diagnostics: [],
  };
}

function bundle(refs = [AB.id, BC.id], from = "source", to = "target") {
  return {
    architecture: {
      title: "V4",
      components: [
        { id: "source", label: "Source", presentationType: "backend", entityRefs: ["resource:service:a"], evidenceRefs: [EV_A.id] },
        { id: "middle", label: "Middle", presentationType: "backend", entityRefs: ["resource:service:b"], evidenceRefs: [EV_B.id] },
        { id: "target", label: "Target", presentationType: "external", entityRefs: ["resource:external:c"], evidenceRefs: [EV_C.id] },
      ],
      boundaries: [],
      connections: [{ id: "connection", from, to, systemLinkRefs: refs, evidenceRefs: [EV_AB.id, EV_BC.id] }],
    },
    workflow: { title: "Workflow", lanes: [], mainPath: [], nodes: [], edges: [] },
    sequences: [],
  };
}

function validate(candidate, facts = store()) {
  return validateAnalysisBundle({
    bundle: candidate,
    evidence: EVIDENCE,
    systemFacts: facts,
    memory: { semanticVersion: 0, concepts: [], claims: [], canonicalScenarios: [] },
  });
}

function codes(result) {
  return result.diagnostics.map((item) => item.code);
}

test("I20-v4 — Vibee-grounded Link의 연속된 multi-hop 경로를 Architecture connection으로 승인한다", () => {
  const result = validate(bundle());
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.bundle.architecture.connections[0].systemLinkRefs, [AB.id, BC.id]);
});

test("I20-v4 — inferred 또는 needs_review Link는 확정 connection에 쓸 수 없다", () => {
  const inferred = { ...BC, certainty: "inferred", status: "needs_review" };
  const result = validate(bundle(), store([AB, inferred]));
  assert.ok(codes(result).includes("bundle/system-link-not-authoritative"));
});

test("I20-v4 — 방향이 뒤집힌 component connection은 거절한다", () => {
  const result = validate(bundle([AB.id, BC.id], "target", "source"));
  assert.ok(codes(result).includes("bundle/system-link-direction-mismatch"));
});

test("I20-v4 — System Link 목록이 연속 경로가 아니면 거절한다", () => {
  const AC = link(A, C, EV_BC.id);
  const result = validate(bundle([AB.id, AC.id]), store([AB, AC]));
  assert.ok(codes(result).includes("bundle/system-link-path-discontinuous"));
});

test("I20-v4 — 실재하지 않는 System Link ID는 거절한다", () => {
  const result = validate(bundle(["system-link:not-real"]));
  assert.ok(codes(result).includes("bundle/unknown-system-link"));
});
