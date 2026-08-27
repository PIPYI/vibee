import { test } from "node:test";
import assert from "node:assert/strict";
import { decideToolUse } from "../agents/claude/adapter.js";

const PROJECT_PATH = "/Users/someone/projects/my-app";

test("decideToolUse allows mcp__vibee__* tools", () => {
  assert.deepEqual(decideToolUse("mcp__vibee__validate_architecture_view", {}, PROJECT_PATH), {
    behavior: "allow",
  });
  assert.deepEqual(decideToolUse("mcp__vibee__submit_architecture_view", {}, PROJECT_PATH), {
    behavior: "allow",
  });
});

test("decideToolUse denies WebFetch and WebSearch", () => {
  assert.equal(decideToolUse("WebFetch", { url: "https://example.com" }, PROJECT_PATH).behavior, "deny");
  assert.equal(decideToolUse("WebSearch", { query: "foo" }, PROJECT_PATH).behavior, "deny");
});

test("decideToolUse denies Write outside the project path", () => {
  const decision = decideToolUse("Write", { file_path: "/etc/passwd" }, PROJECT_PATH);
  assert.equal(decision.behavior, "deny");
});

test("decideToolUse allows Write inside the project path", () => {
  const decision = decideToolUse(
    "Write",
    { file_path: `${PROJECT_PATH}/.vibee/scratch.txt` },
    PROJECT_PATH,
  );
  assert.deepEqual(decision, { behavior: "allow" });
});

test("decideToolUse allows Read", () => {
  assert.deepEqual(decideToolUse("Read", { file_path: `${PROJECT_PATH}/src/index.ts` }, PROJECT_PATH), {
    behavior: "allow",
  });
});

test("decideToolUse allows Read/Grep/Glob without file_path input", () => {
  assert.equal(decideToolUse("Grep", { pattern: "foo" }, PROJECT_PATH).behavior, "allow");
  assert.equal(decideToolUse("Glob", { pattern: "**/*.ts" }, PROJECT_PATH).behavior, "allow");
});
