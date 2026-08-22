/**
 * `/internal/propose-evidence` · `/internal/semantic-patch` — bridge 배선 (implementation_plan
 * §6.5 · §6.3 · §6.9). MCP server 는 이 두 경로를 그대로 loopback 위임하므로, 여기서 검증하는
 * 것이 곧 agent 가 그 tool 을 불렀을 때 실제로 일어나는 일이다.
 *
 * ## 이 시험이 증명하는 것과 증명하지 못하는 것
 *
 * **증명한다** — bridge 의 실제 Express route handler 가 `state.getActiveTaskId()` 로 현재
 * task 를 찾고, 그 task 의 `AnalyzeSession` 을 통해 `@onto/core`의 `validateProposal` ·
 * `commitPatch` 를 부르며, T3(race → abort → 재인덱싱 → 새 transaction)가 실제 HTTP 요청
 * 경로에서 동작하는지.
 *
 * **증명하지 못한다** — Codex/Claude 가 이 tool 을 스스로 호출하는지(`agent-stream`). 이
 * 머신에 CLI 가 없다는 것은 M3 FINDINGS 에 이미 기록된 환경 제약과 같다. 그래서 여기서는
 * "analyze turn 이 열려 있다"를 `state.createTask` + `state.setAnalyzeSession` 으로 직접
 * 만든다 — 이것은 agent 대신 만드는 것이 아니라, agent 가 만들어 낼 **상태**를 대신
 * 준비하는 것뿐이고, 그 다음의 모든 호출은 실제 route handler 를 진짜 HTTP 로 통과한다.
 *
 * `apps/bridge/src/index.ts` 를 **import** 로 쓴다(자식 프로세스로 띄우지 않는다) — 그래야
 * `state` 에 직접 접근해 session 을 미리 심을 수 있다. entrypoint 의 `server.listen` 이
 * import 시점에 실행되지 않도록 `isMainModule` 가드를 두었으므로(이 시험이 그 가드가 필요한
 * 이유다), 여기서 직접 `http.createServer(app)` 로 듣고 시험이 끝나면 닫는다.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { AnalyzeSession, SemanticStore, initialProjectState } from "@onto/core";
import { indexProject } from "@onto/evidence";

const PORT = 43922;
const TOKEN = "m4-wiring-token-0123456789abcdef";
process.env.ONTO_BRIDGE_PORT = String(PORT);
process.env.ONTO_BRIDGE_TOKEN = TOKEN;

const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = { "content-type": "application/json", "x-onto-token": TOKEN };

const { app, state } = await import("../dist/index.js");
const server = createServer(app);

const scratches = [];

before(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/**
 * 매 시험마다 **새 프로젝트**를 만든다. 하나를 공유하면 이전 시험이 커밋한
 * semanticVersion·generation 이 다음 시험의 base 기대값을 조용히 어긋내게 된다 —
 * FINDINGS Finding 3 이 같은 종류의 결함(전역 상태로 판정)을 이미 한 번 잡았다.
 */
function freshProject() {
  const dir = mkdtempSync(join(tmpdir(), "onto-m4-wiring-"));
  scratches.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "follow.js"),
    'export async function requestFollow(fromId, toId) {\n  return { fromId, toId, status: "pending" };\n}\n',
    "utf8",
  );
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "policy.md"), "# 정책\n\n비공개 계정은 승인을 요구한다.\n", "utf8");
  return dir;
}

/**
 * agent 가 analyze turn 을 시작했을 때 bridge 가 실제로 하는 것(재인덱싱 + session 개설)을
 * 재현한다. agent CLI 없이 이 상태를 만들 뿐, 그 이후 모든 호출은 진짜 route handler 를 탄다.
 */
async function openAnalyzeTask() {
  const project = freshProject();
  state.setProjectPath(project);

  const store = new SemanticStore(project);
  await store.init(initialProjectState("m4-wiring", project));
  const before = store.load();
  const nextVersion = before.project.analysisVersion + 1;
  const index = indexProject(project, { analysisVersion: nextVersion });
  await store.commit("index", "index", (snapshot) => {
    snapshot.project.analysisVersion = nextVersion;
    snapshot.evidence = index;
    return snapshot;
  });

  const taskId = randomUUID();
  state.createTask({
    taskId,
    agent: "codex",
    projectPath: project,
    mode: "analyze",
    prompt: "(시험)",
    status: "running",
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });
  state.setAnalyzeSession(taskId, new AnalyzeSession(taskId, project, { baseAnalysisVersion: nextVersion, index }));
  return { taskId, project, nextVersion, index };
}

function endTask(taskId) {
  state.updateTask(taskId, { status: "completed", endedAt: new Date().toISOString() });
  state.disposeAnalyzeSession(taskId, "test cleanup");
}

async function post(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  return response.json();
}

// ---------------------------------------------------------------------------

test("analyze turn 밖에서는 no_active_transaction 을 돌려준다 (C5)", async () => {
  const payload = await post("/internal/propose-evidence", {
    kind: "policy_note",
    filePath: "docs/policy.md",
    location: { startLine: 3, endLine: 3 },
    summary: "정책",
  });
  assert.equal(payload.error, "no_active_transaction");
  assert.ok(payload.next_step);
});

test("propose_evidence — bridge 가 Core 의 검증을 실제로 통과시킨다", async () => {
  const { taskId } = await openAnalyzeTask();
  try {
    const payload = await post("/internal/propose-evidence", {
      kind: "policy_note",
      filePath: "docs/policy.md",
      location: { startLine: 3, endLine: 3 },
      summary: "비공개 계정은 승인을 요구한다는 정책",
    });
    assert.equal(payload.ok, true, JSON.stringify(payload));
    assert.equal(payload.evidence.origin, "agent");
    assert.match(payload.evidence.id, /^ev:agent:/u);

    // get_evidence 가 이 task 안에서 즉시 그것을 봐야 한다 (S2 self-deadlock 없음).
    const evidenceResponse = await fetch(`${BASE_URL}/internal/evidence`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ ids: [payload.evidence.id] }),
    });
    const evidenceBody = await evidenceResponse.json();
    assert.equal(evidenceBody.total, 1, "propose 로 받은 id 를 get_evidence 가 즉시 봐야 한다");
  } finally {
    endTask(taskId);
  }
});

test("acceptance 7 — 지어낸 범위는 bridge 를 거쳐도 거절된다", async () => {
  const { taskId } = await openAnalyzeTask();
  try {
    const payload = await post("/internal/propose-evidence", {
      kind: "policy_note",
      filePath: "docs/policy.md",
      location: { startLine: 1, endLine: 999 },
      summary: "지어낸 범위",
    });
    assert.equal(payload.ok, false);
    assert.ok(payload.diagnostics.some((item) => item.code === "proposal/line-out-of-range"));
  } finally {
    endTask(taskId);
  }
});

test("submit_semantic_patch — propose 로 받은 id 로 patch 를 커밋한다 (acceptance 8)", async () => {
  const { taskId, project, nextVersion } = await openAnalyzeTask();
  try {
    const proposed = await post("/internal/propose-evidence", {
      kind: "policy_note",
      filePath: "docs/policy.md",
      location: { startLine: 3, endLine: 3 },
      summary: "정책",
    });
    assert.equal(proposed.ok, true);

    const committed = await post("/internal/semantic-patch", {
      baseAnalysisVersion: nextVersion,
      baseSemanticVersion: 0,
      addedConcepts: [
        {
          id: "c-wiring-1",
          name: "팔로우 승인 정책",
          evidenceRefs: [proposed.evidence.id],
          status: "active",
        },
      ],
    });
    assert.equal(committed.ok, true, JSON.stringify(committed));
    assert.equal(committed.semanticVersion, 1);

    const store = new SemanticStore(project);
    const head = store.load();
    assert.ok(head.memory.concepts.some((item) => item.id === "c-wiring-1"));
  } finally {
    endTask(taskId);
  }
});

test("acceptance 9 — stale base 는 bridge 를 거쳐도 거절된다", async () => {
  const { taskId, nextVersion } = await openAnalyzeTask();
  try {
    const payload = await post("/internal/semantic-patch", {
      baseAnalysisVersion: nextVersion,
      baseSemanticVersion: 999,
      addedConcepts: [{ id: "c-stale", name: "x", evidenceRefs: [], status: "uncertain" }],
    });
    assert.equal(payload.ok, false);
    assert.ok(payload.diagnostics.some((item) => item.code === "version/stale-base"));
  } finally {
    endTask(taskId);
  }
});

test("acceptance 10 · T3 — 커밋 직전 참조 파일이 바뀌면 재인덱싱 후 새 base 로 이어간다", async () => {
  const { taskId, project, nextVersion } = await openAnalyzeTask();
  try {
    const proposed = await post("/internal/propose-evidence", {
      kind: "policy_note",
      filePath: "docs/policy.md",
      location: { startLine: 3, endLine: 3 },
      summary: "정책",
    });
    assert.equal(proposed.ok, true);

    // 바깥에서 참조 파일이 바뀐다.
    writeFileSync(join(project, "docs", "policy.md"), "# 정책\n\n비공개 계정은 승인을 요구한다.\n\n추가.\n", "utf8");

    const before = new SemanticStore(project).load();
    const blocked = await post("/internal/semantic-patch", {
      baseAnalysisVersion: nextVersion,
      baseSemanticVersion: 0,
      addedConcepts: [
        { id: "c-race", name: "정책", evidenceRefs: [proposed.evidence.id], status: "active" },
      ],
    });

    assert.equal(blocked.ok, false);
    assert.ok(
      blocked.diagnostics.some((item) => item.code === "evidence/file-changed-during-turn"),
      JSON.stringify(blocked),
    );
    // T3 — 같은 session 에 새 baseAnalysisVersion 이 열렸다.
    assert.equal(blocked.baseAnalysisVersion, nextVersion + 1, "재인덱싱이 analysisVersion 을 올려야 한다");
    assert.deepEqual(
      blocked.discardedProposals.map((item) => item.id),
      [proposed.evidence.id],
      "버려진 제안이 요약으로 와야 한다",
    );

    // **쓰기가 일어나지 않았다.**
    const after = new SemanticStore(project).load();
    assert.equal(after.generation, before.generation + 1, "재인덱싱 자체는 커밋 1로 한 generation 늘어난다");
    assert.equal(after.memory.concepts.length, 0, "patch 는 커밋되지 않았어야 한다");
  } finally {
    endTask(taskId);
  }
});

test("stop 이 transaction 을 폐기한다 — 폐기 후에는 다시 propose 할 수 없다", async () => {
  const { taskId } = await openAnalyzeTask();
  const proposed = await post("/internal/propose-evidence", {
    kind: "policy_note",
    filePath: "docs/policy.md",
    location: { startLine: 3, endLine: 3 },
    summary: "정책",
  });
  assert.equal(proposed.ok, true);

  const stopped = await fetch(`${BASE_URL}/api/tasks/${taskId}/stop`, { method: "POST" });
  assert.equal(stopped.ok, true);

  const afterStop = await post("/internal/propose-evidence", {
    kind: "policy_note",
    filePath: "docs/policy.md",
    location: { startLine: 3, endLine: 3 },
    summary: "정책",
  });
  // session 자체가 지워졌으므로 no_active_transaction 이다.
  assert.equal(afterStop.error, "no_active_transaction");
});
