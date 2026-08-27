import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARROW_SHORTEN_DISTANCE,
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

test("routeConnection prefers a short channel between obstacles over the outer canvas edge", () => {
  const fromRect: Rect = { x: 700, y: 480, w: 190, h: 82 };
  const toRect: Rect = { x: 960, y: 160, w: 180, h: 76 };
  const route = routeConnection(
    fromRect,
    { x: 795, y: 480 },
    toRect,
    { x: 1050, y: 236 },
    [
      { id: "upper", x: 700, y: 180, w: 190, h: 82 },
      { id: "middle", x: 960, y: 330, w: 180, h: 76 },
    ],
  );

  assert.equal(route.strategy, "outer-channel");
  assert.deepEqual(route.crossedComponentIds, []);
  assert.ok(route.points.some((point) => point.y > 262 && point.y < 330), "route should use the short channel between rows");
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
