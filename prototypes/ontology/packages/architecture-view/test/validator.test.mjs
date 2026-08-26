import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { checkCitations, checkCompleteness, checkGeometry, hasError, validateArchitectureView } from "@onto/architecture-view";

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
