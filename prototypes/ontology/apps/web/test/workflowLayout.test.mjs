/**
 * `computeWorkflowLayout` — schema3 §3.3 rank/lane 계산. `scenarioLayout.test.mjs`와
 * 같은 태도로 작성한다 — 이 파일이 대체하는 대상이다(§9).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeWorkflowLayout, edgeKey } from "../src/layout/workflowLayout.ts";

function node(id, laneId = "lane-1") {
  return { id, laneId, label: id, presentationType: "backend", entityRefs: [], evidenceRefs: [] };
}

function edge(from, to, id = `${from}-${to}`, overrides = {}) {
  return { id, from, to, role: "main", evidenceRefs: [], ...overrides };
}

function ir(overrides = {}) {
  return {
    title: "워크플로우",
    lanes: [{ id: "lane-1", label: "사용자", kind: "actor" }],
    mainPath: [],
    nodes: [node("n1"), node("n2"), node("n3")],
    edges: [edge("n1", "n2"), edge("n2", "n3")],
    ...overrides,
  };
}

test("선형 흐름 — rank가 순서대로 증가하고 back edge가 없다", () => {
  const layout = computeWorkflowLayout(ir());
  assert.equal(layout.positions.get("n1").rank, 0);
  assert.equal(layout.positions.get("n2").rank, 1);
  assert.equal(layout.positions.get("n3").rank, 2);
  assert.equal(layout.backEdgeKeys.size, 0);
});

test("laneId → laneIndex. lanes[] 순서 그대로다", () => {
  const layout = computeWorkflowLayout(
    ir({
      lanes: [
        { id: "lane-a", label: "A", kind: "actor" },
        { id: "lane-b", label: "B", kind: "system" },
      ],
      nodes: [node("n1", "lane-b"), node("n2", "lane-a"), node("n3", "lane-a")],
      edges: [edge("n1", "n2"), edge("n2", "n3")],
    }),
  );
  assert.equal(layout.lanes[0], "lane-a");
  assert.equal(layout.lanes[1], "lane-b");
  assert.equal(layout.positions.get("n1").laneIndex, 1);
  assert.equal(layout.positions.get("n2").laneIndex, 0);
});

test("구조적 cycle은 loop 필드 없이도 DFS로 back edge로 잡혀 무한 루프에 빠지지 않는다", () => {
  const layout = computeWorkflowLayout(ir({ edges: [edge("n1", "n2"), edge("n2", "n3"), edge("n3", "n1")] }));
  assert.ok(layout.backEdgeKeys.has(edgeKey("n3", "n1")));
  assert.equal(layout.positions.get("n1").rank, 0);
  assert.equal(layout.positions.size, 3);
});

test("mainPath[0]을 entry로 우선한다", () => {
  const layout = computeWorkflowLayout(
    ir({
      mainPath: ["n2"],
      nodes: [node("n1"), node("n2"), node("n3")],
      edges: [edge("n2", "n3"), edge("n1", "n3")],
    }),
  );
  assert.equal(layout.positions.get("n2").rank, 0);
  assert.equal(layout.positions.get("n3").rank, 1);
});

test("같은 입력에 두 번 계산해도 같은 좌표가 나온다 (결정론)", () => {
  const input = ir();
  const first = computeWorkflowLayout(input);
  const second = computeWorkflowLayout(input);
  assert.deepEqual([...first.positions.entries()], [...second.positions.entries()]);
});

test("v2: laneSlot — 같은 (rank, lane)에 겹치는 노드를 barycenter로 갈라 배치한다", () => {
  // n1(system,rank0) -> zeta,alpha(둘 다 system,rank1 — 겹침) -> zeta->p(up), alpha->q(down).
  // id로만 정렬하면 alpha가 zeta보다 앞이지만, zeta는 "up" 쪽으로 이어지고 alpha는 "down"
  // 쪽으로 이어지므로 barycenter는 zeta를 slot 0(위), alpha를 slot 1(아래)에 둬야 한다.
  const layout = computeWorkflowLayout(
    ir({
      lanes: [
        { id: "up", label: "위", kind: "system" },
        { id: "system", label: "시스템", kind: "system" },
        { id: "down", label: "아래", kind: "system" },
      ],
      nodes: [node("n1", "system"), node("zeta", "system"), node("alpha", "system"), node("p", "up"), node("q", "down")],
      edges: [edge("n1", "zeta"), edge("n1", "alpha"), edge("zeta", "p"), edge("alpha", "q")],
    }),
  );
  assert.equal(layout.positions.get("zeta").rank, layout.positions.get("alpha").rank);
  assert.equal(layout.positions.get("zeta").laneIndex, layout.positions.get("alpha").laneIndex);
  assert.equal(layout.positions.get("zeta").slotCount, 2);
  assert.equal(layout.positions.get("zeta").laneSlot, 0);
  assert.equal(layout.positions.get("alpha").laneSlot, 1);
  // 겹치지 않는 흔한 경우는 항상 laneSlot 0, slotCount 1이라 기존 렌더링과 같다.
  assert.equal(layout.positions.get("n1").laneSlot, 0);
  assert.equal(layout.positions.get("n1").slotCount, 1);
});
