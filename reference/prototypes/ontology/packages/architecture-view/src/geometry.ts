/**
 * Architecture 뷰가 실제로 그리는 포트·경로·라벨 배치를 한곳에서 계산한다.
 *
 * 렌더러와 검증기가 서로 다른 선을 상상하면 repair loop가 성립하지 않는다. 따라서 여기서
 * 만든 route/label layout을 SVG renderer와 geometry validator가 함께 소비한다.
 */
import type { ArchitectureViewConnection, ArchitectureViewDocument } from "@onto/protocol";

import { diagnostic, type Diagnostic } from "./diagnostic.js";

export const DEFAULT_ARCHITECTURE_VIEW_BOX: [number, number] = [1200, 760];
const MIN_COMPONENT_GAP = 24;
const PORT_INSET = 16;
const MAX_PORT_SPACING = 14;
const ROUTE_STUB = 24;
const ROUTE_CHANNEL = 40;
const ROUTE_EDGE_INSET = 12;
const EPSILON = 0.001;
const LABEL_HEIGHT = 18;
const LABEL_OFFSET_CANDIDATES = [0, -24, 24, -48, 48, -72, 72] as const;

export type Point = [number, number];
export type Rect = { x: number; y: number; width: number; height: number };
export type PortSide = "left" | "right" | "top" | "bottom";

export type ArchitectureConnectionRoute = {
  connectionIndex: number;
  connectionId: string;
  from: string;
  to: string;
  fromSide: PortSide;
  toSide: PortSide;
  strategy: string;
  points: Point[];
  clearsComponents: boolean;
  crossedComponentIds: string[];
};

export type ArchitectureConnectionLabelLayout = {
  connectionIndex: number;
  connectionId: string;
  text: string;
  x: number;
  y: number;
  rect: Rect;
  offset: number;
  collidesWithComponentIds: string[];
  collidesWithConnectionIds: string[];
};

export type ArchitectureLayoutReport = {
  viewBox: [number, number];
  components: Array<{ id: string; rect: Rect }>;
  routes: ArchitectureConnectionRoute[];
  labels: ArchitectureConnectionLabelLayout[];
};

type CandidateRoute = { strategy: string; points: Point[] };

function rectOf(pos: [number, number], size: [number, number]): Rect {
  return { x: pos[0], y: pos[1], width: size[0], height: size[1] };
}

function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

function rectCenter(rect: Rect): Point {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

function connectionId(connection: ArchitectureViewConnection, index: number): string {
  return connection.id ?? `${connection.from}->${connection.to}#${index + 1}`;
}

function keyForPort(connectionIndex: number, endpoint: "from" | "to"): string {
  return `${connectionIndex}:${endpoint}`;
}

function sideVector(side: PortSide): Point {
  switch (side) {
    case "left": return [-1, 0];
    case "right": return [1, 0];
    case "top": return [0, -1];
    case "bottom": return [0, 1];
  }
}

function oppositeSide(side: PortSide): PortSide {
  switch (side) {
    case "left": return "right";
    case "right": return "left";
    case "top": return "bottom";
    case "bottom": return "top";
  }
}

function move(point: Point, side: PortSide, amount: number): Point {
  const [dx, dy] = sideVector(side);
  return [point[0] + dx * amount, point[1] + dy * amount];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON;
}

function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function isHorizontal(side: PortSide): boolean {
  return side === "left" || side === "right";
}

/** 상대 component의 중심을 향하는 기본 포트 면. */
export function defaultFromSide(from: Rect, to: Rect): PortSide {
  const [fromX, fromY] = rectCenter(from);
  const [toX, toY] = rectCenter(to);
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** target은 source를 바라보는 면으로 들어온다. */
export function defaultToSide(from: Rect, to: Rect): PortSide {
  return defaultFromSide(to, from);
}

/** component 가장자리의 anchor. 같은 면의 여러 edge는 offset으로 분산한다. */
export function anchor(rect: Rect, side: PortSide, offset: number = 0): Point {
  if (isHorizontal(side)) {
    const y = clamp(rect.y + rect.height / 2 + offset, rect.y + PORT_INSET, rectBottom(rect) - PORT_INSET);
    return [side === "left" ? rect.x : rectRight(rect), y];
  }
  const x = clamp(rect.x + rect.width / 2 + offset, rect.x + PORT_INSET, rectRight(rect) - PORT_INSET);
  return [x, side === "top" ? rect.y : rectBottom(rect)];
}

/**
 * 같은 (component, side)에 모이는 edge의 포트를 상대 component 중심 순으로 나열한다.
 * offset key는 `${connectionIndex}:from|to`다.
 */
export function automaticPortSpread(
  connections: readonly ArchitectureViewConnection[],
  boxes: ReadonlyMap<string, Rect>,
): Map<string, number> {
  type Endpoint = { connectionIndex: number; endpoint: "from" | "to"; componentId: string; side: PortSide; order: number };
  const groups = new Map<string, Endpoint[]>();

  connections.forEach((connection, connectionIndex) => {
    const from = boxes.get(connection.from);
    const to = boxes.get(connection.to);
    if (!from || !to) return;
    const fromSide = defaultFromSide(from, to);
    const toSide = defaultToSide(from, to);
    const [fromX, fromY] = rectCenter(from);
    const [toX, toY] = rectCenter(to);
    const endpoints: Endpoint[] = [
      {
        connectionIndex,
        endpoint: "from",
        componentId: connection.from,
        side: fromSide,
        order: isHorizontal(fromSide) ? toY : toX,
      },
      {
        connectionIndex,
        endpoint: "to",
        componentId: connection.to,
        side: toSide,
        order: isHorizontal(toSide) ? fromY : fromX,
      },
    ];
    for (const endpoint of endpoints) {
      const groupKey = `${endpoint.componentId}:${endpoint.side}`;
      const group = groups.get(groupKey) ?? [];
      group.push(endpoint);
      groups.set(groupKey, group);
    }
  });

  const offsets = new Map<string, number>();
  for (const endpoints of groups.values()) {
    endpoints.sort((a, b) => a.order - b.order || a.connectionIndex - b.connectionIndex || a.endpoint.localeCompare(b.endpoint));
    const first = endpoints[0];
    if (!first) continue;
    const rect = boxes.get(first.componentId);
    if (!rect) continue;
    const crossLength = isHorizontal(first.side) ? rect.height : rect.width;
    const maxByBox = Math.max(0, (crossLength - PORT_INSET * 2) / Math.max(1, endpoints.length - 1));
    const spacing = Math.min(MAX_PORT_SPACING, maxByBox);
    const middle = (endpoints.length - 1) / 2;
    endpoints.forEach((endpoint, index) => offsets.set(keyForPort(endpoint.connectionIndex, endpoint.endpoint), (index - middle) * spacing));
  }
  return offsets;
}

function simplifyOrthogonal(points: readonly Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (!previous || !samePoint(previous, point)) unique.push([point[0], point[1]]);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < unique.length - 1; index += 1) {
      const previous = unique[index - 1]!;
      const current = unique[index]!;
      const next = unique[index + 1]!;
      if (
        (Math.abs(previous[0] - current[0]) < EPSILON && Math.abs(current[0] - next[0]) < EPSILON) ||
        (Math.abs(previous[1] - current[1]) < EPSILON && Math.abs(current[1] - next[1]) < EPSILON)
      ) {
        unique.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return unique;
}

function followsSide(from: Point, to: Point, side: PortSide): boolean {
  const [expectedX, expectedY] = sideVector(side);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (expectedX !== 0) return Math.sign(dx) === expectedX && Math.abs(dy) < EPSILON;
  return Math.sign(dy) === expectedY && Math.abs(dx) < EPSILON;
}

/** 첫 segment와 마지막 segment가 각각 endpoint side에 수직인지 확인한다. */
export function routeHonorsEndpointSides(points: readonly Point[], fromSide: PortSide, toSide: PortSide): boolean {
  if (points.length < 2) return false;
  const start = points[0]!;
  const afterStart = points[1]!;
  const beforeEnd = points[points.length - 2]!;
  const end = points[points.length - 1]!;
  return followsSide(start, afterStart, fromSide) && followsSide(beforeEnd, end, oppositeSide(toSide));
}

/** Liang–Barsky 선분/box 판정. 점 하나만 스치는 것은 교차로 취급하지 않는다. */
export function segmentIntersectsRect(p: Point, q: Point, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const edges: Array<[number, number]> = [
    [-dx, p[0] - rect.x],
    [dx, rectRight(rect) - p[0]],
    [-dy, p[1] - rect.y],
    [dy, rectBottom(rect) - p[1]],
  ];
  for (const [denominator, numerator] of edges) {
    if (Math.abs(denominator) < EPSILON) {
      if (numerator < 0) return false;
      continue;
    }
    const t = numerator / denominator;
    if (denominator < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 < t1;
}

function crossedComponents(
  points: readonly Point[],
  boxes: ReadonlyMap<string, Rect>,
  ignoredComponentIds: ReadonlySet<string>,
): string[] {
  const crossed = new Set<string>();
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    for (const [componentId, box] of boxes) {
      if (ignoredComponentIds.has(componentId)) continue;
      if (segmentIntersectsRect(from, to, box)) crossed.add(componentId);
    }
  }
  return [...crossed].sort();
}

/** 실제 라우팅된 폴리라인이 무관한 component를 가로지르지 않는지 확인한다. */
export function routeClearsComponents(
  points: readonly Point[],
  boxes: ReadonlyMap<string, Rect>,
  fromComponentId: string,
  toComponentId: string,
): boolean {
  return crossedComponents(points, boxes, new Set([fromComponentId, toComponentId])).length === 0;
}

function routeCandidates(
  start: Point,
  end: Point,
  fromSide: PortSide,
  toSide: PortSide,
  fromRect: Rect,
  toRect: Rect,
  viewBox: [number, number],
): CandidateRoute[] {
  const fromStub = move(start, fromSide, ROUTE_STUB);
  const toStub = move(end, toSide, ROUTE_STUB);
  const candidates: CandidateRoute[] = [];

  if (Math.abs(start[1] - end[1]) < EPSILON || Math.abs(start[0] - end[0]) < EPSILON) {
    candidates.push({ strategy: "straight", points: [start, end] });
  }
  candidates.push(
    { strategy: "h-first", points: [start, fromStub, [toStub[0], fromStub[1]], toStub, end] },
    { strategy: "v-first", points: [start, fromStub, [fromStub[0], toStub[1]], toStub, end] },
  );

  const [viewWidth, viewHeight] = viewBox;
  const leftChannel = Math.max(ROUTE_EDGE_INSET, Math.min(fromRect.x, toRect.x) - ROUTE_CHANNEL);
  const rightChannel = Math.min(viewWidth - ROUTE_EDGE_INSET, Math.max(rectRight(fromRect), rectRight(toRect)) + ROUTE_CHANNEL);
  const topChannel = Math.max(ROUTE_EDGE_INSET, Math.min(fromRect.y, toRect.y) - ROUTE_CHANNEL);
  const bottomChannel = Math.min(viewHeight - ROUTE_EDGE_INSET, Math.max(rectBottom(fromRect), rectBottom(toRect)) + ROUTE_CHANNEL);
  candidates.push(
    { strategy: "outer-left", points: [start, fromStub, [leftChannel, fromStub[1]], [leftChannel, toStub[1]], toStub, end] },
    { strategy: "outer-right", points: [start, fromStub, [rightChannel, fromStub[1]], [rightChannel, toStub[1]], toStub, end] },
    { strategy: "outer-top", points: [start, fromStub, [fromStub[0], topChannel], [toStub[0], topChannel], toStub, end] },
    { strategy: "outer-bottom", points: [start, fromStub, [fromStub[0], bottomChannel], [toStub[0], bottomChannel], toStub, end] },
  );
  return candidates;
}

function selfRoute(
  connection: ArchitectureViewConnection,
  index: number,
  rect: Rect,
  startOffset: number,
): ArchitectureConnectionRoute {
  const start = anchor(rect, "right", startOffset);
  const end = anchor(rect, "top", 0);
  const outerX = rectRight(rect) + ROUTE_STUB;
  const outerY = Math.max(ROUTE_EDGE_INSET, rect.y - ROUTE_CHANNEL);
  const points = simplifyOrthogonal([start, [outerX, start[1]], [outerX, outerY], [end[0], outerY], end]);
  return {
    connectionIndex: index,
    connectionId: connectionId(connection, index),
    from: connection.from,
    to: connection.to,
    fromSide: "right",
    toSide: "top",
    strategy: "self-loop",
    points,
    clearsComponents: true,
    crossedComponentIds: [],
  };
}

function routeConnection(
  connection: ArchitectureViewConnection,
  index: number,
  fromRect: Rect,
  toRect: Rect,
  start: Point,
  end: Point,
  fromSide: PortSide,
  toSide: PortSide,
  boxes: ReadonlyMap<string, Rect>,
  viewBox: [number, number],
): ArchitectureConnectionRoute {
  const candidates = routeCandidates(start, end, fromSide, toSide, fromRect, toRect, viewBox)
    .map((candidate) => ({ ...candidate, points: simplifyOrthogonal(candidate.points) }));
  const acceptable = candidates.filter((candidate) => routeHonorsEndpointSides(candidate.points, fromSide, toSide));
  const fallback = acceptable[0] ?? candidates[0] ?? { strategy: "fallback", points: [start, end] };

  for (const candidate of acceptable) {
    const crossedComponentIds = crossedComponents(candidate.points, boxes, new Set([connection.from, connection.to]));
    if (crossedComponentIds.length === 0) {
      return {
        connectionIndex: index,
        connectionId: connectionId(connection, index),
        from: connection.from,
        to: connection.to,
        fromSide,
        toSide,
        strategy: candidate.strategy,
        points: candidate.points,
        clearsComponents: true,
        crossedComponentIds,
      };
    }
  }

  const crossedComponentIds = crossedComponents(fallback.points, boxes, new Set([connection.from, connection.to]));
  return {
    connectionIndex: index,
    connectionId: connectionId(connection, index),
    from: connection.from,
    to: connection.to,
    fromSide,
    toSide,
    strategy: `${fallback.strategy}-fallback`,
    points: fallback.points,
    clearsComponents: crossedComponentIds.length === 0,
    crossedComponentIds,
  };
}

/** CJK를 반각보다 넓게 계산해 SVG 라벨 마스크 폭을 추정한다. */
export function labelDisplayWidth(label: string): number {
  const wideCharacter = /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60\uac00-\ud7af]/u;
  return [...label].reduce((width, character) => {
    if (/\s/u.test(character)) return width + 0.35;
    return width + (wideCharacter.test(character) ? 1 : 0.55);
  }, 0);
}

export function labelMaskWidth(label: string): number {
  return Math.max(58, Math.ceil(18 + labelDisplayWidth(label) * 8.4));
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < rectRight(b) && rectRight(a) > b.x && a.y < rectBottom(b) && rectBottom(a) > b.y;
}

function distanceBetweenRects(a: Rect, b: Rect): number {
  const horizontal = Math.max(a.x - rectRight(b), b.x - rectRight(a), 0);
  const vertical = Math.max(a.y - rectBottom(b), b.y - rectBottom(a), 0);
  return Math.hypot(horizontal, vertical);
}

function longestSegment(points: readonly Point[]): { from: Point; to: Point } | undefined {
  let result: { from: Point; to: Point } | undefined;
  let longest = -1;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const length = pointDistance(from, to);
    if (length > longest) {
      result = { from, to };
      longest = length;
    }
  }
  return result;
}

function labelRect(points: readonly Point[], text: string, offset: number): { x: number; y: number; rect: Rect } {
  const segment = longestSegment(points);
  const width = labelMaskWidth(text);
  if (!segment) return { x: width / 2, y: LABEL_HEIGHT / 2, rect: { x: 0, y: 0, width, height: LABEL_HEIGHT } };
  const midX = (segment.from[0] + segment.to[0]) / 2;
  const midY = (segment.from[1] + segment.to[1]) / 2;
  const horizontal = Math.abs(segment.from[0] - segment.to[0]) >= Math.abs(segment.from[1] - segment.to[1]);
  const x = horizontal ? midX : midX + offset;
  const y = horizontal ? midY + offset : midY;
  return { x, y, rect: { x: x - width / 2, y: y - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT } };
}

function layoutConnectionLabels(
  doc: ArchitectureViewDocument,
  routes: readonly ArchitectureConnectionRoute[],
  boxes: ReadonlyMap<string, Rect>,
): ArchitectureConnectionLabelLayout[] {
  const labels: ArchitectureConnectionLabelLayout[] = [];
  const routeByIndex = new Map(routes.map((route) => [route.connectionIndex, route] as const));
  for (let connectionIndex = 0; connectionIndex < doc.connections.length; connectionIndex += 1) {
    const connection = doc.connections[connectionIndex];
    const route = routeByIndex.get(connectionIndex);
    if (!connection?.label || !route) continue;

    let chosen: { x: number; y: number; rect: Rect; offset: number; componentIds: string[]; connectionIds: string[] } | undefined;
    for (const offset of LABEL_OFFSET_CANDIDATES) {
      const candidate = labelRect(route.points, connection.label, offset);
      const componentIds = [...boxes.entries()]
        .filter(([, box]) => overlaps(candidate.rect, box))
        .map(([componentId]) => componentId)
        .sort();
      const connectionIds = labels.filter((existing) => overlaps(candidate.rect, existing.rect)).map((existing) => existing.connectionId).sort();
      const next = { ...candidate, offset, componentIds, connectionIds };
      if (componentIds.length === 0 && connectionIds.length === 0) {
        chosen = next;
        break;
      }
      if (!chosen || componentIds.length + connectionIds.length < chosen.componentIds.length + chosen.connectionIds.length) chosen = next;
    }
    if (!chosen) continue;
    labels.push({
      connectionIndex,
      connectionId: route.connectionId,
      text: connection.label,
      x: chosen.x,
      y: chosen.y,
      rect: chosen.rect,
      offset: chosen.offset,
      collidesWithComponentIds: chosen.componentIds,
      collidesWithConnectionIds: chosen.connectionIds,
    });
  }
  return labels;
}

/** 렌더와 validate response가 공유하는 실제 layout 보고서. */
export function calculateArchitectureLayout(doc: ArchitectureViewDocument): ArchitectureLayoutReport {
  const viewBox = doc.viewBox ?? DEFAULT_ARCHITECTURE_VIEW_BOX;
  const boxes = new Map(doc.components.map((component) => [component.id, rectOf(component.pos, component.size)] as const));
  const portOffsets = automaticPortSpread(doc.connections, boxes);
  const routes: ArchitectureConnectionRoute[] = [];

  doc.connections.forEach((connection, index) => {
    const fromRect = boxes.get(connection.from);
    const toRect = boxes.get(connection.to);
    if (!fromRect || !toRect) return;
    if (connection.from === connection.to) {
      routes.push(selfRoute(connection, index, fromRect, portOffsets.get(keyForPort(index, "from")) ?? 0));
      return;
    }
    const fromSide = defaultFromSide(fromRect, toRect);
    const toSide = defaultToSide(fromRect, toRect);
    const start = anchor(fromRect, fromSide, portOffsets.get(keyForPort(index, "from")) ?? 0);
    const end = anchor(toRect, toSide, portOffsets.get(keyForPort(index, "to")) ?? 0);
    routes.push(routeConnection(connection, index, fromRect, toRect, start, end, fromSide, toSide, boxes, viewBox));
  });

  return {
    viewBox: [viewBox[0], viewBox[1]],
    components: doc.components.map((component) => ({ id: component.id, rect: rectOf(component.pos, component.size) })),
    routes,
    labels: layoutConnectionLabels(doc, routes, boxes),
  };
}

/** 마지막 segment를 target box 밖 9px에서 끝낸다 — marker가 box 밑에 묻히지 않는다. */
export function shortenRouteEnd(points: readonly Point[], distance: number = 9): Point[] {
  if (points.length < 2) return points.map((point) => [point[0], point[1]]);
  const result = points.map((point) => [point[0], point[1]] as Point);
  const previous = result[result.length - 2]!;
  const end = result[result.length - 1]!;
  const length = pointDistance(previous, end);
  if (length < EPSILON) return result;
  const amount = Math.min(distance, Math.max(0, length - 1));
  result[result.length - 1] = [end[0] - ((end[0] - previous[0]) / length) * amount, end[1] - ((end[1] - previous[1]) / length) * amount];
  return result;
}

/** 축 정렬 polyline을 둥근 모서리 SVG path로 직렬화한다. */
export function roundedPath(points: readonly Point[], radius: number = 8): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${format(points[0]![0])} ${format(points[0]![1])}`;
  const parts = [`M ${format(points[0]![0])} ${format(points[0]![1])}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const incoming = pointDistance(previous, current);
    const outgoing = pointDistance(current, next);
    const cornerRadius = Math.min(radius, incoming / 2, outgoing / 2);
    if (cornerRadius < EPSILON) {
      parts.push(`L ${format(current[0])} ${format(current[1])}`);
      continue;
    }
    const before: Point = [
      current[0] + ((previous[0] - current[0]) / incoming) * cornerRadius,
      current[1] + ((previous[1] - current[1]) / incoming) * cornerRadius,
    ];
    const after: Point = [
      current[0] + ((next[0] - current[0]) / outgoing) * cornerRadius,
      current[1] + ((next[1] - current[1]) / outgoing) * cornerRadius,
    ];
    parts.push(`L ${format(before[0])} ${format(before[1])} Q ${format(current[0])} ${format(current[1])} ${format(after[0])} ${format(after[1])}`);
  }
  const end = points[points.length - 1]!;
  parts.push(`L ${format(end[0])} ${format(end[1])}`);
  return parts.join(" ");
}

function format(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function checkGeometry(doc: ArchitectureViewDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const [viewWidth, viewHeight] = doc.viewBox ?? DEFAULT_ARCHITECTURE_VIEW_BOX;
  const componentById = new Map(doc.components.map((component) => [component.id, component] as const));

  for (const component of doc.components) {
    const [x, y] = component.pos;
    const [width, height] = component.size;
    if (width <= 0 || height <= 0) {
      diagnostics.push(
        diagnostic("architecture-view/invalid-size", "error", `컴포넌트 "${component.id}"의 size가 0 이하입니다.`, {
          subject: { componentId: component.id },
          evidence: { size: component.size },
          supportedFixes: ["size를 양수 [width, height]로 고친다"],
        }),
      );
      continue;
    }
    if (x < 0 || y < 0 || x + width > viewWidth || y + height > viewHeight) {
      diagnostics.push(
        diagnostic(
          "architecture-view/out-of-bounds",
          "error",
          `컴포넌트 "${component.id}"가 viewBox(${viewWidth}x${viewHeight}) 밖으로 나갑니다.`,
          {
            subject: { componentId: component.id },
            evidence: { pos: component.pos, size: component.size, viewBox: [viewWidth, viewHeight] },
            supportedFixes: ["pos/size를 viewBox 안으로 옮기거나 viewBox를 늘린다"],
          },
        ),
      );
    }
  }

  for (let firstIndex = 0; firstIndex < doc.components.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < doc.components.length; secondIndex += 1) {
      const first = doc.components[firstIndex]!;
      const second = doc.components[secondIndex]!;
      const firstRect = rectOf(first.pos, first.size);
      const secondRect = rectOf(second.pos, second.size);
      const gap = distanceBetweenRects(firstRect, secondRect);
      if (gap >= MIN_COMPONENT_GAP) continue;
      diagnostics.push(
        diagnostic("architecture-view/overlap", "error", `컴포넌트 "${first.id}"와 "${second.id}"가 겹치거나 ${MIN_COMPONENT_GAP}px 미만으로 가깝습니다.`, {
          subject: { componentIds: [first.id, second.id] },
          evidence: { first: firstRect, second: secondRect, gap, minimumGap: MIN_COMPONENT_GAP },
          supportedFixes: [`둘 사이에 최소 ${MIN_COMPONENT_GAP}px 통로가 남도록 pos를 옮긴다`],
        }),
      );
    }
  }

  for (const boundary of doc.boundaries) {
    for (const memberId of boundary.wraps) {
      if (componentById.has(memberId)) continue;
      diagnostics.push(
        diagnostic(
          "architecture-view/dangling-boundary-ref",
          "error",
          `boundary "${boundary.id ?? boundary.label}"가 존재하지 않는 컴포넌트 "${memberId}"를 감쌉니다.`,
          {
            subject: { boundaryId: boundary.id ?? boundary.label, componentId: memberId },
            evidence: { wraps: boundary.wraps },
            supportedFixes: ["wraps에서 제거하거나 실재하는 component id로 고친다"],
          },
        ),
      );
    }
  }

  for (let index = 0; index < doc.connections.length; index += 1) {
    const connection = doc.connections[index]!;
    for (const [role, id] of [["from", connection.from] as const, ["to", connection.to] as const]) {
      if (componentById.has(id)) continue;
      diagnostics.push(
        diagnostic(
          "architecture-view/dangling-connection-ref",
          "error",
          `connection의 "${role}"이 존재하지 않는 컴포넌트 "${id}"를 가리킵니다.`,
          {
            subject: { connectionId: connectionId(connection, index), [role]: id },
            evidence: { connection },
            supportedFixes: ["실재하는 component id로 고친다"],
          },
        ),
      );
    }
  }

  const validConnections = doc.connections
    .map((connection, index) => ({ connection, index }))
    .filter(({ connection }) => componentById.has(connection.from) && componentById.has(connection.to));
  const duplicateByKey = new Map<string, { connection: ArchitectureViewConnection; index: number }>();
  for (const item of validConnections) {
    const variant = item.connection.variant ?? "default";
    const label = (item.connection.label ?? "").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
    const key = `${item.connection.from}\u0000${item.connection.to}\u0000${variant}\u0000${label}`;
    const previous = duplicateByKey.get(key);
    if (!previous) {
      duplicateByKey.set(key, item);
      continue;
    }
    diagnostics.push(
      diagnostic("architecture-view/duplicate-connection", "error", `connection "${connectionId(item.connection, item.index)}"이 "${connectionId(previous.connection, previous.index)}"와 사실상 중복됩니다.`, {
        subject: { connectionId: connectionId(item.connection, item.index), duplicateOf: connectionId(previous.connection, previous.index) },
        evidence: { connection: item.connection, existing: previous.connection },
        supportedFixes: ["둘 중 하나를 제거하거나 관계의 방향·라벨·variant를 구분한다"],
      }),
    );
  }

  if (doc.components.length > 1) {
    const connectedIds = new Set(validConnections.flatMap(({ connection }) => [connection.from, connection.to]));
    for (const component of doc.components) {
      if (connectedIds.has(component.id)) continue;
      diagnostics.push(
        diagnostic("architecture-view/component-disconnected", "warning", `컴포넌트 "${component.id}"가 어떤 connection에도 참여하지 않습니다.`, {
          subject: { componentId: component.id },
          evidence: { componentCount: doc.components.length, validConnectionCount: validConnections.length },
          supportedFixes: ["실제 관계가 있으면 connection을 추가하고, 독립 컴포넌트라면 이 warning을 남긴다"],
        }),
      );
    }
  }

  const layout = calculateArchitectureLayout(doc);
  for (const route of layout.routes) {
    for (const componentId of route.crossedComponentIds) {
      diagnostics.push(
        diagnostic("architecture-view/edge-crosses-component", "error", `connection "${route.connectionId}"의 실제 경로가 무관한 컴포넌트 "${componentId}"를 가로지릅니다.`, {
          subject: { connectionId: route.connectionId, throughComponentId: componentId },
          evidence: { strategy: route.strategy, points: route.points },
          supportedFixes: ["component 간 통로를 늘리거나 해당 component를 옮겨 라우팅 경로를 비운다"],
        }),
      );
    }
  }

  for (const label of layout.labels) {
    if (label.collidesWithComponentIds.length === 0 && label.collidesWithConnectionIds.length === 0) continue;
    diagnostics.push(
      diagnostic("architecture-view/label-collision", "error", `connection "${label.connectionId}"의 라벨이 다른 요소와 겹칩니다.`, {
        subject: { connectionId: label.connectionId },
        evidence: {
          rect: label.rect,
          collidesWithComponentIds: label.collidesWithComponentIds,
          collidesWithConnectionIds: label.collidesWithConnectionIds,
        },
        supportedFixes: ["component 간 간격을 넓히거나 connection label을 더 짧고 구분되게 고친다"],
      }),
    );
  }

  if (doc.components.length >= 3) {
    const rectangles = doc.components.map((component) => rectOf(component.pos, component.size));
    const minX = Math.min(...rectangles.map((rect) => rect.x));
    const maxX = Math.max(...rectangles.map((rect) => rectRight(rect)));
    const minY = Math.min(...rectangles.map((rect) => rect.y));
    const maxY = Math.max(...rectangles.map((rect) => rectBottom(rect)));
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const overlyFlat = contentHeight < viewHeight * 0.28 || contentWidth / Math.max(1, contentHeight) > 3.4;
    if (overlyFlat) {
      diagnostics.push(
        diagnostic("architecture-view/viewbox-balance", "warning", "component 배치가 한 줄 스트립에 가까워 viewBox의 세로 공간이 과도하게 비어 있습니다.", {
          subject: { viewBox: [viewWidth, viewHeight] },
          evidence: { contentBounds: { minX, minY, maxX, maxY }, contentWidth, contentHeight },
          supportedFixes: ["주 경로 외 component를 두 번째 행에 배치하거나 viewBox 높이를 조정한다"],
        }),
      );
    }
  }

  return diagnostics;
}
