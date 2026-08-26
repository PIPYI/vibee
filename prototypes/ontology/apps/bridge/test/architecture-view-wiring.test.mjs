/**
 * `POST /api/architecture-view` · `GET /api/architecture-view` ·
 * `/internal/validate-architecture-view` · `/internal/submit-architecture-view` — v7 배선.
 *
 * view-wiring.test.mjs와 같은 방식이다 — agent CLI 없이 agent가 만들어 낼 **상태**만 대신
 * 준비하고(활성 architecture task + 사전 계산된 토폴로지), 그 다음은 전부 실제 Express route
 * handler를 진짜 HTTP로 통과한다.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { SemanticStore, detectRepositoryTopology, initialProjectState } from "@onto/core";
import { indexProject } from "@onto/evidence";

const PORT = 43931;
const TOKEN = "architecture-view-wiring-token-0123456789abcdef";
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

function freshProject() {
  const dir = mkdtempSync(join(tmpdir(), "onto-architecture-view-wiring-"));
  scratches.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "app.py"),
    "from flask import Flask\napp = Flask(__name__)\n\n\n@app.route(\"/health\")\ndef handler():\n    return 'ok'\n",
    "utf8",
  );
  return dir;
}

/** 인덱싱된 프로젝트 — architecture turn은 Semantic Memory/System Fact를 필요로 하지 않는다. */
async function indexedProject() {
  const project = freshProject();
  const store = new SemanticStore(project);
  await store.init(initialProjectState(randomUUID(), project));
  const before = store.load();
  const nextVersion = before.project.analysisVersion + 1;
  const index = indexProject(project, { analysisVersion: nextVersion });
  const after = await store.commit("index", "index", (snapshot) => {
    snapshot.project.analysisVersion = nextVersion;
    snapshot.evidence = index;
    return snapshot;
  });
  return { project, store, index, head: after };
}

function minimalDoc(overrides = {}) {
  return {
    schemaVersion: 1,
    title: "테스트 지도",
    viewBox: [800, 600],
    components: [
      { id: "svc", type: "backend", label: "서비스", pos: [50, 50], size: [200, 100], sources: [{ path: "src/app.py" }] },
    ],
    boundaries: [],
    connections: [],
    ...overrides,
  };
}

async function openArchitectureViewTask(seeded) {
  state.setProjectPath(seeded.project);
  const taskId = randomUUID();
  state.createTask({
    taskId,
    agent: "codex",
    projectPath: seeded.project,
    mode: "architecture",
    prompt: "(시험)",
    status: "running",
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });
  const topology = detectRepositoryTopology(seeded.project, seeded.index);
  state.startArchitectureViewSession(taskId, topology);
  return { taskId, topology };
}

function endTask(taskId) {
  state.updateTask(taskId, { status: "completed", endedAt: new Date().toISOString() });
  state.clearArchitectureViewSession(taskId);
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

test("architecture turn 밖에서는 no_active_transaction 을 돌려준다", async () => {
  const validate = await post("/internal/validate-architecture-view", minimalDoc());
  assert.equal(validate.body.error, "no_active_transaction");
  const submit = await post("/internal/submit-architecture-view", minimalDoc());
  assert.equal(submit.body.error, "no_active_transaction");
});

test("validate_architecture_view — 유효한 문서는 진단이 없다", async () => {
  const seeded = await indexedProject();
  const { taskId } = await openArchitectureViewTask(seeded);
  try {
    const { body } = await post("/internal/validate-architecture-view", minimalDoc());
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.deepEqual(body.diagnostics, []);
  } finally {
    endTask(taskId);
  }
});

test("validate_architecture_view — schema 위반은 error로 거절된다", async () => {
  const seeded = await indexedProject();
  const { taskId } = await openArchitectureViewTask(seeded);
  try {
    const { body } = await post("/internal/validate-architecture-view", { schemaVersion: 1, title: "t" });
    assert.equal(body.ok, false);
    assert.ok(body.diagnostics.some((d) => d.code === "architecture-view/schema"));
  } finally {
    endTask(taskId);
  }
});

test("validate_architecture_view — 탐지된 런타임을 인용하지 않으면 completeness warning을 낸다(hard reject 아님)", async () => {
  const seeded = await indexedProject();
  const { taskId } = await openArchitectureViewTask(seeded);
  try {
    const doc = minimalDoc({
      components: [{ id: "unrelated", type: "external", label: "무관", pos: [50, 50], size: [100, 60] }],
    });
    const { body } = await post("/internal/validate-architecture-view", doc);
    assert.equal(body.ok, true, "warning뿐이면 ok:true다 (hard reject 아님)");
    const warning = body.diagnostics.find((d) => d.code === "architecture-view/route-surface-not-represented");
    assert.ok(warning, JSON.stringify(body.diagnostics));
    assert.equal(warning.severity, "warning");
  } finally {
    endTask(taskId);
  }
});

test("validate_architecture_view — 존재하지 않는 파일을 인용하면 citation error로 거절된다", async () => {
  const seeded = await indexedProject();
  const { taskId } = await openArchitectureViewTask(seeded);
  try {
    const doc = minimalDoc({
      components: [{ id: "svc", type: "backend", label: "서비스", pos: [50, 50], size: [200, 100], sources: [{ path: "does-not-exist.py" }] }],
    });
    const { body } = await post("/internal/validate-architecture-view", doc);
    assert.equal(body.ok, false);
    assert.ok(body.diagnostics.some((d) => d.code === "architecture-view/citation-missing-file"));
  } finally {
    endTask(taskId);
  }
});

test("validate_architecture_view — 하드 캡을 넘으면 더 반복하지 말라는 error를 돌려준다", async () => {
  const seeded = await indexedProject();
  const { taskId } = await openArchitectureViewTask(seeded);
  try {
    let last;
    for (let i = 0; i < 7; i += 1) last = await post("/internal/validate-architecture-view", minimalDoc());
    assert.equal(last.body.ok, false);
    assert.equal(last.body.retryable, false);
    assert.ok(last.body.diagnostics.some((d) => d.code === "architecture-view/validate-limit"));
  } finally {
    endTask(taskId);
  }
});

test("submit_architecture_view — 검증을 통과하면 커밋되고 GET으로 다시 읽힌다", async () => {
  const seeded = await indexedProject();
  const { taskId } = await openArchitectureViewTask(seeded);
  const doc = minimalDoc();
  try {
    const { body } = await post("/internal/submit-architecture-view", doc);
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.ok(typeof body.generation === "number");

    const result = await get(`/api/architecture-view?projectPath=${encodeURIComponent(seeded.project)}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.document, doc);

    // AnalysisBundle.architecture와 완전히 별도 경로다 — 건드리지 않는다.
    const head = seeded.store.load();
    assert.equal(head.analysisBundle, null);
  } finally {
    endTask(taskId);
  }
});

test("submit_architecture_view — error가 있으면 커밋하지 않고 diagnostics만 돌려준다", async () => {
  const seeded = await indexedProject();
  const { taskId } = await openArchitectureViewTask(seeded);
  try {
    const doc = minimalDoc({
      components: [{ id: "svc", type: "backend", label: "서비스", pos: [50, 50], size: [200, 100], sources: [{ path: "ghost.py" }] }],
    });
    const before = seeded.store.load().project.semanticVersion;
    const { body } = await post("/internal/submit-architecture-view", doc);
    assert.equal(body.ok, false);
    assert.ok(hasErrorCode(body.diagnostics, "architecture-view/citation-missing-file"));
    assert.equal(seeded.store.load().architectureView, null);
    assert.equal(seeded.store.load().project.semanticVersion, before);
  } finally {
    endTask(taskId);
  }
});

function hasErrorCode(diagnostics, code) {
  return diagnostics.some((d) => d.code === code && d.severity === "error");
}

test("GET /api/architecture-view — 아직 저작한 적 없으면 404다", async () => {
  const seeded = await indexedProject();
  const result = await get(`/api/architecture-view?projectPath=${encodeURIComponent(seeded.project)}`);
  assert.equal(result.status, 404);
});
