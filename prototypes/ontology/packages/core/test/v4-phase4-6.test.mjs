import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  applyAnalysisBundlePatch,
  buildIncrementalAnalysisPlan,
  buildSystemImpactSet,
  planDiscoveryGaps,
  reconcileSystemFactStore,
  mergeProposedSystemFacts,
} from "@onto/core";
import { indexProject } from "@onto/evidence";

import { cleanup, makeProject } from "./_helpers.mjs";

after(cleanup);

const baseEvidence = (id, status = "present", extras = {}) => ({
  id,
  kind: "call",
  origin: "agent",
  filePath: "src/app.ts",
  location: { startLine: 1, endLine: 1 },
  rawHash: "raw",
  normalizedFingerprint: "fp",
  normalizationProfile: "code",
  fileContentHash: "file",
  observedAtVersion: 2,
  status,
  ...extras,
});

const entity = {
  id: "resource:external:openai",
  ref: { kind: "resource", namespace: "external", key: "openai" },
  kind: "external",
  origin: "vibee",
  certainty: "grounded",
  evidenceRefs: ["ev:call"],
  dependsOnEvidenceRefs: ["ev:call", "ev:import"],
  status: "valid",
  firstSeenVersion: 1,
  lastValidatedVersion: 1,
};

const link = {
  id: "system-link:openai",
  from: { kind: "symbol", symbolId: "src/app.ts#answer" },
  to: entity.ref,
  kind: "external_call",
  origin: "vibee",
  certainty: "grounded",
  evidenceRefs: ["ev:call"],
  dependsOnEvidenceRefs: ["ev:call", "ev:import"],
  status: "valid",
  firstSeenVersion: 1,
  lastValidatedVersion: 1,
};

const factStore = (entities = [entity], links = [link]) => ({
  schemaVersion: 4,
  analysisVersion: 1,
  entities,
  links,
  diagnostics: [],
});

test("정확한 source 이동은 relocated이고 Vibee 재검토를 요구하지 않는다", () => {
  const evidence = {
    analysisVersion: 2,
    fileHashes: { "src/app.ts": "file" },
    evidence: [
      baseEvidence("ev:call", "present", { relocationConfidence: "exact", location: { startLine: 8, endLine: 8 } }),
      baseEvidence("ev:import"),
    ],
    adapterReport: [],
  };
  const next = reconcileSystemFactStore({
    previous: factStore(),
    evidence,
    diffs: [{ evidenceId: "ev:call", contentChange: "unchanged", relocated: true }],
  });
  assert.equal(next.entities[0].status, "relocated");
  assert.equal(next.links[0].status, "relocated");
  assert.equal(next.links[0].lastValidatedVersion, 2);
});

test("직접 call 삭제는 missing, 보조 import 삭제는 stale, 의미 변경은 needs_review다", () => {
  const missing = reconcileSystemFactStore({
    previous: factStore(),
    evidence: {
      analysisVersion: 2,
      fileHashes: {},
      evidence: [baseEvidence("ev:call", "missing"), baseEvidence("ev:import")],
      adapterReport: [],
    },
    diffs: [{ evidenceId: "ev:call", contentChange: "missing", relocated: false }],
  });
  assert.equal(missing.links[0].status, "missing");

  const stale = reconcileSystemFactStore({
    previous: factStore(),
    evidence: {
      analysisVersion: 2,
      fileHashes: {},
      evidence: [baseEvidence("ev:call"), baseEvidence("ev:import", "missing")],
      adapterReport: [],
    },
    diffs: [{ evidenceId: "ev:import", contentChange: "missing", relocated: false }],
  });
  assert.equal(stale.links[0].status, "stale");

  const modified = reconcileSystemFactStore({
    previous: factStore(),
    evidence: {
      analysisVersion: 2,
      fileHashes: {},
      evidence: [baseEvidence("ev:call"), baseEvidence("ev:import")],
      adapterReport: [],
    },
    diffs: [{ evidenceId: "ev:call", contentChange: "modified", relocated: false }],
  });
  assert.equal(modified.links[0].status, "needs_review");
});

test("같은 grounded fact의 재제안은 오래된 missing dependency를 교체해 needs_review를 해제한다", () => {
  const previous = { ...link, status: "needs_review", dependsOnEvidenceRefs: ["ev:old-missing"] };
  const candidate = { ...link, status: "valid", evidenceRefs: ["ev:new-call"], dependsOnEvidenceRefs: ["ev:new-call", "ev:new-import"], lastValidatedVersion: 2 };
  const merged = mergeProposedSystemFacts(factStore([], [previous]), { entities: [], links: [candidate] });
  assert.equal(merged.links[0].status, "valid");
  assert.deepEqual(merged.links[0].dependsOnEvidenceRefs, ["ev:new-call", "ev:new-import"]);
});

function bundle() {
  return {
    analysisVersion: 1,
    semanticVersion: 1,
    freshness: "current",
    architecture: {
      title: "system",
      components: [
        { id: "component-a", label: "A", presentationType: "backend", entityRefs: [entity.id], evidenceRefs: ["ev:call"] },
        { id: "component-b", label: "B", presentationType: "external", entityRefs: ["resource:external:other"], evidenceRefs: ["ev:other"] },
      ],
      boundaries: [],
      connections: [
        { id: "connection-a", from: "component-a", to: "component-b", systemLinkRefs: [link.id], evidenceRefs: ["ev:call"] },
      ],
    },
    workflow: {
      title: "flow",
      lanes: [{ id: "lane", label: "system", kind: "system" }],
      mainPath: ["node-a", "node-b"],
      nodes: [
        { id: "node-a", laneId: "lane", label: "A", presentationType: "backend", entityRefs: [entity.id], evidenceRefs: ["ev:call"] },
        { id: "node-b", laneId: "lane", label: "B", presentationType: "external", entityRefs: [], evidenceRefs: ["ev:other"] },
      ],
      edges: [{ id: "edge-a", from: "node-a", to: "node-b", role: "main", evidenceRefs: ["ev:call"], sequenceRef: "seq-a" }],
    },
    sequences: [{
      id: "seq-a",
      title: "call",
      triggeredByEdgeId: "edge-a",
      participants: [],
      messages: [],
      evidenceRefs: ["ev:call"],
    }],
  };
}

const memory = {
  semanticVersion: 1,
  concepts: [{ id: "concept-a", name: "A", evidenceRefs: ["ev:call"], status: "active", createdAtVersion: 1, updatedAtVersion: 1 }],
  claims: [],
  canonicalScenarios: [{ id: "scenario-a", name: "A", type: "system", anchorConceptIds: ["concept-a"], status: "active", createdAtVersion: 1, updatedAtVersion: 1 }],
};

test("SystemImpactSet은 dirty call에서 관련 fact·semantic·Bundle 조각만 닫는다", () => {
  const impact = buildSystemImpactSet({
    diffs: [{ evidenceId: "ev:call", contentChange: "modified", relocated: false }],
    facts: factStore(),
    memory,
    grounding: { conceptGroundings: [], claimGroundings: [] },
    bundle: bundle(),
  });
  assert.deepEqual(impact.systemLinkIds, [link.id]);
  assert.deepEqual(impact.conceptIds, ["concept-a"]);
  assert.deepEqual(impact.architectureConnectionIds, ["connection-a"]);
  assert.deepEqual(impact.workflowEdgeIds, ["edge-a"]);
  assert.deepEqual(impact.sequenceIds, ["seq-a"]);
  assert.equal(impact.architectureComponentIds.includes("component-b"), true, "연결 양 끝은 함께 보정한다");
});

test("이미 검토한 missing fact는 반복 dirty가 아니지만 이전 Bundle이 참조하면 계속 patch 대상이다", () => {
  const reviewed = factStore([], [{ ...link, status: "missing", lastValidatedVersion: 2 }]);
  reviewed.analysisVersion = 2;
  const detached = buildSystemImpactSet({
    diffs: [], facts: reviewed, memory: { ...memory, concepts: [], canonicalScenarios: [] },
    grounding: { conceptGroundings: [], claimGroundings: [] }, bundle: null,
  });
  assert.deepEqual(detached.systemLinkIds, []);
  const referenced = buildSystemImpactSet({
    diffs: [], facts: reviewed, memory, grounding: { conceptGroundings: [], claimGroundings: [] }, bundle: bundle(),
  });
  assert.deepEqual(referenced.systemLinkIds, [link.id]);
  assert.deepEqual(referenced.architectureConnectionIds, ["connection-a"]);
});

test("구조에 닿지 않는 CSS 변경은 provider 0회 fast path가 된다", () => {
  const impact = buildSystemImpactSet({
    diffs: [{ evidenceId: "ev:css", contentChange: "modified", relocated: false }],
    facts: factStore(),
    memory,
    grounding: { conceptGroundings: [], claimGroundings: [] },
    bundle: bundle(),
  });
  const plan = buildIncrementalAnalysisPlan({
    facts: factStore(),
    impact,
    discoveryGaps: [],
    integrationCatalog: [],
    firstAnalysis: false,
  });
  assert.equal(plan.mode, "fast-path");
  assert.equal(plan.semanticTurnRequired, false);
  assert.equal(plan.assemblyTurnRequired, false);
});

test("Bundle patch는 ImpactSet의 ID만 수정하고 범위 밖 ID를 거절한다", () => {
  const impact = {
    evidenceIds: ["ev:call"], systemEntityIds: [entity.id], systemLinkIds: [link.id], conceptIds: [], claimIds: [], scenarioIds: [],
    architectureComponentIds: ["component-a"], architectureConnectionIds: ["connection-a"], workflowNodeIds: ["node-a"], workflowEdgeIds: ["edge-a"], sequenceIds: ["seq-a"],
    discoveryRoots: [], requiresFullDiscovery: false, requiresFullAssembly: false, reasons: [],
  };
  const allowed = applyAnalysisBundlePatch(bundle(), [{ op: "replace", path: "/architecture/components/0/label", value: "A2" }], impact);
  assert.equal(allowed.bundle.architecture.components[0].label, "A2");
  const rejected = applyAnalysisBundlePatch(bundle(), [{ op: "replace", path: "/architecture/components/1/label", value: "B2" }], impact);
  assert.equal(rejected.bundle, undefined);
  assert.equal(rejected.diagnostics.some((item) => item.code === "bundle-patch/id-outside-impact"), true);
});

test("Open-world planner는 SvelteKit과 Python OpenAI import/call을 찾고 README 이름은 무시한다", () => {
  const svelte = makeProject({
    "package.json": JSON.stringify({ dependencies: { "@sveltejs/kit": "2.0.0", svelte: "5.0.0" } }),
    "src/routes/+server.ts": `import { json } from "@sveltejs/kit";\nexport const POST = () => json({ ok: true });\n`,
  });
  const svelteDiscovery = planDiscoveryGaps({ projectPath: svelte, evidence: indexProject(svelte, { analysisVersion: 1 }), facts: factStore([], []) });
  assert.equal(svelteDiscovery.catalog.some((item) => item.packageName === "@sveltejs/kit" && item.callPaths.length > 0), true);
  assert.equal(svelteDiscovery.gaps.some((item) => item.kind === "runtime-boundary"), true);

  const python = makeProject({
    "requirements.txt": "openai==1.99.0\n",
    "app.py": `from openai import OpenAI\nclient = OpenAI()\nclient.responses.create(input="hi")\n`,
    "README.md": "This project may use Stripe someday.\n",
  });
  const pythonDiscovery = planDiscoveryGaps({ projectPath: python, evidence: indexProject(python, { analysisVersion: 1 }), facts: factStore([], []) });
  assert.equal(pythonDiscovery.catalog.some((item) => item.packageName === "openai" && item.callPaths.includes("app.py")), true);
  assert.equal(pythonDiscovery.catalog.some((item) => /stripe/iu.test(item.packageName)), false);
});
