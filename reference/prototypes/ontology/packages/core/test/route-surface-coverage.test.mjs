/**
 * V5 A3 (flagship) — 라우트 표면 커버리지를 런타임/데이터스토어와 같은 하나의 일반화된
 * 메커니즘(componentsCoverEntityRefs)으로 검증한다. 매니페스트가 있든 없든, 프레임워크
 * adapter든 generic-patterns.ts 탐지든 상관없이 route Evidence가 있는 파일은 아키텍처
 * 어딘가에 나타나야 한다.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  assessRepositoryCoverage,
  detectRepositoryTopology,
  validateAnalysisBundle,
} from "@onto/core";
import { indexProject } from "@onto/evidence";

const JAVA_SPRING = fileURLToPath(new URL("../../../fixtures/v5/java-spring/", import.meta.url));
const PYTHON_NO_MANIFEST = fileURLToPath(new URL("../../../fixtures/v5/python-no-manifest/", import.meta.url));
const JAVA_FILE = "src/main/java/com/example/controller/UserController.java";

test("V5 A3 — 매니페스트가 전혀 없어도 route evidence만으로 route surface가 잡힌다", () => {
  const index = indexProject(JAVA_SPRING, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(JAVA_SPRING, index);

  assert.equal(topology.routeSurfaces.length, 1);
  assert.equal(topology.routeSurfaces[0].filePath, JAVA_FILE);
  assert.deepEqual(topology.routeSurfaces[0].routeKeys, ["ANY /api/users", "GET /api/users/{id}", "POST /api/users"]);
});

test("V5 (b) — package.json이 없어도 route evidence 클러스터로 런타임이 추정된다(origin: route-cluster)", () => {
  const index = indexProject(JAVA_SPRING, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(JAVA_SPRING, index);

  assert.equal(topology.runtimes.length, 1, "manifest는 없지만 route evidence로 추정된 런타임 1개가 있어야 한다");
  assert.equal(topology.runtimes[0].origin, "route-cluster");
  assert.equal(topology.runtimes[0].manifestPath, undefined, "route-cluster 런타임은 manifest를 모른다");
  assert.equal(topology.runtimes[0].entrypointRefs.length, 0, "entrypoint도 모른다 — route evidence만 안다");
});

test("V5 A3 — 아키텍처가 라우트 표면을 대표하지 않으면 completeness receipt에 남고 bundle을 막는다", () => {
  const index = indexProject(JAVA_SPRING, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(JAVA_SPRING, index);
  const assessed = assessRepositoryCoverage(topology, { title: "빈 지도", components: [], boundaries: [], connections: [] });

  assert.equal(assessed.coverage.representedRouteSurfaceCount, 0);
  assert.deepEqual(assessed.coverage.missingRouteSurfaceIds, [topology.routeSurfaces[0].id]);

  const result = validateAnalysisBundle({
    projectPath: JAVA_SPRING,
    evidence: index,
    memory: { semanticVersion: 0, concepts: [], claims: [], canonicalScenarios: [] },
    bundle: {
      architecture: { title: "빈 지도", components: [], boundaries: [], connections: [], viewPlan: { primaryPath: [], groups: [] } },
      workflow: { title: "흐름", lanes: [], mainPath: [], nodes: [], edges: [] },
      sequences: [],
    },
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes("bundle/route-surface-not-represented"));
  assert.equal(result.bundle, undefined);
});

test("V5 A3 — 라우트 파일의 entityRefs를 가진 component가 있으면 라우트 표면이 대표된다", () => {
  const index = indexProject(JAVA_SPRING, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(JAVA_SPRING, index);
  const fileEvidence = index.evidence.find((item) => item.kind === "file" && item.filePath === JAVA_FILE);
  const architecture = {
    title: "지도",
    components: [{
      id: "user-controller",
      label: "UserController",
      presentationType: "service",
      layer: "interface",
      boundaryId: "backend",
      entityRefs: [`file:${JAVA_FILE}`],
      evidenceRefs: [fileEvidence.id],
    }],
    boundaries: [{ id: "backend", label: "백엔드", kind: "runtime", wraps: ["user-controller"] }],
    connections: [],
  };
  const assessed = assessRepositoryCoverage(topology, architecture);

  assert.equal(assessed.coverage.representedRouteSurfaceCount, 1);
  assert.deepEqual(assessed.coverage.missingRouteSurfaceIds, []);
});

test("V5 A3 — 매니페스트 없이 import+호출된 패키지가 아키텍처에 없으면 external-integration warning을 낸다(bundle은 막지 않는다)", () => {
  const index = indexProject(PYTHON_NO_MANIFEST, { analysisVersion: 1 });
  const result = validateAnalysisBundle({
    projectPath: PYTHON_NO_MANIFEST,
    evidence: index,
    memory: { semanticVersion: 0, concepts: [], claims: [], canonicalScenarios: [] },
    bundle: {
      architecture: { title: "빈 지도", components: [], boundaries: [], connections: [], viewPlan: { primaryPath: [], groups: [] } },
      workflow: { title: "흐름", lanes: [], mainPath: [], nodes: [], edges: [] },
      sequences: [],
    },
  });
  const warning = result.diagnostics.find(
    (diagnostic) => diagnostic.code === "bundle/external-integration-not-represented" && diagnostic.subject.packageName === "graphrag",
  );
  assert.ok(warning, "graphrag가 discovery-gap + callPaths를 가지므로 warning이 나와야 한다");
  assert.equal(warning.severity, "warning");
});
