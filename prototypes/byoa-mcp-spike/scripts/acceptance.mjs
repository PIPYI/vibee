#!/usr/bin/env node
/**
 * Phase A acceptance 회귀 게이트.
 *
 * 이 spike가 의존하는 것은 Codex의 스키마가 아니라 **동작**이다. 지금까지 두 번의 파손이
 * 모두 스키마는 그대로인 채 의미만 바뀐 경우였다(SPIKE_FINDINGS.md Finding 1, 4).
 * 타입 검사로는 잡을 수 없으므로, 실제로 한 번 돌려보고 확인하는 이 스크립트가
 * Codex 업그레이드 후의 유일한 신뢰할 수 있는 검증 수단이다.
 *
 * Codex를 업데이트했다면 이것부터 돌린다.
 *
 *   npm run acceptance
 *
 * 통과 조건은 SPIKE_FINDINGS.md §2와 같다. 하나라도 어긋나면 비정상 종료한다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bridgeConfig, fixtureDir, spikeRoot } from "./_shared.mjs";

const TIMEOUT_MS = 240_000;
const MARKER = "Edited by BYOA agent.";
const fixture = await fixtureDir();
const readme = join(fixture, "README.md");

const config = await bridgeConfig();
const seenMcp = new Set();
const seenTypes = new Set();
let changedFiles = [];
let result = null;
let failure = null;

function fail(message) {
  console.error(`\n실패: ${message}`);
  process.exit(1);
}

// --- 사전 조건 -------------------------------------------------------------

let codexVersion = "(unknown)";
try {
  codexVersion = execFileSync("codex", ["--version"], { encoding: "utf8" }).trim();
} catch {
  fail("codex CLI를 찾을 수 없습니다.");
}

const health = await fetch(`${config.baseUrl}/api/health`).catch(() => null);
if (!health?.ok) fail(`bridge에 접속할 수 없습니다 (${config.baseUrl}). 먼저 \`npm run bridge\`를 실행하세요.`);
const codexReady = (await health.json()).agents.find((a) => a.agent === "codex");
if (!codexReady?.installed || codexReady.authenticated === false) {
  fail(codexReady?.message ?? "Codex가 준비되지 않았습니다.");
}

console.log(`Codex     : ${codexVersion}`);
console.log(`Bridge    : ${config.baseUrl}`);
console.log(`Fixture   : ${fixture}`);

// 항상 같은 초기 상태에서 시작한다.
execFileSync("node", [join(spikeRoot, "scripts", "create-fixture.mjs")], { stdio: "ignore" });
if (readFileSync(readme, "utf8").includes(MARKER)) fail("fixture 초기화에 실패했습니다.");

// --- 실행 -----------------------------------------------------------------

const { WebSocket } = await import(join(spikeRoot, "node_modules", "ws", "index.js")).then((m) => ({
  WebSocket: m.default ?? m,
}));

const socket = new WebSocket(`${config.baseUrl.replace("http", "ws")}/events`);

/**
 * 우리 task의 이벤트만 센다.
 *
 * bridge는 새로 접속한 클라이언트에게 직전 task의 이벤트를 replay 한다(재접속 대비).
 * taskId로 거르지 않으면 접속 직후 들어오는 이전 실행의 `task.completed`를 우리 것으로
 * 오인해서, agent가 일을 시작하기도 전에 검사를 돌려 버린다.
 */
let ourTaskId = null;
const finished = new Promise((resolve) => {
  const timer = setTimeout(() => {
    failure = `${TIMEOUT_MS / 1000}초 안에 task가 끝나지 않았습니다.`;
    resolve();
  }, TIMEOUT_MS);

  socket.on("message", (raw) => {
    const { event } = JSON.parse(raw.toString());
    if (!ourTaskId || event.taskId !== ourTaskId) return;
    seenTypes.add(event.type);

    if (event.type === "mcp.tool.called") seenMcp.add(`${event.tool}:${event.source}`);
    if (event.type === "app.result") result = event.result;
    if (event.type === "agent.action.completed" && event.name === "fileChange") {
      changedFiles = changedFiles.concat(event.detail?.files ?? []);
    }
    if (event.type === "task.error") failure = event.message;

    if (["task.completed", "task.error", "task.interrupted"].includes(event.type)) {
      clearTimeout(timer);
      setTimeout(resolve, 1000);
    }
  });
});

socket.on("open", async () => {
  const response = await fetch(`${config.baseUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent: "codex",
      projectPath: fixture,
      prompt: `README.md의 마지막에 "${MARKER}" 라는 줄을 추가해줘.`,
      appContext: { selectedItem: { id: "login-screen", label: "Login Screen" } },
    }),
  });
  if (!response.ok) fail(`task 시작 실패: ${await response.text()}`);
  ourTaskId = (await response.json()).taskId;
  console.log(`Task      : ${ourTaskId}\n`);
});

await finished;
socket.close();

// --- 검증 -----------------------------------------------------------------

const checks = [
  ["task가 오류 없이 완료됨", () => (failure ? failure : seenTypes.has("task.completed") || "task.completed 이벤트가 없습니다")],
  ["진행 이벤트가 스트리밍됨", () => seenTypes.has("task.started") || "task.started 이벤트가 없습니다"],
  ["get_app_context — agent 스트림 증거", () => seenMcp.has("get_app_context:agent-stream") || "Codex가 호출을 보고하지 않았습니다"],
  ["get_app_context — bridge 도달 증거", () => seenMcp.has("get_app_context:bridge-endpoint") || "MCP server가 bridge에 도달하지 못했습니다"],
  ["show_result — agent 스트림 증거", () => seenMcp.has("show_result:agent-stream") || "Codex가 호출을 보고하지 않았습니다"],
  ["show_result — bridge 도달 증거", () => seenMcp.has("show_result:bridge-endpoint") || "MCP server가 bridge에 도달하지 못했습니다"],
  ["구조화된 결과가 UI로 전달됨", () => (result ? result.status === "success" || `status가 "${result.status}"입니다` : "app.result 이벤트가 없습니다")],
  ["fileChange 이벤트에 README.md가 있음", () => changedFiles.some((f) => f.endsWith("README.md")) || "README.md 변경이 보고되지 않았습니다"],
  ["파일시스템에 실제로 반영됨", () => readFileSync(readme, "utf8").trimEnd().endsWith(MARKER) || "README.md 마지막 줄이 기대와 다릅니다"],
];

let failed = 0;
for (const [label, check] of checks) {
  let outcome;
  try {
    outcome = check();
  } catch (error) {
    outcome = error.message;
  }
  if (outcome === true) {
    console.log(`  [PASS] ${label}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${label} — ${outcome}`);
  }
}

console.log();
if (failed > 0) {
  console.error(`${failed}/${checks.length} 항목 실패 (Codex ${codexVersion}).`);
  console.error("SPIKE_FINDINGS.md의 Findings를 먼저 확인하세요. 새로운 동작 변경이면 거기에 기록합니다.");
  process.exit(1);
}
console.log(`전 항목 통과 (Codex ${codexVersion}).`);
