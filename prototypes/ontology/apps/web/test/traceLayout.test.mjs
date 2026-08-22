import assert from "node:assert/strict";
import { test } from "node:test";

import { computeTraceLayout } from "../src/layout/traceLayout.ts";

test("hop 별로 column을 나누고 hop 오름차순으로 정렬한다", () => {
  const entities = [
    { id: "b", kind: "symbol", label: "b", hop: 1 },
    { id: "a", kind: "symbol", label: "a", hop: 0 },
    { id: "c", kind: "symbol", label: "c", hop: 1 },
  ];
  const layout = computeTraceLayout(entities);
  assert.deepEqual(
    layout.columns.map((c) => c.hop),
    [0, 1],
  );
  assert.deepEqual(
    layout.columns[1].entities.map((e) => e.id),
    ["b", "c"],
    "Core가 이미 정렬한 순서를 유지해야 한다",
  );
  assert.equal(layout.maxHop, 1);
});

test("빈 목록도 안전하다", () => {
  const layout = computeTraceLayout([]);
  assert.deepEqual(layout.columns, []);
  assert.equal(layout.maxHop, 0);
});
