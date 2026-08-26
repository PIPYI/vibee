#!/usr/bin/env node
/**
 * bridge 포트에 남아 있는 프로세스를 정리한다.
 *
 * `npm run bridge`를 감싸는 npm 스크립트 체인(`npm run bridge` → `npm run start
 * -w @onto/bridge` → `node dist/index.js`)에서는 Ctrl+C(SIGINT)가 가장 안쪽 `node`
 * 프로세스까지 항상 전달된다는 보장이 없다 — npm의 알려진 한계다. 그 결과 이전 bridge가
 * 고아 프로세스로 남아 포트를 물고 있으면 다음 `npm run bridge`가 `EADDRINUSE`로 죽는다.
 *
 * **그 포트에 있는 것이 우리 bridge인지 먼저 확인하고 나서만 죽인다** — 같은 포트를
 * 다른 프로세스가 우연히 쓰고 있을 수도 있으므로, 확인 없이 죽이면 무관한 프로세스를
 * 건드리는 사고가 난다.
 */
import { execFileSync } from "node:child_process";

import { bridgeConfig, fetchJson } from "./_shared.mjs";

const config = await bridgeConfig();

const pids = findListeningPids(config.port);
if (pids.length === 0) {
  console.log(`포트 ${config.port}에 아무것도 떠 있지 않습니다 — 이미 꺼져 있습니다.`);
  process.exit(0);
}

// **우리 bridge인지 확인한다.** `/api/state`가 우리가 아는 모양(`tasks` 배열)으로
// 응답해야만 우리 것으로 인정한다 — 응답이 없거나 모양이 다르면 무관한 프로세스일 수
// 있으므로 죽이지 않고 사람이 판단하게 한다.
const health = await fetchJson(`${config.baseUrl}/api/state`).catch(() => null);
const looksLikeOurBridge = health?.ok && Array.isArray(health.body?.tasks);

if (!looksLikeOurBridge) {
  console.error(`포트 ${config.port}을 뭔가 쓰고 있는데, 우리 bridge인지 확인하지 못했습니다.`);
  console.error(`PID: ${pids.join(", ")}`);
  console.error("우리 bridge가 맞는지 직접 확인한 뒤 수동으로 종료하세요 (예: kill <PID>).");
  process.exit(1);
}

console.log(`우리 bridge를 확인했습니다 (PID: ${pids.join(", ")}). 정리합니다.`);
for (const pid of pids) killGracefully(pid);

await new Promise((resolve) => setTimeout(resolve, 500));
const remaining = findListeningPids(config.port);
if (remaining.length > 0) {
  console.log("아직 남아 있어 SIGKILL로 정리합니다.");
  for (const pid of remaining) killForcefully(pid);
}

console.log(`포트 ${config.port}을 정리했습니다.`);

// ---------------------------------------------------------------------------

function findListeningPids(port) {
  if (process.platform === "win32") {
    const result = spawnCapture("cmd", ["/c", `netstat -ano | findstr :${port}`]);
    if (!result) return [];
    const pids = new Set();
    for (const line of result.split("\n")) {
      const match = line.trim().match(/LISTENING\s+(\d+)\s*$/u);
      if (match) pids.add(match[1]);
    }
    return [...pids];
  }
  const result = spawnCapture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (!result) return [];
  return result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function spawnCapture(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // lsof/netstat가 아무것도 못 찾으면 0이 아닌 코드로 끝난다 — 그냥 "없다"는 뜻이다.
    return null;
  }
}

function killGracefully(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", pid, "/T"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(Number(pid), "SIGTERM");
  } catch {
    // 이미 죽었다.
  }
}

function killForcefully(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch {
    // 이미 죽었다.
  }
}
