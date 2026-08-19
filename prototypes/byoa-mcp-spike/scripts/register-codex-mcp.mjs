#!/usr/bin/env node
/**
 * 이 spike의 MCP server를 사용자의 Codex CLI에 등록한다.
 *
 * 전역 Codex 설정을 건드리는 것은 이 스크립트가 유일하며, `byoa-spike`라는 이름의
 * 항목 하나만 추가한다. `npm run mcp:unregister`는 정확히 그 항목만 제거한다.
 * 사용자의 다른 설정은 읽지도, 덮어쓰지도, 초기화하지도 않는다.
 *
 * 다음 명령과 동등하다.
 *   codex mcp add byoa-spike --env BRIDGE_URL=... --env BRIDGE_TOKEN=... \
 *     -- node <spike>/packages/mcp-server/dist/index.js
 */
import { existsSync } from "node:fs";

import { bridgeConfig, codex, mcpEntry, MCP_SERVER_NAME } from "./_shared.mjs";

if (!existsSync(mcpEntry)) {
  console.error(`MCP server is not built yet: ${mcpEntry}`);
  console.error("Run `npm run build:server` first.");
  process.exit(1);
}

const config = await bridgeConfig();

console.log(`Registering MCP server "${MCP_SERVER_NAME}" with Codex`);
console.log(`  command    node ${mcpEntry}`);
console.log(`  BRIDGE_URL ${config.baseUrl}`);
console.log(`  token      from ${config.configPath}`);

try {
  codex([
    "mcp",
    "add",
    MCP_SERVER_NAME,
    "--env",
    `BRIDGE_URL=${config.baseUrl}`,
    "--env",
    `BRIDGE_TOKEN=${config.token}`,
    "--",
    "node",
    mcpEntry,
  ]);
} catch (error) {
  console.error(`\nFailed to register: ${error.message}`);
  process.exit(1);
}

console.log(`\nDone. Verify with \`npm run mcp:status\`, remove with \`npm run mcp:unregister\`.`);
