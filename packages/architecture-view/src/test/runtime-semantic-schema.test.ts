import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeSemanticDocument } from "@vibee/protocol";
import { checkRuntimeSemanticSchema, runtimeSemanticSchemaText } from "../schema.js";
import { validateRuntimeSemantics } from "../runtime-semantic-validator.js";

function minimalDoc(): RuntimeSemanticDocument {
  return {
    schemaVersion: 1,
    title: "Minimal",
    actors: [{ id: "actorTraveler", label: "Traveler" }],
    runtimes: [
      { id: "runtimeServer", label: "Server", kind: "server", sources: [{ path: "package.json" }] },
    ],
    responsibilities: [
      {
        id: "respOrder",
        runtimeId: "runtimeServer",
        label: "Order Processing",
        sources: [{ path: "package.json" }],
      },
    ],
    states: [],
    externals: [],
    interactions: [
      {
        id: "intPlaceOrder",
        from: "actorTraveler",
        to: "respOrder",
        label: "place order",
        sources: [{ path: "package.json" }],
      },
    ],
  };
}

test("runtimeSemanticSchemaText round-trips as a JSON Schema with the expected $defs", () => {
  const schema = JSON.parse(runtimeSemanticSchemaText());
  assert.equal(schema.type, "object");
  assert.ok(schema.$defs.runtimeUnit);
  assert.ok(schema.$defs.responsibility);
  assert.ok(schema.$defs.interaction);
});

test("checkRuntimeSemanticSchema accepts a valid minimal document", () => {
  const diagnostics = checkRuntimeSemanticSchema(minimalDoc());
  assert.deepEqual(diagnostics, []);
});

test("checkRuntimeSemanticSchema rejects an unknown runtime kind", () => {
  const doc = minimalDoc();
  (doc.runtimes[0] as { kind: string }).kind = "not-a-real-kind";
  const diagnostics = checkRuntimeSemanticSchema(doc);
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((d) => d.code === "runtime-semantic/schema" && d.severity === "error"));
});

test("checkRuntimeSemanticSchema rejects an actor with a runtimeId field", () => {
  const doc = minimalDoc();
  const actorWithRuntimeId = { ...doc.actors[0], runtimeId: "runtimeServer" };
  const diagnostics = checkRuntimeSemanticSchema({ ...doc, actors: [actorWithRuntimeId] });
  assert.ok(diagnostics.length > 0);
});

test("validateRuntimeSemantics rejects a responsibility with an unknown runtimeId", () => {
  const doc = minimalDoc();
  doc.responsibilities[0]!.runtimeId = "runtimeDoesNotExist";
  const diagnostics = validateRuntimeSemantics(doc, { projectPath: process.cwd() });
  const hit = diagnostics.find((d) => d.code === "RESPONSIBILITY_WITHOUT_RUNTIME");
  assert.ok(hit, `expected RESPONSIBILITY_WITHOUT_RUNTIME, got: ${JSON.stringify(diagnostics)}`);
  assert.equal(hit?.severity, "error");
});

test("validateRuntimeSemantics rejects an interaction with an unknown endpoint", () => {
  const doc = minimalDoc();
  doc.interactions[0]!.to = "somethingThatDoesNotExist";
  const diagnostics = validateRuntimeSemantics(doc, { projectPath: process.cwd() });
  const hit = diagnostics.find((d) => d.code === "UNKNOWN_INTERACTION_ENDPOINT");
  assert.ok(hit, `expected UNKNOWN_INTERACTION_ENDPOINT, got: ${JSON.stringify(diagnostics)}`);
  assert.equal(hit?.severity, "error");
});

test("validateRuntimeSemantics rejects duplicate ids across entity kinds", () => {
  const doc = minimalDoc();
  doc.states.push({ id: "respOrder", label: "Duplicate", sources: [{ path: "package.json" }] });
  const diagnostics = validateRuntimeSemantics(doc, { projectPath: process.cwd() });
  const hit = diagnostics.find((d) => d.code === "DUPLICATE_ID");
  assert.ok(hit, `expected DUPLICATE_ID, got: ${JSON.stringify(diagnostics)}`);
  assert.equal(hit?.severity, "error");
});
