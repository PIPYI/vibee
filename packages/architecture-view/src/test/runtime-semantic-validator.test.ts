import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeSemanticDocument } from "@vibee/protocol";
import { checkRuntimeSemanticReferences, validateRuntimeSemantics } from "../runtime-semantic-validator.js";

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

test("checkRuntimeSemanticReferences produces zero diagnostics for a well-formed document", () => {
  const diagnostics = checkRuntimeSemanticReferences(minimalDoc());
  assert.deepEqual(diagnostics, []);
});

test("ORPHAN_RUNTIME: a runtime with no responsibilities or states is a warning", () => {
  const doc = minimalDoc();
  doc.runtimes.push({ id: "runtimeWorker", label: "Worker", kind: "worker", sources: [{ path: "package.json" }] });
  const diagnostics = checkRuntimeSemanticReferences(doc);
  const hit = diagnostics.find((d) => d.code === "ORPHAN_RUNTIME" && d.subject === "runtimeWorker");
  assert.ok(hit);
  assert.equal(hit?.severity, "warning");
});

test("UNCONNECTED_PRIMARY_ENTITY: a responsibility with no interactions touching it is a warning", () => {
  const doc = minimalDoc();
  doc.responsibilities.push({
    id: "respOrphan",
    runtimeId: "runtimeServer",
    label: "Untouched",
    sources: [{ path: "package.json" }],
  });
  const diagnostics = checkRuntimeSemanticReferences(doc);
  const hit = diagnostics.find((d) => d.code === "UNCONNECTED_PRIMARY_ENTITY" && d.subject === "respOrphan");
  assert.ok(hit);
  assert.equal(hit?.severity, "warning");
});

test("MISSING_PRIMARY_SOURCE: a responsibility with no sources is an error", () => {
  const doc = minimalDoc();
  // Bypasses the schema stage on purpose -- this exercises
  // checkRuntimeSemanticReferences directly (the schema already requires
  // sources with minItems 1, so this shape can't reach here through
  // validateRuntimeSemantics's full chain).
  doc.responsibilities[0]!.sources = [];
  const diagnostics = checkRuntimeSemanticReferences(doc);
  const hit = diagnostics.find((d) => d.code === "MISSING_PRIMARY_SOURCE" && d.subject === "respOrder");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("EMPTY_INTERACTION_LABEL: an interaction with a blank label is an error", () => {
  const doc = minimalDoc();
  doc.interactions[0]!.label = "   ";
  const diagnostics = checkRuntimeSemanticReferences(doc);
  const hit = diagnostics.find((d) => d.code === "EMPTY_INTERACTION_LABEL");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("validateRuntimeSemantics flags an invalid source citation as an error", () => {
  const doc = minimalDoc();
  doc.responsibilities[0]!.sources = [{ path: "this/file/does/not/exist.ts" }];
  const diagnostics = validateRuntimeSemantics(doc, { projectPath: process.cwd() });
  const hit = diagnostics.find((d) => d.code === "runtime-semantic/citation-invalid");
  assert.ok(hit, `expected a citation-invalid diagnostic, got: ${JSON.stringify(diagnostics)}`);
  assert.equal(hit?.severity, "error");
});

// Regression test for the bug where citations were checked against a pinned
// git revision instead of the working tree: an AI always explores via
// Read/Grep/Glob (live filesystem), so a stale/unrelated revision recorded on
// the document must never cause a real, currently-cited file to be flagged
// as invalid.
test("validateRuntimeSemantics ignores an unrelated/stale repository.revision and validates the working tree", () => {
  const doc = minimalDoc();
  doc.repository = { revision: "0000000000000000000000000000000000dead" };
  const diagnostics = validateRuntimeSemantics(doc, { projectPath: process.cwd() });
  assert.deepEqual(diagnostics.filter((d) => d.code === "runtime-semantic/citation-invalid"), []);
});

test("validateRuntimeSemantics short-circuits on schema failure and never reaches referential/citation stages", () => {
  const diagnostics = validateRuntimeSemantics({ title: "not even close" }, { projectPath: process.cwd() });
  assert.ok(diagnostics.length > 0);
  assert.ok(diagnostics.every((d) => d.code === "runtime-semantic/schema"));
});
