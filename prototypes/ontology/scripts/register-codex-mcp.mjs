#!/usr/bin/env node
/**
 * Codex 에 이 MCP server 를 등록한다.
 *
 * **Codex 만 필요하다.** Claude 는 `options.mcpServers` 로 query 마다 직접 넘기므로 전역
 * 등록이 필요 없다 — spike 가 확인한 provider 차이다.
 *
 * 등록은 **Codex CLI 가 자기 설정 파일을 소유하게 둔다.** 우리가 `~/.codex/config.toml` 을
 * 직접 편집하지 않는다 — 형식이 버전마다 바뀔 수 있고, 사용자의 다른 설정을 망가뜨릴 수 있다.
 */
import { MCP_SERVER_NAME } from "@onto/protocol";

import { MCP_ENTRY, assertBuilt, bridgeConfig, run } from "./_shared.mjs";

assertBuilt();
const config = await bridgeConfig();

const args = [
  "mcp",
  "add",
  MCP_SERVER_NAME,
  "--env",
  `ONTO_BRIDGE_URL=${config.baseUrl}`,
  "--env",
  `ONTO_BRIDGE_TOKEN=${config.token}`,
  "--",
  process.execPath,
  MCP_ENTRY,
];

const result = run("codex", args);

if (result.error || result.status !== 0) {
  console.error("`codex mcp add` 에 실패했습니다.");
  if (result.error) console.error(`  ${result.error.message}`);
  if (result.stderr?.trim()) console.error(`  ${result.stderr.trim()}`);
  console.error("");
  console.error("CLI 버전에 따라 플래그가 다를 수 있습니다. 수동으로 등록하려면");
  console.error("`~/.codex/config.toml` 에 아래를 추가하세요:");
  console.error("");
  console.error(`[mcp_servers.${MCP_SERVER_NAME}]`);
  console.error(`command = ${JSON.stringify(process.execPath)}`);
  console.error(`args = [${JSON.stringify(MCP_ENTRY)}]`);
  console.error("");
  console.error(`[mcp_servers.${MCP_SERVER_NAME}.env]`);
  console.error(`ONTO_BRIDGE_URL = ${JSON.stringify(config.baseUrl)}`);
  console.error(`ONTO_BRIDGE_TOKEN = ${JSON.stringify(config.token)}`);
  process.exit(1);
}

console.log(`등록됨: ${MCP_SERVER_NAME}`);
console.log(`  command : ${process.execPath}`);
console.log(`  args    : ${MCP_ENTRY}`);
console.log(`  bridge  : ${config.baseUrl}`);
console.log("");
console.log("확인: npm run mcp:status");
