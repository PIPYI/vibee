/**
 * Validator ⓪~⑤ — **acceptance 6 · 9 · 10** (implementation_plan §6.3).
 *
 * > 6.  모든 evidenceRefs 가 present 상태의 실재 evidence 를 가리킨다 (허구 Grounding 0)
 * > 9.  stale base 로 보낸 patch 가 version/stale-base 로 거절된다
 * > 10. 커밋 직전에 참조 파일을 바꾸면 evidence/file-changed-during-turn 으로 **쓰기가
 * >     일어나지 않는다**
 *
 * ⓪과 ⑤가 막는 것이 다르다는 점이 이 파일의 요지다 — ⓪은 **우리 자신의** 동시 쓰기를,
 * ⑤는 **바깥에서** 일어난 파일 변경을 막는다.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { AnalyzeTransaction, commitPatch, validatePatch } from "@onto/core";

import { claim, cleanup, codesOf, concept, makeProject, patchWith, reindex } from "./_helpers.mjs";

after(cleanup);

const FOLLOW = `import { prisma } from "./db.js";

export async function requestFollow(fromId, toId) {
  const target = await prisma.user.findUnique({ where: { id: toId } });
  if (target.private) {
    return prisma.followRequest.create({ data: { fromId, toId, status: "pending" } });
  }
  return prisma.follow.create({ data: { fromId, toId } });
}
`;

async function setup() {
  const dir = makeProject({ "src/db.js": "export const prisma = {};\n", "src/follow.js": FOLLOW });
  const { store, head } = await reindex(dir);
  const transaction = new AnalyzeTransaction("task-1", dir, head.project.analysisVersion, head.evidence);
  const symbol = head.evidence.evidence.find(
    (item) => item.kind === "symbol" && item.symbolId === "src/follow.js#requestFollow",
  );
  assert.ok(symbol, "fixture 에 requestFollow 심볼 evidence 가 있어야 한다");
  return { dir, store, head, transaction, symbolId: symbol.id };
}

// ---------------------------------------------------------------------------
// acceptance 6 — 허구 Grounding 0
// ---------------------------------------------------------------------------

test("acceptance 6 — 지어낸 evidence id 를 가리키는 patch 를 거절한다", async () => {
  const { head, transaction } = await setup();
  const patch = patchWith(head, {
    addedConcepts: [concept("c1", "팔로우 요청", ["ev:symbol:내가지어낸것"])],
  });

  const { diagnostics } = validatePatch({ head, transaction, patch });
  assert.ok(codesOf(diagnostics).includes("evidence/unknown-id"));
  // 진단이 **어느 Concept 의 몇 번째 ref** 인지 말해야 다음 시도에서 같은 곳을 고친다 (A3).
  const failure = diagnostics.find((item) => item.code === "evidence/unknown-id");
  assert.match(failure.message, /addedConcepts\/0 \(id: "c1"\) \/evidenceRefs\/0/u);
});

test("V4 Phase 5 — 증분 Semantic Patch는 SystemImpactSet 밖의 신규 의미를 거절한다", async () => {
  const { head, transaction, symbolId } = await setup();
  const emptyImpact = {
    evidenceIds: [], systemEntityIds: [], systemLinkIds: [], conceptIds: [], claimIds: [], scenarioIds: [],
    architectureComponentIds: [], architectureConnectionIds: [], workflowNodeIds: [], workflowEdgeIds: [], sequenceIds: [],
    discoveryRoots: [], requiresFullDiscovery: false, requiresFullAssembly: false, reasons: [],
  };
  const patch = patchWith(head, { addedConcepts: [concept("outside", "범위 밖", [symbolId])] });
  const rejected = validatePatch({ head, transaction, patch, impactSet: emptyImpact });
  assert.ok(codesOf(rejected.diagnostics).includes("semantic-patch/new-item-outside-impact"));

  const allowed = validatePatch({
    head,
    transaction,
    patch,
    impactSet: { ...emptyImpact, evidenceIds: [symbolId] },
  });
  assert.equal(codesOf(allowed.diagnostics).includes("semantic-patch/new-item-outside-impact"), false);
});

test("acceptance 6 — missing 이 된 근거를 새로 가리키면 거절한다", async () => {
  const { dir, head, transaction, symbolId } = await setup();

  // 심볼을 지운다 → 다음 인덱싱에서 그 evidence 는 missing 이 된다.
  writeFileSync(join(dir, "src/follow.js"), "export const nothing = 1;\n", "utf8");
  const second = await reindex(dir);
  const staleTransaction = new AnalyzeTransaction(
    "task-2",
    dir,
    second.head.project.analysisVersion,
    second.head.evidence,
  );

  const patch = patchWith(second.head, { addedConcepts: [concept("c1", "팔로우 요청", [symbolId])] });
  const { diagnostics } = validatePatch({ head: second.head, transaction: staleTransaction, patch });

  assert.ok(codesOf(diagnostics).includes("evidence/not-present"));
  assert.ok(head && transaction);
});

test("acceptance 6 — 커밋된 상태에는 허구 ref 가 하나도 없다", async () => {
  const { store, head, transaction, symbolId } = await setup();
  const patch = patchWith(head, {
    addedConcepts: [concept("c1", "팔로우 요청", [symbolId])],
    addedClaims: [
      claim("m1", "c1", "비공개 계정을 팔로우하면 승인을 기다린다", { value: "승인 대기" }, [symbolId]),
    ],
  });

  const outcome = await commitPatch(store, { head, transaction, patch });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));

  const committed = store.load();
  const present = new Set(
    committed.evidence.evidence.filter((item) => item.status === "present").map((item) => item.id),
  );
  const refs = [
    ...committed.memory.concepts.flatMap((item) => item.evidenceRefs),
    ...committed.memory.claims.flatMap((item) => item.evidenceRefs),
    ...committed.grounding.conceptGroundings.flatMap((item) => item.evidenceRefs),
    ...committed.grounding.claimGroundings.flatMap((item) => item.evidenceRefs),
  ];
  assert.ok(refs.length > 0, "검사할 ref 가 있어야 의미가 있다");
  for (const ref of refs) assert.ok(present.has(ref), `허구 ref: ${ref}`);

  // 커밋 2 — 인덱스는 그대로, 의미만 오른다. reconcile 이 따라잡는다 (§6.9).
  assert.equal(committed.project.analysisVersion, head.project.analysisVersion);
  assert.equal(committed.project.semanticVersion, head.project.semanticVersion + 1);
  assert.equal(
    committed.project.semanticReconciledAnalysisVersion,
    committed.project.analysisVersion,
  );
});

// ---------------------------------------------------------------------------
// acceptance 9 — stale base
// ---------------------------------------------------------------------------

test("acceptance 9 — stale base 로 보낸 patch 를 version/stale-base 로 거절한다", async () => {
  const { head, transaction, symbolId } = await setup();
  const patch = patchWith(head, {
    baseSemanticVersion: head.project.semanticVersion + 1,
    addedConcepts: [concept("c1", "팔로우 요청", [symbolId])],
  });

  const { diagnostics } = validatePatch({ head, transaction, patch });
  assert.deepEqual(codesOf(diagnostics), ["version/stale-base"]);
  // R3 — base → head 의 SemanticDiff 를 함께 실어야 agent 가 전부 다시 읽지 않고 rebase 한다.
  assert.ok(diagnostics[0].evidence.semanticDiff, "거절 응답에 semanticDiff 가 있어야 한다");
});

test("acceptance 9 — baseAnalysisVersion 이 뒤처져도 거절한다 (재인덱싱이 끼어든 경우)", async () => {
  const { dir, head, transaction, symbolId } = await setup();

  // T3 의 재인덱싱이나 다른 창의 인덱싱이 끼어들면 analysisVersion 만 오른다.
  const second = await reindex(dir);
  const patch = patchWith(head, { addedConcepts: [concept("c1", "팔로우 요청", [symbolId])] });

  const { diagnostics } = validatePatch({ head: second.head, transaction, patch });
  assert.deepEqual(codesOf(diagnostics), ["version/stale-base"]);
  assert.equal(
    diagnostics[0].evidence.patchBaseAnalysisVersion,
    head.project.analysisVersion,
    "무엇과 무엇이 어긋났는지 말해야 agent 가 rebase 할 수 있다",
  );
  assert.equal(diagnostics[0].evidence.headAnalysisVersion, second.head.project.analysisVersion);
});

test("⓪ — transaction 의 base 와 patch 의 base 가 어긋나도 거절한다 (하나의 transaction = 하나의 analysisVersion)", async () => {
  const { dir, head, symbolId } = await setup();
  const second = await reindex(dir);
  // transaction 은 새 인덱스에 열렸는데 patch 는 옛 base 를 들고 왔다.
  const fresh = new AnalyzeTransaction("task-t3", dir, second.head.project.analysisVersion, second.head.evidence);
  const patch = patchWith(second.head, {
    baseAnalysisVersion: head.project.analysisVersion,
    addedConcepts: [concept("c1", "팔로우 요청", [symbolId])],
  });

  const { diagnostics } = validatePatch({ head: second.head, transaction: fresh, patch });
  assert.deepEqual(codesOf(diagnostics), ["version/stale-base"]);
  assert.match(diagnostics[0].message, /transaction 의 base/u);
});

test("acceptance 9 — 실제로 앞서 나간 head 에 대해서도 거절하고, 그 사이의 변경을 알려준다", async () => {
  const { store, head, transaction, symbolId } = await setup();

  // 다른 turn 이 먼저 커밋했다.
  const first = await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, { addedConcepts: [concept("c1", "팔로우 요청", [symbolId])] }),
  });
  assert.equal(first.ok, true);

  // 우리는 아직 옛 head 를 들고 있다.
  const stale = new AnalyzeTransaction("task-9", head.project.projectId ?? "x", head.project.analysisVersion, head.evidence);
  const { diagnostics } = validatePatch({
    head: store.load(),
    transaction: stale,
    patch: patchWith(head, { addedConcepts: [concept("c2", "팔로우 관계", [symbolId])] }),
  });

  assert.deepEqual(codesOf(diagnostics), ["version/stale-base"]);
  assert.deepEqual(diagnostics[0].evidence.semanticDiff.conceptsAdded, ["c1"]);
});

// ---------------------------------------------------------------------------
// acceptance 10 — 커밋 직전 working-tree race (S3)
// ---------------------------------------------------------------------------

test("acceptance 10 — 커밋 직전에 참조 파일이 바뀌면 아무것도 쓰지 않는다", async () => {
  const { dir, store, head, transaction, symbolId } = await setup();
  const before = store.load();

  const patch = patchWith(head, { addedConcepts: [concept("c1", "팔로우 요청", [symbolId])] });
  // ⓪~④ 는 통과하는 patch 다. 여기서 막히면 이 시험이 증명하는 것이 달라진다.
  assert.equal(
    codesOf(validatePatch({ head, transaction, patch }).diagnostics).includes("evidence/unknown-id"),
    false,
  );

  // **바깥에서** 파일이 바뀐다 — 사용자의 format-on-save, git checkout, 다른 도구.
  writeFileSync(join(dir, "src/follow.js"), `${FOLLOW}\nexport const extra = 1;\n`, "utf8");

  const outcome = await commitPatch(store, { head, transaction, patch });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("evidence/file-changed-during-turn"));
  assert.deepEqual(
    outcome.diagnostics.find((item) => item.code === "evidence/file-changed-during-turn").evidence
      .changedFiles,
    ["src/follow.js"],
  );

  // **쓰기가 일어나지 않았다.** generation 도 semanticVersion 도 그대로다.
  const after = store.load();
  assert.equal(after.generation, before.generation);
  assert.equal(after.project.semanticVersion, before.project.semanticVersion);
  assert.equal(after.memory.concepts.length, 0);
});

test("acceptance 10 — 참조하지 않은 파일이 바뀐 것은 막지 않는다 (전체 재스캔이 아니다)", async () => {
  const { dir, store, head, transaction, symbolId } = await setup();
  writeFileSync(join(dir, "src/db.js"), "export const prisma = { changed: true };\n", "utf8");

  const outcome = await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, { addedConcepts: [concept("c1", "팔로우 요청", [symbolId])] }),
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));
});

// ---------------------------------------------------------------------------
// ③ Grounding · ④ Stability
// ---------------------------------------------------------------------------

test("③ — Claim 은 근거 없이 설 수 없다", async () => {
  const { head, transaction, symbolId } = await setup();
  const { diagnostics } = validatePatch({
    head,
    transaction,
    patch: patchWith(head, {
      addedConcepts: [concept("c1", "팔로우 요청", [symbolId])],
      addedClaims: [claim("m1", "c1", "승인을 요구한다", { value: "yes" }, [])],
    }),
  });
  assert.ok(codesOf(diagnostics).includes("grounding/claim-ungrounded"));
});

test('③ — Concept 는 status "uncertain" 일 때만 근거 없이 설 수 있다', async () => {
  const { head, transaction } = await setup();
  const ungrounded = validatePatch({
    head,
    transaction,
    patch: patchWith(head, { addedConcepts: [concept("c1", "팔로우 요청", [])] }),
  });
  assert.ok(codesOf(ungrounded.diagnostics).includes("grounding/concept-ungrounded"));

  const uncertain = validatePatch({
    head,
    transaction,
    patch: patchWith(head, {
      addedConcepts: [concept("c1", "팔로우 요청", [], { status: "uncertain" })],
    }),
  });
  assert.equal(codesOf(uncertain.diagnostics).includes("grounding/concept-ungrounded"), false);
});

test("③ — Concept 를 지우면서 그것을 가리키는 Claim 을 남기면 거절한다 (적용 결과를 검사한다)", async () => {
  const { store, head, transaction, symbolId } = await setup();
  const first = await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, {
      addedConcepts: [concept("c1", "팔로우 요청", [symbolId]), concept("c2", "팔로우 관계", [symbolId])],
      addedClaims: [claim("m1", "c1", "승인되면 관계가 된다", { conceptId: "c2" }, [symbolId])],
    }),
  });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));

  const next = store.load();
  const second = new AnalyzeTransaction("task-3", transaction.projectPath, next.project.analysisVersion, next.evidence);
  const { diagnostics } = validatePatch({
    head: next,
    transaction: second,
    patch: patchWith(next, { removedConceptIds: ["c2"] }),
  });
  assert.ok(codesOf(diagnostics).includes("grounding/unknown-concept"));
});

test("④ — 같은 이름의 Concept 를 새로 만들면 재사용 후보를 warning 으로 알려준다 (막지는 않는다)", async () => {
  const { store, head, transaction, symbolId } = await setup();
  await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, { addedConcepts: [concept("c1", "팔로우 요청", [symbolId])] }),
  });

  const next = store.load();
  const second = new AnalyzeTransaction("task-4", transaction.projectPath, next.project.analysisVersion, next.evidence);
  const outcome = await commitPatch(store, {
    head: next,
    transaction: second,
    patch: patchWith(next, { addedConcepts: [concept("c9", "팔로우 요청", [symbolId])] }),
  });

  // **판단은 AI 다** — 경고는 하지만 커밋은 된다 (I1).
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));
  const warning = outcome.diagnostics.find((item) => item.code === "identity/reuse-candidate");
  assert.ok(warning, "재사용 후보를 알려주지 않았다");
  assert.equal(warning.severity, "warning");
  assert.equal(warning.subject.candidateId, "c1");
});

test("④ — 이미 있는 id 로 added 를 보내면 거절한다 (갱신이면 updated 로)", async () => {
  const { store, head, transaction, symbolId } = await setup();
  await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, { addedConcepts: [concept("c1", "팔로우 요청", [symbolId])] }),
  });

  const next = store.load();
  const second = new AnalyzeTransaction("task-5", transaction.projectPath, next.project.analysisVersion, next.evidence);
  const { diagnostics } = validatePatch({
    head: next,
    transaction: second,
    patch: patchWith(next, { addedConcepts: [concept("c1", "다른 이름", [symbolId])] }),
  });
  assert.ok(codesOf(diagnostics).includes("patch/duplicate-id"));
});
