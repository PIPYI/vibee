#!/usr/bin/env node
/**
 * 드리프트 검출 검증 (docs/vibe_coding_assistant_design.md §3.3, §7.2).
 *
 *   npm run drift              # codex, claude 순서로 모두
 *   npm run drift codex        # 하나만
 *   npm run drift codex 3      # 3회 반복
 *
 * 재는 것은 두 가지이고, **어려운 쪽은 두 번째다.**
 *
 *   1. 검출  — 기준을 어긴 커밋에서 *어느* 기준이 깨졌는지 짚어내는가
 *   2. 오탐  — 아무것도 어기지 않은 커밋에서 조용히 있는가
 *
 * 2번을 같이 재지 않으면 1번은 증거가 되지 못한다. "이 변경이 규칙을 어겼나?"라고 물으면
 * 모델은 웬만하면 무언가를 찾아내기 때문이다. 그래서 무해 커밋에는 **일반 코드 리뷰거리**
 * (중복 로직, 잘라내는 상수)를 일부러 심어 둔다 — 범용 리뷰를 하고 있다면 거기서 걸린다.
 *
 * 두 커밋을 **한 리뷰에 같이** 넣는다. 그래야 "무언가를 찾아냈다"가 아니라 **둘을 구분했다**를
 * 잴 수 있다. 리뷰 단위가 커밋이므로 finding은 커밋 sha를 달고 돌아와야 한다.
 *
 * 판정은 LLM에게 맡기지 않는다. 돌아온 `criterionId`와 `commit`을 문자열로 대조한다.
 *
 * **세 번째로 재는 것 — 해소.** 검출은 절반이다. DEC-1 finding이 들고 온 `resolutionPrompt`를
 * 실제 `task` mode turn에 먹여서, 옆에 띄운 사용자의 agent를 흉내낸다. 어느 쪽으로
 * 판단하는지는 강제하지 않는다 — 코드를 고치는지 `.project-intel/design.json`의 DEC-1만
 * 고치는지는 agent 몫이다. 우리가 재는 것은 **둘 중 정확히 하나만, 그 범위만** 바뀌었는가다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bridgeConfig, spikeRoot } from "./_shared.mjs";
import {
  DESIGN,
  commitBenign,
  commitViolation,
  createDriftFixture,
  driftFixtureDir,
  git,
  isCodeClean,
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

/** 결제를 끼워 넣은 커밋이 어겨야 하는 기준. */
const EXPECTED = "DEC-1";
const CRITERIA_COUNT = DESIGN.decisions.length + DESIGN.rules.length;

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
console.log(`기준      : ${CRITERIA_COUNT}개 (기대 위반: ${EXPECTED}, 커밋 2개 중 1개에서만)`);
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
 * 인계 직후 상태에서 커밋 두 개를 쌓고 한 번에 리뷰한다.
 *
 * `since`를 주지 않는다 — bridge가 `design.json`이 들어온 커밋을 찾아 그 다음부터 보는지도
 * 함께 확인하기 위해서다. 설계보다 앞선 커밋은 판정 대상이 아니다.
 */
async function runOnce(agentId, prefix) {
  const dir = createDriftFixture();
  const violationSha = commitViolation(dir);
  const benignSha = commitBenign(dir);

  const observed = await review(agentId, dir);
  const detectionOk = report(observed, { dir, violationSha, benignSha }, prefix);
  const resolutionOk = await reportResolution(agentId, observed, { dir, violationSha, benignSha }, prefix);
  return detectionOk && resolutionOk;
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

  const observed = { report: null, contextReached: false, error: null, start: null, commits: [], criteriaCount: 0 };
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
      body: JSON.stringify({ agent: agentId, projectPath: dir, ...CHEAP[agentId] }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    taskId = body.taskId;
    observed.start = body.start;
    observed.commits = body.commits;
    observed.criteriaCount = body.criteriaCount;
    if (!taskId) throw new Error("리뷰할 커밋이 없다고 응답했습니다");
    if ((await done) === "timeout") observed.error = observed.error ?? "turn이 시간 안에 끝나지 않았습니다";
  } catch (cause) {
    observed.error = String(cause);
  }

  socket.close();
  return observed;
}

function report(observed, { dir, violationSha, benignSha }, prefix) {
  const found = observed.report?.findings ?? [];
  const onViolation = found.filter((f) => f.commit === violationSha);
  const onBenign = found.filter((f) => f.commit === benignSha);
  const log = readReviewLog(dir);

  const checks = [
    ["turn이 오류 없이 끝났다", () => !observed.error || observed.error],
    ["get_review_context — bridge 도달 증거", () => observed.contextReached || "엔드포인트에 도달하지 않음"],
    // 설계보다 앞선 커밋은 판정 대상이 아니다. 인계 커밋 다음부터 봐야 한다.
    ["설계가 들어온 커밋부터 봤다", () => observed.start === "design" || `시작점: ${observed.start}`],
    ["커밋 2개를 한 리뷰에 넣었다", () => observed.commits.length === 2 || `커밋 ${observed.commits.length}개`],
    ["기준이 실려 나갔다", () => observed.criteriaCount === CRITERIA_COUNT || `기준 ${observed.criteriaCount}개`],
    ["report_drift가 호출되었다", () => observed.report !== null || "리포트가 오지 않았습니다"],
    // 리뷰는 읽기 전용이다. 우리 앱은 코드를 쓰는 곳이 아니라 보는 곳이다.
    ["리뷰가 코드를 건드리지 않았다", () => isCodeClean(dir) || "워킹 트리에 코드 변경이 있습니다"],

    ["위반 커밋에서 찾아냈다", () => onViolation.length > 0 || "위반 커밋에 finding이 없습니다"],
    [
      `올바른 기준을 짚었다 (${EXPECTED})`,
      () => onViolation.some((f) => f.criterionId === EXPECTED) || `짚은 것: ${onViolation.map((f) => f.criterionId).join(", ") || "없음"}`,
    ],
    [
      "어디서 깨졌는지 지목했다",
      () =>
        onViolation.some((f) => f.files?.some((path) => path.includes("payment") || path.includes("rental"))) ||
        "파일을 지목하지 않았습니다",
    ],
    // 여기가 진짜 시험이다. 일반 리뷰거리를 심어 뒀으므로 범용 리뷰를 하고 있다면 걸린다.
    [
      "무해한 커밋은 건드리지 않았다",
      () => onBenign.length === 0 || `오탐 ${onBenign.length}건: ${onBenign.map((f) => f.criterionId).join(", ")}`,
    ],
    [
      "리뷰 지점이 기록됐다",
      () => log?.lastReviewedSha === benignSha || `기록: ${log?.lastReviewedSha?.slice(0, 7) ?? "없음"}`,
    ],
  ];

  console.log(`${prefix}커밋 ${observed.commits.map((c) => c.sha.slice(0, 7)).join(", ")}`);
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

/**
 * 해소 프롬프트를 실제 `task` mode turn에 먹인다.
 *
 * 이 turn은 우리 앱이 돌리는 것이 아니라 **사용자가 옆에 띄운 agent를 흉내내는 것**이다 —
 * 그래서 `mode: "task"`(전체 쓰기 권한)를 쓴다. `task`가 검증 장치라는 것은
 * `docs/BYOA_MCP_INTEGRATION_SPIKE.md` §1.2에 못박혀 있다.
 */
async function resolveDrift(agentId, dir, prompt) {
  const { WebSocket } = await import(join(spikeRoot, "node_modules", "ws", "index.js")).then((m) => ({
    WebSocket: m.default ?? m,
  }));
  const socket = new WebSocket(`${config.baseUrl.replace("http", "ws")}/events`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  const observed = { error: null };
  let taskId = null;
  let settle = null;

  socket.on("message", (raw) => {
    const { event } = JSON.parse(raw.toString());
    if (!taskId || event.taskId !== taskId) return;
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
    const response = await fetch(`${config.baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: agentId, projectPath: dir, prompt, ...CHEAP[agentId] }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    taskId = body.taskId;
    if ((await done) === "timeout") observed.error = observed.error ?? "turn이 시간 안에 끝나지 않았습니다";
  } catch (cause) {
    observed.error = String(cause);
  }

  socket.close();
  return observed;
}

/** commit `sha` 이후로 바뀐 파일 전체 — 커밋된 것과 워킹 트리에 남은 것을 합친다. */
function changedSince(dir, sha) {
  const committed = git(dir, ["diff", "--name-only", `${sha}..HEAD`])
    .split("\n")
    .filter(Boolean);
  // trim으로 먼저 앞 공백을 지우면 " M path" 같은 줄이 "M path"가 되어 slice(3)이 한 글자를
  // 더 잘라낸다 (경로가 "rc/…"로 잘리는 버그). porcelain 줄은 XY+공백 3칸이 고정이므로
  // 줄 자체는 다듬지 않고 끝의 빈 줄만 거른다.
  const uncommitted = git(dir, ["status", "--porcelain"])
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3));
  return new Set([...committed, ...uncommitted]);
}

/** design.json의 항목 하나짜리 배열(decisions/rules) 중 id별로 무엇이 바뀌었는지. 개수가 달라지면 구조가 흔들린 것이다. */
function diffById(before, after) {
  if (!Array.isArray(after) || before.length !== after.length) return null;
  const changed = [];
  for (const b of before) {
    const a = after.find((x) => x.id === b.id);
    if (!a) return null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(b.id);
  }
  return changed;
}

/** decisions/rules 말고 design.json의 나머지 구조가 그대로인가. */
function designStructureUnchanged(before, after) {
  return (
    !!after &&
    before.title === after.title &&
    before.summary === after.summary &&
    JSON.stringify(before.actors) === JSON.stringify(after.actors) &&
    JSON.stringify(before.reqs) === JSON.stringify(after.reqs) &&
    JSON.stringify(before.surfaces) === JSON.stringify(after.surfaces) &&
    JSON.stringify(before.entities) === JSON.stringify(after.entities) &&
    JSON.stringify(before.flows) === JSON.stringify(after.flows)
  );
}

function readDesign(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, ".project-intel", "design.json"), "utf8"));
  } catch {
    return null;
  }
}

/** DEC-1을 어긴 결제 호출이 여전히 코드에 있는가. */
function violationStillInCode(dir) {
  try {
    return readFileSync(join(dir, "src", "rental.js"), "utf8").includes("chargeRentalFee");
  } catch {
    return false;
  }
}

/**
 * 해소 프롬프트가 실제로 그렇게 동작하는지 확인한다.
 *
 * 어느 쪽(코드 수정 / 결정 갱신)을 골랐는지는 강제하지 않는다 — 그것은 agent의 판단이다.
 * 대신 **정확히 한쪽만, 그 범위만** 바뀌었는지를 기계적으로 검사한다. LLM 판정에 기대지 않는다.
 */
async function reportResolution(agentId, observed, { dir, violationSha, benignSha }, prefix) {
  const onViolation = (observed.report?.findings ?? []).filter((f) => f.commit === violationSha);
  const decFinding = onViolation.find((f) => f.criterionId === EXPECTED);

  if (!decFinding?.resolutionPrompt) {
    console.log(`${prefix}[FAIL] 해소 — DEC-1 finding에 resolutionPrompt가 없어 시험할 수 없습니다`);
    return false;
  }

  // 리뷰가 reviews.json에 남긴 변경까지 baseline에 넣는다. 그래야 해소 turn이 만든 변경만
  // 걸러낼 수 있다 — 안 그러면 우리 자신의 기록 파일이 "바뀐 파일"로 잘못 잡힌다.
  const before = changedSince(dir, benignSha);
  const resolved = await resolveDrift(agentId, dir, decFinding.resolutionPrompt);
  const after = changedSince(dir, benignSha);
  const files = [...after].filter((f) => !before.has(f));

  const design = readDesign(dir);
  const touchedDesign = files.includes(".project-intel/design.json");
  const touchedCode = files.some((f) => f.startsWith("src/"));
  const decisionsDiff = design ? diffById(DESIGN.decisions, design.decisions) : null;
  const rulesDiff = design ? diffById(DESIGN.rules, design.rules) : null;

  const checks = [
    [
      "해소 프롬프트에 필요한 것이 다 있다",
      () =>
        (decFinding.resolutionPrompt.includes("DEC-1") &&
          decFinding.resolutionPrompt.includes(".project-intel/design.json")) ||
        "id 또는 파일 경로가 빠졌습니다",
    ],
    ["해소 turn이 오류 없이 끝났다", () => !resolved.error || resolved.error],
    ["방치되지 않았다 — 뭔가 바뀌었다", () => files.length > 0 || "워킹 트리가 그대로입니다"],
    [
      "코드와 결정 중 한쪽만 고쳤다",
      () =>
        touchedDesign !== touchedCode ||
        `design.json: ${touchedDesign}, 코드: ${touchedCode} (바뀐 파일: ${files.join(", ") || "없음"})`,
    ],
  ];

  if (touchedDesign) {
    checks.push(
      ["design.json 구조는 그대로다", () => designStructureUnchanged(DESIGN, design) || "actors/reqs/surfaces/entities/flows 일부가 바뀌었습니다"],
      ["RULE은 건드리지 않았다", () => rulesDiff?.length === 0 || `RULE 변경: ${JSON.stringify(rulesDiff)}`],
      [
        "DEC-1만 고쳤다",
        () => JSON.stringify(decisionsDiff) === JSON.stringify(["DEC-1"]) || `바뀐 DEC: ${JSON.stringify(decisionsDiff)}`,
      ],
      [
        "design.json 말고는 안 건드렸다",
        () => files.length === 1 || `함께 바뀐 파일: ${files.filter((f) => f !== ".project-intel/design.json").join(", ")}`,
      ],
    );
  } else if (touchedCode) {
    checks.push(
      ["결제 호출을 걷어냈다", () => !violationStillInCode(dir) || "rental.js가 여전히 chargeRentalFee를 부릅니다"],
      ["design.json은 그대로다", () => !touchedDesign || "design.json이 함께 바뀌었습니다"],
    );
  }

  console.log(`${prefix}해소  : ${files.join(", ") || "(변경 없음)"}`);
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

function readReviewLog(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, ".project-intel", "reviews.json"), "utf8"));
  } catch {
    return null;
  }
}
