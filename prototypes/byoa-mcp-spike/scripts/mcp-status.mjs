#!/usr/bin/env node
/** 이 spike의 MCP server가 Codex에 등록되어 있는지 보여준다. */
import { codex, MCP_SERVER_NAME } from "./_shared.mjs";

try {
  const output = codex(["mcp", "get", MCP_SERVER_NAME], { capture: true });
  console.log(output.trim());
} catch {
  console.log(`MCP server "${MCP_SERVER_NAME}" is not registered.`);
  console.log("Register it with `npm run mcp:register`.");
  process.exit(1);
}
