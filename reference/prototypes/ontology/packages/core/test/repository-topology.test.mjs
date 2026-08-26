import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { assessRepositoryCoverage, detectRepositoryTopology, validateAnalysisBundle } from "@onto/core";
import { indexProject } from "@onto/evidence";

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "onto-topology-"));
  roots.push(root);
  const files = {
    "package.json": JSON.stringify({ name: "traveler", scripts: { start: "expo start" }, dependencies: { expo: "1" } }),
    "app/_layout.tsx": "export default function Layout() { return null; }",
    "data/missions.json": "[]",
    "admin/package.json": JSON.stringify({ name: "admin", scripts: { dev: "vite" }, devDependencies: { vite: "1" } }),
    "admin/src/main.tsx": "export const Admin = () => null;",
    "admin/data/users.json": "[]",
  };
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  return root;
}

test("manifest·entrypoint·data asset에서 독립 런타임과 저장소를 결정론적으로 탐지한다", () => {
  const root = fixture();
  const index = indexProject(root, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(root, index);

  assert.deepEqual(topology.runtimes.map((runtime) => runtime.rootPath), ["", "admin"]);
  assert.deepEqual(topology.runtimes.map((runtime) => runtime.entrypointRefs), [
    ["file:app/_layout.tsx"],
    ["file:admin/src/main.tsx"],
  ]);
  assert.equal(topology.dataStores.length, 2);
  assert.deepEqual(topology.dataStores.map((store) => store.rootPath).sort(), ["admin/data", "data"]);
});

test("Architecture가 admin과 data를 생략하면 completeness receipt에 그대로 남는다", () => {
  const root = fixture();
  const index = indexProject(root, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(root, index);
  const traveler = topology.runtimes.find((runtime) => runtime.rootPath === "");
  const fileEvidence = index.evidence.find((item) => item.kind === "file" && item.filePath === "app/_layout.tsx");
  const architecture = {
    title: "지도",
    components: [{
      id: "traveler-ui",
      label: "여행자 화면",
      presentationType: "frontend",
      layer: "interface",
      boundaryId: "traveler",
      entityRefs: traveler.entrypointRefs,
      evidenceRefs: [fileEvidence.id],
    }],
    boundaries: [{ id: "traveler", label: "여행자", kind: "runtime", wraps: ["traveler-ui"] }],
    connections: [],
  };
  const assessed = assessRepositoryCoverage(topology, architecture);

  assert.equal(assessed.coverage.representedRuntimeCount, 1);
  assert.equal(assessed.coverage.missingRuntimeIds.length, 1);
  assert.equal(assessed.coverage.missingDataStoreIds.length, 2);

  const result = validateAnalysisBundle({
    projectPath: root,
    evidence: index,
    memory: { semanticVersion: 0, concepts: [], claims: [], canonicalScenarios: [] },
    bundle: {
      architecture: { ...architecture, viewPlan: { primaryPath: ["traveler-ui"], groups: [] } },
      workflow: { title: "흐름", lanes: [], mainPath: [], nodes: [], edges: [] },
      sequences: [],
    },
  });
  const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes("bundle/runtime-not-represented"));
  assert.ok(codes.includes("bundle/data-store-not-represented"));
  assert.equal(result.bundle, undefined, "completeness 오류가 있으면 bundle을 커밋할 수 없어야 한다");
});

test("서로 다른 런타임이 같은 boundaryId를 쓰면 collapsed runtime으로 탐지한다", () => {
  const root = fixture();
  const index = indexProject(root, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(root, index);
  const components = topology.runtimes.map((runtime) => ({
    id: `component-${runtime.id}`,
    label: runtime.label,
    presentationType: "frontend",
    boundaryId: "all-in-one",
    entityRefs: runtime.entrypointRefs,
    evidenceRefs: runtime.evidenceRefs,
  }));
  const assessed = assessRepositoryCoverage(topology, {
    title: "잘못 합친 지도",
    components,
    boundaries: [{ id: "all-in-one", label: "전체", kind: "runtime", wraps: components.map((component) => component.id) }],
    connections: [],
  });
  assert.equal(assessed.coverage.sharedBoundaryRuntimeIds.length, 2);
});
