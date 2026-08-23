/**
 * `edgeRouting` — schema2 §1.2 A10·M10. archify `automaticPortSpread`의 축소판이
 * 결정론적이고(같은 입력 → 같은 출력), 라벨 충돌을 실제로 없애는지 검증한다.
 *
 * Node 24가 `.ts`를 그대로 실행할 수 있어 컴파일 없이 소스를 직접 import한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countCrossings,
  properSegmentIntersection,
  rectsOverlap,
  reduceCrossings,
  resolveLabelOverlaps,
  routedPath,
  routedPathAvoiding,
  routedGeometryAvoiding,
  routeEdges,
  segmentIntersectsRect,
} from "../src/layout/edgeRouting.ts";

function box(id, left, top, width = 190, height = 60) {
  return { id, left, top, right: left + width, bottom: top + height, cy: top + height / 2 };
}

test("rectsOverlap — 겹치는 사각형과 안 겹치는 사각형을 구별한다", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  const b = { x: 5, y: 5, width: 10, height: 10 };
  const c = { x: 20, y: 20, width: 10, height: 10 };
  assert.equal(rectsOverlap(a, b), true);
  assert.equal(rectsOverlap(a, c), false);
});

test("rectsOverlap — gap을 주면 붙어 있어도 겹침으로 본다", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  const b = { x: 12, y: 0, width: 10, height: 10 }; // 2px 떨어져 있다
  assert.equal(rectsOverlap(a, b), false);
  assert.equal(rectsOverlap(a, b, 4), true);
});

test("rectsOverlap — non-finite 좌표는 겹침이 아니라 unknown이다", () => {
  const a = { x: NaN, y: 0, width: 10, height: 10 };
  const b = { x: 0, y: 0, width: 10, height: 10 };
  assert.equal(rectsOverlap(a, b), false);
});

test("routeEdges — 같은 입력을 두 번 넣으면 좌표가 바이트 단위로 같다 (결정론)", () => {
  const boxes = new Map([box("a", 0, 0), box("b", 400, 0), box("c", 400, 120), box("d", 400, 240)].map((b) => [b.id, b]));
  const edges = [
    { key: "e1", fromId: "a", toId: "b" },
    { key: "e2", fromId: "a", toId: "c" },
    { key: "e3", fromId: "a", toId: "d" },
  ];
  const first = routeEdges(edges, (id) => boxes.get(id));
  const second = routeEdges(edges, (id) => boxes.get(id));
  assert.deepEqual(first, second);
});

test("routeEdges — 한 노드의 같은 면에서 만나는 엣지는 세로로 고르게 펼쳐진다", () => {
  const boxes = new Map([box("a", 0, 0), box("b", 400, 0), box("c", 400, 120), box("d", 400, 240)].map((b) => [b.id, b]));
  const edges = [
    { key: "e1", fromId: "a", toId: "b" },
    { key: "e2", fromId: "a", toId: "c" },
    { key: "e3", fromId: "a", toId: "d" },
  ];
  const routed = routeEdges(edges, (id) => boxes.get(id));
  const fromYs = routed.map((r) => r.fromPort.y).sort((x, y) => x - y);
  // 세 포트가 서로 달라야 한다 — 안 그러면 한 점에서 겹쳐 나간다.
  assert.equal(new Set(fromYs).size, 3);
  // a의 중심(cy=30)을 기준으로 대칭으로 퍼져야 한다.
  const centerA = boxes.get("a").cy;
  const spreadAroundCenter = fromYs[0] < centerA && fromYs[2] > centerA;
  assert.ok(spreadAroundCenter, `${JSON.stringify(fromYs)} 가 ${centerA} 주변으로 퍼지지 않았다`);
});

test("routeEdges — 상대 노드의 y좌표로 먼저 정렬해 시각적 교차를 줄인다", () => {
  const boxes = new Map([box("a", 0, 0), box("b", 400, 240), box("c", 400, 120), box("d", 400, 0)].map((b) => [b.id, b]));
  // 등록 순서는 뒤섞였지만(b가 제일 아래, d가 제일 위) 결과는 상대 y 오름차순이어야 한다.
  const edges = [
    { key: "toB", fromId: "a", toId: "b" },
    { key: "toC", fromId: "a", toId: "c" },
    { key: "toD", fromId: "a", toId: "d" },
  ];
  const routed = new Map(routeEdges(edges, (id) => boxes.get(id)).map((r) => [r.key, r]));
  assert.ok(routed.get("toD").fromPort.y < routed.get("toC").fromPort.y);
  assert.ok(routed.get("toC").fromPort.y < routed.get("toB").fromPort.y);
});

test("routeEdges — 하나뿐인 엣지는 펼치지 않고 노드 중심을 그대로 쓴다", () => {
  const boxes = new Map([box("a", 0, 0), box("b", 400, 0)].map((b) => [b.id, b]));
  const routed = routeEdges([{ key: "e1", fromId: "a", toId: "b" }], (id) => boxes.get(id));
  assert.equal(routed[0].fromPort.y, boxes.get("a").cy);
  assert.equal(routed[0].toPort.y, boxes.get("b").cy);
});

test("routeEdges — 존재하지 않는 노드를 가리키는 엣지는 조용히 건너뛴다", () => {
  const boxes = new Map([box("a", 0, 0)].map((b) => [b.id, b]));
  const routed = routeEdges([{ key: "e1", fromId: "a", toId: "ghost" }], (id) => boxes.get(id));
  assert.equal(routed.length, 0);
});

test("routedPath — 세로 어긋남이 없으면 직선이다", () => {
  const path = routedPath({ x: 0, y: 50 }, { x: 100, y: 50 });
  assert.equal(path, "M 0 50 L 100 50");
});

test("routedPath — 세로로 어긋나면 시작점과 끝점을 정확히 지나는 elbow를 그린다", () => {
  const from = { x: 0, y: 10 };
  const to = { x: 100, y: 90 };
  const path = routedPath(from, to);
  const firstMove = path.match(/^M ([-\d.]+) ([-\d.]+)/);
  const lastLine = [...path.matchAll(/L ([-\d.]+) ([-\d.]+)/g)].pop();
  assert.equal(Number(firstMove[1]), from.x);
  assert.equal(Number(firstMove[2]), from.y);
  assert.equal(Number(lastLine[1]), to.x);
  assert.equal(Number(lastLine[2]), to.y);
});

test("resolveLabelOverlaps — 완전히 겹치는 라벨 셋을 넣으면 최종 배치에 겹침이 하나도 안 남는다", () => {
  const labels = [
    { id: "l1", x: 100, y: 100, width: 60, height: 14 },
    { id: "l2", x: 100, y: 100, width: 60, height: 14 },
    { id: "l3", x: 100, y: 100, width: 60, height: 14 },
  ];
  const offsets = resolveLabelOverlaps(labels);
  const placed = labels.map((l) => ({ ...l, y: l.y + (offsets.get(l.id) ?? 0) }));
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      assert.equal(rectsOverlap(placed[i], placed[j]), false, `${placed[i].id}, ${placed[j].id} 가 겹친다`);
    }
  }
});

test("resolveLabelOverlaps — 안 겹치는 라벨은 원래 자리를 유지한다(오프셋 0)", () => {
  const labels = [
    { id: "l1", x: 0, y: 0, width: 20, height: 14 },
    { id: "l2", x: 500, y: 500, width: 20, height: 14 },
  ];
  const offsets = resolveLabelOverlaps(labels);
  assert.equal(offsets.get("l1"), 0);
  assert.equal(offsets.get("l2"), 0);
});

test("resolveLabelOverlaps — 입력 순서를 뒤집어도 최종 결과(겹침 없음)는 같다 (결정론)", () => {
  const labels = [
    { id: "l1", x: 100, y: 100, width: 60, height: 14 },
    { id: "l2", x: 102, y: 101, width: 60, height: 14 },
    { id: "l3", x: 98, y: 99, width: 60, height: 14 },
  ];
  const forward = resolveLabelOverlaps(labels);
  const reversed = resolveLabelOverlaps([...labels].reverse());
  assert.deepEqual([...forward.entries()].sort(), [...reversed.entries()].sort());
});

// v2 — archify geometry.mjs 이식분 (properSegmentIntersection · segmentIntersectsRect · countCrossings)

test("properSegmentIntersection — 진짜 내부 X 교차만 잡고 끝점 접촉은 무시한다", () => {
  const crossing = properSegmentIntersection([0, 0], [10, 10], [0, 10], [10, 0]);
  assert.ok(crossing, "대각선 X는 교차해야 한다");
  const parallel = properSegmentIntersection([0, 0], [10, 0], [0, 5], [10, 5]);
  assert.equal(parallel, null);
  const touchingEndpoint = properSegmentIntersection([0, 0], [10, 0], [10, 0], [10, 10]);
  assert.equal(touchingEndpoint, null, "끝점만 닿는 건 내부 교차가 아니다");
});

test("segmentIntersectsRect — 사각형을 관통하는 선분과 안 그런 선분을 구별한다", () => {
  const rect = { x: 40, y: 40, width: 20, height: 20 };
  const through = { start: [30, 50], end: [80, 50] };
  const clear = { start: [30, 90], end: [80, 90] };
  assert.equal(segmentIntersectsRect(through, rect), true);
  assert.equal(segmentIntersectsRect(clear, rect), false);
});

test("countCrossings — 실제로 교차하는 두 엣지만 센다", () => {
  const boxes = new Map(
    [box("a", 0, 0), box("b", 0, 100), box("c", 300, 0), box("d", 300, 100)].map((b) => [b.id, b]),
  );
  // a(위)->d(아래), b(아래)->c(위): 서로 X자로 꼬인다
  const crossingEdges = [
    { key: "ad", fromId: "a", toId: "d" },
    { key: "bc", fromId: "b", toId: "c" },
  ];
  assert.equal(countCrossings(routeEdges(crossingEdges, (id) => boxes.get(id))), 1);

  // a->c, b->d: 안 꼬인다
  const straightEdges = [
    { key: "ac", fromId: "a", toId: "c" },
    { key: "bd", fromId: "b", toId: "d" },
  ];
  assert.equal(countCrossings(routeEdges(straightEdges, (id) => boxes.get(id))), 0);
});

test("countCrossings — 같은 노드를 공유하는 fan-out은 교차로 세지 않는다", () => {
  const boxes = new Map([box("a", 0, 0), box("b", 300, 0), box("c", 300, 100)].map((b) => [b.id, b]));
  const edges = [
    { key: "ab", fromId: "a", toId: "b" },
    { key: "ac", fromId: "a", toId: "c" },
  ];
  assert.equal(countCrossings(routeEdges(edges, (id) => boxes.get(id))), 0);
});

test("routedPathAvoiding — 기본 elbow가 지나가는 장애물을 세로 구간을 옮겨 피한다", () => {
  const from = { x: 0, y: 10 };
  const to = { x: 200, y: 90 };
  // 기본 midX(100)가 정확히 이 장애물 박스(90~110) 안에 있고, 세로 구간(y 10~90)과도 겹친다.
  const obstacle = { id: "mid", left: 90, top: 0, right: 110, bottom: 100, cy: 50 };
  const avoided = routedPathAvoiding(from, to, [obstacle]);
  const verticalXs = [...avoided.matchAll(/[LQ] ([-\d.]+) [-\d.]+/g)].map((m) => Number(m[1]));
  const midXs = verticalXs.filter((x) => x > from.x + 1 && x < to.x - 1);
  assert.ok(midXs.every((x) => x < obstacle.left || x > obstacle.right), `${JSON.stringify(midXs)}가 장애물을 못 피했다`);
});

test("routedPathAvoiding — 장애물이 없으면 routedPath와 같다", () => {
  const from = { x: 0, y: 10 };
  const to = { x: 200, y: 90 };
  assert.equal(routedPathAvoiding(from, to, []), routedPath(from, to));
});

test("routedGeometryAvoiding — 라벨 위치는 장애물 회피 후 실제 경로 위에서 계산한다", () => {
  const from = { x: 100, y: 50 };
  const to = { x: 400, y: 250 };
  const obstacle = box("obstacle", 230, 100, 270, 200);
  const geometry = routedGeometryAvoiding(from, to, [obstacle]);
  assert.ok(geometry.path.includes(`L ${geometry.labelPoint.x}`) || geometry.labelPoint.y === from.y || geometry.labelPoint.y === to.y);
  assert.equal(Number.isFinite(geometry.labelPoint.x) && Number.isFinite(geometry.labelPoint.y), true);
});

test("reduceCrossings — barycenter로도 안 풀리는 X자 교차를 스왑으로 실제로 없앤다", () => {
  const xOf = { 0: 0, 1: 200, 2: 400 };
  const buildBoxes = (order) => {
    const boxes = new Map();
    for (const [rank, list] of order) {
      list.forEach((id, index) => {
        const left = xOf[rank];
        const top = index * 100;
        boxes.set(id, { id, left, top, right: left + 120, bottom: top + 60, cy: top + 30 });
      });
    }
    return boxes;
  };
  const groups = new Map([
    [0, ["hub"]],
    [1, ["c", "d"]], // id 순 — c 위, d 아래
    [2, ["e", "f"]],
  ]);
  const forward = [
    { key: "hc", fromId: "hub", toId: "c" },
    { key: "hd", fromId: "hub", toId: "d" },
    { key: "cf", fromId: "c", toId: "f" }, // 위(c) -> 아래(f)
    { key: "de", fromId: "d", toId: "e" }, // 아래(d) -> 위(e): c-f와 X로 꼬인다
  ];
  const before = countCrossings(routeEdges(forward, (id) => buildBoxes(groups).get(id)));
  assert.equal(before, 1);

  const improved = reduceCrossings(groups, buildBoxes, forward);
  const after = countCrossings(routeEdges(forward, (id) => buildBoxes(improved).get(id)));
  assert.equal(after, 0);
  assert.ok(after <= before);
});
