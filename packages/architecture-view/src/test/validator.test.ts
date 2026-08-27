import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArchitectureViewComponent, ArchitectureViewDocument } from "@vibee/protocol";
import { hasError } from "@vibee/protocol";
import { checkGeometry } from "../geometry.js";
import { architectureViewExampleText } from "../schema.js";
import { validateArchitectureView } from "../validator.js";

function comp(overrides: Partial<ArchitectureViewComponent> & Pick<ArchitectureViewComponent, "id">): ArchitectureViewComponent {
  return {
    type: "backend",
    semanticRole: "responsibility",
    semanticRefs: [`resp-${overrides.id}`],
    label: overrides.id,
    pos: [0, 0],
    size: [100, 60],
    ...overrides,
  };
}

function doc(partial: Partial<ArchitectureViewDocument>): ArchitectureViewDocument {
  return {
    schemaVersion: 2,
    title: "Test doc",
    components: [],
    boundaries: [],
    connections: [],
    ...partial,
  };
}

function codesOf(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((d) => d.code);
}

test("invalid-size: a component with non-positive size is an error", () => {
  const d = doc({ components: [comp({ id: "a", size: [0, 50] })] });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/invalid-size");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("out-of-bounds: a component extending past the viewBox is an error", () => {
  const d = doc({ components: [comp({ id: "a", pos: [1150, 50], size: [200, 200] })] });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/out-of-bounds");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("overlap: two overlapping components is an error", () => {
  const d = doc({
    components: [comp({ id: "a", pos: [0, 0], size: [100, 100] }), comp({ id: "b", pos: [10, 10], size: [100, 100] })],
  });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/overlap");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("dangling-boundary-ref: a boundary wrapping an unknown id is an error", () => {
  const d = doc({
    components: [comp({ id: "a" })],
    boundaries: [{ kind: "region", label: "X", wraps: ["ghost"] }],
  });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/dangling-boundary-ref");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("dangling-connection-ref: a connection referencing an unknown id is an error", () => {
  const d = doc({
    components: [comp({ id: "a" })],
    connections: [{ from: "a", to: "ghost" }],
  });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/dangling-connection-ref");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("duplicate-connection: two connections sharing endpoints is a warning", () => {
  const d = doc({
    components: [comp({ id: "a", pos: [0, 0] }), comp({ id: "b", pos: [300, 0] })],
    connections: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ],
  });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/duplicate-connection");
  assert.ok(hit);
  assert.equal(hit?.severity, "warning");
});

test("component-disconnected: a component with no connections is a warning", () => {
  const d = doc({
    components: [comp({ id: "a", pos: [0, 0] }), comp({ id: "b", pos: [300, 0] }), comp({ id: "c", pos: [600, 0] })],
    connections: [{ from: "a", to: "b" }],
  });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/component-disconnected" && x.subject === "c");
  assert.ok(hit);
  assert.equal(hit?.severity, "warning");
});

test("edge-crosses-component: a connection whose target is fully walled in is an error", () => {
  // "c" is boxed in on all four sides by wall components with no gap, so any
  // route from "a" to "c" must cross a wall no matter which strategy is tried.
  const d = doc({
    components: [
      comp({ id: "a", pos: [50, 430], size: [100, 60] }),
      comp({ id: "c", pos: [410, 410], size: [80, 80] }),
      comp({ id: "wallTop", pos: [390, 380], size: [120, 30] }),
      comp({ id: "wallBottom", pos: [390, 490], size: [120, 30] }),
      comp({ id: "wallLeft", pos: [390, 380], size: [20, 140] }),
      comp({ id: "wallRight", pos: [490, 380], size: [20, 140] }),
    ],
    connections: [{ from: "a", to: "c" }],
  });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/edge-crosses-component");
  assert.ok(hit, `expected an edge-crosses-component diagnostic, got codes: ${codesOf(diagnostics).join(", ")}`);
  assert.equal(hit?.severity, "error");
});

test("connection labels try alternate positions before reporting a collision", () => {
  const d = doc({
    components: [comp({ id: "a", pos: [0, 0], size: [80, 200] }), comp({ id: "b", pos: [300, 0], size: [80, 200] })],
    connections: [
      { id: "e1", from: "a", to: "b", label: "x" },
      { id: "e2", from: "a", to: "b", label: "x" },
    ],
  });
  const diagnostics = checkGeometry(d);
  assert.ok(!diagnostics.some((x) => x.code === "architecture-view/label-collision"));
});

test("connection routing avoids routes that were already placed", () => {
  const d = doc({
    components: [
      comp({ id: "left", pos: [0, 160], size: [80, 80] }),
      comp({ id: "right", pos: [320, 160], size: [80, 80] }),
      comp({ id: "top", pos: [160, 0], size: [80, 80] }),
      comp({ id: "bottom", pos: [160, 320], size: [80, 80] }),
    ],
    connections: [
      { id: "horizontal", from: "left", to: "right", label: "across" },
      { id: "vertical", from: "top", to: "bottom", label: "down" },
    ],
  });
  const diagnostics = checkGeometry(d);
  assert.ok(!diagnostics.some((x) => x.code === "architecture-view/edge-collision"));
});

test("viewbox-balance: an extremely flat single-row layout is a warning", () => {
  const d = doc({
    components: [
      comp({ id: "a", pos: [0, 50], size: [100, 20] }),
      comp({ id: "b", pos: [500, 50], size: [100, 20] }),
      comp({ id: "c", pos: [900, 50], size: [100, 20] }),
    ],
  });
  const diagnostics = checkGeometry(d);
  const hit = diagnostics.find((x) => x.code === "architecture-view/viewbox-balance");
  assert.ok(hit);
  assert.equal(hit?.severity, "warning");
});

test("a fully valid document produces zero errors end to end", () => {
  const example = JSON.parse(architectureViewExampleText());
  const diagnostics = validateArchitectureView(example, { projectPath: process.cwd() });
  assert.equal(hasError(diagnostics), false, `expected no errors, got: ${JSON.stringify(diagnostics, null, 2)}`);
});

// Regression test for the bug where citations were checked against a pinned
// git revision instead of the working tree: an AI always explores via
// Read/Grep/Glob (live filesystem), so a stale/unrelated revision recorded on
// the document must never cause a real, currently-cited file to be flagged
// as invalid.
test("validateArchitectureView ignores an unrelated/stale repository.revision and validates the working tree", () => {
  const d = doc({
    components: [comp({ id: "a", sources: [{ path: "package.json", line: 1 }] })],
    repository: { revision: "0000000000000000000000000000000000dead" },
  });
  const diagnostics = validateArchitectureView(d, { projectPath: process.cwd() });
  assert.deepEqual(diagnostics.filter((x) => x.code === "architecture-view/citation-invalid"), []);
});
