import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  exploredFilesFromCommandActions,
  exploredFilesFromExecInput,
  mcpToolsFromExecInput,
} from "../agents/codex/adapter.js";

const PROJECT_PATH = "/workspace/example";

test("exploredFilesFromCommandActions returns structured read targets", () => {
  assert.deepEqual(
    exploredFilesFromCommandActions(
      [
        { type: "search", path: "src" },
        { type: "read", path: "src/index.ts" },
        { type: "listFiles", path: "." },
        { type: "read", path: "/workspace/example/package.json" },
      ],
      PROJECT_PATH,
    ),
    ["/workspace/example/src/index.ts", "/workspace/example/package.json"],
  );
});

test("exploredFilesFromCommandActions ignores duplicate and out-of-project reads", () => {
  assert.deepEqual(
    exploredFilesFromCommandActions(
      [
        { type: "read", path: "src/index.ts" },
        { type: "read", path: "src/../src/index.ts" },
        { type: "read", path: "../secret.txt" },
        { type: "read", path: "/etc/passwd" },
      ],
      PROJECT_PATH,
    ),
    ["/workspace/example/src/index.ts"],
  );
});

test("exploredFilesFromExecInput extracts existing files from code-mode commands", async () => {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "vibee-codex-adapter-"));
  try {
    await mkdir(path.join(projectPath, "src"));
    await writeFile(path.join(projectPath, "src/index.ts"), "export {};\n");
    await writeFile(path.join(projectPath, "package.json"), "{}\n");
    const input = `const r = await tools.exec_command({"cmd":"nl -ba src/index.ts && rg -n test package.json ../outside.txt","workdir":${JSON.stringify(projectPath)}});`;

    assert.deepEqual(exploredFilesFromExecInput(input, projectPath), [
      path.join(projectPath, "src/index.ts"),
      path.join(projectPath, "package.json"),
    ]);
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test("mcpToolsFromExecInput extracts and deduplicates Vibee code-mode calls", () => {
  assert.deepEqual(
    mcpToolsFromExecInput(
      "await tools.mcp__vibee__validate_architecture_view(doc); await tools.mcp__vibee__validate_architecture_view(doc); await tools.mcp__other__ignored({});",
    ),
    ["mcp__vibee__validate_architecture_view"],
  );
});
