#!/usr/bin/env node
/**
 * 드리프트 검출 검증 (docs/vibe_coding_assistant_design.md §3.3, §7.2).
 *
 *   npm run drift              # codex, claude 순서로 모두
 *   npm run drift codex        # 하나만
 *   npm run drift codex 3      # 케이스당 3회 반복
 *
 * 재는 것은 두 가지이고, **어려운 쪽은 두 번째다.**
 *
 *   1. 검출  — 기준을 어긴 diff에서 *어느* 기준이 깨졌는지 짚어내는가
 *   2. 오탐  — 아무것도 어기지 않은 diff에서 조용히 있는가
 *
 * 2번을 같이 재지 않으면 1번은 증거가 되지 못한다. "이 변경이 규칙을 어겼나?"라고 물으면
 * 모델은 웬만하면 무언가를 찾아내기 때문이다. 그래서 무해 케이스에는 **일반 코드 리뷰거리**
 * (중복 로직, 매직 넘버)를 일부러 심어 둔다 — 범용 리뷰를 하고 있다면 거기서 걸린다.
 *
 * 판정은 LLM에게 맡기지 않는다. `report_drift`가 넘긴 `criterionId`를 문자열로 대조한다.
 */
import { join } from "node:path";

import { bridgeConfig, spikeRoot } from "./_shared.mjs";
import {
  DESIGN,
  commitBenign,
  commitViolation,
  createDriftFixture,
  driftFixtureDir,
  isClean,
} from "./drift-fixture.mjs";

const TURN_TIMEOUT_MS = 300_000;

/**
 * 검증 단계에서 쓰는 싼 조합. **haiku는 effort를 받지 않는다** — `listModels()`가 신고한
 * `efforts`가 비어 있다. 값을 넣으면 SDK가 거부한다.
 *
 * 약한 모델은 지시를 덜 따르므로 증거가 비대칭이다. 통과하면 강한 증거이고, 실패하면
 * 모델 탓인지 설계 탓인지 이 결과만으로는 가릴 수 없다.
 */
const CHEAP = {
  codex: { model: "gpt-5.6-luna", effort: "low" },
  claude: { model: "haiku" },
};

/** DEC-1을 어긴 커밋에서 리뷰어가 짚어야 하는 기준. */
const EXPECTED = "DEC-1";

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
console.log(`Fixture   : ${driftFixtureDir}`);
console.log(`기준      : ${DESIGN.decisions.length + DESIGN.rules.length}개 (기대 위반: ${EXPECTED})`);
if (runs === 1) console.log("반복      : 1회 — 동작 확인용이며 통계적 증거가 아니다");
else console.log(`반복      : 케이스당 ${runs}회`);

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

  const tally = { violation: 0, benign: 0 };
  for (let run = 1; run <= runs; run += 1) {
    const prefix = runs > 1 ? `  [${run}/${runs}] ` : "  ";
    tally.violation += (await runCase(agentId, "violation", prefix)) ? 1 : 0;
    tally.benign += (await runCase(agentId, "benign", prefix)) ? 1 : 0;
  }

  console.log(`  검출 ${tally.violation}/${runs} · 오탐 없음 ${tally.benign}/${runs}`);
  if (tally.violation < runs || tally.benign < runs) failed += 1;
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

/**
 * 케이스 하나. **매번 fixture를 새로 만든다** — 무해 케이스가 위반 커밋 위에 쌓이면
 * 저장소에 결제 코드가 남아 있어서, 리뷰어가 diff 밖의 것을 보고 짚었을 때
 * 오탐인지 정당한 지적인지 가릴 수 없다.
 */
async function runCase(agentId, kind, prefix) {
  const dir = createDriftFixture();
  if (kind === "violation") commitViolation(dir);
  else commitBenign(dir);

  const observed = await review(agentId, dir);
  return report(kind, observed, prefix);
}

async function review(agentId, dir) {
  const { WebSocket } = await import(join(spikeRoot, "node_modules", "ws", "index.js")).then((m) => ({
    WebSocket: m.default ?? m,
  }));
  const socket = new WebSocket(`${config.baseUrl.replace("http", "ws")}/events`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  const observed = { report: null, contextReached: false, error: null, criteriaCount: 0, changedFiles: [] };
  let taskId = null;
  let settle = null;

  socket.on("message", (raw) => {
    const { event } = JSON.parse(raw.toString());
    if (!taskId || event.taskId !== taskId) return;

    // bridge 엔드포인트에 실제로 도달했는지 — agent 스트림의 주장과 독립된 증거다.
    if (event.type === "mcp.tool.called" && event.tool === "get_review_context" && event.source === "bridge-endpoint") {
      observed.contextReached = true;
    }
    if (event.type === "app.drift") observed.report = event.report;
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
    const response = await fetch(`${config.baseUrl}/api/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: agentId, projectPath: dir, base: "HEAD~1", ...CHEAP[agentId] }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    taskId = body.taskId;
    observed.criteriaCount = body.criteriaCount;
    observed.changedFiles = body.changedFiles;
    if ((await done) === "timeout") observed.error = observed.error ?? "turn이 시간 안에 끝나지 않았습니다";
  } catch (cause) {
    observed.error = String(cause);
  }

  socket.close();
  observed.clean = isClean(dir);
  return observed;
}

function report(kind, observed, prefix) {
  const found = observed.report?.findings ?? [];
  const ids = found.map((f) => f.criterionId);

  const common = [
    ["turn이 오류 없이 끝났다", () => !observed.error || observed.error],
    ["get_review_context — bridge 도달 증거", () => observed.contextReached || "엔드포인트에 도달하지 않음"],
    ["기준이 실려 나갔다", () => observed.criteriaCount === 8 || `기준 ${observed.criteriaCount}개`],
    ["report_drift가 호출되었다", () => observed.report !== null || "리포트가 오지 않았습니다"],
    // 리뷰는 읽기 전용이다. 우리 앱은 코드를 쓰는 곳이 아니라 보는 곳이다.
    ["리뷰가 코드를 건드리지 않았다", () => observed.clean || "워킹 트리가 더럽습니다"],
  ];

  const specific =
    kind === "violation"
      ? [
          ["위반을 찾아냈다", () => found.length > 0 || "findings가 비어 있습니다"],
          [`올바른 기준을 짚었다 (${EXPECTED})`, () => ids.includes(EXPECTED) || `짚은 것: ${ids.join(", ") || "없음"}`],
          [
            "어디서 깨졌는지 지목했다",
            () =>
              found.some((f) => f.files?.some((path) => path.includes("payment") || path.includes("rental"))) ||
              "파일을 지목하지 않았습니다",
          ],
        ]
      : [
          // 여기가 진짜 시험이다. 일반 리뷰거리를 심어 뒀으므로, 범용 리뷰를 하고 있다면 걸린다.
          ["어긋난 것이 없다고 보고했다", () => found.length === 0 || `오탐 ${found.length}건: ${ids.join(", ")}`],
        ];

  console.log(`${prefix}--- ${kind === "violation" ? "위반 있는 변경" : "무해한 변경"} (${observed.changedFiles.length}개 파일)`);
  let ok = true;
  for (const [label, check] of [...common, ...specific]) {
    const result = check();
    if (result === true) {
      console.log(`${prefix}[PASS] ${label}`);
    } else {
      console.log(`${prefix}[FAIL] ${label} — ${result}`);
      ok = false;
    }
  }
  if (observed.report) console.log(`${prefix}       리포트: ${observed.report.summary.replace(/\s+/g, " ").slice(0, 100)}…`);
  return ok;
}
