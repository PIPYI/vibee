import { test } from "node:test";
import assert from "node:assert/strict";
import { hasError, type Diagnostic } from "../diagnostic.js";
import type {
  ArchitectureViewDocument,
  ArchitectureViewComponent,
} from "../architecture-view.js";

test("hasError returns true when at least one error is present", () => {
  const diagnostics: Diagnostic[] = [
    { code: "x/warn", severity: "warning", message: "just a warning" },
    { code: "x/err", severity: "error", message: "an actual error" },
  ];
  assert.equal(hasError(diagnostics), true);
});

test("hasError returns false when only warnings are present", () => {
  const diagnostics: Diagnostic[] = [
    { code: "x/warn", severity: "warning", message: "just a warning" },
  ];
  assert.equal(hasError(diagnostics), false);
});

test("hasError returns false for an empty diagnostics array", () => {
  assert.equal(hasError([]), false);
});

test("ArchitectureViewDocument shape accepts a minimal valid structure", () => {
  const component: ArchitectureViewComponent = {
    id: "web",
    type: "frontend",
    label: "Web app",
    pos: [0, 0],
    size: [100, 60],
  };
  const doc: ArchitectureViewDocument = {
    schemaVersion: 1,
    title: "Minimal",
    components: [component],
    boundaries: [],
    connections: [],
  };
  assert.equal(doc.components.length, 1);
  assert.equal(doc.components[0]?.id, "web");
});
