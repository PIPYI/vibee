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

test("v2: 구조적 cycle은 DFS로 back edge로 잡혀 rank 계산이 폭주하지 않는다", () => {
  const layout = computeArchitectureLayout(
    ir([component("a"), component("b"), component("c")], [connection("a", "b"), connection("b", "c"), connection("c", "a")]),
  );
  assert.equal(layout.backEdgeKeys.size, 1);
  assert.equal(layout.positions.get("a").rank, 0);
  assert.equal(layout.positions.size, 3);
  // 순환이 있어도 rank가 노드 수를 넘어서는 폭주가 없어야 한다.
  for (const pos of layout.positions.values()) assert.ok(pos.rank <= 2);
});

test("v2: barycenter — X자로 꼬이는 연결을 id 정렬 대신 안 꼬이게 재배치한다", () => {
  // rank0=[hub] rank1=[c,d](id순) rank2=[e,f](id순). 연결은 c->f, d->e — id 순서 그대로면
  // c(위)->f(아래), d(아래)->e(위)가 서로 X자로 꼬인다. barycenter는 rank1을 [d,c]로 뒤집어
  // d(위)->e(위), c(아래)->f(아래)로 안 꼬이게 만들어야 한다.
  const layout = computeArchitectureLayout(
    ir(
      [component("hub"), component("c"), component("d"), component("e"), component("f")],
      [connection("hub", "c"), connection("hub", "d"), connection("c", "f"), connection("d", "e")],
    ),
  );
  assert.equal(layout.positions.get("d").index, 0);
  assert.equal(layout.positions.get("c").index, 1);
  assert.equal(layout.positions.get("e").index, 0);
  assert.equal(layout.positions.get("f").index, 1);
});
