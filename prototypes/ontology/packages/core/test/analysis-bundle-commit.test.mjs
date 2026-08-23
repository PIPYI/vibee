/**
 * `commitAnalysisBundle` (schema3 §5.2 Stage 4).
 *
 * `store.test.mjs`처럼 실제 디스크에 generation을 커밋한다 — 검증이 `store.commit()`의
 * mutate 클로저 **안에서** 도는 것(analysis-bundle-commit.ts 헤더 참고)이 실제로 지켜지는지,
 * 그리고 실패했을 때 generation이 전혀 만들어지지 않는지를 확인한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { SemanticStore, commitAnalysisBundle, initialProjectState } from "@onto/core";

const roots = [];

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "onto-bundle-commit-"));
  roots.push(dir);
  return dir;
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
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

const EV_ROUTE = evidenceItem("ev-route", {
  kind: "route",
  graph: { role: "entity", entity: { kind: "route", routeKey: "GET /api/x" }, label: "GET /api/x" },
});
const EV_SVC = evidenceItem("ev-svc", {
  kind: "symbol",
  graph: { role: "entity", entity: { kind: "symbol", symbolId: "svc#handle" }, label: "handle" },
});
const EV_LINK = evidenceItem("ev-link", {
  kind: "api_handler",
  graph: {
    role: "link",
    from: { kind: "route", routeKey: "GET /api/x" },
    to: { kind: "symbol", symbolId: "svc#handle" },
    linkKind: "api_handler",
  },
});

/** init 후 route/symbol/link 골격 evidence를 커밋한 store. */
async function seededStore() {
  const root = scratch();
  const store = new SemanticStore(root);
  await store.init(initialProjectState("p1", root));
  await store.commit("index", "index", (snapshot) => {
    snapshot.project.analysisVersion = 1;
    snapshot.evidence = {
      analysisVersion: 1,
      fileHashes: {},
      evidence: [EV_ROUTE, EV_SVC, EV_LINK],
      adapterReport: [],
    };
    return snapshot;
  });
  return store;
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
        {
          id: "conn-1",
          from: "comp-1",
          to: "comp-1",
          traceLinkRefs: [EV_LINK.id],
          evidenceRefs: [EV_LINK.id],
        },
      ],
    },
    workflow: { title: "워크플로우", lanes: [], mainPath: [], nodes: [], edges: [] },
    sequences: [],
  };
}

test("유효한 bundle은 커밋되고 analysisVersion/semanticVersion/freshness가 찍힌다 (§3.5)", async () => {
  const store = await seededStore();
  const before = store.load();

  const outcome = await commitAnalysisBundle(store, validBundle());
  assert.equal(outcome.ok, true, JSON.stringify(outcome.ok ? "" : outcome.diagnostics));

  const after1 = store.load();
  assert.equal(after1.generation, before.generation + 1);
  assert.equal(after1.analysisBundle.analysisVersion, after1.project.analysisVersion);
  assert.equal(after1.analysisBundle.semanticVersion, after1.project.semanticVersion);
  assert.equal(after1.analysisBundle.freshness, "current");
  assert.deepEqual(after1.analysisBundle.architecture, validBundle().architecture);
});

test("agent가 analysisVersion/semanticVersion/freshness를 함께 보내도 Core가 덮어쓴다", async () => {
  const store = await seededStore();
  const tampered = { ...validBundle(), analysisVersion: 999, semanticVersion: 999, freshness: "needs_review" };

  const outcome = await commitAnalysisBundle(store, tampered);
  assert.equal(outcome.ok, true);

  const after1 = store.load();
  assert.notEqual(after1.analysisBundle.analysisVersion, 999);
  assert.equal(after1.analysisBundle.analysisVersion, after1.project.analysisVersion);
  assert.equal(after1.analysisBundle.freshness, "current");
});

test("근거 없는 골격 연결(traceLinkRefs 비어 있음, I20)은 거절되고 generation이 만들어지지 않는다", async () => {
  const store = await seededStore();
  const before = store.load();

  const bundle = validBundle();
  bundle.architecture.connections[0].traceLinkRefs = [];

  const outcome = await commitAnalysisBundle(store, bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.diagnostics.some((d) => d.code === "bundle/connection-not-grounded-in-skeleton"));

  const after1 = store.load();
  assert.equal(after1.generation, before.generation, "실패한 커밋은 generation을 진행시키지 않는다");
  assert.equal(after1.analysisBundle, null);
});

test("실재하지 않는 evidence id를 가리키면 거절된다 — schema 검증만이 아니라 실제 EvidenceIndex와 대조한다", async () => {
  const store = await seededStore();
  const bundle = validBundle();
  bundle.architecture.components[0].evidenceRefs = ["ev-지어냄"];

  const outcome = await commitAnalysisBundle(store, bundle);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.diagnostics.some((d) => d.code === "evidence/unknown-id"));
});
