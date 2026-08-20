import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_SERVER_NAME = "byoa-spike";
export const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const mcpEntry = join(spikeRoot, "packages", "mcp-server", "dist", "index.js");

/** 빌드된 protocol 패키지를 그대로 쓴다. 경로·토큰 정의를 한 곳으로 모으기 위함이다. */
async function protocolNode() {
  return import(join(spikeRoot, "packages", "protocol", "dist", "node.js"));
}

/** bridge와 같은 설정 로더를 재사용해서 토큰이 항상 일치하도록 한다. */
export async function bridgeConfig() {
  return (await protocolNode()).loadBridgeConfig(spikeRoot);
}

/** bridge가 브라우저에 내려주는 것과 동일한 fixture 경로. */
export async function fixtureDir() {
  return (await protocolNode()).fixturePath(spikeRoot);
}

/** 윈도우에서 codex/claude는 .cmd 래퍼라 shell을 거쳐야 실행된다 (apps/bridge/src/platform.ts). */
export const cliSpawnOptions = { shell: process.platform === "win32" };

export function codex(args, { capture = false } = {}) {
  return execFileSync("codex", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...cliSpawnOptions,
  });
}
