#!/usr/bin/env node
/**
 * 인터뷰 → `save_design` 검증 (docs/requirements_flow.md §4.11, §8).
 *
 *   npm run interview          # codex, claude 순서로 모두
 *   npm run interview codex    # 하나만
 *
 * `npm run acceptance`가 "MCP 채널이 살아 있는가"를 보는 것과 달리, 이쪽은 **산출물의 형태**를
 * 본다. §8이 "아직 검증하지 않은 것"으로 지목한 두 가지가 핵심이다.
 *
 *   - FLOW의 **순서**가 시나리오 문장에서 실제로 도출되는가 (단계가 2개 이상인가)
 *   - ENTITY **관계**가 도출되는가 (사용자가 말해주지 않는 것이다)
 *
 * 사람의 답변은 아래 ANSWERS로 대신한다. 질문이 무엇이든 순서대로 하나씩 넣는다 —
 * §4.5가 가정한 "사용자가 질문을 무시하고 하고 싶은 말을 해도 흡수한다"에 가까운 상황이며,
 * SPIKE_FINDINGS.md §10에서 실제로 그렇게 동작하는 것을 확인했다.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { bridgeConfig, cliSpawnOptions, fixtureDir, spikeRoot } from "./_shared.mjs";

const TURN_TIMEOUT_MS = 240_000;
const MAX_TURNS = 8;

/** 시나리오 문장을 일부러 섞어 넣는다 — FLOW 순서와 ENTITY 관계가 여기서 나와야 한다. */
const ANSWERS = [
  "동네 사람들끼리 안 쓰는 물건을 서로 빌려주는 앱을 만들고 싶어요.",
  "우리 동네 주민이면 누구나 쓸 수 있으면 좋겠어요. 빌려주는 사람도 있고 빌리는 사람도 있고요.",
  "빌려줄 물건을 사진이랑 같이 올려두면, 빌리고 싶은 사람이 그걸 보고 신청을 해요. " +
    "주인이 수락하면 둘이 채팅으로 만날 시간을 정하고, 물건을 건네주면 대여가 시작돼요. " +
    "반납하면 서로 후기를 남기고요.",
  "돈 주고받는 건 앱 안에서 안 했으면 좋겠어요. 그냥 만나서 현금으로 하면 될 것 같아요.",
  "됐어요, 이 정도면 충분해요. 초안 보여주세요.",
];

const requested = parseAgents(process.argv[2]);
const config = await bridgeConfig();
const fixture = await fixtureDir();

const health = await fetch(`${config.baseUrl}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`bridge에 접속할 수 없습니다 (${config.baseUrl}). 먼저 \`npm run bridge\`를 실행하세요.`);
  process.exit(1);
}
const readiness = (await health.json()).agents;

console.log(`Bridge    : ${config.baseUrl}`);
console.log(`Fixture   : ${fixture}`);

let failed = 0;
for (const agentId of requested) {
  console.log(`\n=== ${agentId} ===`);
  failed += await runInterview(agentId);
}

if (failed > 0) {
  console.error(`\n${failed}개 항목 실패.`);
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

async function runInterview(agentId) {
  const ready = readiness.find((a) => a.agent === agentId);
  if (!ready?.installed || ready.authenticated === false) {
    console.error(`  실패: ${ready?.message ?? `${agentId}가 준비되지 않았습니다.`}`);
    return 1;
  }
  console.log(`  버전    : ${ready.version ?? "(unknown)"}`);

  execFileSync("node", [join(spikeRoot, "scripts", "create-fixture.mjs")], { stdio: "ignore" });

  const { WebSocket } = await import(join(spikeRoot, "node_modules", "ws", "index.js")).then((m) => ({
    WebSocket: m.default ?? m,
  }));
  const socket = new WebSocket(`${config.baseUrl.replace("http", "ws")}/events`);
  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  const questions = [];
  let design = null;
  let sessionId = null;
  let sessionChanges = 0;
  let error = null;

  // turn 하나가 끝날 때까지 기다린다. 우리 task의 이벤트만 본다(acceptance와 같은 이유).
  let currentTaskId = null;
  let settle = null;
  socket.on("message", (raw) => {
    const { event } = JSON.parse(raw.toString());
    if (!currentTaskId || event.taskId !== currentTaskId) return;

    if (event.type === "app.question") questions.push(event.question);
    if (event.type === "app.design") design = event.design;
    if (event.type === "agent.session") {
      if (sessionId && sessionId !== event.sessionId) sessionChanges += 1;
      sessionId = event.sessionId;
    }
    if (event.type === "task.error") error = event.message;
    if (["task.completed", "task.error", "task.interrupted"].includes(event.type)) {
      setTimeout(() => settle?.(), 600);
    }
  });

  const awaitTurn = async (start) => {
    const done = new Promise((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), TURN_TIMEOUT_MS);
      settle = () => {
        clearTimeout(timer);
        resolve("done");
      };
    });
    const response = await start();
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    currentTaskId = body.taskId;
    return done;
  };

  try {
    await awaitTurn(() =>
      fetch(`${config.baseUrl}/api/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: agentId, projectPath: fixture, prompt: "(interview)", mode: "interview" }),
      }),
    );

    for (let turn = 0; turn < MAX_TURNS && !design && !error; turn += 1) {
      const answer = ANSWERS[Math.min(turn, ANSWERS.length - 1)];
      if (questions.length === 0) break; // 질문 없이 끝났다면 더 답할 것이 없다
      process.stdout.write(`  turn ${turn + 1}: ${questions[questions.length - 1].question.slice(0, 46)}…\n`);
      await awaitTurn(() =>
        fetch(`${config.baseUrl}/api/interview/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent: agentId, projectPath: fixture, message: answer }),
        }),
      );
    }
  } catch (cause) {
    error = String(cause);
  }

  socket.close();
  return report(design, questions, sessionChanges, error);
}

function report(design, questions, sessionChanges, error) {
  const checks = [
    ["turn 진행 중 오류가 없었다", () => !error || error],
    ["질문이 2개 이상 왔다", () => questions.length >= 2 || `질문 ${questions.length}개`],
    ["같은 세션이 유지되었다", () => sessionChanges === 0 || `세션이 ${sessionChanges}번 바뀌었다`],
    ["save_design이 호출되었다", () => design !== null || "초안이 오지 않았습니다"],
    ["ACTOR가 있다", () => (design?.actors?.length ?? 0) > 0 || "비어 있음"],
    ["REQ가 있다", () => (design?.reqs?.length ?? 0) > 0 || "비어 있음"],
    ["SURFACE가 REQ를 가리킨다", () => design?.surfaces?.some((s) => s.shows?.length > 0) || "shows가 모두 비었음"],
    ["ENTITY 관계가 도출되었다", () => design?.entities?.some((e) => e.relations?.length > 0) || "relations가 모두 비었음"],
    ["ENTITY 상태가 도출되었다", () => design?.entities?.some((e) => e.states?.length > 0) || "states가 모두 비었음"],
    [
      "FLOW에 순서가 있다 (2단계 이상)",
      () => design?.flows?.some((f) => (f.steps?.length ?? 0) >= 2) || "단계가 2개 이상인 흐름이 없음",
    ],
    ["FLOW 단계가 ACTOR/ENTITY를 가리킨다", () => flowStepsAreWired(design) || "steps가 id를 참조하지 않음"],
    ["RULE이 있다", () => (design?.rules?.length ?? 0) > 0 || "비어 있음"],
    ["DEC이 있다", () => (design?.decisions?.length ?? 0) > 0 || "비어 있음"],
    ["DEC에 why가 채워졌다", () => design?.decisions?.every((d) => d.why?.trim()) || "why가 빈 DEC이 있음"],
    ["AI가 채운 항목이 표시되었다", () => hasAiSource(design) || 'source: "ai"인 항목이 없음'],
  ];

  let failures = 0;
  for (const [label, check] of checks) {
    const outcome = check();
    if (outcome === true) {
      console.log(`  [PASS] ${label}`);
    } else {
      failures += 1;
      console.log(`  [FAIL] ${label} — ${outcome === false ? "실패" : outcome}`);
    }
  }

  if (design) {
    console.log(
      `  단위    : ACTOR ${design.actors.length} · REQ ${design.reqs.length} · ` +
        `SURFACE ${design.surfaces.length} · ENTITY ${design.entities.length} · ` +
        `FLOW ${design.flows.length} · RULE ${design.rules.length} · DEC ${design.decisions.length}`,
    );
  }
  return failures;
}

function flowStepsAreWired(design) {
  const steps = (design?.flows ?? []).flatMap((flow) => flow.steps ?? []);
  return steps.some((step) => step.actor || step.entity || step.surface);
}

function hasAiSource(design) {
  if (!design) return false;
  return [...design.reqs, ...design.surfaces, ...design.entities, ...design.flows, ...design.rules, ...design.decisions]
    .some((item) => item.source === "ai");
}
