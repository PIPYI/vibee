import { test } from "node:test";
import assert from "node:assert/strict";
import { architectureViewExampleText, architectureViewSchemaText, checkSchema } from "../schema.js";

test("architectureViewSchemaText round-trips as a JSON Schema with the expected $defs", () => {
  const schema = JSON.parse(architectureViewSchemaText());
  assert.equal(schema.type, "object");
  assert.ok(schema.$defs.component);
  assert.ok(schema.$defs.boundary);
  assert.ok(schema.$defs.connection);
  assert.ok(schema.$defs.card);
});

test("checkSchema accepts the bundled example with zero diagnostics", () => {
  const example = JSON.parse(architectureViewExampleText());
  const diagnostics = checkSchema(example);
  assert.deepEqual(diagnostics, []);
});

test("checkSchema rejects a document with 13 components", () => {
  const component = (id: string) => ({
    id,
    type: "backend",
    semanticRole: "responsibility",
    semanticRefs: [`resp-${id}`],
    label: id,
    pos: [0, 0],
    size: [10, 10],
  });
  const doc = {
    schemaVersion: 2,
    title: "Too many components",
    components: Array.from({ length: 13 }, (_, i) => component(`c${i}`)),
    boundaries: [],
    connections: [],
  };
  const diagnostics = checkSchema(doc);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((d) => d.code === "architecture-view/schema" && d.severity === "error"));
});

test("checkSchema rejects an unknown component type", () => {
  const doc = {
    schemaVersion: 2,
    title: "Bad type",
    components: [
      {
        id: "x",
        type: "not-a-real-type",
        semanticRole: "responsibility",
        semanticRefs: ["resp-x"],
        label: "X",
        pos: [0, 0],
        size: [10, 10],
      },
    ],
    boundaries: [],
    connections: [],
  };
  const diagnostics = checkSchema(doc);
  assert.ok(diagnostics.length > 0);
});

test("checkSchema rejects an unknown semanticRole", () => {
  const doc = {
    schemaVersion: 2,
    title: "Bad semantic role",
    components: [
      { id: "x", type: "backend", semanticRole: "component", semanticRefs: ["resp-x"], label: "X", pos: [0, 0], size: [10, 10] },
    ],
    boundaries: [],
    connections: [],
  };
  const diagnostics = checkSchema(doc);
  assert.ok(diagnostics.length > 0);
});

test("checkSchema accepts a kind=runtime boundary", () => {
  const doc = {
    schemaVersion: 2,
    title: "Runtime boundary kind",
    components: [
      { id: "x", type: "backend", semanticRole: "responsibility", semanticRefs: ["resp-x"], label: "X", pos: [0, 0], size: [100, 60] },
    ],
    boundaries: [{ kind: "runtime", label: "Runtime", wraps: ["x"] }],
    connections: [],
  };
  const diagnostics = checkSchema(doc);
  assert.deepEqual(diagnostics, []);
});
