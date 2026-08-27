import { test } from "node:test";
import assert from "node:assert/strict";
import { architectureViewSchemaText, runtimeSemanticSchemaText } from "@vibee/architecture-view";
import { buildArchitectureViewPrompt } from "../prompt.js";
import { MAX_ARCHITECTURE_VIEW_ATTEMPTS, MAX_RUNTIME_SEMANTIC_ATTEMPTS } from "../state.js";

const ARCHITECTURE_SCHEMA_FENCE_START = "```json architecture-view-schema";
const RUNTIME_SEMANTIC_SCHEMA_FENCE_START = "```json runtime-semantic-schema";
const SCHEMA_FENCE_END = "```";

function extractFencedBlock(prompt: string, fenceStart: string): string {
  const startIdx = prompt.indexOf(fenceStart);
  assert.ok(startIdx >= 0, `expected fence marker "${fenceStart}" to be present in the prompt`);
  const afterStart = startIdx + fenceStart.length;
  const endIdx = prompt.indexOf(SCHEMA_FENCE_END, afterStart);
  assert.ok(endIdx >= 0, "expected a closing fence after the block");
  return prompt.slice(afterStart, endIdx).trim();
}

test("the architecture-view schema embedded in the prompt is exactly the validator's schema (single source of truth)", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", "abc123");
  const embedded = JSON.parse(extractFencedBlock(prompt, ARCHITECTURE_SCHEMA_FENCE_START));
  const canonical = JSON.parse(architectureViewSchemaText());
  assert.deepEqual(embedded, canonical);
});

test("the runtime-semantic schema embedded in the prompt is exactly the validator's schema (single source of truth)", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", "abc123");
  const embedded = JSON.parse(extractFencedBlock(prompt, RUNTIME_SEMANTIC_SCHEMA_FENCE_START));
  const canonical = JSON.parse(runtimeSemanticSchemaText());
  assert.deepEqual(embedded, canonical);
});

test("the prompt names all three MCP tools and states both hard caps with their real numbers", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", "abc123");
  assert.match(prompt, /submit_runtime_semantics/);
  assert.match(prompt, /validate_architecture_view/);
  assert.match(prompt, /submit_architecture_view/);

  assert.equal(MAX_RUNTIME_SEMANTIC_ATTEMPTS, 4);
  assert.equal(MAX_ARCHITECTURE_VIEW_ATTEMPTS, 6);
  const semanticCapRegex = new RegExp(`\\b${MAX_RUNTIME_SEMANTIC_ATTEMPTS}\\b.*calls total|calls total.*\\b${MAX_RUNTIME_SEMANTIC_ATTEMPTS}\\b`);
  assert.match(prompt, semanticCapRegex);
  const architectureCapRegex = new RegExp(`\\b${MAX_ARCHITECTURE_VIEW_ATTEMPTS}\\b.*calls total|calls total.*\\b${MAX_ARCHITECTURE_VIEW_ATTEMPTS}\\b`);
  assert.match(prompt, architectureCapRegex);
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

// docs/v2_plan.md §12.4: the following concepts/phrases must always be
// present in the assembled prompt.
test("the prompt covers every §12.4 regression-test concept", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/some-project", "abc123");

  assert.match(prompt, /runtime architecture/i);
  assert.match(prompt, /responsibility/i);
  assert.match(prompt, /implementation.*(preserved|not.*(lost|summarized))|preserved verbatim in the semantic model/i);
  assert.match(prompt, /not a topology (to copy|template)/i);
  assert.match(prompt, /do not reproduce (their|example) node counts.*coordinates/i);
  assert.match(prompt, /repository evidence/i);
  assert.match(prompt, /actors? (are|is|placed) (never inside|outside)|outside every runtime boundary/i);
  assert.match(prompt, /source of truth/i);
  assert.match(prompt, /exactly one canonical architecture/i);
  assert.match(prompt, /simple and technical share the same semantic identity/i);
  assert.match(prompt, /hide technical jargon by default/i);
  assert.match(prompt, /every visible simple-view text must be Korean/i);
  assert.match(prompt, /English-only phrase/i);
  assert.match(prompt, /no profile-specific topology generation/i);
  assert.match(prompt, /every component kept on the canvas must retain at least one evidence-backed connection/i);
  assert.match(prompt, /do not stop merely because the total error count stayed the same/i);
  assert.match(prompt, /changed .*code.*subject.* set means the previous fix made progress/i);
});
