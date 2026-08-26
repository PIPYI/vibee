import { test } from "node:test";
import assert from "node:assert/strict";
import { architectureViewSchemaText } from "@vibee/architecture-view";
import { buildArchitectureViewPrompt } from "../prompt.js";

const SCHEMA_FENCE_START = "```json architecture-view-schema";
const SCHEMA_FENCE_END = "```";

function extractSchemaBlock(prompt: string): string {
  const startIdx = prompt.indexOf(SCHEMA_FENCE_START);
  assert.ok(startIdx >= 0, "expected the schema fence marker to be present in the prompt");
  const afterStart = startIdx + SCHEMA_FENCE_START.length;
  const endIdx = prompt.indexOf(SCHEMA_FENCE_END, afterStart);
  assert.ok(endIdx >= 0, "expected a closing fence after the schema block");
  return prompt.slice(afterStart, endIdx).trim();
}

test("the schema embedded in the prompt is exactly the validator's schema (single source of truth)", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", "abc123");
  const embedded = JSON.parse(extractSchemaBlock(prompt));
  const canonical = JSON.parse(architectureViewSchemaText());
  assert.deepEqual(embedded, canonical);
});

test("the prompt names both MCP tools and states the 6-call cap", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", "abc123");
  assert.match(prompt, /validate_architecture_view/);
  assert.match(prompt, /submit_architecture_view/);
  assert.match(prompt, /\b6\b/);
});

test("the prompt mentions the project path and, when given, the git revision", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", "abc123");
  assert.match(prompt, /\/tmp\/some-project/);
  assert.match(prompt, /abc123/);
});

test("the prompt explains the no-git-revision case when none is given", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", undefined);
  assert.match(prompt, /not a git repository|working-tree/);
});
