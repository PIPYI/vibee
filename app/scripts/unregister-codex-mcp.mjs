#!/usr/bin/env node
/** Codex 설정에서 `vci-app` MCP server 항목만 제거한다. */
import { codex, MCP_SERVER_NAME } from "./_shared.mjs";

try {
  codex(["mcp", "remove", MCP_SERVER_NAME]);
  console.log(`Removed MCP server "${MCP_SERVER_NAME}".`);
} catch (error) {
  console.error(`Failed to remove "${MCP_SERVER_NAME}": ${error.message}`);
  process.exit(1);
}
