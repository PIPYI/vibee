#!/usr/bin/env node
/**
 * M8 — §7.3 비교 arm. **같은 모델·같은 Validator·같은 fixture**로 agent-first와
 * index-only를 각각 독립된 프로젝트에서 첫 분석 한 번씩 돌려 표를 채운다.
 *
 *   npm run eval:index-only          # 설치된 agent 전부
 *   npm run eval:index-only codex
 *
 * §7.3이 조작하는 변수는 하나뿐이다 — **저장소를 직접 탐색하게 하는가, 미리 만든 evidence
 * 요약만 주는가.** 강제로 막지 않는다(Codex/Claude에 파일 도구를 확실히 끊을 방법이 없다).
 * 대신 `agent.file.explored` 이벤트로 index-only arm이 그래도 탐색했는지를 관측한다 —
 * 탐색했다면 그 자체가 §9 Q1′의 findings다.
 *
 * 두 arm은 **독립된 프로젝트 디렉터리**를 쓴다 — 같은 store를 공유하면 두 번째 turn이
 * 첫 번째가 만든 Semantic Memory를 "이미 있는 의미"로 보고 재사용/병합하려 들어 비교가
 * 오염된다. §7.2 structural coverage(checkCoverage)를 그대로 재사용해 "몇 개 중 몇 개"를
 * 센다 — 새 채점 기준을 만들지 않는다.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SemanticStore } from "@onto/core";
import { ONTO_BUILD_ID, ONTO_PROTOCOL_VERSION } from "@onto/protocol";

import { checkCoverage } from "./coverage.mjs";
import { writeFixtureTo } from "./create-fixture.mjs";
import { computeEvidenceOriginStats } from "./stability.mjs";
import { fetchJson, requireBridge, waitForTask } from "./_shared.mjs";

const EXPECTATIONS = JSON.parse(
  readFileSync(new URL("../fixtures/fixture-app/expectations.json", import.meta.url), "utf8"),
);
const TIMEOUT_MS = 300_000;

const requested = process.argv[2];
const config = await requireBridge();

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

const scratches = [];
const rows = [];

for (const agent of targets) {
  console.log("");
  console.log(`=== ${agent} ===`);

  const agentFirstDir = mkdtempSync(join(tmpdir(), "onto-eval-agentfirst-"));
  const indexOnlyDir = mkdtempSync(join(tmpdir(), "onto-eval-indexonly-"));
  scratches.push(agentFirstDir, indexOnlyDir);
  writeFixtureTo(agentFirstDir);
  writeFixtureTo(indexOnlyDir);

  const agentFirst = await runArm(config.baseUrl, agent, agentFirstDir, undefined);
  rows.push({ agent, arm: "agent-first", ...agentFirst });

  const indexOnly = await runArm(config.baseUrl, agent, indexOnlyDir, "index-only");
  rows.push({ agent, arm: "index-only", ...indexOnly });
}

for (const dir of scratches) rmSync(dir, { recursive: true, force: true });

printTable(rows);

// ---------------------------------------------------------------------------

async function runArm(baseUrl, agent, projectPath, mode) {
  const selected = await fetchJson(`${baseUrl}/api/project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath }),
  });
  if (!selected.ok) throw new Error(`프로젝트 선택 실패: ${JSON.stringify(selected.body)}`);

  const started = await fetchJson(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agent,
      projectPath,
      clientRuntime: { protocolVersion: ONTO_PROTOCOL_VERSION, buildId: ONTO_BUILD_ID },
      ...(mode ? { mode } : {}),
    }),
  });
  if (!started.ok) throw new Error(`analyze 시작 실패(${mode ?? "agent-first"}): ${JSON.stringify(started.body)}`);
  const taskId = started.body.taskId;
  const outcome = await waitForTask(baseUrl, taskId, TIMEOUT_MS);

  const stateResponse = await fetchJson(`${baseUrl}/api/state`);
  const task = (stateResponse.body.tasks ?? []).find((item) => item.taskId === taskId);

  if (outcome.status !== "completed") {
    console.log(`  [WARN] ${mode ?? "agent-first"} turn이 완료되지 않았다 — ${outcome.status}: ${outcome.detail}`);
    return { outcome, exploredFiles: task?.exploredFiles?.length ?? 0, tokenUsage: task?.tokenUsage };
  }

  const store = new SemanticStore(projectPath);
  const after = store.load();
  const coverage = checkCoverage(after, EXPECTATIONS);
  const originStats = computeEvidenceOriginStats(after.evidence);

  const allConceptsAndClaims = [...after.memory.concepts, ...after.memory.claims];
  const groundedCount = allConceptsAndClaims.filter((item) => item.evidenceRefs.length > 0).length;
  const groundingCoverage = allConceptsAndClaims.length > 0 ? groundedCount / allConceptsAndClaims.length : null;

  return {
    outcome,
    coverage,
    groundingCoverage,
    agentOriginRatio: originStats.totalPresent > 0 ? originStats.byOrigin.agent / originStats.totalPresent : 0,
    exploredFiles: task?.exploredFiles?.length ?? 0,
    exploredFilesList: task?.exploredFiles ?? [],
    tokenUsage: task?.tokenUsage,
  };
}

function fmtRatio(matched, total) {
  return `${matched}/${total}`;
}

function fmtPct(value) {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(0)}%`;
}

function printTable(rows) {
  console.log("");
  console.log("§7.3 비교 표");
  console.log("");
  const header = [
    "agent",
    "arm",
    "concept coverage",
    "claim coverage",
    "forbidden(↓)",
    "grounding coverage",
    "agent-origin evidence",
    "탐색한 파일 수",
    "turn tokens",
  ];
  console.log(header.join(" | "));
  for (const row of rows) {
    if (!row.coverage) {
      console.log([row.agent, row.arm, "(turn 미완료)", "", "", "", "", row.exploredFiles, row.tokenUsage ?? "—"].join(" | "));
      continue;
    }
    console.log(
      [
        row.agent,
        row.arm,
        fmtRatio(row.coverage.counts.concepts.matched, row.coverage.counts.concepts.total),
        fmtRatio(row.coverage.counts.claims.matched, row.coverage.counts.claims.total),
        row.coverage.counts.forbiddenPromoted,
        fmtPct(row.groundingCoverage),
        fmtPct(row.agentOriginRatio),
        row.exploredFiles,
        row.tokenUsage ?? "—",
      ].join(" | "),
    );
    if (row.arm === "index-only" && row.exploredFiles > 0) {
      console.log(
        `  [FINDING] index-only arm이 explore를 금지받지 않았는데도 native 도구로 ${row.exploredFiles}개 파일을 직접 읽었다: ${row.exploredFilesList.slice(0, 5).join(", ")}${row.exploredFilesList.length > 5 ? " ..." : ""}`,
      );
    }
  }
}
