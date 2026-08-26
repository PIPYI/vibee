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

/**
 * task 가 끝날 때까지 기다린다.
 *
 * **taskId 로 거른다** (B8). replay 버퍼에 이전 task 의 종료 이벤트가 남아 있으면 그것을
 * 자기 것으로 오인한다 — spike 의 acceptance 가 정확히 그것으로 망가졌다(Finding 5).
 * 여기서는 폴링이라 더 단순하지만, 같은 이유로 taskId 를 확인한다.
 */
export async function waitForTask(baseUrl, taskId, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await fetchJson(`${baseUrl}/api/state`);
    const task = (state.body.tasks ?? []).find((item) => item.taskId === taskId);
    if (task && task.status !== "starting" && task.status !== "running") {
      return { status: task.status, detail: task.error ?? "" };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { status: "timeout", detail: `${timeoutMs}ms 안에 끝나지 않았습니다` };
}
