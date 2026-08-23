/**
 * Edge routing (schema2 §1.2 A10, M10, v2 §6) — archify `renderers/shared/geometry.mjs`의
 * automatic port spread · rounded routing · 라벨 충돌 회피를 우리 도메인에 맞게 이식한다.
 *
 * archify는 노드가 2D 평면 어디에나 놓이고 4면 어느 쪽에서나 연결될 수 있다. 우리 두 View는
 * 항상 rank/hop 컬럼을 오른쪽에서 왼쪽으로 흐른다 — 그래서 archify의 `automaticPortSpread`가
 * 다루는 4면 대신 **오른쪽(나가는 포트) / 왼쪽(들어오는 포트) 두 면만** 다룬다.
 *
 * A7 · I10과 같은 이유로 이 모듈은 IR에 없는 좌표를 만들지만, **agent가 아니라 렌더러가**
 * 계산한다 — Renderer가 결정론적으로 layout을 계산한다는 원칙(§6.8) 그대로다.
 *
 * 결정론 보장: 정렬은 항상 (상대 노드의 y좌표, 그다음 edge key 문자열)로 tie-break한다.
 * 입력 배열의 원래 순서에 의존하지 않는다 — 같은 IR을 두 번 넣으면 항상 같은 좌표가 나온다.
 *
 * v2: archify `geometry.mjs`는 원래 AI가 직접 쓴 좌표의 결함(교차·장애물 통과)을 찾아 AI에게
 * 돌려주는 린터다 — 우리는 AI가 좌표를 안 쓰므로(A7) 그 "찾아서 보고" 절반은 옮기지 않는다.
 * 대신 순수 기하 판정(`properSegmentIntersection`/`segmentIntersectsRect`)만 이식해서, 렌더러가
 * "찾아서 스스로 고치는" 데 쓴다 — `resolveLabelOverlaps`가 이미 하던 것과 같은 철학이다.
 */

export type Box = { id: string; left: number; top: number; right: number; bottom: number; cy: number };

export type RoutableEdge = { key: string; fromId: string; toId: string };

export type RoutedPort = { x: number; y: number };

export type RoutedEdge = RoutableEdge & { fromPort: RoutedPort; toPort: RoutedPort };

const GUTTER = 8;
const MAX_SPACING = 14;
const OBSTACLE_CLEARANCE = 6;

/** archify `rectsOverlap`을 그대로 옮긴다 — AABB 겹침, non-finite는 겹침이 아니라 unknown이다. */
export function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap = 0,
): boolean {
  const finite = [a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height].every(Number.isFinite);
  if (!finite) return false;
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

type PortGroupItem = { edge: RoutableEdge; box: Box; side: "right" | "left"; counterpartCy: number };

/**
 * 같은 노드의 같은 면에서 만나는 엣지들을 세로로 고르게 펼친다
 * (archify `automaticPortSpread`의 축소판 — gutter·maxSpacing 정책은 그대로 가져온다).
 *
 * 상대 노드의 y좌표로 먼저 정렬해 시각적 교차를 줄이고, 값이 같으면 edge key로 정한다 —
 * 그래야 두 번 계산해도 항상 같은 순서, 같은 좌표가 나온다.
 */
export function routeEdges(edges: RoutableEdge[], boxOf: (id: string) => Box | undefined): RoutedEdge[] {
  const outGroups = new Map<string, PortGroupItem[]>();
  const inGroups = new Map<string, PortGroupItem[]>();
  const validEdges: Array<{ edge: RoutableEdge; fromBox: Box; toBox: Box }> = [];

  for (const edge of edges) {
    const fromBox = boxOf(edge.fromId);
    const toBox = boxOf(edge.toId);
    if (!fromBox || !toBox) continue;
    validEdges.push({ edge, fromBox, toBox });
    const outKey = fromBox.id;
    const inKey = toBox.id;
    if (!outGroups.has(outKey)) outGroups.set(outKey, []);
    if (!inGroups.has(inKey)) inGroups.set(inKey, []);
    outGroups.get(outKey)!.push({ edge, box: fromBox, side: "right", counterpartCy: toBox.cy });
    inGroups.get(inKey)!.push({ edge, box: toBox, side: "left", counterpartCy: fromBox.cy });
  }

  const outOffset = new Map<string, number>();
  const inOffset = new Map<string, number>();
  spreadGroups(outGroups, outOffset);
  spreadGroups(inGroups, inOffset);

  return validEdges.map(({ edge, fromBox, toBox }) => ({
    ...edge,
    fromPort: { x: fromBox.right, y: fromBox.cy + (outOffset.get(edge.key) ?? 0) },
    toPort: { x: toBox.left, y: toBox.cy + (inOffset.get(edge.key) ?? 0) },
  }));
}

function spreadGroups(groups: Map<string, PortGroupItem[]>, offsetByEdgeKey: Map<string, number>): void {
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const sorted = [...items].sort((a, b) => {
      if (a.counterpartCy !== b.counterpartCy) return a.counterpartCy - b.counterpartCy;
      return a.edge.key < b.edge.key ? -1 : a.edge.key > b.edge.key ? 1 : 0;
    });
    const extent = sorted[0]!.box.bottom - sorted[0]!.box.top;
    const usable = Math.max(0, extent - GUTTER * 2);
    const spacing = Math.min(MAX_SPACING, usable / (sorted.length - 1));
    if (!(spacing > 0)) continue;
    sorted.forEach((item, index) => {
      const offset = (index - (sorted.length - 1) / 2) * spacing;
      offsetByEdgeKey.set(item.edge.key, offset);
    });
  }
}

/** 두 포트 사이 경로의 꺾이는 지점(직선 구간의 뼈대). `routedPath`/`countCrossings`가 공유한다. */
export function routePoints(from: RoutedPort, to: RoutedPort, midXOverride?: number): [number, number][] {
  if (Math.abs(from.y - to.y) < 0.5) {
    return [
      [from.x, from.y],
      [to.x, to.y],
    ];
  }
  const midX = midXOverride ?? (from.x + to.x) / 2;
  return [
    [from.x, from.y],
    [midX, from.y],
    [midX, to.y],
    [to.x, to.y],
  ];
}

/**
 * 두 포트를 잇는 경로. 세로 어긋남이 없으면 직선, 있으면 archify `roundedPath`처럼
 * 둥근 모서리 두 개짜리 elbow로 그린다 — 사선 대신 가로/세로만 쓰면 여러 엣지가 겹쳐도
 * 어느 것이 어디로 가는지 더 잘 읽힌다. `midXOverride`가 있으면 그 x로 세로 구간을 옮긴다
 * (rank를 건너뛰는 엣지가 중간 rank의 노드를 피해가도록 `routedPathAvoiding`이 넘긴다).
 */
export function routedPath(from: RoutedPort, to: RoutedPort, radius = 10, midXOverride?: number): string {
  if (Math.abs(from.y - to.y) < 0.5) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  const midX = midXOverride ?? (from.x + to.x) / 2;
  const r = Math.min(radius, Math.abs(midX - from.x), Math.abs(to.x - midX), Math.abs(to.y - from.y) / 2);
  const verticalSign = to.y > from.y ? 1 : -1;
  const horizontalSignOut = midX > from.x ? 1 : -1;
  const horizontalSignIn = to.x > midX ? 1 : -1;
  return [
    `M ${from.x} ${from.y}`,
    `L ${midX - r * horizontalSignOut} ${from.y}`,
    `Q ${midX} ${from.y} ${midX} ${from.y + r * verticalSign}`,
    `L ${midX} ${to.y - r * verticalSign}`,
    `Q ${midX} ${to.y} ${midX + r * horizontalSignIn} ${to.y}`,
    `L ${to.x} ${to.y}`,
  ].join(" ");
}

function segmentIntersectsBox(
  segment: { start: [number, number]; end: [number, number] },
  box: Box,
  gap = 0,
): boolean {
  return segmentIntersectsRect(segment, { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top }, gap);
}

/** 세로 구간이 obstacle 박스를 가로지르지 않는 x를 찾는다 — 기본 midX부터, 후보들을 거리순으로 시도. */
function findClearMidX(from: RoutedPort, to: RoutedPort, obstacles: Box[]): number {
  const base = (from.x + to.x) / 2;
  if (Math.abs(from.y - to.y) < 0.5 || obstacles.length === 0) return base;

  const lo = Math.min(from.x, to.x) + 4;
  const hi = Math.max(from.x, to.x) - 4;
  // 후보를 gap 경계선에 정확히 두면 그 경계 자체가 "닿음"으로 판정돼 늘 걸러진다 — 1px 더 벌린다.
  const candidateSet = new Set<number>([base]);
  for (const obstacle of obstacles) {
    candidateSet.add(obstacle.left - OBSTACLE_CLEARANCE - 1);
    candidateSet.add(obstacle.right + OBSTACLE_CLEARANCE + 1);
  }
  const candidates = [...candidateSet]
    .filter((mx) => mx >= lo && mx <= hi)
    .sort((a, b) => Math.abs(a - base) - Math.abs(b - base) || a - b);

  for (const midX of candidates) {
    const vertical = { start: [midX, from.y] as [number, number], end: [midX, to.y] as [number, number] };
    if (!obstacles.some((obstacle) => segmentIntersectsBox(vertical, obstacle, OBSTACLE_CLEARANCE))) return midX;
  }
  return base;
}

/**
 * `routedPath`와 같은 elbow를 그리되, rank를 건너뛰는 엣지가 지나갈 중간 rank에 다른 노드가
 * 있으면 그 노드를 피해 세로 구간의 x를 옆으로 옮긴다. `obstacles`에는 이 엣지의 양 끝
 * 노드를 뺀 나머지 박스를 넘긴다.
 */
export function routedPathAvoiding(from: RoutedPort, to: RoutedPort, obstacles: Box[], radius = 10): string {
  return routedGeometryAvoiding(from, to, obstacles, radius).path;
}

/** 장애물 회피로 실제 이동한 경로와 같은 좌표계에서 라벨 위치도 계산한다. */
export function routedGeometryAvoiding(
  from: RoutedPort,
  to: RoutedPort,
  obstacles: Box[],
  radius = 10,
): { path: string; labelPoint: RoutedPort } {
  const midX = findClearMidX(from, to, obstacles);
  const points = routePoints(from, to, midX);
  const segments = points.slice(0, -1).map((start, index) => {
    const end = points[index + 1]!;
    return { start, end, horizontal: Math.abs(start[1] - end[1]) < 0.5, length: Math.hypot(end[0] - start[0], end[1] - start[1]) };
  });
  const horizontal = segments.filter((segment) => segment.horizontal).sort((a, b) => b.length - a.length)[0];
  const segment = horizontal ?? segments.sort((a, b) => b.length - a.length)[0];
  const labelPoint = segment
    ? { x: (segment.start[0] + segment.end[0]) / 2, y: (segment.start[1] + segment.end[1]) / 2 }
    : { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return { path: routedPath(from, to, radius, midX), labelPoint };
}

/** archify `segmentIntersectsRect`를 이식 — 선분이 사각형과 만나는지(끝점이 안에 있어도 만남). */
export function segmentIntersectsRect(
  segment: { start: [number, number]; end: [number, number] },
  rect: { x: number; y: number; width: number; height: number },
  gap = 0,
): boolean {
  const box = { x1: rect.x - gap, y1: rect.y - gap, x2: rect.x + rect.width + gap, y2: rect.y + rect.height + gap };
  const [a, b] = [segment.start, segment.end];
  const pointInBox = (p: [number, number]): boolean => p[0] >= box.x1 && p[0] <= box.x2 && p[1] >= box.y1 && p[1] <= box.y2;
  if (pointInBox(a) || pointInBox(b)) return true;
  return (
    segmentsIntersect(a, b, [box.x1, box.y1], [box.x2, box.y1]) ||
    segmentsIntersect(a, b, [box.x2, box.y1], [box.x2, box.y2]) ||
    segmentsIntersect(a, b, [box.x2, box.y2], [box.x1, box.y2]) ||
    segmentsIntersect(a, b, [box.x1, box.y2], [box.x1, box.y1])
  );
}

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return o1 !== o2 && o3 !== o4;
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): 0 | 1 | 2 {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: [number, number], b: [number, number], c: [number, number]): boolean {
  return (
    b[0] <= Math.max(a[0], c[0]) &&
    b[0] >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) &&
    b[1] >= Math.min(a[1], c[1])
  );
}

/** archify `properSegmentIntersection`을 이식 — 끝점 접촉이 아니라 진짜 내부 X 교차만 잡는다. */
export function properSegmentIntersection(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): [number, number] | null {
  const cross = (p: [number, number], q: [number, number], r: [number, number]): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const epsilon = 0.0001;
  const opposite = (left: number, right: number): boolean => (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon);
  if (!opposite(abC, abD) || !opposite(cdA, cdB)) return null;

  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) < epsilon) return null;
  const ab = a[0] * b[1] - a[1] * b[0];
  const cd = c[0] * d[1] - c[1] * d[0];
  return [(ab * (c[0] - d[0]) - (a[0] - b[0]) * cd) / denominator, (ab * (c[1] - d[1]) - (a[1] - b[1]) * cd) / denominator];
}

const MIN_CORRIDOR_OVERLAP = 4;

/**
 * 두 선분이 같은 직선(같은 x의 세로선이거나 같은 y의 가로선) 위에서 겹치는 길이 — archify
 * `collinearAxisOverlap`을 이식했다. rank가 같은 두 컴포넌트 쌍이 같은 x-span을 잇는 elbow를
 * 그리면(우리 렌더러에서 가장 흔한 경우) 기본 midX가 똑같아서 세로 구간이 완전히 겹친다 —
 * 대각선으로 교차하는 게 아니라 한 통로를 공유하는 것이라 `properSegmentIntersection`(진짜
 * X자 교차)만으로는 못 잡는다. 그래서 `countCrossings`가 두 판정을 같이 쓴다.
 */
function collinearOverlapLength(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number {
  const epsilon = 0.0001;
  const horizontal = Math.abs(a[1] - b[1]) <= epsilon && Math.abs(c[1] - d[1]) <= epsilon && Math.abs(a[1] - c[1]) <= epsilon;
  const vertical = Math.abs(a[0] - b[0]) <= epsilon && Math.abs(c[0] - d[0]) <= epsilon && Math.abs(a[0] - c[0]) <= epsilon;
  if (!horizontal && !vertical) return 0;
  const axis = horizontal ? 0 : 1;
  const lo = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const hi = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  return Math.max(0, hi - lo);
}

/**
 * 실제로 라우팅된 엣지들 사이의 교차(대각선 X자 교차 + 같은 통로를 겹쳐 지나가는 경우)를
 * 센다 — 같은 노드를 공유하는(끝점이 겹치는) 쌍은 정상적인 fan-out/fan-in이라 제외한다
 * (archify `cleanCrossingProblems`와 같은 예외). `architectureLayout.ts`의 barycenter 순서가
 * 실제로 교차를 줄였는지 검증하거나, 렌더러가 인접 노드를 스왑해보는 로컬 개선(`reduceCrossings`)의
 * 목적함수로 쓴다.
 */
export function countCrossings(routed: RoutedEdge[]): number {
  let count = 0;
  for (let i = 0; i < routed.length; i += 1) {
    const left = routed[i]!;
    const pointsA = routePoints(left.fromPort, left.toPort);
    for (let j = i + 1; j < routed.length; j += 1) {
      const right = routed[j]!;
      if (left.fromId === right.fromId || left.fromId === right.toId || left.toId === right.fromId || left.toId === right.toId) {
        continue;
      }
      const pointsB = routePoints(right.fromPort, right.toPort);
      let hit = false;
      for (let si = 0; si < pointsA.length - 1 && !hit; si += 1) {
        for (let sj = 0; sj < pointsB.length - 1; sj += 1) {
          const a = pointsA[si]!;
          const b = pointsA[si + 1]!;
          const c = pointsB[sj]!;
          const d = pointsB[sj + 1]!;
          if (properSegmentIntersection(a, b, c, d) || collinearOverlapLength(a, b, c, d) > MIN_CORRIDOR_OVERLAP) {
            hit = true;
            break;
          }
        }
      }
      if (hit) count += 1;
    }
  }
  return count;
}

const SWAP_PASSES = 3;

/**
 * barycenter로 정한 초기 순서를 실제 라우팅된 엣지로 검증한다 — 같은 그룹(rank) 안의 인접
 * 두 항목을 스왑했을 때 교차 수(`countCrossings`)가 줄어들면 받아들인다. barycenter는
 * 근사치라 이 로컬 탐색이 있어야 확실히 줄어든다. `buildBoxes`는 그룹별 순서(id 배열)를
 * 받아 실제 픽셀 `Box`를 만드는 콜백이다 — rank/lane 같은 그룹 개념을 모르는 채로 순수
 * 기하만 다룬다. 개선이 없으면(로컬 최적) 입력 순서를 그대로 돌려준다 — 결정론 유지.
 */
export function reduceCrossings(
  groups: Map<number, string[]>,
  buildBoxes: (order: Map<number, string[]>) => Map<string, Box>,
  forward: RoutableEdge[],
): Map<number, string[]> {
  const countFor = (order: Map<number, string[]>): number => {
    const boxes = buildBoxes(order);
    return countCrossings(routeEdges(forward, (id) => boxes.get(id)));
  };

  let best = new Map([...groups].map(([key, list]) => [key, [...list]]));
  let bestCount = countFor(best);

  for (let pass = 0; pass < SWAP_PASSES; pass += 1) {
    let improved = false;
    for (const key of [...best.keys()].sort((a, b) => a - b)) {
      const list = best.get(key)!;
      for (let i = 0; i < list.length - 1; i += 1) {
        const trial = new Map(best);
        const swapped = [...list];
        [swapped[i], swapped[i + 1]] = [swapped[i + 1]!, swapped[i]!];
        trial.set(key, swapped);
        const trialCount = countFor(trial);
        if (trialCount < bestCount) {
          best = trial;
          bestCount = trialCount;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

export type LabelBox = { id: string; x: number; y: number; width: number; height: number };

/**
 * 겹치는 라벨을 세로로 밀어낸다. 입력 순서와 무관하게 (x, id)로 정렬해 결정론을 지킨다 —
 * 배치 순서가 흔들리면 같은 IR이 렌더마다 다른 좌표를 낼 수 있다.
 *
 * 반환값은 라벨 id → y 보정값(px)이다. 겹치지 않는 라벨은 0을 받는다(원래 위치 유지).
 */
export function resolveLabelOverlaps(labels: LabelBox[], gap = 2): Map<string, number> {
  const offsetById = new Map<string, number>();
  const sorted = [...labels].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: LabelBox[] = [];

  for (const label of sorted) {
    let offset = 0;
    let moved = true;
    // 이미 배치된 라벨과 겹치지 않을 때까지 한 줄 간격(height+gap)씩 아래로 민다.
    // 라벨 수가 적어(수십 개 수준) 선형 탐색으로 충분하고, 매 반복이 결정론적이다.
    while (moved) {
      moved = false;
      const candidate = { ...label, y: label.y + offset };
      for (const other of placed) {
        if (rectsOverlap(candidate, other, gap)) {
          offset += label.height + gap;
          moved = true;
          break;
        }
      }
    }
    offsetById.set(label.id, offset);
    placed.push({ ...label, y: label.y + offset });
  }

  return offsetById;
}
