import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { SemanticStore, buildV4RolloutReport, initialProjectState } from "@onto/core";
import { parseSystemIntelligenceV4Mode } from "@onto/protocol/bridge-config";

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function emptyImpact() {
  return {
    evidenceIds: [], systemEntityIds: [], systemLinkIds: [], conceptIds: [], claimIds: [], scenarioIds: [],
    architectureComponentIds: [], architectureConnectionIds: [], workflowNodeIds: [], workflowEdgeIds: [], sequenceIds: [],
    discoveryRoots: [], requiresFullDiscovery: false, requiresFullAssembly: false, reasons: [],
  };
}

test("Phase 8 feature flag는 off/shadow/on만 허용하고 잘못된 값은 on으로 안전하게 수렴한다", () => {
  assert.equal(parseSystemIntelligenceV4Mode("off"), "off");
  assert.equal(parseSystemIntelligenceV4Mode("shadow"), "shadow");
  assert.equal(parseSystemIntelligenceV4Mode("on"), "on");
  assert.equal(parseSystemIntelligenceV4Mode("unexpected"), "on");
});

test("Phase 8 shadow report는 같은 snapshot의 V3 투영보다 Vibee-grounded 외부 연동 증가를 계측한다", () => {
  const externalRef = { kind: "resource", namespace: "external", key: "novel-ai" };
  const facts = {
    schemaVersion: 4, analysisVersion: 2, diagnostics: [],
    entities: [{ id: "entity-external", ref: externalRef, kind: "external", origin: "vibee", certainty: "grounded", evidenceRefs: ["ev-call"], dependsOnEvidenceRefs: ["ev-call"], status: "valid", firstSeenVersion: 1, lastValidatedVersion: 2 }],
    links: [{ id: "link-external", from: { kind: "symbol", symbolId: "src/app.ts#answer" }, to: externalRef, kind: "external_call", origin: "vibee", certainty: "grounded", evidenceRefs: ["ev-call"], dependsOnEvidenceRefs: ["ev-call"], status: "valid", firstSeenVersion: 1, lastValidatedVersion: 2 }],
  };
  const bundle = {
    analysisVersion: 2, semanticVersion: 1, freshness: "current",
    architecture: {
      title: "system",
      components: [
        { id: "local", label: "App", presentationType: "backend", entityRefs: ["symbol:src/app.ts#answer"], evidenceRefs: ["ev-call"] },
        { id: "external", label: "Novel AI", presentationType: "external", entityRefs: ["resource:external:novel-ai"], evidenceRefs: ["ev-call"] },
      ],
      boundaries: [], connections: [{ id: "call", from: "local", to: "external", systemLinkRefs: ["link-external"], evidenceRefs: ["ev-call"] }],
    },
    workflow: { title: "flow", lanes: [], mainPath: [], nodes: [], edges: [] },
    userMap: { title: "journeys", journeys: [{ id: "journey", name: "ask", type: "user", participants: [], steps: [{ id: "step", label: "ask", conceptRefs: [], evidenceRefs: ["ev-call"] }], transitions: [], entryStepId: "step", outcomeStepIds: ["step"] }] },
    sequences: [],
  };
  const impact = emptyImpact();
  const plan = {
    mode: "incremental", semanticTurnRequired: true, assemblyTurnRequired: true, fullDiscovery: false, fullAssembly: false,
    reason: "외부 SDK 호출 변경", impact, discoveryGaps: [], integrationCatalog: [],
    previousSystemDigest: { analysisVersion: 1, entityCount: 2, linkCount: 1, reusableEntityIds: ["entity-local"], reusableLinkIds: [], reviewEntityIds: [], reviewLinkIds: ["link-external"], impact },
  };
  const task = { taskId: "task", agent: "codex", projectPath: "/project", mode: "assembly", prompt: "", status: "completed", startedAt: "2026-08-24T00:00:00.000Z", endedAt: "2026-08-24T00:00:02.000Z", mcpCalls: [], exploredFiles: [], tokenUsage: 120, stageSessions: [{ stage: "semantic", sessionId: "s1", resumed: false, startedAt: "2026-08-24T00:00:00.000Z" }, { stage: "assembly", sessionId: "s2", resumed: false, startedAt: "2026-08-24T00:00:01.000Z" }] };
  const report = buildV4RolloutReport({ task, plan, featureMode: "shadow", generation: 7, analysisVersion: 2, semanticVersion: 1, facts, bundle, endedAt: task.endedAt });
  assert.equal(report.providerTurns, 2);
  assert.equal(report.v4.externalIntegrations, 1);
  assert.equal(report.v3Projection.externalIntegrations, 0);
  assert.equal(report.deltas.externalIntegrations, 1);
  assert.equal(report.v4.ungroundedConnections, 0);
  assert.equal(report.transitionReady, true);
});

test("Phase 8 rollback은 HEAD를 뒤로 돌리지 않고 과거 상태를 새 generation으로 복원한다", async () => {
  const root = mkdtempSync(join(tmpdir(), "onto-v4-rollback-"));
  roots.push(root);
  const store = new SemanticStore(root);
  await store.init(initialProjectState("project", "rollback"));
  await store.commit("advance", "index", (snapshot) => {
    snapshot.project.analysisVersion = 1;
    snapshot.evidence.analysisVersion = 1;
    snapshot.systemFacts.analysisVersion = 1;
    return snapshot;
  });
  const restored = await store.restoreGeneration(1);
  assert.equal(restored.generation, 3);
  assert.equal(restored.project.analysisVersion, 0);
  assert.deepEqual(restored.versions.map((item) => item.generation), [1, 2, 3]);
  assert.equal(restored.versions.at(-1).source, "rollback");
  assert.equal(store.readHead().generation, 3);
});
