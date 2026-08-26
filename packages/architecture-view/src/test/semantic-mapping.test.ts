import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArchitectureViewComponent, ArchitectureViewDocument, RuntimeSemanticDocument } from "@vibee/protocol";
import { checkSemanticMapping } from "../semantic-mapping.js";

function semanticDoc(partial: Partial<RuntimeSemanticDocument> = {}): RuntimeSemanticDocument {
  return {
    schemaVersion: 1,
    title: "Semantic",
    actors: [{ id: "actor-traveler", label: "Traveler" }],
    runtimes: [{ id: "runtime-server", label: "Server", kind: "server", sources: [{ path: "src/server.ts" }] }],
    responsibilities: [
      { id: "resp-order", runtimeId: "runtime-server", label: "Order Processing", sources: [{ path: "src/order.ts" }] },
    ],
    states: [],
    externals: [],
    interactions: [
      { id: "int-place-order", from: "actor-traveler", to: "resp-order", label: "place order", sources: [{ path: "src/order.ts" }] },
    ],
    ...partial,
  };
}

function comp(overrides: Partial<ArchitectureViewComponent> & Pick<ArchitectureViewComponent, "id" | "semanticRole" | "semanticRefs">): ArchitectureViewComponent {
  return {
    type: "backend",
    label: overrides.id,
    pos: [0, 0],
    size: [100, 60],
    ...overrides,
  };
}

function archDoc(partial: Partial<ArchitectureViewDocument>): ArchitectureViewDocument {
  return {
    schemaVersion: 2,
    title: "Arch",
    components: [],
    boundaries: [],
    connections: [],
    ...partial,
  };
}

test("a fully matching document produces zero diagnostics", () => {
  const doc = archDoc({
    components: [
      comp({ id: "traveler", semanticRole: "actor", semanticRefs: ["actor-traveler"], pos: [0, 0] }),
      comp({ id: "orderProcessing", semanticRole: "responsibility", semanticRefs: ["resp-order"], pos: [300, 0] }),
    ],
    boundaries: [{ kind: "runtime", semanticRefs: ["runtime-server"], label: "Server Runtime", wraps: ["orderProcessing"] }],
    connections: [{ id: "e1", from: "traveler", to: "orderProcessing", semanticRefs: ["int-place-order"] }],
  });
  const diagnostics = checkSemanticMapping(doc, semanticDoc());
  assert.deepEqual(diagnostics, []);
});

test("ACTOR_WRAPPED_BY_RUNTIME: an actor component inside a kind=runtime boundary is an error", () => {
  const doc = archDoc({
    components: [comp({ id: "traveler", semanticRole: "actor", semanticRefs: ["actor-traveler"], pos: [0, 0] })],
    boundaries: [{ kind: "runtime", semanticRefs: ["runtime-server"], label: "Server Runtime", wraps: ["traveler"] }],
  });
  const diagnostics = checkSemanticMapping(doc, semanticDoc());
  const hit = diagnostics.find((d) => d.code === "ACTOR_WRAPPED_BY_RUNTIME");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("a component semanticRefs pointing at a nonexistent semantic entity is an error", () => {
  const doc = archDoc({
    components: [comp({ id: "orderProcessing", semanticRole: "responsibility", semanticRefs: ["resp-does-not-exist"], pos: [0, 0] })],
  });
  const diagnostics = checkSemanticMapping(doc, semanticDoc());
  const hit = diagnostics.find((d) => d.code === "UNKNOWN_SEMANTIC_REF" && d.subject === "orderProcessing");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("a runtime boundary whose semanticRefs don't point at a real runtime is an error", () => {
  const doc = archDoc({
    components: [comp({ id: "orderProcessing", semanticRole: "responsibility", semanticRefs: ["resp-order"], pos: [0, 0] })],
    boundaries: [{ kind: "runtime", semanticRefs: ["runtime-does-not-exist"], label: "Server Runtime", wraps: ["orderProcessing"] }],
  });
  const diagnostics = checkSemanticMapping(doc, semanticDoc());
  const hit = diagnostics.find((d) => d.code === "UNKNOWN_SEMANTIC_REF" && d.subject === "Server Runtime");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});

test("a connection semanticRefs pointing at an unknown interaction id is an error", () => {
  const doc = archDoc({
    components: [
      comp({ id: "traveler", semanticRole: "actor", semanticRefs: ["actor-traveler"], pos: [0, 0] }),
      comp({ id: "orderProcessing", semanticRole: "responsibility", semanticRefs: ["resp-order"], pos: [300, 0] }),
    ],
    connections: [{ id: "e1", from: "traveler", to: "orderProcessing", semanticRefs: ["int-does-not-exist"] }],
  });
  const diagnostics = checkSemanticMapping(doc, semanticDoc());
  const hit = diagnostics.find((d) => d.code === "UNKNOWN_SEMANTIC_REF" && d.subject === "e1");
  assert.ok(hit);
  assert.equal(hit?.severity, "error");
});
