#!/usr/bin/env node
/**
 * M3 회귀 게이트 — acceptance 2·3 (implementation_plan §7.1).
 *
 *   npm run acceptance          # 설치된 agent 전부
 *   npm run acceptance codex
 *   npm run acceptance claude
 *
 * ## 무엇을 신뢰하는가
 *
 * **agent 의 자기 보고를 신뢰의 근거로 삼지 않는다.** MCP 호출에 대해 서로 독립적인 두
 * 증거원을 모두 요구한다 (B4):
 *
 * - `agent-stream`   — agent 가 스스로 보고한 tool 호출
 * - `bridge-endpoint`— agent 가 spawn 한 **별도 프로세스**가 loopback 으로 우리에게 도달한 사실
 *
 * spike 에서 실제로 `agent-stream` 만 잡히고 tool 이 돌지 않은 적이 있다(Finding 4).
 * 두 개를 분리해 두지 않았다면 "MCP 는 호출됐다"고 잘못 판단했을 것이다.
 */
import { execFileSync } from "node:child_process";

import { FIXTURE_DIR, fetchJson, requireBridge, waitForTask } from "./_shared.mjs";

const TIMEOUT_MS = 240_000;
const REQUIRED_TOOLS = ["get_project_semantic_memory", "get_evidence"];

const requested = process.argv[2];
const config = await requireBridge();

// fixture 를 매번 새로 만든다 — 이전 실행의 상태가 결과에 섞이지 않게 한다.
execFileSync(process.execPath, [new URL("./create-fixture.mjs", import.meta.url).pathname], {
  stdio: "pipe",
});

const health = await fetchJson(`${config.baseUrl}/api/health`);
const available = health.body.agents.filter((agent) => agent.installed).map((agent) => agent.agent);
const missing = health.body.agents.filter((agent) => !agent.installed);

for (const agent of missing) {
  console.log(`[SKIP] ${agent.agent} — ${agent.message ?? "설치되지 않음"}`);
}

const targets = requested ? [requested] : available;
if (targets.length === 0) {
  console.error("");
  console.error("실행할 수 있는 agent 가 없습니다. codex 또는 claude 를 설치하고 로그인하세요.");
  console.error("  npm i -g @openai/codex && codex login");
  console.error("  npm i -g @anthropic-ai/claude-code && claude");
  process.exit(1);
}

let failed = false;

for (const agent of targets) {
  console.log("");
  console.log(`=== ${agent} ===`);
  const results = [];
  const check = (label, ok, detail = "") => {
    results.push({ label, ok, detail });
    if (!ok) failed = true;
  };

  const selected = await fetchJson(`${config.baseUrl}/api/project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: FIXTURE_DIR }),
  });
  check("프로젝트를 선택했다", selected.ok, JSON.stringify(selected.body));

  // **인덱싱을 먼저 한다.** 그러지 않으면 agent 가 받는 것은 evidence 가 아니라
  // `memory_unavailable` 이고, "tool 이 불렸다"만 증명될 뿐 데이터가 흐르는지는 모른다.
  const indexed = await fetchJson(`${config.baseUrl}/api/index`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: FIXTURE_DIR }),
  });
  check(
    "fixture 를 인덱싱했다",
    indexed.ok && indexed.body.analysisVersion > 0,
    JSON.stringify(indexed.body),
  );

  const started = await fetchJson(`${config.baseUrl}/api/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, projectPath: FIXTURE_DIR }),
  });
  if (!started.ok) {
    check("verify turn 을 시작했다", false, JSON.stringify(started.body));
    report(agent, results);
    continue;
  }
  const taskId = started.body.taskId;
  check("verify turn 을 시작했다", true);

  const outcome = await waitForTask(config.baseUrl, taskId, TIMEOUT_MS);
  check("task 가 오류 없이 끝났다", outcome.status === "completed", outcome.detail);

  const evidence = await fetchJson(`${config.baseUrl}/api/tasks/${taskId}/mcp-evidence`);
  const calls = evidence.body.calls ?? [];
  const both = new Set(evidence.body.toolsWithBothSources ?? []);

  for (const tool of REQUIRED_TOOLS) {
    const sources = new Set(calls.filter((call) => call.tool === tool).map((call) => call.source));
    // 두 증거원을 **따로** 검사한다. 한쪽만 있으면 그것이 곧 진단이다.
    check(`${tool} — agent 스트림 증거`, sources.has("agent-stream"));
    check(`${tool} — bridge 도달 증거`, sources.has("bridge-endpoint"));
    check(`${tool} — 두 증거원이 모두 있다`, both.has(tool));
  }

  // **불렸다 ≠ 데이터를 받았다.** 채널만 보면 memory_unavailable 을 받은 turn 도 통과한다.
  //
  // 기록은 **이 task 의 것만** 본다. 전역 목록으로 판정했다가 다른 실행의 호출까지 세어
  // 2회차에서 `data=5/2` 로 실패한 적이 있다.
  for (const tool of REQUIRED_TOOLS) {
    const arrivals = calls.filter(
      (call) => call.tool === tool && call.source === "bridge-endpoint",
    );
    // **긍정 확인을 요구한다.** "unavailable 이 없다"로 판정하면 필드 자체가 없을 때도
    // 통과한다 — 증거의 부재를 증거로 쓰는 것이다. 실제로 그렇게 거짓 통과한 적이 있다.
    const gotData = arrivals.some((call) => call.outcome === "data");
    check(
      `${tool} — 실제 데이터를 돌려줬다`,
      gotData,
      JSON.stringify(arrivals.map((call) => call.outcome ?? "(기록없음)")),
    );
  }

  report(agent, results);
}

console.log("");
if (failed) {
  console.error("일부 항목이 실패했습니다.");
  console.error("진단: npm run mcp:status  /  bridge 창의 로그  /  ~/.codex/sessions 의 rollout");
  process.exit(1);
}
console.log("전 항목 통과.");

// ---------------------------------------------------------------------------

function report(agent, results) {
  for (const { label, ok, detail } of results) {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  }
  const passed = results.filter((item) => item.ok).length;
  console.log(`  ${passed}/${results.length} (${agent})`);
}
