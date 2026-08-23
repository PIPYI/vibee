/**
 * `validateAnalysisBundle` (schema3 §5.2 Stage 3~4, I9, I18~I20).
 *
 * `view-validator.test.mjs`와 같은 방식으로 필요한 상태(evidence/memory)를 합성한다 —
 * 이 validator도 디스크를 건드리지 않는 순수 함수다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateAnalysisBundle } from "@onto/core";

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

// entityKey("route:GET /api/x") / entityKey("symbol:svc#handle") 골격 노드를 낳는 entity evidence.
const EV_ROUTE = evidenceItem("ev-route", {
  kind: "route",
  graph: { role: "entity", entity: { kind: "route", routeKey: "GET /api/x" }, label: "GET /api/x" },
});
const EV_SVC = evidenceItem("ev-svc", {
  kind: "symbol",
  graph: { role: "entity", entity: { kind: "symbol", symbolId: "svc#handle" }, label: "handle" },
});
// route → symbol 골격 링크. traceLinkRefs가 참조할 수 있는 유일한 종류(link-role evidence).
const EV_LINK = evidenceItem("ev-link", {
  kind: "api_handler",
  graph: {
    role: "link",
    from: { kind: "route", routeKey: "GET /api/x" },
    to: { kind: "symbol", symbolId: "svc#handle" },
    linkKind: "api_handler",
  },
});
const EV_MISSING = evidenceItem("ev-missing", { status: "missing", missingSinceVersion: 2 });

const EVIDENCE_INDEX = {
  analysisVersion: 1,
  fileHashes: {},
  evidence: [EV_ROUTE, EV_SVC, EV_LINK, EV_MISSING],
  adapterReport: [],
};

function memoryWith(concepts = []) {
  return { semanticVersion: 1, concepts, claims: [], canonicalScenarios: [] };
}

function conceptOf(id, name = id) {
  return { id, name, evidenceRefs: [EV_ROUTE.id], status: "active", createdAtVersion: 1, updatedAtVersion: 1 };
}

const MEMORY = memoryWith([conceptOf("cpt-1")]);

function baseBundle(overrides = {}) {
  return {
    architecture: {
      title: "아키텍처",
      components: [
        {
          id: "comp-1",
          label: "예약 서비스",
          presentationType: "backend",
          entityRefs: ["route:GET /api/x", "symbol:svc#handle"],
          evidenceRefs: [EV_ROUTE.id, EV_SVC.id],
          description: "예약을 만든다",
        },
      ],
      boundaries: [],
      connections: [],
    },
    workflow: {
      title: "워크플로우",
      lanes: [{ id: "lane-1", label: "사용자", kind: "actor" }],
      mainPath: ["node-1"],
      nodes: [
        {
          id: "node-1",
          laneId: "lane-1",
          label: "예약 요청",
          presentationType: "backend",
          entityRefs: ["route:GET /api/x"],
          evidenceRefs: [EV_ROUTE.id],
        },
      ],
      edges: [],
    },
    sequences: [],
    ...overrides,
  };
}

function validate(bundle, memory = MEMORY) {
  return validateAnalysisBundle({ bundle, evidence: EVIDENCE_INDEX, memory });
}

test("유효한 최소 Bundle은 schema와 구조 검사를 모두 통과한다", () => {
  const result = validate(baseBundle());
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.bundle);
});

test("필수 필드가 없으면 schema 오류다", () => {
  const result = validate({ architecture: {}, workflow: {}, sequences: [] });
  assert.ok(codesOf(result.diagnostics).includes("bundle/schema"));
});

test("I9 — component의 evidenceRefs가 비어 있으면 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components[0].evidenceRefs = [];
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/component-ungrounded"));
});

test("존재하지 않는 evidence id를 가리키면 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components[0].evidenceRefs = ["ev-없음"];
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("evidence/unknown-id"));
});

test("missing 상태가 된 evidence를 가리키면 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components[0].evidenceRefs.push(EV_MISSING.id);
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("evidence/not-present"));
});

test("Stage 1 골격에 없는 entity를 entityRefs가 가리키면 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components[0].entityRefs = ["symbol:없음#fn"];
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-entity"));
});

test("실재하지 않는 conceptRefs는 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components[0].conceptRefs = ["cpt-없음"];
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("view/unknown-concept"));
});

test("I9 — ComponentIO의 evidenceRefs가 비어 있으면 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components[0].inputs = [
    { label: "GET /api/bookings", kind: "route", direction: "in", evidenceRefs: [] },
  ];
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/io-ungrounded"));
});

test("boundary가 실재하지 않는 component를 wraps하면 거절된다", () => {
  const bundle = baseBundle({
    architecture: {
      ...baseBundle().architecture,
      boundaries: [{ id: "b1", label: "백엔드", kind: "layer", wraps: ["comp-없음"] }],
    },
  });
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-component"));
});

test("component.boundaryId가 실재하지 않으면 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components[0].boundaryId = "b-없음";
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-boundary"));
});

// ---------------------------------------------------------------------------
// I20 — connection은 Stage 1 골격 엣지(link evidence)로 뒷받침되어야 한다
// ---------------------------------------------------------------------------

function bundleWithConnection(traceLinkRefs) {
  const bundle = baseBundle();
  bundle.architecture.components.push({
    id: "comp-2",
    label: "핸들러",
    presentationType: "backend",
    entityRefs: ["symbol:svc#handle"],
    evidenceRefs: [EV_SVC.id],
    description: "요청을 처리한다",
  });
  bundle.architecture.connections = [
    { id: "conn-1", from: "comp-1", to: "comp-2", traceLinkRefs, evidenceRefs: [EV_LINK.id] },
  ];
  return bundle;
}

test("I20 — traceLinkRefs가 비어 있으면 거절된다", () => {
  const result = validate(bundleWithConnection([]));
  assert.ok(codesOf(result.diagnostics).includes("bundle/connection-not-grounded-in-skeleton"));
});

test("I20 — traceLinkRefs가 link-role이 아닌 evidence를 가리키면 거절된다", () => {
  const result = validate(bundleWithConnection([EV_ROUTE.id]));
  assert.ok(codesOf(result.diagnostics).includes("bundle/connection-not-grounded-in-skeleton"));
});

test("I20 — traceLinkRefs가 실제 link evidence를 가리키면 통과한다", () => {
  const result = validate(bundleWithConnection([EV_LINK.id]));
  assert.deepEqual(result.diagnostics, []);
});

test("connection의 from/to가 실재하지 않는 component를 가리키면 거절된다", () => {
  const bundle = bundleWithConnection([EV_LINK.id]);
  bundle.architecture.connections[0].to = "comp-없음";
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-component"));
});

// ---------------------------------------------------------------------------
// WorkflowEdge ↔ SequenceIR — 1엣지-1시퀀스 (schema3 §3.4)
// ---------------------------------------------------------------------------

function sequenceOf(id, triggeredByEdgeId, overrides = {}) {
  return {
    id,
    title: "예약 흐름",
    triggeredByEdgeId,
    participants: [{ id: "p1", label: "사용자" }],
    messages: [
      {
        id: "m1",
        fromParticipantId: "p1",
        toParticipantId: "p1",
        order: 0,
        label: "요청",
        kind: "call",
        evidenceRefs: [EV_LINK.id],
      },
    ],
    evidenceRefs: [EV_LINK.id],
    ...overrides,
  };
}

function bundleWithEdge(sequenceRef, sequences) {
  const bundle = baseBundle();
  bundle.workflow.edges = [
    { id: "edge-1", from: "node-1", to: "node-1", role: "main", evidenceRefs: [EV_LINK.id], sequenceRef },
  ];
  bundle.sequences = sequences;
  return bundle;
}

test("WorkflowEdge.sequenceRef가 실재하지 않는 sequence를 가리키면 거절된다", () => {
  const result = validate(bundleWithEdge("seq-없음", []));
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-sequence"));
});

test("SequenceIR.triggeredByEdgeId가 실재하지 않는 edge를 가리키면 거절된다", () => {
  const bundle = baseBundle();
  bundle.sequences = [sequenceOf("seq-1", "edge-없음")];
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-edge"));
});

test("WorkflowEdge.sequenceRef와 SequenceIR.triggeredByEdgeId가 서로 다른 곳을 가리키면 거절된다", () => {
  const bundle = bundleWithEdge("seq-1", [sequenceOf("seq-1", "edge-다른곳")]);
  bundle.workflow.edges.push({
    id: "edge-다른곳",
    from: "node-1",
    to: "node-1",
    role: "main",
    evidenceRefs: [EV_LINK.id],
  });
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/sequence-edge-mismatch"));
});

test("WorkflowEdge.sequenceRef와 SequenceIR.triggeredByEdgeId가 서로 일치하면 통과한다", () => {
  const result = validate(bundleWithEdge("seq-1", [sequenceOf("seq-1", "edge-1")]));
  assert.deepEqual(result.diagnostics, []);
});

test("중복 id는 거절된다", () => {
  const bundle = baseBundle();
  bundle.architecture.components.push({ ...bundle.architecture.components[0] });
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/duplicate-id"));
});

// ---------------------------------------------------------------------------
// SequenceIR의 activation/phase — fromStepId/toStepId는 SequenceMessage.id를 가리킨다
// (schema3 §3.5, steps[]가 없으므로 messages[]가 유일한 순서 있는 단위)
// ---------------------------------------------------------------------------

test("activation.fromStepId/toStepId가 실재하지 않는 message를 가리키면 거절된다", () => {
  const bundle = bundleWithEdge("seq-1", [
    sequenceOf("seq-1", "edge-1", {
      activations: [{ participantId: "p1", fromStepId: "m-없음", toStepId: "m1", evidenceRefs: [EV_LINK.id] }],
    }),
  ]);
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-message"));
});

test("phase.fromStepId/toStepId가 실재하지 않는 message를 가리키면 거절된다", () => {
  const bundle = bundleWithEdge("seq-1", [
    sequenceOf("seq-1", "edge-1", {
      phases: [{ id: "ph-1", label: "요청", fromStepId: "m1", toStepId: "m-없음", evidenceRefs: [EV_LINK.id] }],
    }),
  ]);
  const result = validate(bundle);
  assert.ok(codesOf(result.diagnostics).includes("bundle/unknown-message"));
});

test("activation/phase가 실재하는 message.id를 가리키면 통과한다", () => {
  const bundle = bundleWithEdge("seq-1", [
    sequenceOf("seq-1", "edge-1", {
      activations: [{ participantId: "p1", fromStepId: "m1", toStepId: "m1", evidenceRefs: [EV_LINK.id] }],
      phases: [{ id: "ph-1", label: "요청", fromStepId: "m1", toStepId: "m1", evidenceRefs: [EV_LINK.id] }],
    }),
  ]);
  const result = validate(bundle);
  assert.deepEqual(result.diagnostics, []);
});
