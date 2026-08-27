import type {
  ArchitectureViewComponent,
  ArchitectureViewConnection,
  ArchitectureViewDocument,
} from "@vibee/protocol";
import type { Diagnostic } from "@vibee/protocol";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_ARCHITECTURE_VIEW_BOX: [number, number] = [1200, 760];
export const MIN_COMPONENT_GAP = 24;
export const PORT_INSET = 16;
export const MAX_PORT_SPACING = 14;
export const ROUTE_STUB = 24;
export const ROUTE_CHANNEL = 40;
export const ROUTE_EDGE_INSET = 12;
export const ARROW_SHORTEN_DISTANCE = 9;
export const ROUNDED_CORNER_RADIUS = 8;

// ---------------------------------------------------------------------------
// Base geometric types
// ---------------------------------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number };
export type PortSide = "top" | "right" | "bottom" | "left";
export type Point = { x: number; y: number };

/**
 * A component rect annotated with its owning component id, used as a
 * collision obstacle during routing. The `routeConnection` signature in the
 * design doc is written as `obstacles: Rect[]`, but reporting
 * `crossedComponentIds` requires knowing *which* component a crossed rect
 * belongs to -- so this is a deliberate, documented widening of that type to
 * `Rect & { id: string }`.
 */
export type Obstacle = Rect & { id: string };

export type Route = {
  points: Point[];
  strategy: "straight" | "h-first" | "v-first" | "outer-channel";
  crossedComponentIds: string[];
};

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(p: Point): string {
  return `${round2(p.x)},${round2(p.y)}`;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Gap between two axis-aligned rects: 0 (or negative-ish, clamped to 0) when
 * they overlap, otherwise the shortest distance between their boundaries.
 */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  if (dx > 0 && dy > 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}

function boundingBoxOf(rects: Rect[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function dedupePoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const p of points) {
    const last = result[result.length - 1];
    if (!last || dist(last, p) > 0.01) result.push(p);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Component rects and default port sides
// ---------------------------------------------------------------------------

export function componentRect(c: ArchitectureViewComponent): Rect {
  return { x: c.pos[0], y: c.pos[1], w: c.size[0], h: c.size[1] };
}

/**
 * Picks the side of `from` that faces `to`, comparing center-to-center delta
 * x vs delta y to decide whether the dominant direction is horizontal or
 * vertical, then choosing the corresponding side on that axis.
 */
export function defaultFromSide(from: Rect, to: Rect): PortSide {
  const fromCenter = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "bottom" : "top";
}

/** The side of `to` that faces `from` -- symmetric to `defaultFromSide`. */
export function defaultToSide(from: Rect, to: Rect): PortSide {
  return defaultFromSide(to, from);
}

function sideOfPoint(rect: Rect, point: Point, eps = 0.5): PortSide {
  if (Math.abs(point.y - rect.y) <= eps) return "top";
  if (Math.abs(point.y - (rect.y + rect.h)) <= eps) return "bottom";
  if (Math.abs(point.x - rect.x) <= eps) return "left";
  if (Math.abs(point.x - (rect.x + rect.w)) <= eps) return "right";
  const dTop = Math.abs(point.y - rect.y);
  const dBottom = Math.abs(point.y - (rect.y + rect.h));
  const dLeft = Math.abs(point.x - rect.x);
  const dRight = Math.abs(point.x - (rect.x + rect.w));
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return "top";
  if (min === dBottom) return "bottom";
  if (min === dLeft) return "left";
  return "right";
}

function stubDirection(side: PortSide): Point {
  switch (side) {
    case "top":
      return { x: 0, y: -1 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
    case "right":
      return { x: 1, y: 0 };
  }
}

function sideRectPoint(rect: Rect, side: PortSide, position: number): Point {
  switch (side) {
    case "top":
      return { x: rect.x + position, y: rect.y };
    case "bottom":
      return { x: rect.x + position, y: rect.y + rect.h };
    case "left":
      return { x: rect.x, y: rect.y + position };
    case "right":
      return { x: rect.x + rect.w, y: rect.y + position };
  }
}

/**
 * Positions for `n` siblings spread along a side of length `sideLength`,
 * inset by PORT_INSET from each end. When there are few edges, siblings are
 * spaced MAX_PORT_SPACING apart around the center; when there would not be
 * room for that, the spread is clamped to the usable length instead of
 * overflowing the side.
 */
function spreadPositions(sideLength: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [sideLength / 2];
  const usable = Math.max(0, sideLength - 2 * PORT_INSET);
  const desiredSpan = (n - 1) * MAX_PORT_SPACING;
  const span = Math.min(desiredSpan, usable);
  const start = (sideLength - span) / 2;
  const step = span / (n - 1);
  return Array.from({ length: n }, (_, i) => start + i * step);
}

// ---------------------------------------------------------------------------
// Port spreading
// ---------------------------------------------------------------------------

type PortRequest = {
  edgeKey: string;
  end: "from" | "to";
  componentId: string;
  side: PortSide;
  otherComponentId: string;
};

function edgeKeyFor(conn: ArchitectureViewConnection, index: number): string {
  return conn.id ?? `connection-${index}`;
}

/**
 * Groups every connection endpoint by (componentId, side), sorts each group
 * by the other endpoint's position along that side's cross-axis, and spreads
 * anchor points evenly across the side.
 *
 * Keys in the returned map are `${edgeKey}#from` / `${edgeKey}#to`, where
 * `edgeKey` is the connection's own `id` if present, else the synthetic
 * `connection-${index}` (index into the input `connections` array). A single
 * connection needs two anchor points (one per endpoint), which is why the
 * key includes the `#from`/`#to` suffix rather than being keyed by edge
 * alone.
 */
export function automaticPortSpread(
  connections: ArchitectureViewConnection[],
  boxes: Map<string, Rect>,
): Map<string, Point> {
  const requests: PortRequest[] = [];
  connections.forEach((conn, i) => {
    const fromRect = boxes.get(conn.from);
    const toRect = boxes.get(conn.to);
    if (!fromRect || !toRect) return;
    const edgeKey = edgeKeyFor(conn, i);
    requests.push({
      edgeKey,
      end: "from",
      componentId: conn.from,
      side: defaultFromSide(fromRect, toRect),
      otherComponentId: conn.to,
    });
    requests.push({
      edgeKey,
      end: "to",
      componentId: conn.to,
      side: defaultToSide(fromRect, toRect),
      otherComponentId: conn.from,
    });
  });

  const grouped = new Map<string, PortRequest[]>();
  for (const r of requests) {
    const key = `${r.componentId}|${r.side}`;
    const arr = grouped.get(key) ?? [];
    arr.push(r);
    grouped.set(key, arr);
  }

  const result = new Map<string, Point>();
  for (const [key, group] of grouped) {
    const sep = key.lastIndexOf("|");
    const componentId = key.slice(0, sep);
    const side = key.slice(sep + 1) as PortSide;
    const rect = boxes.get(componentId);
    if (!rect) continue;

    const crossAxisValue = (r: PortRequest): number => {
      const otherRect = boxes.get(r.otherComponentId);
      if (!otherRect) return 0;
      const cx = otherRect.x + otherRect.w / 2;
      const cy = otherRect.y + otherRect.h / 2;
      return side === "top" || side === "bottom" ? cx : cy;
    };

    const sorted = [...group].sort((a, b) => crossAxisValue(a) - crossAxisValue(b));
    const sideLength = side === "top" || side === "bottom" ? rect.w : rect.h;
    const positions = spreadPositions(sideLength, sorted.length);
    sorted.forEach((r, idx) => {
      const position = positions[idx] ?? sideLength / 2;
      result.set(`${r.edgeKey}#${r.end}`, sideRectPoint(rect, side, position));
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Segment/rect intersection (Liang-Barsky) and route validation
// ---------------------------------------------------------------------------

function segmentIntersectsRect(p0: Point, p1: Point, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const checks: Array<[number, number]> = [
    [-dx, p0.x - rect.x],
    [dx, rect.x + rect.w - p0.x],
    [-dy, p0.y - rect.y],
    [dy, rect.y + rect.h - p0.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

function routeIntersectsRect(points: Point[], rect: Rect): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsRect(points[i]!, points[i + 1]!, rect)) return true;
  }
  return false;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p: Point, q: Point, r: Point) =>
    q.x >= Math.min(p.x, r.x) - 0.01 && q.x <= Math.max(p.x, r.x) + 0.01 &&
    q.y >= Math.min(p.y, r.y) - 0.01 && q.y <= Math.max(p.y, r.y) + 0.01;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (Math.abs(abC) < 0.01 && onSegment(a, c, b)) ||
    (Math.abs(abD) < 0.01 && onSegment(a, d, b)) ||
    (Math.abs(cdA) < 0.01 && onSegment(c, a, d)) ||
    (Math.abs(cdB) < 0.01 && onSegment(c, b, d));
}

function routesIntersect(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      if (segmentsIntersect(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
    }
  }
  return false;
}

function routeCrossesAny(points: Point[], routes: Point[][]): boolean {
  return routes.some((route) => routesIntersect(points, route));
}

/**
 * Which obstacle ids (if any) a polyline's segments pass through. Obstacles
 * are shrunk by half a pixel on each side so a route that merely runs flush
 * along a box's boundary (as happens right next to a port stub) doesn't
 * register as a false-positive crossing.
 */
function routeClearsComponents(points: Point[], obstacles: Obstacle[]): string[] {
  const crossed = new Set<string>();
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    for (const obstacle of obstacles) {
      const shrunk: Rect = {
        x: obstacle.x + 0.5,
        y: obstacle.y + 0.5,
        w: Math.max(0, obstacle.w - 1),
        h: Math.max(0, obstacle.h - 1),
      };
      if (segmentIntersectsRect(p0, p1, shrunk)) crossed.add(obstacle.id);
    }
  }
  return [...crossed];
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Routes a connection from `fromPort` (on the boundary of `fromRect`) to
 * `toPort` (on the boundary of `toRect`), avoiding `obstacles` (which the
 * caller must already have filtered to exclude the two connected
 * components' own rects).
 *
 * Strategy order: `straight` when the ports are already axis-aligned and the
 * direct segment is clear; otherwise `h-first`/`v-first` dogleg candidates
 * built from short ROUTE_STUB stubs off each port; otherwise `outer-channel`
 * candidates that go around the outside of the bounding box of all
 * obstacles; if every candidate still crosses something, falls back to the
 * `h-first` candidate and reports the real crossings so validation can flag
 * `edge-crosses-component`.
 */
export function routeConnection(
  fromRect: Rect,
  fromPort: Point,
  toRect: Rect,
  toPort: Point,
  obstacles: Obstacle[],
  avoidRoutes: Point[][] = [],
): Route {
  const axisAligned = Math.abs(fromPort.x - toPort.x) < 0.01 || Math.abs(fromPort.y - toPort.y) < 0.01;
  if (axisAligned) {
    const straightPoints = [fromPort, toPort];
    if (routeClearsComponents(straightPoints, obstacles).length === 0 && !routeCrossesAny(straightPoints, avoidRoutes)) {
      return { points: straightPoints, strategy: "straight", crossedComponentIds: [] };
    }
  }

  const fromSide = sideOfPoint(fromRect, fromPort);
  const toSide = sideOfPoint(toRect, toPort);
  const dirFrom = stubDirection(fromSide);
  const dirTo = stubDirection(toSide);
  const stubFrom: Point = { x: fromPort.x + dirFrom.x * ROUTE_STUB, y: fromPort.y + dirFrom.y * ROUTE_STUB };
  const stubTo: Point = { x: toPort.x + dirTo.x * ROUTE_STUB, y: toPort.y + dirTo.y * ROUTE_STUB };

  const hFirst = dedupePoints([
    fromPort,
    stubFrom,
    { x: stubTo.x, y: stubFrom.y },
    stubTo,
    toPort,
  ]);
  const vFirst = dedupePoints([
    fromPort,
    stubFrom,
    { x: stubFrom.x, y: stubTo.y },
    stubTo,
    toPort,
  ]);

  const hCrossed = routeClearsComponents(hFirst, obstacles);
  if (hCrossed.length === 0 && !routeCrossesAny(hFirst, avoidRoutes)) {
    return { points: hFirst, strategy: "h-first", crossedComponentIds: [] };
  }
  const vCrossed = routeClearsComponents(vFirst, obstacles);
  if (vCrossed.length === 0 && !routeCrossesAny(vFirst, avoidRoutes)) {
    return { points: vFirst, strategy: "v-first", crossedComponentIds: [] };
  }

  if (obstacles.length > 0) {
    const bbox = boundingBoxOf(obstacles);
    const horizontalChannels = new Set([
      bbox.y - ROUTE_CHANNEL,
      bbox.y + bbox.h + ROUTE_CHANNEL,
      ...obstacles.flatMap((obstacle) => [obstacle.y - ROUTE_CHANNEL, obstacle.y + obstacle.h + ROUTE_CHANNEL]),
    ]);
    const verticalChannels = new Set([
      bbox.x - ROUTE_CHANNEL,
      bbox.x + bbox.w + ROUTE_CHANNEL,
      ...obstacles.flatMap((obstacle) => [obstacle.x - ROUTE_CHANNEL, obstacle.x + obstacle.w + ROUTE_CHANNEL]),
    ]);
    const channelCandidates: Point[][] = [
      ...[...horizontalChannels].map((channelY) => dedupePoints([
        fromPort,
        stubFrom,
        { x: stubFrom.x, y: channelY },
        { x: stubTo.x, y: channelY },
        stubTo,
        toPort,
      ])),
      ...[...verticalChannels].map((channelX) => dedupePoints([
        fromPort,
        stubFrom,
        { x: channelX, y: stubFrom.y },
        { x: channelX, y: stubTo.y },
        stubTo,
        toPort,
      ])),
    ].filter((candidate) => routeClearsComponents(candidate, obstacles).length === 0 && !routeCrossesAny(candidate, avoidRoutes));
    if (channelCandidates.length > 0) {
      const shortest = channelCandidates.reduce((best, candidate) =>
        polylineLength(candidate) < polylineLength(best) ? candidate : best,
      );
      return { points: shortest, strategy: "outer-channel", crossedComponentIds: [] };
    }
  }

  return { points: hFirst, strategy: "h-first", crossedComponentIds: hCrossed };
}

/**
 * Trims the last segment of a polyline so the final point sits `distance`
 * back from the true target anchor -- so an SVG marker-end arrowhead sits
 * visibly before the box rather than underneath/inside it.
 */
export function shortenRouteEnd(points: Point[], distance: number): Point[] {
  if (points.length < 2) return points;
  const last = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const segLen = dist(prev, last);
  if (segLen <= 0.0001) return points;
  const clamped = Math.min(distance, segLen);
  const t = (segLen - clamped) / segLen;
  const newLast: Point = { x: prev.x + (last.x - prev.x) * t, y: prev.y + (last.y - prev.y) * t };
  return [...points.slice(0, -1), newLast];
}

/**
 * Builds an SVG path `d` string with quadratic-curve corner rounding at each
 * interior vertex. A corner is left sharp (drawn as a plain `L`) if either
 * adjacent segment is shorter than `radius`, so tiny doglegs don't produce
 * self-intersecting curves.
 */
export function roundedPath(points: Point[], radius: number): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  if (points.length === 1) return `M ${fmt(first)}`;
  if (points.length === 2) return `M ${fmt(first)} L ${fmt(points[1]!)}`;

  let d = `M ${fmt(first)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const dPrev = dist(prev, curr);
    const dNext = dist(curr, next);
    if (dPrev < radius || dNext < radius) {
      d += ` L ${fmt(curr)}`;
      continue;
    }
    const before = pointAt(prev, curr, radius);
    const after = pointAt(next, curr, radius);
    d += ` L ${fmt(before)} Q ${fmt(curr)} ${fmt(after)}`;
  }
  d += ` L ${fmt(points[points.length - 1]!)}`;
  return d;
}

/** Point on the segment from `to` towards `from`, at `distance` from `to`. */
function pointAt(from: Point, to: Point, distance: number): Point {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = distance / len;
  return { x: to.x + dx * t, y: to.y + dy * t };
}

function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

function pointAlongPolyline(points: Point[], fraction: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1]!, points[i]!);
    lengths.push(d);
    total += d;
  }
  let target = total * fraction;
  for (let i = 0; i < lengths.length; i++) {
    const segLen = lengths[i]!;
    if (target <= segLen || i === lengths.length - 1) {
      const t = segLen === 0 ? 0 : target / segLen;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    target -= segLen;
  }
  return points[Math.floor(points.length / 2)]!;
}

// ---------------------------------------------------------------------------
// CJK-aware label width
// ---------------------------------------------------------------------------

function codePointWeight(cp: number): number {
  const isHangulSyllable = cp >= 0xac00 && cp <= 0xd7a3;
  const isHangulJamo = cp >= 0x1100 && cp <= 0x11ff;
  const isCjkUnified = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
  const isCjkSymbols = cp >= 0x3000 && cp <= 0x303f;
  const isFullwidth = cp >= 0xff00 && cp <= 0xffef;
  if (isHangulSyllable || isHangulJamo || isCjkUnified || isCjkSymbols || isFullwidth) return 1.0;
  return 0.55;
}

/**
 * Approximate rendered pixel width of `text`, counting CJK codepoints
 * (Hangul, CJK ideographs, CJK punctuation, fullwidth forms) as full-width
 * and everything else as half-width, with whitespace weighted separately.
 * Both the renderer and the validator MUST call this same function for
 * anything label-sized so they can't disagree about layout.
 */
export function labelDisplayWidth(text: string, fontSize = 13): number {
  let weight = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      weight += 0.3;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    weight += codePointWeight(cp);
  }
  return weight * fontSize;
}

/** `labelDisplayWidth` plus fixed padding, for label collision boxes/masks. */
export function labelMaskWidth(text: string, fontSize = 13): number {
  return labelDisplayWidth(text, fontSize) + 8;
}

// ---------------------------------------------------------------------------
// Layout: the single shared function renderer + validator both call
// ---------------------------------------------------------------------------

export type ArchitectureLayout = {
  componentRects: Map<string, Rect>;
  routes: Map<string, Route>;
  labelRects: Map<string, Rect>;
};

const LABEL_HEIGHT = 16;

export function calculateArchitectureLayout(doc: ArchitectureViewDocument): ArchitectureLayout {
  const componentRects = new Map<string, Rect>();
  for (const c of doc.components) componentRects.set(c.id, componentRect(c));

  const portPoints = automaticPortSpread(doc.connections, componentRects);

  const routes = new Map<string, Route>();
  doc.connections.forEach((conn, i) => {
    const edgeKey = edgeKeyFor(conn, i);
    const fromRect = componentRects.get(conn.from);
    const toRect = componentRects.get(conn.to);
    if (!fromRect || !toRect) {
      routes.set(edgeKey, { points: [], strategy: "straight", crossedComponentIds: [] });
      return;
    }
    const fromPort = portPoints.get(`${edgeKey}#from`) ?? { x: fromRect.x, y: fromRect.y };
    const toPort = portPoints.get(`${edgeKey}#to`) ?? { x: toRect.x, y: toRect.y };
    const obstacles: Obstacle[] = doc.components
      .filter((c) => c.id !== conn.from && c.id !== conn.to)
      .map((c) => ({ id: c.id, ...componentRect(c) }));
    const routed = routeConnection(fromRect, fromPort, toRect, toPort, obstacles, [...routes.values()].map((route) => route.points));
    const points = shortenRouteEnd(routed.points, ARROW_SHORTEN_DISTANCE);
    routes.set(edgeKey, { points, strategy: routed.strategy, crossedComponentIds: routed.crossedComponentIds });
  });

  const labelRects = new Map<string, Rect>();
  for (const c of doc.components) {
    if (!c.sublabel) continue;
    const rect = componentRects.get(c.id);
    if (!rect) continue;
    const width = labelMaskWidth(c.sublabel);
    const x = rect.x + rect.w / 2 - width / 2;
    const y = rect.y + rect.h - LABEL_HEIGHT - 6;
    labelRects.set(`component-sublabel:${c.id}`, { x, y, w: width, h: LABEL_HEIGHT });
  }
  doc.connections.forEach((conn, i) => {
    if (!conn.label) return;
    const edgeKey = edgeKeyFor(conn, i);
    const route = routes.get(edgeKey);
    if (!route || route.points.length === 0) return;
    const width = labelMaskWidth(conn.label);
    const otherRoutes = [...routes.entries()].filter(([key]) => key !== edgeKey).map(([, value]) => value.points);
    const occupiedLabels = [...labelRects.values()];
    const candidates = [0.5, 0.4, 0.6, 0.3, 0.7].map((fraction) => {
      const point = pointAlongPolyline(route.points, fraction);
      return { x: point.x - width / 2, y: point.y - LABEL_HEIGHT / 2, w: width, h: LABEL_HEIGHT };
    });
    const chosen = candidates.find((candidate) =>
      ![...componentRects.values()].some((rect) => rectsIntersect(candidate, rect)) &&
      !occupiedLabels.some((rect) => rectsIntersect(candidate, rect)) &&
      !otherRoutes.some((points) => routeIntersectsRect(points, candidate)),
    ) ?? candidates[0]!;
    labelRects.set(`connection-label:${edgeKey}`, chosen);
  });

  return { componentRects, routes, labelRects };
}

// ---------------------------------------------------------------------------
// Geometry diagnostics
// ---------------------------------------------------------------------------

export function checkGeometry(doc: ArchitectureViewDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const viewBox = doc.viewBox ?? DEFAULT_ARCHITECTURE_VIEW_BOX;
  const { componentRects, routes, labelRects } = calculateArchitectureLayout(doc);
  const componentIds = new Set(doc.components.map((c) => c.id));

  for (const c of doc.components) {
    const rect = componentRects.get(c.id)!;
    if (rect.w <= 0 || rect.h <= 0) {
      diagnostics.push({
        code: "architecture-view/invalid-size",
        severity: "error",
        message: `Component "${c.id}" has non-positive size [${rect.w}, ${rect.h}].`,
        subject: c.id,
        evidence: { size: [rect.w, rect.h] },
        supportedFixes: [`set size to positive numbers, e.g. [160, 80]`],
      });
      continue;
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > viewBox[0] || rect.y + rect.h > viewBox[1]) {
      diagnostics.push({
        code: "architecture-view/out-of-bounds",
        severity: "error",
        message: `Component "${c.id}" extends outside the viewBox [${viewBox[0]}, ${viewBox[1]}].`,
        subject: c.id,
        evidence: { rect, viewBox },
        supportedFixes: [`move pos or shrink size so the component fits within [0,0]-[${viewBox[0]},${viewBox[1]}]`],
      });
    }
  }

  const ids = doc.components.map((c) => c.id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const idA = ids[i]!;
      const idB = ids[j]!;
      const a = componentRects.get(idA)!;
      const b = componentRects.get(idB)!;
      const gap = rectGap(a, b);
      if (gap < MIN_COMPONENT_GAP) {
        diagnostics.push({
          code: "architecture-view/overlap",
          severity: "error",
          message: `Components "${idA}" and "${idB}" are ${
            gap <= 0 ? "overlapping" : `only ${gap.toFixed(1)}px apart`
          }, less than the minimum gap of ${MIN_COMPONENT_GAP}px.`,
          subject: `${idA},${idB}`,
          evidence: { gap },
          supportedFixes: [`move one of "${idA}"/"${idB}" so the gap is at least ${MIN_COMPONENT_GAP}px`],
        });
      }
    }
  }

  for (const b of doc.boundaries) {
    for (const wrapped of b.wraps) {
      if (!componentIds.has(wrapped)) {
        diagnostics.push({
          code: "architecture-view/dangling-boundary-ref",
          severity: "error",
          message: `Boundary "${b.label}" wraps unknown component id "${wrapped}".`,
          subject: wrapped,
          evidence: { boundary: b.label, wraps: b.wraps },
          supportedFixes: [`remove "${wrapped}" from boundary "${b.label}".wraps, or add a matching component`],
        });
      }
    }
  }

  doc.connections.forEach((conn, i) => {
    const edgeKey = edgeKeyFor(conn, i);
    if (!componentIds.has(conn.from)) {
      diagnostics.push({
        code: "architecture-view/dangling-connection-ref",
        severity: "error",
        message: `Connection "${edgeKey}" references unknown "from" component id "${conn.from}".`,
        subject: edgeKey,
        evidence: { from: conn.from },
        supportedFixes: [`fix "from" to reference an existing component id`],
      });
    }
    if (!componentIds.has(conn.to)) {
      diagnostics.push({
        code: "architecture-view/dangling-connection-ref",
        severity: "error",
        message: `Connection "${edgeKey}" references unknown "to" component id "${conn.to}".`,
        subject: edgeKey,
        evidence: { to: conn.to },
        supportedFixes: [`fix "to" to reference an existing component id`],
      });
    }
  });

  const pairSeen = new Map<string, number>();
  for (const conn of doc.connections) {
    const pair = [conn.from, conn.to].sort().join("|");
    pairSeen.set(pair, (pairSeen.get(pair) ?? 0) + 1);
  }
  for (const [pair, count] of pairSeen) {
    if (count > 1) {
      const [a, b] = pair.split("|") as [string, string];
      diagnostics.push({
        code: "architecture-view/duplicate-connection",
        severity: "warning",
        message: `${count} connections share the same endpoints "${a}" and "${b}".`,
        subject: `${a},${b}`,
        evidence: { count },
        supportedFixes: [`give each connection a distinct id/label, or merge them if they represent the same relationship`],
      });
    }
  }

  const connected = new Set<string>();
  for (const conn of doc.connections) {
    connected.add(conn.from);
    connected.add(conn.to);
  }
  for (const c of doc.components) {
    if (!connected.has(c.id)) {
      diagnostics.push({
        code: "architecture-view/component-disconnected",
        severity: "warning",
        message: `Component "${c.id}" has no connections.`,
        subject: c.id,
        supportedFixes: [`add at least one connection to/from "${c.id}", or remove it`],
      });
    }
  }

  for (const [edgeKey, route] of routes) {
    if (route.crossedComponentIds.length > 0) {
      diagnostics.push({
        code: "architecture-view/edge-crosses-component",
        severity: "error",
        message: `Connection "${edgeKey}" route crosses component(s) ${route.crossedComponentIds.join(", ")}.`,
        subject: edgeKey,
        evidence: { crossedComponentIds: route.crossedComponentIds, strategy: route.strategy },
        supportedFixes: [`reposition "${edgeKey}"'s endpoints or the crossed component(s) so the route can go around them`],
      });
    }
    if (route.points.length >= 2) {
      const routeLength = polylineLength(route.points);
      const directLength = dist(route.points[0]!, route.points[route.points.length - 1]!);
      const detourRatio = directLength > 0 ? routeLength / directLength : 1;
      if (routeLength > 300 && detourRatio > 2) {
        diagnostics.push({
          code: "architecture-view/edge-excessive-detour",
          severity: "error",
          message: `Connection "${edgeKey}" takes an excessive detour (${detourRatio.toFixed(2)}x its direct distance).`,
          subject: edgeKey,
          evidence: { routeLength, directLength, detourRatio, strategy: route.strategy },
          supportedFixes: ["reposition its endpoints or intervening components so the connection has a shorter clear channel"],
        });
      }
    }
  }

  const routeEntries = [...routes.entries()];
  for (let i = 0; i < routeEntries.length; i++) {
    for (let j = i + 1; j < routeEntries.length; j++) {
      const [keyA, routeA] = routeEntries[i]!;
      const [keyB, routeB] = routeEntries[j]!;
      if (routesIntersect(routeA.points, routeB.points)) {
        diagnostics.push({
          code: "architecture-view/edge-collision",
          severity: "error",
          message: `Connections "${keyA}" and "${keyB}" overlap or cross.`,
          subject: `${keyA},${keyB}`,
          supportedFixes: ["reposition the connected components so the two routes no longer overlap or cross"],
        });
      }
    }
  }

  for (const [labelKey, labelRect] of labelRects) {
    if (!labelKey.startsWith("connection-label:")) continue;
    const ownEdgeKey = labelKey.slice("connection-label:".length);
    for (const [edgeKey, route] of routes) {
      if (edgeKey !== ownEdgeKey && routeIntersectsRect(route.points, labelRect)) {
        diagnostics.push({
          code: "architecture-view/edge-label-collision",
          severity: "error",
          message: `Connection "${edgeKey}" crosses label "${labelKey}".`,
          subject: `${edgeKey},${labelKey}`,
          supportedFixes: ["move the connected components or shorten the label so the route clears it"],
        });
      }
    }
  }

  const labelEntries = [...labelRects.entries()];
  for (let i = 0; i < labelEntries.length; i++) {
    for (let j = i + 1; j < labelEntries.length; j++) {
      const entryA = labelEntries[i]!;
      const entryB = labelEntries[j]!;
      if (rectsIntersect(entryA[1], entryB[1])) {
        diagnostics.push({
          code: "architecture-view/label-collision",
          severity: "warning",
          message: `Labels "${entryA[0]}" and "${entryB[0]}" overlap.`,
          subject: `${entryA[0]},${entryB[0]}`,
          supportedFixes: [`shorten one of the labels, or move the components/connections apart`],
        });
      }
    }
  }

  if (doc.components.length > 0) {
    const rects = doc.components.map((c) => componentRects.get(c.id)!);
    const bbox = boundingBoxOf(rects);
    if (bbox.w > 0 && bbox.h > 0) {
      const ratio = bbox.h / bbox.w;
      if (ratio < 0.15 || ratio > 1 / 0.15) {
        diagnostics.push({
          code: "architecture-view/viewbox-balance",
          severity: "warning",
          message: `Component layout bounding box is extremely ${ratio < 0.15 ? "flat" : "tall"} (w=${bbox.w.toFixed(
            0,
          )}, h=${bbox.h.toFixed(0)}).`,
          subject: doc.components.map((c) => c.id).join(","),
          evidence: { boundW: bbox.w, boundH: bbox.h, ratio },
          supportedFixes: [`spread components across both axes instead of a single row/column`],
        });
      }
    }
  }

  return diagnostics;
}
