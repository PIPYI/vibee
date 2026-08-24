import assert from "node:assert/strict";
import test from "node:test";

import { applyBundlePatch } from "../dist/bundle-patch.js";

test("V3.2 Bundle draft는 실패 경로만 replace/add/remove할 수 있다", () => {
  const source = {
    architecture: { title: "A", connections: [] },
    workflow: { mainPath: ["one", "two"], edges: [] },
    sequences: [],
  };
  const patched = applyBundlePatch(source, [
    { op: "replace", path: "/workflow/mainPath/1", value: "three" },
    { op: "add", path: "/workflow/edges/-", value: { id: "edge" } },
    { op: "remove", path: "/architecture/title" },
  ]);

  assert.deepEqual(patched.workflow.mainPath, ["one", "three"]);
  assert.deepEqual(patched.workflow.edges, [{ id: "edge" }]);
  assert.equal("title" in patched.architecture, false);
  assert.equal(source.workflow.mainPath[1], "two", "서버 draft 원본을 직접 변경하면 안 된다");
});

test("V3.2 Bundle patch는 허용 section 밖과 prototype 경로를 거절한다", () => {
  assert.throws(() => applyBundlePatch({ workflow: {} }, [{ op: "add", path: "/analysisVersion/value", value: 1 }]));
  assert.throws(() => applyBundlePatch({ workflow: {} }, [{ op: "add", path: "/workflow/__proto__/polluted", value: true }]));
});
