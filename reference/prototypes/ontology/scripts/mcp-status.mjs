#!/usr/bin/env node
/**
 * 등록 상태와 bridge 연결을 확인한다.
 *
 * 실패를 조용히 넘기지 않는다 — 무엇이 없어서 안 되는지 말한다.
 */
import { existsSync } from "node:fs";

import { MCP_SERVER_NAME } from "@onto/protocol";

import { MCP_ENTRY, bridgeConfig, run } from "./_shared.mjs";

const config = await bridgeConfig();

console.log("MCP server");
console.log(`  entry     : ${MCP_ENTRY} ${existsSync(MCP_ENTRY) ? "(있음)" : "(없음 — npm run build)"}`);
console.log(`  bridge    : ${config.baseUrl}`);
console.log(`  config    : ${config.configPath}`);

const health = await fetch(`${config.baseUrl}/api/state`).catch(() => null);
console.log(`  bridge 응답: ${health?.ok ? "예" : "아니오 (npm run bridge)"}`);

console.log("");
console.log("Codex 등록");
const listed = run("codex", ["mcp", "list"]);
if (listed.error || listed.status !== 0) {
  console.log("  codex CLI 를 실행할 수 없습니다 (설치되지 않았거나 PATH 에 없음)");
} else {
  const output = (listed.stdout ?? "").trim();
  const registered = output.includes(MCP_SERVER_NAME);
  console.log(`  ${MCP_SERVER_NAME}: ${registered ? "등록됨" : "없음 — npm run mcp:register"}`);
  if (output) console.log(output.split("\n").map((line) => `    ${line}`).join("\n"));
}

console.log("");
console.log("Claude 는 전역 등록이 필요 없습니다 (query 마다 직접 전달).");
