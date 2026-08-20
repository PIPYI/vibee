#!/usr/bin/env node
/**
 * Acceptance 회귀 게이트. 기본은 codex + claude 둘 다 돌린다.
 *
 *   npm run acceptance          # codex, claude 순서로 모두
 *   npm run acceptance codex    # codex만
 *   npm run acceptance claude   # claude만
 *
 * 이 spike가 의존하는 것은 provider의 스키마가 아니라 **동작**이다. Codex는 스키마가 그대로인
 * 채 의미만 바뀌어 두 번 파손된 적이 있다(SPIKE_FINDINGS.md Finding 1, 4). 타입 검사로는 잡을
 * 수 없으므로, 실제로 한 번 돌려보고 확인하는 이 스크립트가 CLI 업그레이드 후의 유일한
 * 신뢰할 수 있는 검증 수단이다. Codex/Claude를 업데이트했다면 이것부터 돌린다.
 *
 * 통과 조건은 SPIKE_FINDINGS.md §2와 같다. 하나라도 어긋나면 비정상 종료한다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bridgeConfig, cliSpawnOptions, fixtureDir, spikeRoot } from "./_shared.mjs";

const TIMEOUT_MS = 240_000;
const MARKER = "Edited by BYOA agent.";

const VERSION_COMMAND = {
  codex: ["codex", ["--version"]],
  claude: ["claude", ["--version"]],
};

const requested = parseAgents(process.argv[2]);

const config = await bridgeConfig();
const fixture = await fixtureDir();
const readme = join(fixture, "README.md");

const health = await fetch(`${config.baseUrl}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`bridge에 접속할 수 없습니다 (${config.baseUrl}). 먼저 \`npm run bridge\`를 실행하세요.`);
  process.exit(1);
}
const readiness = (await health.json()).agents;

console.log(`Bridge    : ${config.baseUrl}`);
console.log(`Fixture   : ${fixture}`);

let overallFailed = 0;
for (const agentId of requested) {
  console.log(`\n=== ${agentId} ===`);
  overallFailed += await runAcceptance(agentId);
}

if (overallFailed > 0) {
  console.error(`\n${overallFailed}개 항목 실패.`);
  console.error("SPIKE_FINDINGS.md의 Findings를 먼저 확인하세요. 새로운 동작 변경이면 거기에 기록합니다.");
  process.exit(1);
}
console.log(`\n전 항목 통과 (${requested.join(", ")}).`);

// ---------------------------------------------------------------------------

function parseAgents(arg) {
  if (!arg || arg === "all") return ["codex", "claude"];
  if (arg === "codex" || arg === "claude") return [arg];
  console.error(`알 수 없는 agent: "${arg}" (codex|claude|all 중 하나)`);
  process.exit(1);
}

async function runAcceptance(agentId) {
  const [command, args] = VERSION_COMMAND[agentId];
  let version = "(unknown)";
  try {
    version = execFileSync(command, args, { encoding: "utf8", ...cliSpawnOptions }).trim();
  } catch {
    console.error(`  실패: ${command} CLI를 찾을 수 없습니다.`);
    return 1;
  }

  const ready = readiness.find((a) => a.agent === agentId);
  if (!ready?.installed || ready.authenticated === false) {
    console.error(`  실패: ${ready?.message ?? `${agentId}가 준비되지 않았습니다.`}`);
    return 1;
  }
  console.log(`  버전    : ${version}`);

  // 항상 같은 초기 상태에서 시작한다.
  execFileSync("node", [join(spikeRoot, "scripts", "create-fixture.mjs")], { stdio: "ignore" });
  if (readFileSync(readme, "utf8").includes(MARKER)) {
    console.error("  실패: fixture 초기화에 실패했습니다.");
    return 1;
  }

  const { WebSocket } = await import(join(spikeRoot, "node_modules", "ws", "index.js")).then((m) => ({
    WebSocket: m.default ?? m,
  }));

  const socket = new WebSocket(`${config.baseUrl.replace("http", "ws")}/events`);

  const seenMcp = new Set();
  const seenTypes = new Set();
  let changedFiles = [];
  let result = null;
  let failure = null;

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
        agent: agentId,
        projectPath: fixture,
        prompt: `README.md의 마지막에 "${MARKER}" 라는 줄을 추가해줘.`,
        appContext: { selectedItem: { id: "login-screen", label: "Login Screen" } },
      }),
    });
    if (!response.ok) {
      failure = `task 시작 실패: ${await response.text()}`;
      socket.close();
      return;
    }
    ourTaskId = (await response.json()).taskId;
    console.log(`  Task    : ${ourTaskId}`);
  });

  await finished;
  socket.close();

  const checks = [
    ["task가 오류 없이 완료됨", () => (failure ? failure : seenTypes.has("task.completed") || "task.completed 이벤트가 없습니다")],
    ["진행 이벤트가 스트리밍됨", () => seenTypes.has("task.started") || "task.started 이벤트가 없습니다"],
    ["get_app_context — agent 스트림 증거", () => seenMcp.has("get_app_context:agent-stream") || `${agentId}가 호출을 보고하지 않았습니다`],
    ["get_app_context — bridge 도달 증거", () => seenMcp.has("get_app_context:bridge-endpoint") || "MCP server가 bridge에 도달하지 못했습니다"],
    ["show_result — agent 스트림 증거", () => seenMcp.has("show_result:agent-stream") || `${agentId}가 호출을 보고하지 않았습니다`],
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
  return failed;
}
