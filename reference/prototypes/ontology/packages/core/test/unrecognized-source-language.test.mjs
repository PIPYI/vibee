/**
 * Fix 3 (미지 언어 catch-all) — `isSourceFile`의 닫힌 허용목록 밖 언어는 gap으로도 안 잡히고
 * 완전히 사라지던 사각지대를, 특정 프레임워크를 하드코딩하지 않는 일반 메커니즘으로 없앤다.
 *
 * Elixir/Phoenix를 골랐다 — 이 코드베이스 어디에도 Elixir 전용 코드가 없다(grep으로 확인
 * 가능). 그런데도 이 gap이 잡힌다는 것 자체가 메커니즘이 일반적임을 증명한다.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { planDiscoveryGaps, reconcileSystemFactStore } from "@onto/core";
import { diffEvidence, indexProject } from "@onto/evidence";

const UNRECOGNIZED_ELIXIR = fileURLToPath(new URL("../../../fixtures/v5/unrecognized-elixir/", import.meta.url));

test("Elixir/Phoenix — 인식된 언어 밖 파일은 evidence가 전혀 생기지 않는다 (지금까지의 사각지대)", () => {
  const index = indexProject(UNRECOGNIZED_ELIXIR, { analysisVersion: 1 });
  assert.deepEqual(index.evidence, [], "adapter/언어 파서가 없으니 kind:\"file\" evidence조차 없다");
});

test("Elixir/Phoenix — unindexedFiles가 그 파일들을 확장자별로 관측 가능하게 남긴다", () => {
  const index = indexProject(UNRECOGNIZED_ELIXIR, { analysisVersion: 1 });
  const byExtension = new Map();
  for (const item of index.unindexedFiles) {
    byExtension.set(item.extension, (byExtension.get(item.extension) ?? 0) + 1);
  }
  assert.equal(byExtension.get(".ex"), 3, "router/controller/application 세 개의 .ex 파일");
  assert.equal(byExtension.get(".exs"), 1, "mix.exs 하나");
});

test("Elixir/Phoenix — planDiscoveryGaps가 언어별 전용 코드 없이 unrecognized-source-language gap을 만든다", () => {
  const index = indexProject(UNRECOGNIZED_ELIXIR, { analysisVersion: 1 });
  const diffs = diffEvidence(undefined, index);
  const facts = reconcileSystemFactStore({
    previous: { schemaVersion: 4, analysisVersion: 0, entities: [], links: [], diagnostics: [] },
    evidence: index,
    diffs,
  });
  const { gaps } = planDiscoveryGaps({ projectPath: UNRECOGNIZED_ELIXIR, evidence: index, facts });

  // 이 작은 fixture에서는 .ex(3개, 개수 임계치)와 .exs(1개, 이 fixture에서는 전체의 25%라
  // 비율 임계치)가 각각 독립된 gap이 된다 — 확장자별로 묶는다는 게 이 테스트의 핵심이다.
  const languageGaps = gaps.filter((gap) => gap.kind === "unrecognized-source-language");
  assert.equal(languageGaps.length, 2);
  const exGap = languageGaps.find((gap) => gap.filePaths.some((path) => path.endsWith(".ex")));
  assert.ok(exGap, ".ex 그룹이 있어야 한다");
  assert.equal(exGap.priority, "medium");
  assert.deepEqual(
    exGap.filePaths.slice().sort(),
    [
      "lib/my_app/application.ex",
      "lib/my_app/router.ex",
      "lib/my_app/user_controller.ex",
    ],
  );
  assert.doesNotMatch(exGap.reason, /elixir|phoenix/iu, "reason 텍스트는 프레임워크 이름을 언급하지 않는다");
  const exsGap = languageGaps.find((gap) => gap.filePaths.includes("mix.exs"));
  assert.ok(exsGap, ".exs 그룹도 이 작은 fixture에서는 비율 임계치를 넘는다");
});

test("대형 저장소에서 우연히 섞인 파일 1개(개수·비율 둘 다 임계치 미만)는 gap이 되지 않는다", () => {
  // 실제 큰 저장소를 흉내낸 합성 EvidenceIndex — 인식된 파일 99개 중 미지 확장자 1개는
  // 개수(<3)도 비율(<5%)도 임계치를 못 넘으므로 gap이 되면 안 된다. 작은 fixture로는
  // 이 "임계치 미만" 경로를 자연스럽게 재현하기 어려워 합성 입력을 쓴다.
  const fileHashes = Object.fromEntries(
    Array.from({ length: 99 }, (_, i) => [`src/file-${i}.ts`, `hash-${i}`]),
  );
  const evidence = {
    analysisVersion: 1,
    fileHashes,
    evidence: [],
    adapterReport: [],
    unindexedFiles: [{ filePath: "misc/one-off.foo", extension: ".foo" }],
  };
  const facts = { schemaVersion: 4, analysisVersion: 1, entities: [], links: [], diagnostics: [] };
  const { gaps } = planDiscoveryGaps({ projectPath: UNRECOGNIZED_ELIXIR, evidence, facts });
  assert.deepEqual(gaps.filter((gap) => gap.kind === "unrecognized-source-language"), []);
});
