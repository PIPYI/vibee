import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";

import { SemanticStore } from "@onto/core";

import { performReindex } from "../dist/index.js";

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function project(files) {
  const root = mkdtempSync(join(tmpdir(), "onto-v4-pipeline-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return root;
}

async function seedCompletedAnalysis(root) {
  const first = await performReindex(new SemanticStore(root), root, undefined);
  const store = new SemanticStore(root);
  await store.commit("test completed analysis", "patch", (snapshot) => {
    snapshot.project.semanticVersion = 1;
    snapshot.project.semanticReconciledAnalysisVersion = snapshot.project.analysisVersion;
    snapshot.memory.semanticVersion = 1;
    snapshot.analysisBundle = {
      analysisVersion: snapshot.project.analysisVersion,
      semanticVersion: 1,
      freshness: "current",
      architecture: { title: "system", components: [], boundaries: [], connections: [] },
      workflow: { title: "flow", lanes: [], mainPath: [], nodes: [], edges: [] },
      sequences: [],
    };
    return snapshot;
  });
  return first;
}

test("V4 Phase 5 — 같은 snapshot 재분석은 provider turn 0 fast path다", async () => {
  const root = project({ "src/value.ts": "export const value = 1;\n" });
  await seedCompletedAnalysis(root);
  const second = await performReindex(new SemanticStore(root), root, undefined);
  assert.equal(second.plan.mode, "fast-path");
  assert.equal(second.plan.semanticTurnRequired, false);
  assert.equal(second.plan.assemblyTurnRequired, false);
  assert.equal(second.after.analysisBundle.analysisVersion, second.nextVersion);
});

test("V4 Phase 4 — 구조와 무관한 CSS 변경도 provider turn을 만들지 않는다", async () => {
  const root = project({
    "src/value.ts": "export const value = 1;\n",
    "src/theme.css": ".button { color: red; }\n",
  });
  await seedCompletedAnalysis(root);
  writeFileSync(join(root, "src/theme.css"), ".button { color: blue; }\n", "utf8");
  const second = await performReindex(new SemanticStore(root), root, undefined);
  assert.equal(second.plan.mode, "fast-path");
  assert.equal(second.plan.semanticTurnRequired, false);
});
