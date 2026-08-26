/**
 * V5 C1 — 파이프라인이 실행마다 스스로 만든 산출물 폴더(예: GraphRAG의 타임스탬프 run
 * 디렉터리)를 사람이 선언한 데이터 자산과 구분한다. 삭제하지 않고 origin만 표시하며,
 * generated-artifact는 커버리지 게이트의 missingDataStoreIds 집계에서 빠진다.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { assessRepositoryCoverage, detectRepositoryTopology } from "@onto/core";
import { indexProject } from "@onto/evidence";

const ROOT = fileURLToPath(new URL("../../../fixtures/v5/generated-artifact-data/", import.meta.url));

test("V5 C1 — 타임스탬프 run 디렉터리가 반복되고 같은 파일명이 되풀이되면 generated-artifact로 표시한다", () => {
  const index = indexProject(ROOT, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(ROOT, index);

  const generated = topology.dataStores.filter((store) => store.origin === "generated-artifact");
  const declared = topology.dataStores.filter((store) => store.origin === "declared");

  assert.equal(generated.length, 1, "20240101-120000/20240102-130501 아래 create_final_nodes.json이 한 그룹으로 묶여야 한다");
  assert.deepEqual(
    generated[0].entityRefs.sort(),
    [
      "file:data/20240101-120000/create_final_nodes.json",
      "file:data/20240102-130501/create_final_nodes.json",
    ].sort(),
  );

  assert.equal(declared.length, 1, "data/missions.json은 timestamp 디렉터리 밖이므로 declared로 남아야 한다");
  assert.deepEqual(declared[0].entityRefs, ["file:data/missions.json"]);
});

test("V5 C1 — generated-artifact는 architecture에 없어도 missingDataStoreIds에 잡히지 않는다(declared는 그대로 잡힌다)", () => {
  const index = indexProject(ROOT, { analysisVersion: 1 });
  const topology = detectRepositoryTopology(ROOT, index);
  const assessed = assessRepositoryCoverage(topology, { title: "빈 지도", components: [], boundaries: [], connections: [] });

  const generatedId = topology.dataStores.find((store) => store.origin === "generated-artifact").id;
  const declaredId = topology.dataStores.find((store) => store.origin === "declared").id;

  assert.equal(assessed.coverage.missingDataStoreIds.includes(generatedId), false);
  assert.equal(assessed.coverage.missingDataStoreIds.includes(declaredId), true);
});
