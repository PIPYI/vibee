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
