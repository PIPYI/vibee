/**
 * `POST /api/views` · `GET /api/views/:id` · `/internal/submit-view-ir` — bridge 배선
 * (implementation_plan §6.4 V2 · §6.6 R4 · §6.9 [C], M6).
 *
 * m4-wiring.test.mjs와 같은 방식이다 — agent CLI 없이 agent가 만들어 낼 **상태**만 대신
 * 준비하고, 그 다음은 전부 실제 Express route handler를 진짜 HTTP로 통과한다.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { SemanticStore, initialProjectState } from "@onto/core";
import { indexProject } from "@onto/evidence";

const PORT = 43923;
const TOKEN = "view-wiring-token-0123456789abcdef";
process.env.ONTO_BRIDGE_PORT = String(PORT);
process.env.ONTO_BRIDGE_TOKEN = TOKEN;

const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = { "content-type": "application/json", "x-onto-token": TOKEN };

const { app, state } = await import("../dist/index.js");
const { hashViewRequest } = await import("../dist/view.js");
const server = createServer(app);

const scratches = [];

before(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

function freshProject() {
  const dir = mkdtempSync(join(tmpdir(), "onto-view-wiring-"));
  scratches.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "follow.js"),
    'export async function requestFollow(fromId, toId) {\n  return { fromId, toId, status: "pending" };\n}\n',
    "utf8",
  );
  return dir;
}

/** 인덱싱만 하고 Semantic Memory는 아직 없는 프로젝트. */
async function indexedProject() {
  const project = freshProject();
  const store = new SemanticStore(project);
  await store.init(initialProjectState(randomUUID(), project));
  const before = store.load();
  const nextVersion = before.project.analysisVersion + 1;
  const index = indexProject(project, { analysisVersion: nextVersion });
  const after = await store.commit("index", "index", (snapshot) => {
    snapshot.project.analysisVersion = nextVersion;
    // 이 프로젝트에는 dirty evidence가 없다 — 실제 reindex()라면 자동 advance됐을 값이다.
    snapshot.project.semanticReconciledAnalysisVersion = nextVersion;
    snapshot.evidence = index;
    return snapshot;
  });
  const symbol = after.evidence.evidence.find(
    (item) => item.kind === "symbol" && item.symbolId === "src/follow.js#requestFollow",
  );
  return { project, store, head: after, symbol };
}

/** 인덱싱 + Concept 하나가 이미 있는 Semantic Memory. */
async function projectWithConcept() {
  const indexed = await indexedProject();
  const conceptId = "cpt-follow-request";
  const after = await indexed.store.commit("seed memory", "patch", (snapshot) => {
    snapshot.memory = {
      semanticVersion: 1,
      concepts: [
        {
          id: conceptId,
          name: "팔로우 요청",
          evidenceRefs: [indexed.symbol.id],
          status: "active",
          createdAtVersion: 1,
          updatedAtVersion: 1,
        },
      ],
      claims: [],
      canonicalScenarios: [],
    };
    snapshot.project.semanticVersion = 1;
    return snapshot;
  });
  return { ...indexed, head: after, conceptId };
}

async function openViewTask(viewKind, seeded) {
  state.setProjectPath(seeded.project);
  const taskId = randomUUID();
  state.createTask({
    taskId,
    agent: "codex",
    projectPath: seeded.project,
    mode: "view",
    prompt: "(시험)",
    status: "running",
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });
  state.setPendingViewRequest(taskId, {
    viewKind,
    semanticVersion: seeded.head.project.semanticVersion,
    // 실제 `/api/views` 요청과 같은 값(anchor/question/scope 없음)을 해시한다 — 그래야
    // 캐시 조회 시험에서 `/api/views`가 계산하는 키와 실제로 일치한다.
    requestHash: hashViewRequest({ viewKind }),
  });
  return taskId;
}

function endTask(taskId) {
  state.updateTask(taskId, { status: "completed", endedAt: new Date().toISOString() });
  state.clearPendingViewRequest(taskId);
}

async function post(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function get(path) {
  const response = await fetch(`${BASE_URL}${path}`, { headers: HEADERS });
  return { status: response.status, body: await response.json() };
}

// ---------------------------------------------------------------------------

test("view turn 밖에서는 no_active_transaction 을 돌려준다 (C5)", async () => {
  const { body } = await post("/internal/submit-view-ir", { viewKind: "overview", ir: { title: "t", areas: [] } });
  assert.equal(body.error, "no_active_transaction");
  assert.ok(body.next_step);
});

test("submit_view_ir — bridge가 Core의 view-validator를 실제로 통과시키고 캐시에 남긴다", async () => {
  const seeded = await projectWithConcept();
  const taskId = await openViewTask("overview", seeded);
  try {
    const ir = {
      title: "제품 개요",
      areas: [
        {
          id: "area-1",
          label: "팔로우",
          items: [{ id: "item-1", label: "팔로우 요청", conceptRefs: [seeded.conceptId] }],
        },
      ],
    };
    const { body } = await post("/internal/submit-view-ir", { viewKind: "overview", ir });
    assert.equal(body.ok, true, JSON.stringify(body));

    endTask(taskId);
    const result = await get(`/api/views/${taskId}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "completed");
    assert.deepEqual(result.body.view.ir, ir);
    assert.equal(result.body.view.freshness, "current");
  } finally {
    endTask(taskId);
  }
});

test("submit_view_ir — 실재하지 않는 conceptRefs는 bridge를 거쳐도 거절된다 (I9)", async () => {
  const seeded = await projectWithConcept();
  const taskId = await openViewTask("overview", seeded);
  try {
    const ir = {
      title: "t",
      areas: [{ id: "a", label: "a", items: [{ id: "i", label: "i", conceptRefs: ["cpt-지어냄"] }] }],
    };
    const { body } = await post("/internal/submit-view-ir", { viewKind: "overview", ir });
    assert.equal(body.ok, false);
    assert.ok(body.diagnostics.some((d) => d.code === "view/unknown-concept"));
  } finally {
    endTask(taskId);
  }
});

test("submit_view_ir — 요청받은 viewKind와 다르게 제출하면 거절된다", async () => {
  const seeded = await projectWithConcept();
  const taskId = await openViewTask("overview", seeded);
  try {
    const { body } = await post("/internal/submit-view-ir", {
      viewKind: "scenario",
      ir: { id: "s", name: "s", type: "user", participants: [], steps: [], transitions: [], entryStepId: "x", outcomeStepIds: [] },
    });
    assert.equal(body.ok, false);
    assert.ok(body.diagnostics.some((d) => d.code === "view/wrong-kind"));
  } finally {
    endTask(taskId);
  }
});

test("POST /api/views trace — Core가 동기로 투영한다. agent turn이 없다 (§6.6 R4)", async () => {
  const seeded = await indexedProject();
  const { status, body } = await post("/api/views", {
    viewKind: "trace",
    projectPath: seeded.project,
    anchor: { kind: "symbol", symbolId: seeded.symbol.symbolId },
  });
  assert.equal(status, 200);
  assert.equal(body.viewKind, "trace");
  assert.ok(body.ir.codeEntities.some((entity) => entity.symbolId === seeded.symbol.symbolId));
  assert.equal(body.taskId, undefined, "trace는 task를 만들지 않는다");
});

test("POST /api/views overview — 캐시가 있으면 agent 없이도 즉시 cached:true로 응답한다 (§6.4 V2)", async () => {
  const seeded = await projectWithConcept();
  const taskId = await openViewTask("overview", seeded);
  const ir = { title: "t", areas: [{ id: "a", label: "a", items: [{ id: "i", label: "i" }] }] };
  await post("/internal/submit-view-ir", { viewKind: "overview", ir });
  endTask(taskId);

  // requestHash가 실제 hashViewRequest()와 일치해야 캐시가 잡힌다 — anchor/question/scope 없음.
  const { status, body } = await post("/api/views", { viewKind: "overview", projectPath: seeded.project });
  assert.equal(status, 200);
  assert.equal(body.cached, true);
  assert.deepEqual(body.view.ir, ir);
});

test("POST /api/views overview — 캐시가 없으면 agent 준비 상태를 확인한다", async () => {
  const seeded = await indexedProject();
  const { status, body } = await post("/api/views", {
    viewKind: "overview",
    projectPath: seeded.project,
    agent: "no-such-agent",
  });
  assert.equal(status, 400);
  assert.match(body.error, /지원하지 않는 agent/u);
});

test("POST /api/views — 인덱싱되지 않은 프로젝트는 412다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "onto-view-wiring-empty-"));
  scratches.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n", "utf8");
  const { status, body } = await post("/api/views", { viewKind: "overview", projectPath: dir });
  assert.equal(status, 412);
  assert.match(body.error, /인덱싱/u);
});
