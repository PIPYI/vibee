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

test("V4 Phase 5 — /api/index 직후 /api/analyze 처럼 두 번 연속 재색인하면, semanticVersion이 아직 0이어도 두 번째 discovery는 full이 아니다", async () => {
  // 회귀 재현: /api/index(재색인만)와 /api/analyze가 연달아 오면, Semantic Patch가
  // 한 번도 커밋되지 않았으므로 semanticVersion/memory.concepts는 두 호출 모두에서 0이다.
  // firstAnalysis를 그 둘로 유추하면 두 번째 호출도 "첫 분석"으로 오판해 파일이
  // 하나도 안 바뀌었는데도 전체 discovery가 중복 실행된다 (docs v6 §4의 gen2→3 관찰).
  //
  // 주의: bundle이 아직 없으므로 semanticTurnRequired/assemblyTurnRequired는 두 번째
  // 호출에서도 여전히 true다 — Vibee가 이 프로젝트를 한 번도 분석한 적이 없어서 실제로
  // 불려야 하기 때문이다(이건 버그가 아니라 의도된 동작). 이 테스트가 검증하는 건 오직
  // "파일이 안 바뀌었으면 discovery 자체는 다시 full로 안 돈다"는 것이다.
  const root = project({ "src/value.ts": "export const value = 1;\n" });
  const first = await performReindex(new SemanticStore(root), root, undefined);
  assert.equal(first.plan.fullDiscovery, true);
  const second = await performReindex(new SemanticStore(root), root, undefined);
  assert.equal(second.plan.fullDiscovery, false);
  assert.equal(second.plan.discoveryGaps.length, 0);
});

test("V4 Phase 8 — off arm은 integration catalog는 관측하되 open-world discovery gap은 provider에 주지 않는다", async () => {
  const root = project({
    "package.json": JSON.stringify({ dependencies: { "novel-ai-sdk": "1.0.0" } }),
    "src/app.ts": "import { Client } from 'novel-ai-sdk';\nnew Client().responses.create({ input: 'hello' });\n",
  });
  const result = await performReindex(new SemanticStore(root), root, undefined, undefined, "off");
  assert.equal(result.plan.integrationCatalog.some((item) => item.packageName === "novel-ai-sdk"), true);
  assert.deepEqual(result.plan.discoveryGaps, []);
});
