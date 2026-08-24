/**
 * `/internal/submit-analysis-bundle` · `GET /api/analysis-bundle` — bridge 배선
 * (schema3 §5.2 Stage 3~4, §5.4).
 *
 * view-wiring.test.mjs와 같은 방식이다 — agent CLI 없이 assembly turn이 만들어 낼 **상태**만
 * 대신 준비하고, 그 다음은 전부 실제 Express route handler를 진짜 HTTP로 통과한다.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { SemanticStore, initialProjectState } from "@onto/core";

const PORT = 43925;
const TOKEN = "bundle-wiring-token-0123456789abcdef";
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

function evidenceItem(id, overrides = {}) {
  return {
    id,
    kind: "symbol",
    origin: "engine",
    rawHash: "h",
    normalizedFingerprint: "f",
    normalizationProfile: "code",
    fileContentHash: "fc",
    observedAtVersion: 1,
    status: "present",
    ...overrides,
  };
}

// entityKey("route:GET /api/x") / entityKey("symbol:svc#handle") 골격 노드를 낳는 entity evidence.
const EV_ROUTE = evidenceItem("ev-route", {
  kind: "route",
  graph: { role: "entity", entity: { kind: "route", routeKey: "GET /api/x" }, label: "GET /api/x" },
});
const EV_SVC = evidenceItem("ev-svc", {
  kind: "symbol",
  graph: { role: "entity", entity: { kind: "symbol", symbolId: "svc#handle" }, label: "handle" },
});
// route → symbol 골격 링크. traceLinkRefs가 참조할 수 있는 유일한 종류(link-role evidence).
const EV_LINK = evidenceItem("ev-link", {
  kind: "api_handler",
  graph: {
    role: "link",
    from: { kind: "route", routeKey: "GET /api/x" },
    to: { kind: "symbol", symbolId: "svc#handle" },
    linkKind: "api_handler",
  },
});

/** route/symbol/link 골격 evidence가 이미 커밋된 프로젝트. */
async function seededProject() {
  const dir = mkdtempSync(join(tmpdir(), "onto-bundle-wiring-"));
  scratches.push(dir);
  const store = new SemanticStore(dir);
  await store.init(initialProjectState(randomUUID(), dir));
  await store.commit("index", "index", (snapshot) => {
    snapshot.project.analysisVersion = 1;
    snapshot.project.semanticReconciledAnalysisVersion = 1;
    snapshot.evidence = {
      analysisVersion: 1,
      fileHashes: {},
      evidence: [EV_ROUTE, EV_SVC, EV_LINK],
      adapterReport: [],
    };
    return snapshot;
  });
  return { project: dir };
}

function validBundle() {
  return {
    architecture: {
      title: "아키텍처",
      components: [
        {
          id: "comp-1",
          label: "예약 서비스",
          presentationType: "backend",
          entityRefs: ["route:GET /api/x", "symbol:svc#handle"],
          evidenceRefs: [EV_ROUTE.id, EV_SVC.id],
          description: "예약을 만든다",
        },
      ],
      boundaries: [],
      connections: [
        { id: "conn-1", from: "comp-1", to: "comp-1", traceLinkRefs: [EV_LINK.id], evidenceRefs: [EV_LINK.id] },
      ],
    },
    workflow: { title: "워크플로우", lanes: [], mainPath: [], nodes: [], edges: [] },
    sequences: [],
  };
}

function openTask(seeded, mode) {
  state.setProjectPath(seeded.project);
  const taskId = randomUUID();
  state.createTask({
    taskId,
    agent: "codex",
    projectPath: seeded.project,
    mode,
    prompt: "(시험)",
    status: "running",
    startedAt: new Date().toISOString(),
    mcpCalls: [],
    exploredFiles: [],
  });
  return taskId;
}

function endTask(taskId) {
  state.updateTask(taskId, { status: "completed", endedAt: new Date().toISOString() });
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

test("assembly turn 밖에서는 no_active_transaction 을 돌려준다 (C5)", async () => {
  const { body } = await post("/internal/submit-analysis-bundle", validBundle());
  assert.equal(body.error, "no_active_transaction");
  assert.ok(body.next_step);
});

test("활성 task가 있어도 mode가 assembly가 아니면 no_active_transaction 이다", async () => {
  const seeded = await seededProject();
  const taskId = openTask(seeded, "view");
  try {
    const { body } = await post("/internal/submit-analysis-bundle", validBundle());
    assert.equal(body.error, "no_active_transaction");
  } finally {
    endTask(taskId);
  }
});

test("submit_analysis_bundle — 유효한 bundle은 커밋되고 GET /api/analysis-bundle이 재요청 없이 즉시 읽는다 (§5.4)", async () => {
  const seeded = await seededProject();
  const taskId = openTask(seeded, "assembly");
  try {
    const { body } = await post("/internal/submit-analysis-bundle", validBundle());
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.ok(body.generation > 0);

    const result = await get(`/api/analysis-bundle?projectPath=${encodeURIComponent(seeded.project)}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.bundle.freshness, "current");
    assert.deepEqual(
      result.body.bundle.architecture.connections[0].traceLinkRefs,
      validBundle().architecture.connections[0].traceLinkRefs,
    );
    assert.equal(result.body.bundle.architecture.connections[0].systemLinkRefs.length, 1);
    assert.deepEqual(result.body.bundle.workflow, validBundle().workflow);
  } finally {
    endTask(taskId);
  }
});

test("submit_analysis_bundle — I20 위반(traceLinkRefs 비어 있음)은 거절되고 아무것도 커밋되지 않는다", async () => {
  const seeded = await seededProject();
  const taskId = openTask(seeded, "assembly");
  try {
    const bundle = validBundle();
    bundle.architecture.connections[0].traceLinkRefs = [];
    const { body } = await post("/internal/submit-analysis-bundle", bundle);
    assert.equal(body.ok, false);
    assert.ok(body.diagnostics.some((d) => d.code === "bundle/connection-not-grounded-in-skeleton"));

    const result = await get(`/api/analysis-bundle?projectPath=${encodeURIComponent(seeded.project)}`);
    assert.equal(result.status, 404, "실패한 제출은 AnalysisBundle을 남기지 않는다");
  } finally {
    endTask(taskId);
  }
});

test("GET /api/analysis-bundle — 아직 분석하지 않은(인덱싱만 된) 프로젝트는 404다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "onto-bundle-wiring-empty-"));
  scratches.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n", "utf8");
  const store = new SemanticStore(dir);
  await store.init(initialProjectState(randomUUID(), dir));

  const { status, body } = await get(`/api/analysis-bundle?projectPath=${encodeURIComponent(dir)}`);
  assert.equal(status, 404);
  assert.match(body.error, /AnalysisBundle/);
});

test("GET /api/analysis-bundle — 인덱싱조차 되지 않은 프로젝트는 412다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "onto-bundle-wiring-noindex-"));
  scratches.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.js"), "export const a = 1;\n", "utf8");

  const { status, body } = await get(`/api/analysis-bundle?projectPath=${encodeURIComponent(dir)}`);
  assert.equal(status, 412);
  assert.match(body.error, /인덱싱/u);
});
