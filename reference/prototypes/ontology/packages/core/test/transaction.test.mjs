/**
 * AnalyzeTransaction — **acceptance 8** 과 T3 (implementation_plan §6.5 S2 · §6.3 T3).
 *
 * > 8. propose_evidence 가 analysisVersion 을 올리지 **않는다**, 그리고 같은 turn 의 patch 가
 * >    stale-base 로 거절되지 **않는다** (self-deadlock 없음)
 *
 * 8 은 두 조각을 **함께** 걸어야 뜻이 있다. 버전이 오르지 않는 것만 보면 "제안을 아예
 * 저장하지 않는" 구현이 통과하고, patch 가 통과하는 것만 보면 제안이 버전을 올렸는지
 * 알 수 없다. 둘을 같이 걸어야 S2 가 실제로 도는 것이 된다.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  AnalyzeSession,
  AnalyzeTransaction,
  MAX_TRANSACTION_RESTARTS,
  commitPatch,
} from "@onto/core";
import { indexProject } from "@onto/evidence";
import { eventsPath } from "@onto/protocol/node";

import { claim, cleanup, codesOf, concept, makeProject, patchWith, reindex } from "./_helpers.mjs";

after(cleanup);

/** 엔진이 모델링하지 못하는 정책 — `propose_evidence` 가 있는 이유 그 자체다 (R2). */
const POLICY = `# 팔로우 정책

비공개 계정은 팔로우 시 승인을 요구한다.
공개 계정은 즉시 관계가 생긴다.
`;

const FOLLOW = `export async function requestFollow(fromId, toId) {
  return { fromId, toId, status: "pending" };
}
`;

async function setup(taskId = "task-1") {
  const dir = makeProject({ "src/follow.js": FOLLOW, "docs/policy.md": POLICY });
  const { store, head } = await reindex(dir);
  const transaction = new AnalyzeTransaction(taskId, dir, head.project.analysisVersion, head.evidence);
  return { dir, store, head, transaction };
}

const PROPOSAL = {
  kind: "policy_note",
  filePath: "docs/policy.md",
  location: { startLine: 3, endLine: 4 },
  summary: "비공개 계정 팔로우는 승인을 요구한다는 정책",
};

// ---------------------------------------------------------------------------
// acceptance 8
// ---------------------------------------------------------------------------

test("acceptance 8 — 제안은 analysisVersion 을 올리지 않고, 같은 turn 의 patch 가 통과한다", async () => {
  const { store, head, transaction } = await setup();
  const beforeState = store.load();

  const proposed = transaction.propose(PROPOSAL);
  assert.equal(proposed.ok, true, JSON.stringify(proposed.diagnostics, null, 2));
  const evidenceId = proposed.value.id;

  // (a) 버전도 generation 도 오르지 않았다. Trace cache 가 통째로 무효가 될 이유가 없다.
  const afterPropose = store.load();
  assert.equal(afterPropose.project.analysisVersion, beforeState.project.analysisVersion);
  assert.equal(afterPropose.generation, beforeState.generation);
  assert.equal(proposed.value.observedAtVersion, transaction.baseAnalysisVersion);

  // (b) 검증된 제안은 **이 task 안에서 즉시 읽히고 grounding 할 수 있다.**
  assert.ok(transaction.findEvidence(evidenceId), "get_evidence 가 pendingEvidence 를 봐야 한다");
  assert.ok(transaction.visibleEvidence().some((item) => item.id === evidenceId));

  // (c) 같은 turn 의 patch 가 stale-base 로 거절되지 않는다 — self-deadlock 이 없다.
  const outcome = await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, {
      addedConcepts: [concept("c1", "팔로우 승인 정책", [evidenceId])],
    }),
  });
  assert.equal(
    codesOf(outcome.diagnostics).includes("version/stale-base"),
    false,
    "제안이 자기 turn 의 patch 를 stale 로 만들었다 — S2 가 막으려던 self-deadlock 이다",
  );
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));

  // (d) 제안은 patch 와 **하나의 generation** 으로 함께 커밋된다 (§5 T4).
  const committed = store.load();
  assert.equal(committed.generation, beforeState.generation + 1, "generation 이 하나만 늘어야 한다");
  const stored = committed.evidence.evidence.find((item) => item.id === evidenceId);
  assert.ok(stored, "pendingEvidence 가 커밋되지 않았다");
  assert.equal(stored.origin, "agent");
  assert.equal(committed.project.analysisVersion, beforeState.project.analysisVersion);
  assert.equal(committed.project.semanticVersion, beforeState.project.semanticVersion + 1);
});

test("patch 가 참조하지 않은 제안은 버리되 events.ndjson 에 남긴다 (S2)", async () => {
  const { dir, store, head, transaction } = await setup("task-unused");
  const used = transaction.propose(PROPOSAL);
  const unused = transaction.propose({ ...PROPOSAL, location: { startLine: 1, endLine: 1 } });
  assert.equal(used.ok, true);
  assert.equal(unused.ok, true);

  const outcome = await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, { addedConcepts: [concept("c1", "팔로우 승인 정책", [used.value.id])] }),
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));
  assert.deepEqual(outcome.value.unusedProposalIds, [unused.value.id]);

  const committed = store.load();
  assert.equal(
    committed.evidence.evidence.some((item) => item.id === unused.value.id),
    false,
    "쓰이지 않은 제안이 저장되면 안 된다",
  );
  const log = readFileSync(eventsPath(dir), "utf8");
  assert.match(log, /evidence\/proposed-unused/u);
  assert.match(log, new RegExp(unused.value.id.replace(/[:]/gu, "[:]"), "u"));
  assert.ok(existsSync(eventsPath(dir)));
});

// ---------------------------------------------------------------------------
// T3 — race 가 나면 transaction 을 버리고 같은 session 에서 새로 연다
// ---------------------------------------------------------------------------

test("T3 — race 후 같은 session 에서 새 baseAnalysisVersion 으로 새 transaction 이 열린다", async () => {
  const { dir, store, head } = await setup("task-race");
  const session = new AnalyzeSession("task-race", dir, {
    baseAnalysisVersion: head.project.analysisVersion,
    index: head.evidence,
  });
  const proposed = session.transaction.propose(PROPOSAL);
  assert.equal(proposed.ok, true);

  // 바깥에서 참조 파일이 바뀐다 → 커밋 직전 재확인(⑤)이 막는다.
  writeFileSync(join(dir, "docs/policy.md"), `${POLICY}\n승인은 24시간 안에 처리한다.\n`, "utf8");
  const blocked = await commitPatch(store, {
    head,
    transaction: session.transaction,
    patch: patchWith(head, {
      addedConcepts: [concept("c1", "팔로우 승인 정책", [proposed.value.id])],
    }),
  });
  assert.equal(blocked.ok, false);
  assert.ok(codesOf(blocked.diagnostics).includes("evidence/file-changed-during-turn"));

  const previous = session.transaction;
  const restarted = session.restartAfterRace(["docs/policy.md"], () => {
    // 커밋 1 과 **같은 종류의 transition** 이다 — analysisVersion 만 오른다.
    const reindexed = indexAgain(dir);
    return { baseAnalysisVersion: reindexed.version, index: reindexed.index };
  });

  assert.equal(restarted.ok, true);
  assert.equal(previous.status, "aborted");
  assert.equal(previous.pendingEvidence.length, 0, "pendingEvidence 를 전부 버려야 한다");
  assert.equal(restarted.value.taskId, "task-race", "session 은 유지된다 (B2)");
  assert.equal(
    restarted.value.baseAnalysisVersion,
    head.project.analysisVersion + 1,
    "새 transaction 은 새 analysisVersion 에 묶인다",
  );
  assert.equal(restarted.value.pendingEvidence.length, 0, "제안을 자동으로 옮겨 주지 않는다");

  // agent 에게 넘길 것 — 진단과 **버려진 제안의 요약**.
  assert.equal(restarted.diagnostics[0].code, "evidence/file-changed-during-turn");
  assert.deepEqual(
    session.lastDiscarded.map((item) => item.id),
    [proposed.value.id],
  );
});

test("T3 — 재시작은 3회까지다. 넘으면 열지 않고 사람에게 말한다", async () => {
  const { dir, head } = await setup("task-limit");
  const session = new AnalyzeSession("task-limit", dir, {
    baseAnalysisVersion: head.project.analysisVersion,
    index: head.evidence,
  });

  let version = head.project.analysisVersion;
  const reopen = () => ({ baseAnalysisVersion: ++version, index: head.evidence });

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RESTARTS; attempt += 1) {
    const outcome = session.restartAfterRace(["docs/policy.md"], reopen);
    assert.equal(outcome.ok, true, `${attempt}회차가 실패했다`);
    assert.equal(session.restartCount, attempt);
  }

  const overflow = session.restartAfterRace(["docs/policy.md"], reopen);
  assert.equal(overflow.ok, false);
  assert.deepEqual(codesOf(overflow.diagnostics), ["transaction/restart-limit"]);
  assert.match(overflow.diagnostics[0].message, /저장을 멈추고/u);
});

test("성공한 커밋 뒤에도 transaction 은 열려 있다 — 같은 turn 에서 더 제안하고 더 제출할 수 있다", async () => {
  const { store, head, transaction } = await setup("task-multi");

  const firstProposal = transaction.propose(PROPOSAL);
  assert.equal(firstProposal.ok, true);
  const firstCommit = await commitPatch(store, {
    head,
    transaction,
    patch: patchWith(head, {
      addedConcepts: [concept("c1", "팔로우 승인 정책", [firstProposal.value.id])],
    }),
  });
  assert.equal(firstCommit.ok, true, JSON.stringify(firstCommit.diagnostics, null, 2));

  // transaction 은 "하나의 patch" 가 아니라 "하나의 analysisVersion" 에 묶인다 (S2) —
  // analysisVersion 이 바뀌지 않았으므로 같은 turn 에서 계속 쓸 수 있어야 한다.
  assert.equal(transaction.status, "open", "성공한 커밋이 transaction 을 닫으면 안 된다");

  const secondProposal = transaction.propose({
    ...PROPOSAL,
    location: { startLine: 1, endLine: 1 },
  });
  assert.equal(
    secondProposal.ok,
    true,
    "transaction 이 닫혀 있으면 여기서 transaction/not-open 으로 실패한다",
  );

  const secondHead = store.load();
  const secondCommit = await commitPatch(store, {
    head: secondHead,
    transaction,
    patch: patchWith(secondHead, {
      addedConcepts: [
        concept("c2", "팔로우 관계", [secondProposal.value.id]),
      ],
    }),
  });
  assert.equal(secondCommit.ok, true, JSON.stringify(secondCommit.diagnostics, null, 2));
  assert.deepEqual(transaction.committedGenerations, [firstCommit.value.generation, secondCommit.value.generation]);

  const final = store.load();
  assert.equal(final.memory.concepts.length, 2);
  assert.equal(final.project.semanticVersion, head.project.semanticVersion + 2);
});

test("같은 근거를 두 번 제안해도 pendingEvidence 는 하나다 — id 가 곧 주소이자 지문이다", async () => {
  const { transaction } = await setup("task-dup");
  const first = transaction.propose(PROPOSAL);
  const second = transaction.propose(PROPOSAL);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.value.id, first.value.id);
  assert.equal(transaction.pendingEvidence.length, 1);
});

// ---------------------------------------------------------------------------

/** 시험이 직접 인덱싱한다 — bridge 의 재인덱싱 경로와 **같은 함수**를 쓴다. */
function indexAgain(dir) {
  const version = 2;
  return { version, index: indexProject(dir, { analysisVersion: version }) };
}
