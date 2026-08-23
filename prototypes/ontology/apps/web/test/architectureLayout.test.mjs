/**
 * `computeArchitectureLayout` — schema3 §3.2 rank 계산.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeArchitectureLayout } from "../src/layout/architectureLayout.ts";

function component(id) {
  return { id, label: id, presentationType: "backend", entityRefs: [], evidenceRefs: [] };
}

function connection(from, to, id = `${from}-${to}`) {
  return { id, from, to, traceLinkRefs: [], evidenceRefs: [] };
}

function ir(components, connections, boundaries = []) {
  return { title: "아키텍처", components, boundaries, connections };
}

test("선형 연결 — rank가 순서대로 증가한다", () => {
  const layout = computeArchitectureLayout(ir([component("a"), component("b"), component("c")], [connection("a", "b"), connection("b", "c")]));
  assert.equal(layout.positions.get("a").rank, 0);
  assert.equal(layout.positions.get("b").rank, 1);
  assert.equal(layout.positions.get("c").rank, 2);
  assert.equal(layout.maxRank, 2);
});

test("같은 rank 안에서는 id로 정렬해 결정론을 지킨다", () => {
  const layout = computeArchitectureLayout(ir([component("z"), component("a")], []));
  assert.equal(layout.positions.get("a").index, 0);
  assert.equal(layout.positions.get("z").index, 1);
});

test("들어오는 연결이 없는 component가 rank 0이다 — 여러 root도 모두 rank 0", () => {
  const layout = computeArchitectureLayout(
    ir([component("api"), component("worker"), component("db")], [connection("api", "db"), connection("worker", "db")]),
  );
  assert.equal(layout.positions.get("api").rank, 0);
  assert.equal(layout.positions.get("worker").rank, 0);
  assert.equal(layout.positions.get("db").rank, 1);
});

test("self-loop connection은 rank 계산에 영향을 주지 않는다", () => {
  const layout = computeArchitectureLayout(ir([component("a")], [connection("a", "a")]));
  assert.equal(layout.positions.get("a").rank, 0);
});

test("같은 입력에 두 번 계산해도 같은 좌표가 나온다 (결정론)", () => {
  const input = ir([component("b"), component("a"), component("c")], [connection("a", "b"), connection("b", "c")]);
  const first = computeArchitectureLayout(input);
  const second = computeArchitectureLayout(input);
  assert.deepEqual([...first.positions.entries()], [...second.positions.entries()]);
});
