import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArchitectureViewDocument } from "@vibee/protocol";
import { checkCitations } from "../citation.js";

function docWithSource(source: { path: string; line?: number; endLine?: number }): ArchitectureViewDocument {
  return {
    schemaVersion: 2,
    title: "Citation test",
    components: [
      {
        id: "comp",
        type: "backend",
        semanticRole: "responsibility",
        semanticRefs: ["resp-comp"],
        label: "Comp",
        pos: [0, 0],
        size: [100, 60],
        sources: [source],
      },
    ],
    boundaries: [],
    connections: [],
  };
}

// Tests run with cwd set to the package root (`node --test dist/test/`
// resolves relative to wherever `npm test` was invoked), so package.json at
// process.cwd() is a real file we can cite without needing git.
const projectPath = process.cwd();

test("checkCitations accepts a real file/line with no revision pinned (working tree mode)", () => {
  const doc = docWithSource({ path: "package.json", line: 1 });
  const diagnostics = checkCitations(doc, { projectPath });
  assert.deepEqual(diagnostics, []);
});

test("checkCitations flags a nonexistent path", () => {
  const doc = docWithSource({ path: "this/file/does/not/exist.ts" });
  const diagnostics = checkCitations(doc, { projectPath });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "architecture-view/citation-invalid");
  assert.equal(diagnostics[0]?.severity, "error");
});

test("checkCitations flags a line number far beyond the file's actual length", () => {
  const doc = docWithSource({ path: "package.json", line: 1_000_000 });
  const diagnostics = checkCitations(doc, { projectPath });
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "architecture-view/citation-invalid");
});

// Regression test for the bug where citations were checked against a pinned
// git revision instead of the working tree: an AI always explores via
// Read/Grep/Glob (live filesystem), so a stale/unrelated revision must never
// cause a real, currently-cited file to be flagged as invalid. `revision` is
// no longer even part of `CitationContext` -- passing it through as an
// unknown property confirms callers can't accidentally re-enable the old
// behavior.
test("checkCitations ignores an unrelated/stale revision and validates the working tree", () => {
  const doc = docWithSource({ path: "package.json", line: 1 });
  const diagnostics = checkCitations(doc, {
    projectPath,
    revision: "0000000000000000000000000000000000dead",
  } as unknown as { projectPath: string });
  assert.deepEqual(diagnostics, []);
});
