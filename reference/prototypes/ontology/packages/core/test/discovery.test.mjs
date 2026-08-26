/** V5 A1 — 매니페스트가 아예 없는 런타임에서도 import된 비-stdlib 패키지가 discovery 후보에 오른다. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildExternalIntegrationCatalog, isExternalLookingImportName, localModuleNames } from "@onto/core";
import { indexProject } from "@onto/evidence";

const PYTHON_NO_MANIFEST = fileURLToPath(new URL("../../../fixtures/v5/python-no-manifest/", import.meta.url));
const NESTED_LOCAL_PACKAGE = fileURLToPath(new URL("../../../fixtures/v5/nested-local-package/", import.meta.url));
const emptyFacts = { schemaVersion: 4, analysisVersion: 1, entities: [], links: [], diagnostics: [] };

test("V5 A1 — requirements.txt/pyproject.toml이 전혀 없어도 import된 non-stdlib 패키지가 discovery-gap 후보가 된다", () => {
  const index = indexProject(PYTHON_NO_MANIFEST, { analysisVersion: 1 });
  const catalog = buildExternalIntegrationCatalog(PYTHON_NO_MANIFEST, index, emptyFacts);
  const names = catalog.map((item) => item.packageName);

  assert.ok(names.includes("graphrag"), "매니페스트 없이 import+호출된 패키지도 후보가 되어야 한다");
  const graphrag = catalog.find((item) => item.packageName === "graphrag");
  assert.equal(graphrag.status, "discovery-gap");
  assert.deepEqual(graphrag.manifestPaths, []);
  assert.ok(graphrag.callPaths.length > 0, "get_local_search_engine() 호출이 call evidence로 잡혀야 한다");

  assert.ok(names.includes("flask"), "Flask도 매니페스트가 없으므로 후보가 되어야 한다");
});

test("V5 A1 — 로컬 first-party 모듈과 Python stdlib은 후보에서 제외된다", () => {
  const index = indexProject(PYTHON_NO_MANIFEST, { analysisVersion: 1 });
  const catalog = buildExternalIntegrationCatalog(PYTHON_NO_MANIFEST, index, emptyFacts);
  const names = catalog.map((item) => item.packageName);

  assert.equal(names.includes("routes"), false, "같은 저장소 안의 로컬 패키지는 외부 연동 후보가 아니다");
  assert.equal(names.includes("os"), false, "Python stdlib은 외부 연동 후보가 아니다");
});

test("V5 A1 — isExternalLookingImportName은 node/Python builtin과 로컬 모듈을 걸러낸다", () => {
  const local = new Set(["backend"]);
  assert.equal(isExternalLookingImportName("fs", local), false);
  assert.equal(isExternalLookingImportName("node:fs", local), false);
  assert.equal(isExternalLookingImportName("os", local), false);
  assert.equal(isExternalLookingImportName("backend", local), false);
  assert.equal(isExternalLookingImportName("", local), false);
  assert.equal(isExternalLookingImportName("graphrag", local), true);
});

test("V5 A1 — localModuleNames는 모든 깊이의 디렉터리/파일 stem을 뽑는다(최상위만이 아니다)", () => {
  const names = localModuleNames(["backend/app.py", "backend/routes/query_routes.py", "manage.py"]);
  assert.deepEqual([...names].sort(), ["app", "backend", "manage", "query_routes", "routes"]);
});

// ---------------------------------------------------------------------------
// 회귀 테스트 — QA-Maker-main 실제 실행에서 발견된 두 가지 오탐 (2026-08-25)
// ---------------------------------------------------------------------------

test("V5 A1 회귀 — backend/ 아래 중첩된 로컬 패키지(routes/firebase_config)는 후보에서 빠진다", () => {
  const index = indexProject(NESTED_LOCAL_PACKAGE, { analysisVersion: 1 });
  const catalog = buildExternalIntegrationCatalog(NESTED_LOCAL_PACKAGE, index, emptyFacts);
  const names = catalog.map((item) => item.packageName);

  // "backend/routes/query_routes.py"의 "routes"·"backend/firebase_config.py"의 "firebase_config"는
  // backend/app.py에서 "from routes.query_routes import ..."·"from firebase_config import db"처럼
  // 접두사 없이 import된다 — 최상위 디렉터리("backend")만 보면 이 둘을 놓친다.
  assert.equal(names.includes("routes"), false);
  assert.equal(names.includes("firebase_config"), false);
  // 진짜 외부 패키지는 그대로 후보로 남아야 한다.
  assert.ok(names.includes("graphrag"));
  assert.ok(names.includes("firebase_admin"));
});

test("V5 A1 회귀 — JS 파일의 default import 바인딩 이름이 패키지 이름으로 오인되지 않는다", () => {
  const index = indexProject(NESTED_LOCAL_PACKAGE, { analysisVersion: 1 });
  const catalog = buildExternalIntegrationCatalog(NESTED_LOCAL_PACKAGE, index, emptyFacts);
  const names = catalog.map((item) => item.packageName);

  // "import React from 'react'" / "import reportWebVitals from './reportWebVitals'"의 바인딩
  // 식별자가 Python 전용 정규식에 우연히 걸려 패키지 이름처럼 기록되던 버그.
  assert.equal(names.includes("React"), false);
  assert.equal(names.includes("reportWebVitals"), false);
  // react는 package.json에 선언되어 있으니 상태는 covered여도 후보 목록 자체에는 남는다.
  assert.ok(names.includes("react"));
});
