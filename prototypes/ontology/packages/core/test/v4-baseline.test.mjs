/** Phase 0 — V3.2/Phase 1의 표현력 공백을 고정한다. Phase 6이 이 시험의 기대를 뒤집는다. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildEngineSystemFactStore } from "@onto/core";
import { indexProject } from "@onto/evidence";

const SVELTEKIT = fileURLToPath(new URL("../../../fixtures/v4/unsupported-sveltekit/", import.meta.url));
const PYTHON_EXTERNAL = fileURLToPath(new URL("../../../fixtures/v4/python-external/", import.meta.url));

test("Phase 0 baseline — adapter 없는 SvelteKit route/runtime은 engine fact에 나타나지 않는다", () => {
  const facts = buildEngineSystemFactStore(indexProject(SVELTEKIT, { analysisVersion: 1 }));

  assert.equal(facts.entities.some((item) => item.ref.kind === "route"), false);
  assert.equal(facts.entities.some((item) => item.ref.kind === "resource"), false);
  assert.equal(facts.links.some((item) => item.kind === "external_call"), false);
});

test("Phase 0 baseline — Python attribute SDK call은 아직 external System Link가 아니다", () => {
  const facts = buildEngineSystemFactStore(indexProject(PYTHON_EXTERNAL, { analysisVersion: 1 }));

  assert.ok(facts.entities.some((item) => item.ref.kind === "route"), "FastAPI route 골격은 이미 탐지해야 한다");
  assert.equal(facts.entities.some((item) => item.ref.kind === "resource"), false);
  assert.equal(facts.links.some((item) => item.kind === "external_call"), false);
});
