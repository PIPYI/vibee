import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ArchitectureViewDocument } from "@vibee/protocol";
import { readArchitectureView, writeArchitectureView } from "../store.js";

function makeDoc(): ArchitectureViewDocument {
  return {
    schemaVersion: 1,
    title: "Test App",
    components: [
      { id: "web", type: "frontend", label: "Web App", pos: [0, 0], size: [170, 70] },
      { id: "api", type: "backend", label: "API", pos: [250, 0], size: [170, 70] },
    ],
    boundaries: [],
    connections: [{ from: "web", to: "api", label: "HTTPS" }],
  };
}

test("writeArchitectureView then readArchitectureView round-trips the document and stamps committedAt", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vibee-store-test-"));
  try {
    const doc = makeDoc();
    writeArchitectureView(dir, doc, { gitRevision: "deadbeef", taskId: "task-1" });

    const result = readArchitectureView(dir);
    assert.ok(result);
    assert.deepEqual(result.document, doc);
    assert.equal(result.meta.taskId, "task-1");
    assert.equal(result.meta.gitRevision, "deadbeef");
    assert.equal(typeof result.meta.committedAt, "string");
    assert.ok(result.meta.committedAt.length > 0);
    // Sanity check it's a real ISO timestamp.
    assert.ok(!Number.isNaN(Date.parse(result.meta.committedAt)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readArchitectureView returns null when nothing has been committed yet", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vibee-store-test-empty-"));
  try {
    assert.equal(readArchitectureView(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeArchitectureView works without a gitRevision", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "vibee-store-test-norev-"));
  try {
    const doc = makeDoc();
    writeArchitectureView(dir, doc, { taskId: "task-2" });
    const result = readArchitectureView(dir);
    assert.ok(result);
    assert.equal(result.meta.gitRevision, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
