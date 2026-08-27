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
export const MAX_PORT_SPACING = 20;
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
): Route {
  const axisAligned = Math.abs(fromPort.x - toPort.x) < 0.01 || Math.abs(fromPort.y - toPort.y) < 0.01;
  if (axisAligned) {
    const straightPoints = [fromPort, toPort];
    if (routeClearsComponents(straightPoints, obstacles).length === 0) {
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
  if (hCrossed.length === 0) {
    return { points: hFirst, strategy: "h-first", crossedComponentIds: [] };
  }
  const vCrossed = routeClearsComponents(vFirst, obstacles);
  if (vCrossed.length === 0) {
    return { points: vFirst, strategy: "v-first", crossedComponentIds: [] };
  }

  if (obstacles.length > 0) {
    const bbox = boundingBoxOf(obstacles);
    const channelCandidates: Point[][] = [
      dedupePoints([
        fromPort,
        stubFrom,
        { x: stubFrom.x, y: bbox.y - ROUTE_CHANNEL },
        { x: stubTo.x, y: bbox.y - ROUTE_CHANNEL },
        stubTo,
        toPort,
      ]),
      dedupePoints([
        fromPort,
        stubFrom,
        { x: stubFrom.x, y: bbox.y + bbox.h + ROUTE_CHANNEL },
        { x: stubTo.x, y: bbox.y + bbox.h + ROUTE_CHANNEL },
        stubTo,
        toPort,
      ]),
      dedupePoints([
        fromPort,
        stubFrom,
        { x: bbox.x - ROUTE_CHANNEL, y: stubFrom.y },
        { x: bbox.x - ROUTE_CHANNEL, y: stubTo.y },
        stubTo,
        toPort,
      ]),
      dedupePoints([
        fromPort,
        stubFrom,
        { x: bbox.x + bbox.w + ROUTE_CHANNEL, y: stubFrom.y },
        { x: bbox.x + bbox.w + ROUTE_CHANNEL, y: stubTo.y },
        stubTo,
        toPort,
      ]),
    ];
    for (const candidate of channelCandidates) {
      if (routeClearsComponents(candidate, obstacles).length === 0) {
        return { points: candidate, strategy: "outer-channel", crossedComponentIds: [] };
      }
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
 * interior vertex. A corner is left sharp (drawn as a plain `L`) if its
 * effective radius (see below) rounds down to ~0, so tiny doglegs don't
 * produce self-intersecting curves.
 *
 * When two interior corners are close together (their connecting segment
 * shorter than `2 * radius`), each corner's "before"/"after" point would
 * otherwise be computed independently at a full `radius` from that shared
 * segment -- which, once the segment is shorter than `2 * radius`, makes the
 * two points cross and the path double back on itself for a few pixels
 * before curving on toward its actual direction. That's most visible right
 * before a connection's endpoint, where it reads as the arrowhead not lining
 * up with the curve. To prevent it, a corner's radius on a given side is
 * capped to half that side's segment length, but *only* when the point on
 * the other end of that segment is itself an interior corner that will also
 * round (and thus also wants a share of the same segment) -- a corner next
 * to the path's un-rounded start/end point still gets the full `radius`, so
 * ordinary routes (where the near-endpoint segment is comfortably longer
 * than `radius` but not necessarily `2 * radius`) are unaffected.
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
    const prevIsCorner = i - 1 >= 1;
    const nextIsCorner = i + 1 <= points.length - 2;
    const maxFromPrev = prevIsCorner ? dPrev / 2 : dPrev;
    const maxFromNext = nextIsCorner ? dNext / 2 : dNext;
    const effectiveRadius = Math.min(radius, maxFromPrev, maxFromNext);
    if (effectiveRadius < 0.01) {
      d += ` L ${fmt(curr)}`;
      continue;
    }
    const before = pointAt(prev, curr, effectiveRadius);
    const after = pointAt(next, curr, effectiveRadius);
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

function midpointOfPolyline(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1]!, points[i]!);
    lengths.push(d);
    total += d;
  }
  let target = total / 2;
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

/**
 * Max display width (px, same scale as `labelDisplayWidth`) a connection
 * label is allowed before `truncateLabelForDisplay` starts trimming it. Sized
 * against `labelDisplayWidth`'s default fontSize (13) so a handful of Latin
 * words -- or a shorter CJK phrase -- fit before truncation kicks in.
 */
export const MAX_CONNECTION_LABEL_WIDTH = 96;

/**
 * Trims characters off the end of `label` and appends "…" until the
 * estimated display width (via `labelDisplayWidth`, ellipsis included) fits
 * within `maxWidth`. Returns the original label unchanged when it already
 * fits. Both renderer and validator (if either grows a use for this) MUST
 * call this same function so they can't disagree about what got truncated.
 */
export function truncateLabelForDisplay(label: string, maxWidth: number): { display: string; truncated: boolean } {
  if (labelDisplayWidth(label) <= maxWidth) {
    return { display: label, truncated: false };
  }
  const ellipsis = "…";
  const chars = [...label];
  for (let n = chars.length - 1; n > 0; n--) {
    const candidate = chars.slice(0, n).join("") + ellipsis;
    if (labelDisplayWidth(candidate) <= maxWidth) {
      return { display: candidate, truncated: true };
    }
  }
  return { display: ellipsis, truncated: true };
}

// ---------------------------------------------------------------------------
// Layout: the single shared function renderer + validator both call
// ---------------------------------------------------------------------------

export type ArchitectureLayout = {
  componentRects: Map<string, Rect>;
  routes: Map<string, Route>;
  labelRects: Map<string, Rect>;
};

export const LABEL_HEIGHT = 16;

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
    const routed = routeConnection(fromRect, fromPort, toRect, toPort, obstacles);
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
    const mid = midpointOfPolyline(route.points);
    const width = labelMaskWidth(conn.label);
    labelRects.set(`connection-label:${edgeKey}`, {
      x: mid.x - width / 2,
      y: mid.y - LABEL_HEIGHT / 2,
      w: width,
      h: LABEL_HEIGHT,
    });
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
