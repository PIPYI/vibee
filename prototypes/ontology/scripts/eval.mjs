#!/usr/bin/env node
/**
 * M5 회귀 게이트 — acceptance 4 · 5 · 18 · 18b (implementation_plan.md §7.1 · §7.2).
 *
 *   npm run eval          # 설치된 agent 전부
 *   npm run eval codex
 *   npm run eval claude
 *
 * acceptance.mjs(M3)는 채널만 본다 — tool이 불렸고 데이터가 흘렀는가. 여기서는 그 다음을
 * 본다: **submit_semantic_patch가 실제로 하나의 generation을 커밋했는가**(4),
 * **그렇게 커밋된 Semantic Memory가 이 fixture에서 사람이 미리 정한 구조적 기대를
 * 만족하는가**(5), 그리고 **코드가 바뀐 뒤 다음 turn이 올바른 할 일을 받는가**(18·18b).
 *
 * ## 무엇을 신뢰하는가
 *
 * 결정론적인 부분(18·18b의 SemanticWorkSet 계산)은 **agent 완료를 기다리지 않고** 확인한다
 * — `/api/analyze`는 커밋 1(재인덱싱)을 끝낸 뒤에만 응답하고, agent turn은 그 뒤에
 * 비동기로 시작된다(§6.9). 그래서 응답의 `workSetSize`만으로 Core가 옳은 할 일을
 * 계산했는지 증명할 수 있다 — LLM이 뭘 하든 상관없다.
 *
 * agent의 판단이 필요한 부분(5의 structural coverage, 18b의 "새 Concept를 만든다")은
 * turn이 끝난 뒤 **파일시스템 위의 committed Semantic Memory를 직접 읽어** 확인한다
 * (B4 — agent 자기 보고를 신뢰의 근거로 삼지 않는다).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SemanticStore } from "@onto/core";

import { checkCoverage } from "./coverage.mjs";
import { FIXTURE_DIR, fetchJson, requireBridge, waitForTask } from "./_shared.mjs";

const EXPECTATIONS = JSON.parse(
  readFileSync(new URL("../fixtures/fixture-app/expectations.json", import.meta.url), "utf8"),
);
const TIMEOUT_MS = 300_000;

const requested = process.argv[2];
const config = await requireBridge();

execFileSync(process.execPath, [new URL("./create-fixture.mjs", import.meta.url).pathname], { stdio: "pipe" });

const health = await fetchJson(`${config.baseUrl}/api/health`);
const available = health.body.agents.filter((agent) => agent.installed).map((agent) => agent.agent);
const missing = health.body.agents.filter((agent) => !agent.installed);
for (const agent of missing) console.log(`[SKIP] ${agent.agent} — ${agent.message ?? "설치되지 않음"}`);

const targets = requested ? [requested] : available;
if (targets.length === 0) {
  console.error("");
  console.error("실행할 수 있는 agent 가 없습니다. codex 또는 claude 를 설치하고 로그인하세요.");
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

  // ---------------------------------------------------------------------
  // turn 1 — 첫 분석. acceptance 4 (patch commit) · 5 (structural coverage)
  // ---------------------------------------------------------------------
  const turn1 = await analyzeTurn(config.baseUrl, agent, "첫 분석");
  check("turn 1 이 오류 없이 끝났다", turn1.outcome.status === "completed", turn1.outcome.detail);
  if (turn1.outcome.status !== "completed") {
    report(agent, results);
    continue;
  }

  const evidence1 = await fetchJson(`${config.baseUrl}/api/tasks/${turn1.taskId}/mcp-evidence`);
  const both1 = new Set(evidence1.body.toolsWithBothSources ?? []);
  check(
    "acceptance 4 — submit_semantic_patch 가 두 증거원 모두에서 관측되었다",
    both1.has("submit_semantic_patch"),
    JSON.stringify(evidence1.body.calls?.map((c) => `${c.tool}:${c.source}`)),
  );

  const store = new SemanticStore(FIXTURE_DIR);
  const afterTurn1 = store.load();
  check(
    "acceptance 4 — semanticVersion 이 올라 새 generation 이 커밋되었다 (Validator ⓪~⑤ 통과)",
    afterTurn1.project.semanticVersion > 0,
    `semanticVersion=${afterTurn1.project.semanticVersion}`,
  );

  const coverage1 = checkCoverage(afterTurn1, EXPECTATIONS);
  check(
    "acceptance 5 — §7.2 structural coverage (hard)",
    coverage1.structuralPass,
    coverage1.hardFailures.join(" / "),
  );
  for (const warning of coverage1.warnings) console.log(`  [WARN] ${warning}`);
  for (const item of coverage1.semanticQueue) {
    console.log(`  [REVIEW] ${item.claimKey} — "${item.predicate}" (사람 판정 필요, §7.2 semantic 층)`);
  }

  // ---------------------------------------------------------------------
  // turn 2 — 심볼 삭제. acceptance 18
  // ---------------------------------------------------------------------
  deleteSymbol();
  const turn2 = await analyzeTurn(config.baseUrl, agent, "심볼 삭제 후 증분 분석");
  check(
    "acceptance 18 — 삭제된 심볼에 grounding된 Concept/Claim 이 할 일 목록(affected*)에 나타났다",
    turn2.summary.workSetSize.affectedConcepts + turn2.summary.workSetSize.affectedClaims > 0,
    JSON.stringify(turn2.summary.workSetSize),
  );
  check("turn 2 가 오류 없이 끝났다", turn2.outcome.status === "completed", turn2.outcome.detail);

  // ---------------------------------------------------------------------
  // turn 3 — 새 기능 파일 추가. acceptance 18b
  // ---------------------------------------------------------------------
  const beforeTurn3 = store.load();
  addFeatureFile();
  const turn3 = await analyzeTurn(config.baseUrl, agent, "새 기능 추가 후 증분 분석");
  check(
    "acceptance 18b — ungroundedAppearedEvidenceIds 가 비어 있지 않다 (새 기능 발견, U1)",
    turn3.summary.workSetSize.ungroundedAppearedEvidence > 0,
    JSON.stringify(turn3.summary.workSetSize),
  );
  check("turn 3 이 오류 없이 끝났다", turn3.outcome.status === "completed", turn3.outcome.detail);

  if (turn3.outcome.status === "completed") {
    const afterTurn3 = store.load();
    const newEvidenceIds = new Set(
      afterTurn3.evidence.evidence
        .filter((item) => item.status === "present" && item.filePath?.startsWith("src/services/block"))
        .map((item) => item.id),
    );
    const groundedNewConcept = afterTurn3.memory.concepts.some(
      (concept) =>
        !beforeTurn3.memory.concepts.some((old) => old.id === concept.id) &&
        concept.evidenceRefs.some((ref) => newEvidenceIds.has(ref)),
    );
    check(
      "acceptance 18b — agent 가 새 근거에 grounding된 새 Concept 를 만들었다",
      groundedNewConcept,
      `새로 나타난 evidence ${newEvidenceIds.size}개, concept 는 ${afterTurn3.memory.concepts.length}개(이전 ${beforeTurn3.memory.concepts.length}개)`,
    );
  }

  report(agent, results);
}

console.log("");
if (failed) {
  console.error("일부 항목이 실패했습니다.");
  process.exit(1);
}
console.log("전 항목 통과.");

// ---------------------------------------------------------------------------

/** `/api/analyze`는 인덱싱(커밋 1)이 끝난 뒤에만 응답한다 — agent turn은 그 다음이다 (§6.9). */
async function analyzeTurn(baseUrl, agent, label) {
  const started = await fetchJson(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, projectPath: FIXTURE_DIR }),
  });
  if (!started.ok) {
    throw new Error(`${label} 시작 실패: ${JSON.stringify(started.body)}`);
  }
  const taskId = started.body.taskId;
  const outcome = await waitForTask(baseUrl, taskId, TIMEOUT_MS);
  return { taskId, summary: started.body, outcome };
}

/**
 * acceptance 18 — "심볼을 삭제하고 커밋". `requestFollow`와 그것만 쓰는 route 를 지운다.
 * 파일 자체는 남긴다 — "그 evidence만" missing 이어야 한다는 것을 지키기 위함이다.
 */
function deleteSymbol() {
  writeFileSync(
    join(FIXTURE_DIR, "src/services/follow.js"),
    `import { prisma } from "../db.js";

export async function approveFollowRequest(requestId) {
  const request = await prisma.followRequest.update({
    where: { id: requestId },
    data: { status: "approved" },
  });
  return prisma.follow.create({ data: { fromId: request.fromId, toId: request.toId } });
}

export async function listPendingRequests(userId) {
  return prisma.followRequest.findMany({ where: { toId: userId, status: "pending" } });
}
`,
    "utf8",
  );
  rmSync(join(FIXTURE_DIR, "app/api/follow/route.js"), { force: true });
  commit("remove requestFollow");
}

/** acceptance 18b — "기능 파일을 통째로 새로 추가하고 커밋". */
function addFeatureFile() {
  mkdirSync(join(FIXTURE_DIR, "app/api/block"), { recursive: true });
  writeFileSync(
    join(FIXTURE_DIR, "src/services/block.js"),
    `import { prisma } from "../db.js";

/** 차단하면 상대는 더 이상 팔로우 요청을 보낼 수 없다. */
export async function blockUser(fromId, toId) {
  await prisma.follow.deleteMany({ where: { fromId: toId, toId: fromId } });
  return prisma.blockedUser.create({ data: { fromId, toId } });
}
`,
    "utf8",
  );
  writeFileSync(
    join(FIXTURE_DIR, "app/api/block/route.js"),
    `import { blockUser } from "../../../src/services/block.js";

export async function POST(request) {
  const body = await request.json();
  return blockUser(body.fromId, body.toId);
}
`,
    "utf8",
  );
  commit("add block feature");
}

function commit(message) {
  try {
    execFileSync("git", ["-C", FIXTURE_DIR, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", FIXTURE_DIR, "commit", "-q", "-m", message], { stdio: "pipe" });
  } catch (error) {
    console.error(`git 커밋을 건너뜁니다: ${error.message}`);
  }
}

function report(agent, results) {
  for (const { label, ok, detail } of results) {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  }
  const passed = results.filter((item) => item.ok).length;
  console.log(`  ${passed}/${results.length} (${agent})`);
}
