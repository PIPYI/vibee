#!/usr/bin/env node
/**
 * 아키텍처·기술부채 검증 (docs/product_flow_decisions.md 질문 5).
 *
 *   npm run architecture              # codex, claude 순서로 모두
 *   npm run architecture codex        # 하나만
 *   npm run architecture codex 3      # 3회 반복
 *
 * fixture 하나에 세 검출 대상(파일 비대화·의미 중복·방치된 임시 조치)을 함께 심고,
 * 한 번의 구조 점검 turn이 셋을 각각 찾아내는지 잰다. 판정은 카테고리 문자열과 근거
 * 파일 경로를 문자열로 대조한다 — LLM 판정에 기대지 않는다.
 *
 * 같은 fixture를 design.json 없이도 한 번 더 돌린다 — "이미 코드가 있는 프로젝트를
 * 여는" 진입 경로는 인터뷰를 거치지 않아 설계 원본이 없는 쪽이 더 흔하다
 * (`docs/product_flow_decisions.md`). 이때도 oversized-module이 REQ/ENTITY 없이 코드
 * 판단만으로 나오고, 그 사실이 `limitations`에 남는지를 본다.
 *
 * 다른 검증 스크립트(drift.mjs, wiki.mjs)와 같은 이유로, WebSocket 이벤트는 이번 요청의
 * taskId로만 걸러 듣는다 — bridge가 재접속 대비로 지난 이벤트를 재생하기 때문이다.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { bridgeConfig, spikeRoot } from "./_shared.mjs";
import {
  architectureFixtureDir,
  architectureNoDesignFixtureDir,
  createArchitectureFixture,
  isSourceClean,
} from "./architecture-fixture.mjs";

const TURN_TIMEOUT_MS = 300_000;

/**
 * 검증 단계에서 쓰는 싼 조합. haiku는 effort를 받지 않는다 — `listModels()`가 신고한
 * `efforts`가 비어 있다.
 */
const CHEAP = {
  codex: { model: "gpt-5.6-luna", effort: "low" },
  claude: { model: "haiku" },
};

const ALLOWED_CATEGORIES = ["oversized-module", "duplicated-logic", "stale-temporary-workaround"];

const requested = parseAgents(process.argv[2]);
const runs = Number(process.argv[3] ?? 1);
const config = await bridgeConfig();

const health = await fetch(`${config.baseUrl}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`bridge에 접속할 수 없습니다 (${config.baseUrl}). 먼저 \`npm run bridge\`를 실행하세요.`);
  process.exit(1);
}
const readiness = (await health.json()).agents;

console.log(`Bridge    : ${config.baseUrl}`);
console.log(`Fixture   : ${architectureFixtureDir}`);
console.log(runs === 1 ? "반복      : 1회 — 동작 확인용이며 통계적 증거가 아니다" : `반복      : ${runs}회`);

let failed = 0;
for (const agentId of requested) {
  console.log(`\n=== ${agentId} ===`);
  const ready = readiness.find((a) => a.agent === agentId);
  if (!ready?.installed || ready.authenticated === false) {
    console.error(`  실패: ${ready?.message ?? `${agentId}가 준비되지 않았습니다.`}`);
    failed += 1;
    continue;
  }
  console.log(`  버전    : ${ready.version ?? "(unknown)"}`);
  console.log(`  모델    : ${CHEAP[agentId].model}${CHEAP[agentId].effort ? ` (${CHEAP[agentId].effort})` : ""}`);

  let passed = 0;
  for (let run = 1; run <= runs; run += 1) {
    passed += (await runOnce(agentId, runs > 1 ? `  [${run}/${runs}] ` : "  ")) ? 1 : 0;
  }
  console.log(`  통과 ${passed}/${runs}`);
  if (passed < runs) failed += 1;

  // "기존 코드베이스를 여는" 진입 경로 — design.json이 없을 때도 oversized-module이
  // 코드 판단만으로 나오는지. 통계적 반복이 아니라 한 번만 확인한다.
  console.log(`  -- design.json 없이 (기존 코드베이스 진입) --`);
  if (!(await runNoDesignOnce(agentId, "  "))) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed}개 agent에서 실패.`);
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

async function runOnce(agentId, prefix) {
  const dir = createArchitectureFixture();
  const observed = await analyze(agentId, dir);
  return report(observed, dir, prefix);
}

/**
 * design.json 없이 같은 fixture를 돌린다 (docs/product_flow_decisions.md 질문 5의 후속 —
 * "설계문서가 있으면 활용하고, 없으면 코드를 읽어본 판단을 허용한다"). oversized-module이
 * REQ/ENTITY 없이도 나오고, 그 사실이 `limitations`에 남는지를 본다.
 */
async function runNoDesignOnce(agentId, prefix) {
  const dir = createArchitectureFixture(architectureNoDesignFixtureDir, { withDesign: false });
  const observed = await analyze(agentId, dir);
  return reportNoDesign(observed, dir, prefix);
}

async function analyze(agentId, dir) {
  const { WebSocket } = await import(join(spikeRoot, "node_modules", "ws", "index.js")).then((m) => ({
    WebSocket: m.default ?? m,
  }));
  const socket = new WebSocket(`${config.baseUrl.replace("http", "ws")}/events`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  const observed = { report: null, contextReached: false, reportReached: false, error: null };
  let taskId = null;
  let settle = null;

  socket.on("message", (raw) => {
    const { event } = JSON.parse(raw.toString());
    if (!taskId || event.taskId !== taskId) return;

    if (event.type === "mcp.tool.called" && event.tool === "get_architecture_context" && event.source === "bridge-endpoint") {
      observed.contextReached = true;
    }
    if (event.type === "mcp.tool.called" && event.tool === "report_architecture" && event.source === "bridge-endpoint") {
      observed.reportReached = true;
    }
    if (event.type === "app.architecture") observed.report = event.report;
    if (event.type === "task.error") observed.error = event.message;
    if (["task.completed", "task.error", "task.interrupted"].includes(event.type)) {
      setTimeout(() => settle?.(), 600);
    }
  });

  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), TURN_TIMEOUT_MS);
    settle = () => {
      clearTimeout(timer);
      resolve("done");
    };
  });

  try {
    const response = await fetch(`${config.baseUrl}/api/architecture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: agentId, projectPath: dir, ...CHEAP[agentId] }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    taskId = body.taskId;
    if (!taskId) throw new Error("taskId 없이 응답했습니다");
    if ((await done) === "timeout") observed.error = observed.error ?? "turn이 시간 안에 끝나지 않았습니다";
  } catch (cause) {
    observed.error = String(cause);
  }

  socket.close();
  return observed;
}

function report(observed, dir, prefix) {
  const findings = observed.report?.findings ?? [];
  const byCategory = (category) => findings.filter((f) => f.category === category);
  const oversized = byCategory("oversized-module");
  const duplicated = byCategory("duplicated-logic");
  const stale = byCategory("stale-temporary-workaround");
  const architectureJson = join(dir, ".project-intel", "architecture.json");
  const architectureMd = join(dir, ".project-intel", "architecture.md");

  const checks = [
    ["turn이 오류 없이 끝났다", () => !observed.error || observed.error],
    ["get_architecture_context — bridge 도달 증거", () => observed.contextReached || "엔드포인트에 도달하지 않음"],
    ["report_architecture — bridge 도달 증거", () => observed.reportReached || "엔드포인트에 도달하지 않음"],
    ["report_architecture가 호출되었다", () => observed.report !== null || "리포트가 오지 않았습니다"],
    [
      "허용된 카테고리만 나왔다",
      () => findings.every((f) => ALLOWED_CATEGORIES.includes(f.category)) || `범위 밖 카테고리: ${findings.map((f) => f.category).join(", ")}`,
    ],
    [
      "파일 비대화(src/app.js)를 찾아냈다",
      () => oversized.some((f) => f.files.includes("src/app.js")) || `찾은 것: ${oversized.map((f) => f.files.join("+")).join(" / ") || "없음"}`,
    ],
    [
      "설계 단위를 근거로 들었다",
      () => oversized.some((f) => f.designIds.length > 0) || "oversized-module finding에 designIds가 비어 있습니다",
    ],
    [
      "의미 중복(member.js/borrower.js)을 찾아냈다",
      () =>
        duplicated.some((f) => f.files.includes("src/member.js") && f.files.includes("src/borrower.js")) ||
        `찾은 것: ${duplicated.map((f) => f.files.join("+")).join(" / ") || "없음"}`,
    ],
    [
      "방치된 임시 조치(src/store.js)를 찾아냈다",
      () => stale.some((f) => f.files.includes("src/store.js")) || `찾은 것: ${stale.map((f) => f.files.join("+")).join(" / ") || "없음"}`,
    ],
    ["finding마다 해소 프롬프트가 채워졌다", () => findings.every((f) => typeof f.resolutionPrompt === "string" && f.resolutionPrompt.length > 0) || "비어 있는 resolutionPrompt가 있습니다"],
    // 구조 점검은 읽기 전용이다. 우리 앱은 코드를 쓰는 곳이 아니라 보는 곳이다.
    ["구조 점검이 소스를 건드리지 않았다", () => isSourceClean(dir) || "워킹 트리에 소스 변경이 있습니다"],
    [".project-intel/architecture.json이 저장됐다", () => existsSync(architectureJson) || "파일이 없습니다"],
    [".project-intel/architecture.md가 저장됐다", () => existsSync(architectureMd) || "파일이 없습니다"],
  ];

  let ok = true;
  for (const [label, check] of checks) {
    const result = check();
    if (result === true) {
      console.log(`${prefix}[PASS] ${label}`);
    } else {
      console.log(`${prefix}[FAIL] ${label} — ${result}`);
      ok = false;
    }
  }
  if (observed.report) console.log(`${prefix}       리포트: ${observed.report.summary.replace(/\s+/g, " ").slice(0, 96)}…`);
  return ok;
}

function reportNoDesign(observed, dir, prefix) {
  const findings = observed.report?.findings ?? [];
  const oversized = findings.filter((f) => f.category === "oversized-module");
  const limitations = observed.report?.limitations ?? [];

  const checks = [
    ["turn이 오류 없이 끝났다", () => !observed.error || observed.error],
    ["report_architecture가 호출되었다", () => observed.report !== null || "리포트가 오지 않았습니다"],
    [
      "design.json 없이도 파일 비대화(src/app.js)를 찾아냈다",
      () =>
        oversized.some((f) => f.files.includes("src/app.js")) ||
        `찾은 것: ${oversized.map((f) => f.files.join("+")).join(" / ") || "없음"}`,
    ],
    [
      "설계 근거 없이 판단했다 (designIds가 비어 있다)",
      () => oversized.every((f) => f.designIds.length === 0) || "design.json이 없는데도 designIds가 채워졌습니다",
    ],
    [
      "설계 없음을 한계로 알렸다",
      () => limitations.some((l) => l.includes("design.json")) || `limitations: ${JSON.stringify(limitations)}`,
    ],
    ["구조 점검이 소스를 건드리지 않았다", () => isSourceClean(dir) || "워킹 트리에 소스 변경이 있습니다"],
  ];

  let ok = true;
  for (const [label, check] of checks) {
    const result = check();
    if (result === true) {
      console.log(`${prefix}[PASS] ${label}`);
    } else {
      console.log(`${prefix}[FAIL] ${label} — ${result}`);
      ok = false;
    }
  }
  return ok;
}
