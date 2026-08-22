/**
 * Edge routing (schema2 §1.2 A10, M10) — archify `renderers/shared/geometry.mjs`의
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
 */

export type Box = { id: string; left: number; top: number; right: number; bottom: number; cy: number };

export type RoutableEdge = { key: string; fromId: string; toId: string };

export type RoutedPort = { x: number; y: number };

export type RoutedEdge = RoutableEdge & { fromPort: RoutedPort; toPort: RoutedPort };

const GUTTER = 8;
const MAX_SPACING = 14;

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

/**
 * 두 포트를 잇는 경로. 세로 어긋남이 없으면 직선, 있으면 archify `roundedPath`처럼
 * 둥근 모서리 두 개짜리 elbow로 그린다 — 사선 대신 가로/세로만 쓰면 여러 엣지가 겹쳐도
 * 어느 것이 어디로 가는지 더 잘 읽힌다.
 */
export function routedPath(from: RoutedPort, to: RoutedPort, radius = 10): string {
  if (Math.abs(from.y - to.y) < 0.5) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  const midX = (from.x + to.x) / 2;
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
