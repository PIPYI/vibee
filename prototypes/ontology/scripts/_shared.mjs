/**
 * 스크립트들이 공유하는 것. bridge 설정을 **bridge 와 같은 함수로** 읽는다 (B1).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROTO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MCP_ENTRY = join(PROTO_ROOT, "packages", "mcp-server", "dist", "index.js");
export const FIXTURE_DIR = join(PROTO_ROOT, "tmp", "fixture");

export async function bridgeConfig() {
  const { loadBridgeConfig } = await import("@onto/protocol/bridge-config");
  return loadBridgeConfig(PROTO_ROOT);
}

export function assertBuilt() {
  if (!existsSync(MCP_ENTRY)) {
    console.error(`MCP server 가 빌드되지 않았습니다: ${MCP_ENTRY}`);
    console.error("먼저 `npm run build` 를 실행하세요.");
    process.exit(1);
  }
}

/** 윈도우의 `.cmd` 래퍼를 위해 셸을 거친다. 인자는 전부 상수 문자열이다. */
export function cliSpawnOptions(extra = {}) {
  return process.platform === "win32" ? { ...extra, shell: true } : { ...extra };
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...cliSpawnOptions(options) });
}

export async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
}

export async function requireBridge() {
  const config = await bridgeConfig();
  const health = await fetch(`${config.baseUrl}/api/state`).catch(() => null);
  if (!health?.ok) {
    console.error(`bridge 에 접속할 수 없습니다 (${config.baseUrl}).`);
    console.error("먼저 다른 창에서 `npm run bridge` 를 실행하세요.");
    process.exit(1);
  }
  return config;
}
