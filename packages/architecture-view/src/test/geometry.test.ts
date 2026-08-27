import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARROW_SHORTEN_DISTANCE,
  ROUNDED_CORNER_RADIUS,
  automaticPortSpread,
  labelDisplayWidth,
  roundedPath,
  routeConnection,
  shortenRouteEnd,
  type Obstacle,
  type Rect,
} from "../geometry.js";
import type { ArchitectureViewConnection } from "@vibee/protocol";

test("automaticPortSpread spreads siblings on the same (component, side) to distinct points within bounds", () => {
  const boxes = new Map<string, Rect>([
    ["hub", { x: 400, y: 200, w: 160, h: 160 }],
    ["a", { x: 700, y: 60, w: 100, h: 60 }],
    ["b", { x: 700, y: 180, w: 100, h: 60 }],
    ["c", { x: 700, y: 300, w: 100, h: 60 }],
    ["d", { x: 700, y: 420, w: 100, h: 60 }],
  ]);
  const connections: ArchitectureViewConnection[] = [
    { from: "hub", to: "a" },
    { from: "hub", to: "b" },
    { from: "hub", to: "c" },
    { from: "hub", to: "d" },
  ];
  const points = automaticPortSpread(connections, boxes);
  const hubRect = boxes.get("hub")!;
  const fromPoints = connections.map((_, i) => points.get(`connection-${i}#from`)!);

  for (const p of fromPoints) {
    assert.ok(p, "expected a port point for each connection");
    assert.ok(p.y >= hubRect.y && p.y <= hubRect.y + hubRect.h, "port must lie within the side's bounds");
  }

  const uniqueYs = new Set(fromPoints.map((p) => p.y));
  assert.equal(uniqueYs.size, fromPoints.length, "all sibling ports should be distinct");
});

test("routeConnection routes around an obstacle directly on the line between two components", () => {
  const fromRect: Rect = { x: 0, y: 0, w: 100, h: 60 };
  const toRect: Rect = { x: 500, y: 0, w: 100, h: 60 };
  const obstacleRect: Rect = { x: 250, y: 0, w: 100, h: 60 };
  const fromPort = { x: 100, y: 30 };
  const toPort = { x: 500, y: 30 };
  const obstacles: Obstacle[] = [{ id: "b", ...obstacleRect }];

  const route = routeConnection(fromRect, fromPort, toRect, toPort, obstacles);

  assert.notEqual(route.strategy, "straight");
  assert.ok(!route.crossedComponentIds.includes("b"), "route should have gone around the obstacle, not through it");
});

test("labelDisplayWidth weighs CJK text wider per-character than latin text", () => {
  const korean = "데이터베이스"; // 6 codepoints
  const english = "database"; // 8 codepoints
  assert.ok(korean.length < english.length);
  assert.ok(labelDisplayWidth(korean) > labelDisplayWidth(english));
});

test("shortenRouteEnd trims exactly the requested distance off the final segment", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const shortened = shortenRouteEnd(points, ARROW_SHORTEN_DISTANCE);
  const last = shortened[shortened.length - 1]!;
  const originalLast = points[points.length - 1]!;
  const trimmedDistance = Math.hypot(originalLast.x - last.x, originalLast.y - last.y);
  assert.ok(Math.abs(trimmedDistance - ARROW_SHORTEN_DISTANCE) < 1e-6);
});

test("roundedPath starts with M and rounds corners with Q for a non-collinear polyline", () => {
  const d = roundedPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ],
    8,
  );
  assert.ok(d.startsWith("M"));
  assert.ok(d.includes("Q"));
});

test("roundedPath does not double back when two interior corners share a short segment (arrow stays flush with the curve)", () => {
  // A dogleg with a sharp turn near the endpoint: the two interior corners
  // C=(100,100) and D=(110,100) are only 10px apart, which sits between
  // ROUNDED_CORNER_RADIUS (8) and 2*ROUNDED_CORNER_RADIUS (16). Before the
  // fix, each corner independently claimed a full `radius` off that shared
  // 10px segment, so their rounding points crossed and the path drew a
  // visible backward jog (x decreasing) right before curving into the final
  // leg -- which is what made the arrowhead look rotated/offset from the
  // curve, even though the final segment's own direction was always correct.
  const points = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 110, y: 100 }, // C-D distance = 10, the sharp-corner-near-endpoint case
    { x: 110, y: 200 },
  ];
  const shortened = shortenRouteEnd(points, ARROW_SHORTEN_DISTANCE);
  const d = roundedPath(shortened, ROUNDED_CORNER_RADIUS);

  const points_ = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));

  // Every x-coordinate emitted by the path must be non-decreasing: this
  // route only ever moves rightward (or holds) on the x-axis, so any
  // decrease indicates the corner-rounding reversal bug.
  for (let i = 1; i < points_.length; i++) {
    assert.ok(
      points_[i]!.x >= points_[i - 1]!.x - 1e-9,
      `expected non-decreasing x, got ${points_[i - 1]!.x} -> ${points_[i]!.x} in "${d}"`,
    );
  }

  // The final rendered segment (what the marker-end arrowhead orients to)
  // must point straight down, matching the route's actual final leg -- not
  // some direction skewed by the corner-rounding artifact above it.
  const last = shortened[shortened.length - 1]!;
  const secondToLast = points_[points_.length - 2]!;
  const finalPoint = points_[points_.length - 1]!;
  assert.ok(Math.abs(finalPoint.x - last.x) < 0.01 && Math.abs(finalPoint.y - last.y) < 0.01);
  const dir = { x: finalPoint.x - secondToLast.x, y: finalPoint.y - secondToLast.y };
  const len = Math.hypot(dir.x, dir.y);
  assert.ok(Math.abs(dir.x / len) < 0.01, "final segment should point straight down (no x drift)");
  assert.ok(dir.y / len > 0.99, "final segment should point in the +y direction, matching the route's last leg");
});
