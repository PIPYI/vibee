import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArchitectureViewDocument, RuntimeSemanticDocument } from "@vibee/protocol";
import { inheritSemanticSources } from "../semantic-sources.js";

test("inheritSemanticSources copies canonical responsibility evidence onto its visual component", () => {
  const document: ArchitectureViewDocument = {
    schemaVersion: 2,
    title: "Example",
    components: [{
      id: "storeDocs",
      type: "backend",
      semanticRole: "responsibility",
      semanticRefs: ["resp-store-docs"],
      label: "Store Uploaded Documents",
      pos: [0, 0],
      size: [180, 80],
    }],
    boundaries: [],
    connections: [],
  };
  const semanticDocument: RuntimeSemanticDocument = {
    schemaVersion: 1,
    title: "Example",
    actors: [],
    runtimes: [],
    responsibilities: [{
      id: "resp-store-docs",
      runtimeId: "runtime-server",
      label: "Store Uploaded Documents",
      sources: [{ path: "server/documents.ts", line: 12, endLine: 28 }],
    }],
    states: [],
    externals: [],
    interactions: [],
  };

  const inherited = inheritSemanticSources(document, semanticDocument);
  assert.deepEqual(inherited.components[0]?.sources, [{ path: "server/documents.ts", line: 12, endLine: 28 }]);
});
