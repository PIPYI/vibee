#!/usr/bin/env node
/** 등록을 되돌린다. 프로토타입을 정리할 때 사용자의 전역 설정에 흔적을 남기지 않는다. */
import { MCP_SERVER_NAME } from "@onto/protocol";

import { run } from "./_shared.mjs";

const result = run("codex", ["mcp", "remove", MCP_SERVER_NAME]);
if (result.error || result.status !== 0) {
  console.error("`codex mcp remove` 에 실패했습니다.");
  if (result.stderr?.trim()) console.error(`  ${result.stderr.trim()}`);
  console.error(`수동으로 \`~/.codex/config.toml\` 의 [mcp_servers.${MCP_SERVER_NAME}] 을 지우세요.`);
  process.exit(1);
}
console.log(`등록 해제됨: ${MCP_SERVER_NAME}`);
