/**
 * V5 C3 — 서로 다른 boundary의 component를 잇는 workflow.edge인데 대응하는
 * architecture.connection이 없으면 경고한다. I20-v4 evidence 검증을 우회하지 않도록
 * hard error가 아니라 warning이라 bundle 커밋을 막지 않는다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateAnalysisBundle } from "@onto/core";

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

const EV_ROUTE = evidenceItem("ev-route", {
  kind: "route",
  graph: { role: "entity", entity: { kind: "route", routeKey: "GET /api/x" }, label: "GET /api/x" },
});
const EV_SVC = evidenceItem("ev-svc", {
  kind: "symbol",
  graph: { role: "entity", entity: { kind: "symbol", symbolId: "svc#handle" }, label: "handle" },
});
const EV_LINK = evidenceItem("ev-link", {
  kind: "api_handler",
  graph: {
    role: "link",
    from: { kind: "route", routeKey: "GET /api/x" },
    to: { kind: "symbol", symbolId: "svc#handle" },
    linkKind: "api_handler",
  },
});

const EVIDENCE_INDEX = {
  analysisVersion: 1,
  fileHashes: {},
  evidence: [EV_ROUTE, EV_SVC, EV_LINK],
  adapterReport: [],
};
const MEMORY = { semanticVersion: 1, concepts: [], claims: [], canonicalScenarios: [] };

function baseBundle(connections) {
  return {
    architecture: {
      title: "아키텍처",
      components: [
        {
          id: "comp-frontend",
          label: "프론트",
          presentationType: "frontend",
          boundaryId: "frontend",
          entityRefs: ["route:GET /api/x"],
          evidenceRefs: [EV_ROUTE.id],
        },
        {
          id: "comp-backend",
          label: "백엔드",
          presentationType: "backend",
          boundaryId: "backend",
          entityRefs: ["symbol:svc#handle"],
          evidenceRefs: [EV_SVC.id],
        },
      ],
      boundaries: [
        { id: "frontend", label: "프론트엔드", kind: "runtime", wraps: ["comp-frontend"] },
        { id: "backend", label: "백엔드", kind: "runtime", wraps: ["comp-backend"] },
      ],
      connections,
    },
    workflow: {
      title: "워크플로우",
      lanes: [{ id: "lane-1", label: "사용자", kind: "actor" }],
      mainPath: ["node-1", "node-2"],
      nodes: [
        {
          id: "node-1",
          laneId: "lane-1",
          label: "요청",
          presentationType: "frontend",
          entityRefs: ["route:GET /api/x"],
          evidenceRefs: [EV_ROUTE.id],
        },
        {
          id: "node-2",
          laneId: "lane-1",
          label: "처리",
          presentationType: "backend",
          entityRefs: ["symbol:svc#handle"],
          evidenceRefs: [EV_SVC.id],
        },
      ],
      edges: [{ id: "edge-1", from: "node-1", to: "node-2", role: "main", evidenceRefs: [EV_LINK.id] }],
    },
    sequences: [],
  };
}

function validate(bundle) {
  return validateAnalysisBundle({ bundle, evidence: EVIDENCE_INDEX, memory: MEMORY });
}

test("V5 C3 — 다른 boundary를 잇는 workflow.edge인데 대응하는 connection이 없으면 warning이다(bundle은 막지 않는다)", () => {
  const result = validate(baseBundle([]));
  const warning = result.diagnostics.find((item) => item.code === "bundle/cross-boundary-edge-not-promoted");
  assert.ok(warning, "경고가 나와야 한다");
  assert.equal(warning.severity, "warning");
  assert.ok(result.bundle, "warning만 있으므로 bundle은 커밋되어야 한다");
});

test("V5 C3 — 대응하는 connection이 있으면 warning이 나오지 않는다", () => {
  const bundle = baseBundle([
    { id: "conn-1", from: "comp-frontend", to: "comp-backend", traceLinkRefs: [EV_LINK.id], evidenceRefs: [EV_LINK.id] },
  ]);
  const result = validate(bundle);
  const codes = result.diagnostics.map((item) => item.code);
  assert.equal(codes.includes("bundle/cross-boundary-edge-not-promoted"), false);
});

test("V5 C3 — 같은 boundary 안의 edge는 경고 대상이 아니다", () => {
  const bundle = baseBundle([]);
  bundle.architecture.components[1].boundaryId = "frontend";
  bundle.architecture.boundaries = [
    { id: "frontend", label: "프론트엔드", kind: "runtime", wraps: ["comp-frontend", "comp-backend"] },
  ];
  const result = validate(bundle);
  const codes = result.diagnostics.map((item) => item.code);
  assert.equal(codes.includes("bundle/cross-boundary-edge-not-promoted"), false);
});
