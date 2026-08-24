import assert from "node:assert/strict";
import { after, test } from "node:test";

import { AnalyzeTransaction, commitPatch } from "@onto/core";

import { cleanup, codesOf, makeProject, patchWith, reindex } from "./_helpers.mjs";

after(cleanup);

const PYTHON = `from openai import OpenAI

client = OpenAI()
structured = client.responses.parse(model="gpt-5", input="question")
answer = client.responses.create(model="gpt-5", input="grounded context")
`;

async function setup() {
  const dir = makeProject({ "app.py": PYTHON, "requirements.txt": "openai>=1.0\n" });
  const { store, head } = await reindex(dir);
  const transaction = new AnalyzeTransaction(
    "v4-phase2",
    dir,
    head.project.analysisVersion,
    head.evidence,
    head.systemFacts,
  );
  return { dir, store, head, transaction };
}

function openAiProposal(baseAnalysisVersion) {
  return {
    baseAnalysisVersion,
    anchors: [
      { localId: "dep", kind: "dependency", filePath: "requirements.txt", location: { startLine: 1 }, summary: "OpenAI package dependency", normalizationProfile: "prose" },
      { localId: "import", kind: "import", filePath: "app.py", location: { startLine: 1 }, summary: "OpenAI client import" },
      { localId: "parse-call", kind: "call", filePath: "app.py", location: { startLine: 4 }, summary: "Responses parse call" },
      { localId: "create-call", kind: "call", filePath: "app.py", location: { startLine: 5 }, summary: "Responses create call" },
    ],
    entities: [
      { localId: "answerer", ref: { kind: "symbol", symbolId: "app.py#answer" }, kind: "service", anchorLocalIds: ["parse-call", "create-call"], certainty: "grounded" },
      { localId: "openai", ref: { kind: "resource", namespace: "external", key: "openai-responses" }, kind: "external", anchorLocalIds: ["dep", "import"], certainty: "grounded" },
    ],
    links: [
      { localId: "parse", from: { localId: "answerer" }, to: { localId: "openai" }, kind: "external-sdk-call", mechanism: "responses.parse", anchorLocalIds: ["parse-call"], dependencyAnchorLocalIds: ["dep", "import"], certainty: "grounded" },
      { localId: "create", from: { localId: "answerer" }, to: { localId: "openai" }, kind: "external-sdk-call", mechanism: "responses.create", anchorLocalIds: ["create-call"], dependencyAnchorLocalIds: ["dep", "import"], certainty: "grounded" },
    ],
  };
}

test("Phase 2 — 기존 index에 없는 OpenAI entity와 두 call link를 Semantic Patch와 원자 커밋한다", async () => {
  const { store, head, transaction } = await setup();
  const before = store.load();
  const proposed = transaction.proposeSystemFacts(openAiProposal(head.project.analysisVersion));
  assert.equal(proposed.ok, true, JSON.stringify(proposed.diagnostics, null, 2));
  assert.equal(Object.keys(proposed.value.linkIds).length, 2);
  assert.notEqual(proposed.value.linkIds.parse, proposed.value.linkIds.create);
  assert.deepEqual(proposed.value.downgradedFactLocalIds, []);

  const committed = await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head),
  });
  assert.equal(committed.ok, true, JSON.stringify(committed.diagnostics, null, 2));
  assert.equal(committed.value.committedSystemLinkIds.length, 2);

  const afterState = store.load();
  assert.equal(afterState.generation, before.generation + 1);
  const external = afterState.systemFacts.entities.find((item) => item.id === proposed.value.entityIds.openai);
  assert.equal(external?.origin, "vibee");
  assert.equal(external?.certainty, "grounded");
  assert.equal(afterState.systemFacts.links.filter((item) => item.origin === "vibee").length, 2);
  for (const link of afterState.systemFacts.links.filter((item) => item.origin === "vibee")) {
    assert.equal(link.certainty, "grounded");
    assert.equal(link.status, "valid");
    assert.ok(link.evidenceRefs.length > 0);
  }
});

test("Phase 2 — 존재하지 않는 파일이나 endpoint가 있으면 batch 전체가 pending에 들어가지 않는다", async () => {
  const { head, transaction } = await setup();
  const invalidFile = openAiProposal(head.project.analysisVersion);
  invalidFile.anchors[0].filePath = "missing.txt";
  const first = transaction.proposeSystemFacts(invalidFile);
  assert.equal(first.ok, false);
  assert.ok(codesOf(first.diagnostics).includes("proposal/file-missing"));
  assert.equal(transaction.pendingEvidence.length, 0);
  assert.equal(transaction.pendingSystemEntities.length, 0);
  assert.equal(transaction.pendingSystemLinks.length, 0);

  const invalidEndpoint = openAiProposal(head.project.analysisVersion);
  invalidEndpoint.links[0].to = { entityId: "resource:external:not-real" };
  const second = transaction.proposeSystemFacts(invalidEndpoint);
  assert.equal(second.ok, false);
  assert.ok(codesOf(second.diagnostics).includes("system-fact/unresolved-endpoint"));
  assert.equal(transaction.pendingEvidence.length, 0);
  assert.equal(transaction.pendingSystemEntities.length, 0);
  assert.equal(transaction.pendingSystemLinks.length, 0);
});

test("Phase 2 — config만 있고 실제 call이 없는 external link는 inferred/needs_review로 강등한다", async () => {
  const { head, transaction } = await setup();
  const proposal = openAiProposal(head.project.analysisVersion);
  proposal.links = [{
    localId: "config-only",
    from: { localId: "answerer" },
    to: { localId: "openai" },
    kind: "external-sdk-call",
    mechanism: "configured-only",
    anchorLocalIds: ["dep"],
    dependencyAnchorLocalIds: ["import"],
    certainty: "grounded",
  }];
  const outcome = transaction.proposeSystemFacts(proposal);
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));
  assert.deepEqual(outcome.value.downgradedFactLocalIds, ["config-only"]);
  assert.ok(codesOf(outcome.diagnostics).includes("system-fact/source-contract-downgraded"));
  assert.equal(transaction.pendingSystemLinks[0].certainty, "inferred");
  assert.equal(transaction.pendingSystemLinks[0].status, "needs_review");
});

test("Phase 2 — 사용되지 않은 entity/anchor 제안은 진단에 남는다", async () => {
  const { head, transaction } = await setup();
  const proposal = openAiProposal(head.project.analysisVersion);
  proposal.anchors.push({ localId: "unused-anchor", kind: "config", filePath: "app.py", location: { startLine: 2 }, summary: "unused" });
  proposal.entities.push({ localId: "unused-entity", ref: { kind: "resource", namespace: "external", key: "unused" }, kind: "external", anchorLocalIds: [], certainty: "inferred" });
  const outcome = transaction.proposeSystemFacts(proposal);
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));
  assert.ok(codesOf(outcome.diagnostics).includes("system-fact/unused-proposal"));
  assert.deepEqual(outcome.value.unusedLocalIds, ["anchor:unused-anchor", "entity:unused-entity"]);
});

test("Phase 2 — runtime은 manifest/config/entrypoint 중 하나만 있으면 inferred로 강등한다", async () => {
  const { head, transaction } = await setup();
  const proposal = {
    baseAnalysisVersion: head.project.analysisVersion,
    anchors: [{ localId: "manifest", kind: "manifest", filePath: "requirements.txt", location: { startLine: 1 }, summary: "runtime dependency", normalizationProfile: "prose" }],
    entities: [{ localId: "runtime", ref: { kind: "resource", namespace: "runtime", key: "python-app" }, kind: "runtime", anchorLocalIds: ["manifest"], certainty: "grounded" }],
    links: [],
  };
  const outcome = transaction.proposeSystemFacts(proposal);
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));
  assert.deepEqual(outcome.value.downgradedFactLocalIds, ["runtime"]);
  assert.equal(transaction.pendingSystemEntities[0].certainty, "inferred");
});
