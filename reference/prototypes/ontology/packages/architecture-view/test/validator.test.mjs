import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { calculateArchitectureLayout, checkCitations, checkCompleteness, checkGeometry, hasError, validateArchitectureView } from "@onto/architecture-view";

const EXAMPLE_PATH = fileURLToPath(new URL("../examples/minimal.architecture-view.json", import.meta.url));
const PYTHON_NO_MANIFEST = fileURLToPath(new URL("../../../fixtures/v5/python-no-manifest/", import.meta.url));

function loadExample() {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));
}

test("예시 문서는 schema+geometry를 통과한다 (진단 없음)", () => {
  const doc = loadExample();
  for (const component of doc.components) delete component.sources; // citation 층은 별도로 테스트한다
  const diagnostics = validateArchitectureView(doc, { projectPath: PYTHON_NO_MANIFEST });
  assert.deepEqual(diagnostics, []);
});

test("schema 위반이 있으면 geometry 등 나머지 층은 건너뛰고 schema 오류만 돌려준다", () => {
  const doc = { ...loadExample(), components: [{ id: "x" }] };
  const diagnostics = validateArchitectureView(doc, { projectPath: PYTHON_NO_MANIFEST });
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((d) => d.code === "architecture-view/schema"));
});

test("geometry — viewBox를 벗어나면 error", () => {
  const doc = loadExample();
  doc.components[0].pos = [-10, 0];
  const diagnostics = checkGeometry(doc);
  assert.ok(diagnostics.some((d) => d.code === "architecture-view/out-of-bounds"));
});

test("geometry — 겹치는 컴포넌트는 error", () => {
  const doc = loadExample();
  doc.components[1].pos = [...doc.components[0].pos];
  doc.components[1].size = [...doc.components[0].size];
  const diagnostics = checkGeometry(doc);
  assert.ok(diagnostics.some((d) => d.code === "architecture-view/overlap"));
});

test("geometry — 실재하지 않는 component를 가리키는 connection/boundary는 error", () => {
  const doc = loadExample();
  doc.connections.push({ from: "web-client", to: "ghost" });
  doc.boundaries.push({ kind: "runtime", label: "유령", wraps: ["ghost"] });
  const diagnostics = checkGeometry(doc);
  assert.ok(diagnostics.some((d) => d.code === "architecture-view/dangling-connection-ref"));
  assert.ok(diagnostics.some((d) => d.code === "architecture-view/dangling-boundary-ref"));
});

test("geometry — 24px 미만 통로도 overlap으로 거절한다", () => {
  const doc = loadExample();
  doc.components = [
    { id: "left", type: "backend", label: "Left", pos: [40, 100], size: [140, 70] },
    { id: "right", type: "backend", label: "Right", pos: [190, 100], size: [140, 70] },
  ];
  doc.boundaries = [];
  doc.connections = [];
  const diagnostics = checkGeometry(doc);
  const overlap = diagnostics.find((d) => d.code === "architecture-view/overlap");
  assert.equal(overlap?.severity, "error");
  assert.equal(overlap?.evidence.minimumGap, 24);
});

test("geometry — renderer와 같은 경로를 써서 막힌 edge를 error로 보고한다", () => {
  const doc = {
    schemaVersion: 1,
    title: "막힌 경로",
    viewBox: [800, 600],
    components: [
      { id: "source", type: "frontend", label: "Source", pos: [40, 250], size: [120, 80] },
      { id: "wall", type: "backend", label: "Wall", pos: [300, 0], size: [200, 600] },
      { id: "target", type: "database", label: "Target", pos: [640, 250], size: [120, 80] },
    ],
    boundaries: [],
    connections: [{ id: "blocked", from: "source", to: "target", label: "request" }],
  };
  const layout = calculateArchitectureLayout(doc);
  assert.deepEqual(layout.routes[0]?.crossedComponentIds, ["wall"]);
  const diagnostics = checkGeometry(doc);
  const crossing = diagnostics.find((d) => d.code === "architecture-view/edge-crosses-component");
  assert.equal(crossing?.severity, "error");
  assert.equal(crossing?.subject.throughComponentId, "wall");
  assert.ok(Array.isArray(crossing?.evidence.points));
  assert.ok((crossing?.supportedFixes.length ?? 0) > 0);
});

test("geometry — 예시의 포트·경로·라벨은 서로 충돌하지 않는다", () => {
  const layout = calculateArchitectureLayout(loadExample());
  assert.ok(layout.routes.every((route) => route.clearsComponents));
  assert.ok(layout.routes.some((route) => route.points.length > 2), "대각 관계는 dogleg으로 꺾는다");
  assert.ok(layout.labels.every((label) => label.collidesWithComponentIds.length === 0 && label.collidesWithConnectionIds.length === 0));
});

test("completeness — 탐지된 런타임을 인용하지 않으면 warning (hard reject 아님)", () => {
  const doc = loadExample();
  const topology = {
    runtimes: [
      {
        id: "runtime:1",
        label: "미인용 런타임",
        rootPath: "unrelated",
        kind: "service",
        entrypointRefs: ["file:unrelated/app.py"],
        evidenceRefs: [],
        origin: "route-cluster",
      },
    ],
    dataStores: [],
    routeSurfaces: [],
    coverage: {
      detectedRuntimeCount: 1,
      representedRuntimeCount: 0,
      detectedDataStoreCount: 0,
      representedDataStoreCount: 0,
      detectedRouteSurfaceCount: 0,
      representedRouteSurfaceCount: 0,
      missingRuntimeIds: ["runtime:1"],
      missingDataStoreIds: [],
      missingRouteSurfaceIds: [],
      sharedBoundaryRuntimeIds: [],
    },
  };
  const diagnostics = checkCompleteness(doc, topology);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "architecture-view/runtime-not-represented");
  assert.equal(diagnostics[0].severity, "warning");
});

test("completeness — sources가 런타임 entrypoint를 인용하면 통과한다", () => {
  const doc = loadExample();
  doc.components[0].sources.push({ path: "app.py" });
  const topology = {
    runtimes: [
      {
        id: "runtime:1",
        label: "인용된 런타임",
        rootPath: "",
        kind: "service",
        entrypointRefs: ["file:app.py"],
        evidenceRefs: [],
        origin: "manifest",
      },
    ],
    dataStores: [],
    routeSurfaces: [],
    coverage: {
      detectedRuntimeCount: 1,
      representedRuntimeCount: 1,
      detectedDataStoreCount: 0,
      representedDataStoreCount: 0,
      detectedRouteSurfaceCount: 0,
      representedRouteSurfaceCount: 0,
      missingRuntimeIds: [],
      missingDataStoreIds: [],
      missingRouteSurfaceIds: [],
      sharedBoundaryRuntimeIds: [],
    },
  };
  assert.deepEqual(checkCompleteness(doc, topology), []);
});

test("completeness — 접두 경로를 인정하고 빈 root route-cluster가 저장소 전체를 덮지 않는다", () => {
  const doc = loadExample();
  doc.components = [{
    id: "api",
    type: "backend",
    label: "API",
    pos: [50, 50],
    size: [180, 80],
    sources: [{ path: "services/api" }],
  }];
  doc.boundaries = [];
  doc.connections = [];
  const topology = {
    runtimes: [
      {
        id: "runtime:api",
        label: "API runtime",
        rootPath: "services/api",
        kind: "service",
        entrypointRefs: ["file:services/api/src/main.py"],
        evidenceRefs: [],
        origin: "manifest",
      },
      {
        id: "runtime:root-routes",
        label: "root route cluster",
        rootPath: "",
        kind: "service",
        entrypointRefs: [],
        evidenceRefs: [],
        origin: "route-cluster",
      },
    ],
    dataStores: [],
    routeSurfaces: [{
      id: "route:other",
      label: "other route",
      filePath: "other/routes.py",
      runtimeId: "runtime:root-routes",
      routeKeys: ["GET /health"],
      entityRefs: ["file:other/routes.py"],
      evidenceRefs: [],
    }],
    coverage: {
      detectedRuntimeCount: 2,
      representedRuntimeCount: 0,
      detectedDataStoreCount: 0,
      representedDataStoreCount: 0,
      detectedRouteSurfaceCount: 1,
      representedRouteSurfaceCount: 0,
      missingRuntimeIds: [],
      missingDataStoreIds: [],
      missingRouteSurfaceIds: [],
      sharedBoundaryRuntimeIds: [],
    },
  };
  const diagnostics = checkCompleteness(doc, topology);
  assert.ok(!diagnostics.some((item) => item.subject.runtimeId === "runtime:api"), JSON.stringify(diagnostics));
  assert.ok(diagnostics.some((item) => item.subject.runtimeId === "runtime:root-routes"), JSON.stringify(diagnostics));
  assert.ok(diagnostics.some((item) => item.code === "architecture-view/route-surface-not-represented"));
});

test("completeness — uses 외부 서비스는 사용하는 파일을 인용하지 않으면 warning을 낸다", () => {
  const doc = loadExample();
  doc.components = [{
    id: "web",
    type: "frontend",
    label: "웹",
    pos: [50, 50],
    size: [180, 80],
    sources: [{ path: "src/App.tsx" }],
  }];
  doc.boundaries = [];
  doc.connections = [];
  const topology = {
    runtimes: [], dataStores: [], routeSurfaces: [],
    coverage: {
      detectedRuntimeCount: 0, representedRuntimeCount: 0,
      detectedDataStoreCount: 0, representedDataStoreCount: 0,
      detectedRouteSurfaceCount: 0, representedRouteSurfaceCount: 0,
      missingRuntimeIds: [], missingDataStoreIds: [], missingRouteSurfaceIds: [], sharedBoundaryRuntimeIds: [],
    },
  };
  const facts = {
    schemaVersion: 4,
    analysisVersion: 1,
    entities: [{
      id: "resource:npm:openai",
      ref: { kind: "resource", namespace: "npm", key: "openai" },
      kind: "external_library",
      origin: "vibee",
      certainty: "grounded",
      evidenceRefs: ["ev-openai"],
      dependsOnEvidenceRefs: ["ev-openai"],
      status: "valid",
      firstSeenVersion: 1,
      lastValidatedVersion: 1,
    }],
    links: [{
      id: "uses:openai",
      from: { kind: "symbol", symbolId: "src/services/ai.ts#ask" },
      to: { kind: "resource", namespace: "npm", key: "openai" },
      kind: "uses",
      origin: "vibee",
      certainty: "grounded",
      evidenceRefs: ["ev-openai"],
      dependsOnEvidenceRefs: ["ev-openai"],
      status: "valid",
      firstSeenVersion: 1,
      lastValidatedVersion: 1,
    }],
    diagnostics: [],
  };
  const missing = checkCompleteness(doc, topology, facts);
  assert.ok(missing.some((item) => item.code === "architecture-view/external-service-not-represented"));

  doc.components[0].sources.push({ path: "src/services" });
  assert.ok(!checkCompleteness(doc, topology, facts).some((item) => item.code === "architecture-view/external-service-not-represented"));
});

function clearSources(doc) {
  for (const component of doc.components) delete component.sources;
  return doc;
}

test("citation — 실재하는 파일·줄 범위는 통과한다 (실제 fixture)", () => {
  const doc = clearSources(loadExample());
  doc.components[0].sources = [{ path: "app.py", line: 1, endLine: 3 }];
  const diagnostics = checkCitations(doc, { projectPath: PYTHON_NO_MANIFEST });
  assert.deepEqual(diagnostics, []);
});

test("citation — 존재하지 않는 파일을 인용하면 error (허구 grounding 0)", () => {
  const doc = clearSources(loadExample());
  doc.components[0].sources = [{ path: "does-not-exist.py" }];
  const diagnostics = checkCitations(doc, { projectPath: PYTHON_NO_MANIFEST });
  assert.ok(diagnostics.some((d) => d.code === "architecture-view/citation-missing-file"));
  assert.ok(hasError(diagnostics));
});

test("citation — 파일은 있지만 줄 범위를 벗어나면 error", () => {
  const doc = clearSources(loadExample());
  doc.components[0].sources = [{ path: "app.py", line: 9999 }];
  const diagnostics = checkCitations(doc, { projectPath: PYTHON_NO_MANIFEST });
  assert.ok(diagnostics.some((d) => d.code === "architecture-view/citation-out-of-range"));
});
