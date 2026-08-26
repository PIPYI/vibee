/**
 * **acceptance 16 · 17 의 agent 절반** (implementation_plan §6.5 S1 · §6.2 T1 · §6.9).
 *
 * > 16. 파일을 **포매팅만** 바꿔 커밋 → engine·agent evidence 모두 하나도 끊기지 않고,
 * >     contentChange 가 전부 unchanged/cosmetic 이라 dirty set 이 비어 있다
 * >     → semanticReconciledAnalysisVersion 이 커밋 1 에서 자동 advance 된다
 * > 17. 심볼의 **본문 의미**를 바꿔 커밋 → 그 evidence 가 modified 로 분류되어 dirty set 에
 * >     들어가고, grounding 된 Concept 가 할 일 목록에 나타나며, reconcile 이 advance 되지
 * >     **않는다**
 *
 * ## 왜 둘을 한 파일에 두는가
 *
 * **16 과 17 은 한 쌍으로만 의미가 있다.** 16 만 있으면 "아무것도 dirty 로 만들지 않는"
 * 구현이 통과하고, 17 만 있으면 "전부 dirty 로 만드는" 구현이 통과한다. 둘을 같이 걸어야
 * 분류가 실제로 작동한다는 뜻이 된다.
 *
 * M1 이 이미 engine 절반을 걸었다. 여기는 **agent evidence 가 재인덱싱을 살아남는가**다 —
 * 엔진이 다시 만들어 주지 않는 근거이므로 relocation 이 유일한 생존 경로다.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { AnalyzeTransaction, commitPatch } from "@onto/core";
import { isSemanticDirty } from "@onto/protocol";

import {
  cleanup,
  concept,
  diffOf,
  makeProject,
  patchWith,
  reindex,
  writeFiles,
} from "./_helpers.mjs";

after(cleanup);

const ORIGINAL = `import { prisma } from "./db.js";

export async function requestFollow(fromId, toId) {
  const target = await prisma.user.findUnique({ where: { id: toId } });
  if (target.private) {
    return prisma.followRequest.create({ data: { fromId, toId, status: "pending" } });
  }
  return prisma.follow.create({ data: { fromId, toId } });
}
`;

/** prettier 재정렬 + 따옴표 + 주석 추가 + 위쪽에 줄 하나. **의미는 그대로다.** */
const REFORMATTED = `// 팔로우 요청을 만든다
import { prisma } from './db.js';

export async function requestFollow( fromId, toId )
{
    // 비공개 계정이면 승인을 기다린다
    const target = await prisma.user.findUnique( { where: { id: toId } } );

    if ( target.private )
    {
        return prisma.followRequest.create( {
            data: { fromId, toId, status: 'pending' },
        } );
    }

    return prisma.follow.create( { data: { fromId, toId } } );
}
`;

/** 승인을 기다리지 않고 바로 관계를 만든다. **의미가 바뀌었다.** */
const MEANING_CHANGED = `import { prisma } from "./db.js";

export async function requestFollow(fromId, toId) {
  const target = await prisma.user.findUnique({ where: { id: toId } });
  if (target.private) {
    return prisma.follow.create({ data: { fromId, toId } });
  }
  return prisma.follow.create({ data: { fromId, toId } });
}
`;

const PROPOSAL = {
  kind: "policy_note",
  filePath: "src/follow.js",
  // 함수 전체. 엔진의 symbol evidence 와 같은 범위를 일부러 고른다 — 두 origin 이
  // 같은 변경에 대해 같은 판정을 내리는지 나란히 볼 수 있다.
  location: { startLine: 3, endLine: 9 },
  summary: "비공개 계정은 승인을 기다린다",
  symbolHint: "src/follow.js#requestFollow",
};

async function groundedProject() {
  const dir = makeProject({ "src/db.js": "export const prisma = {};\n", "src/follow.js": ORIGINAL });
  const first = await reindex(dir);

  const transaction = new AnalyzeTransaction(
    "task-1",
    dir,
    first.head.project.analysisVersion,
    first.head.evidence,
  );
  const proposed = transaction.propose(PROPOSAL);
  assert.equal(proposed.ok, true, JSON.stringify(proposed.diagnostics, null, 2));

  const outcome = await commitPatch(first.store, {
    head: first.head,
    transaction,
    patch: patchWith(first.head, {
      addedConcepts: [concept("c1", "팔로우 요청", [proposed.value.id])],
    }),
  });
  assert.equal(outcome.ok, true, JSON.stringify(outcome.diagnostics, null, 2));

  return { dir, store: first.store, agentEvidenceId: proposed.value.id };
}

test("acceptance 16 (agent 절반) — 포매팅만 바꾸면 agent evidence 가 끊기지 않고 dirty 도 아니다", async () => {
  const { dir, store, agentEvidenceId } = await groundedProject();
  const before = store.load();

  writeFiles(dir, { "src/follow.js": REFORMATTED });
  const { diffs, work, head, report } = await reindex(dir);

  // 1. **끊기지 않았다.** id 가 그대로이고 status 가 present 다.
  const carried = head.evidence.evidence.find((item) => item.id === agentEvidenceId);
  assert.ok(carried, "agent evidence 가 사라졌다 — 재인덱싱이 그것을 다시 만들어 주지 않는다");
  assert.equal(carried.status, "present");
  assert.equal(carried.origin, "agent");
  assert.deepEqual(
    report.relocated.map((item) => item.confidence),
    ["exact"],
    "포매팅 변경은 exact relocation 이어야 한다",
  );

  // 2. **dirty 가 아니다.** cosmetic 이 dirty 로 들어가면 prettier 한 번에 프로젝트 전체를
  //    재검토하게 된다 — §46 이 실패로 규정한 churn 이다.
  const diff = diffOf(diffs, agentEvidenceId);
  assert.ok(["unchanged", "cosmetic"].includes(diff.contentChange), diff.contentChange);
  assert.equal(isSemanticDirty(diff), false);
  assert.deepEqual(work.dirtyEvidence, [], "engine·agent 어느 쪽도 dirty 가 아니어야 한다");
  assert.deepEqual(work.affectedConceptIds, []);

  // 3. agent 를 부르지 않고 reconcile 이 따라잡는다 (V1 · §6.9 커밋 1).
  assert.equal(head.project.analysisVersion, before.project.analysisVersion + 1);
  assert.equal(head.project.semanticVersion, before.project.semanticVersion, "의미는 그대로다");
  assert.equal(
    head.project.semanticReconciledAnalysisVersion,
    head.project.analysisVersion,
    "cosmetic 분류가 값을 만들어 내는 지점이 여기다",
  );
});

test("acceptance 17 (agent 절반) — 본문 의미를 바꾸면 modified 로 분류되어 할 일이 된다", async () => {
  const { dir, store, agentEvidenceId } = await groundedProject();
  const before = store.load();

  writeFiles(dir, { "src/follow.js": MEANING_CHANGED });
  const { diffs, work, head, report } = await reindex(dir);

  // 1. id 는 살아남는다 — 같은 근거가 **바뀐 것**이지 사라진 것이 아니다.
  const carried = head.evidence.evidence.find((item) => item.id === agentEvidenceId);
  assert.ok(carried, "id 가 살아남아야 grounding 이 유지되고 재검토 대상이 된다");
  assert.equal(carried.relocationConfidence, "degraded");
  assert.deepEqual(report.relocated.map((item) => item.confidence), ["degraded"]);

  // 2. **modified 다.** 여기가 조용한 부패를 막는 자리다 (T1) — status 는 present 인데
  //    내용이 달라진 근거를 증분 루프가 영원히 들여다보지 않는 상태.
  const diff = diffOf(diffs, agentEvidenceId);
  assert.equal(diff.contentChange, "modified");
  assert.equal(isSemanticDirty(diff), true);
  assert.ok(work.dirtyEvidence.some((item) => item.evidenceId === agentEvidenceId));

  // 3. grounding 된 Concept 가 할 일 목록에 나타난다.
  assert.deepEqual(work.affectedConceptIds, ["c1"]);

  // 4. reconcile 이 advance 되지 **않는다** → 기존 View 는 지워지지 않고 needs review 가 된다.
  assert.equal(head.project.analysisVersion, before.project.analysisVersion + 1);
  assert.equal(
    head.project.semanticReconciledAnalysisVersion,
    before.project.semanticReconciledAnalysisVersion,
  );
  assert.ok(
    head.project.semanticReconciledAnalysisVersion < head.project.analysisVersion,
    "코드는 앞서 갔고 의미는 아직 따라가지 못한 상태여야 한다",
  );
});

test("engine 과 agent 가 같은 변경에 대해 같은 판정을 내린다", async () => {
  const { dir, agentEvidenceId } = await groundedProject();
  writeFiles(dir, { "src/follow.js": MEANING_CHANGED });
  const { diffs, head } = await reindex(dir);

  const symbol = head.evidence.evidence.find(
    (item) => item.kind === "symbol" && item.symbolId === "src/follow.js#requestFollow",
  );
  assert.equal(diffOf(diffs, symbol.id).contentChange, "modified", "engine 절반 (M1)");
  assert.equal(diffOf(diffs, agentEvidenceId).contentChange, "modified", "agent 절반 (M4)");
});

test("근거가 통째로 사라지면 missing 이고, 지어내서 옮기지 않는다", async () => {
  const { dir, agentEvidenceId } = await groundedProject();
  writeFiles(dir, { "src/follow.js": "export const nothing = 1;\n" });
  const { diffs, work, head } = await reindex(dir);

  const carried = head.evidence.evidence.find((item) => item.id === agentEvidenceId);
  assert.equal(carried.status, "missing");
  assert.equal(diffOf(diffs, agentEvidenceId).contentChange, "missing");
  assert.deepEqual(work.affectedConceptIds, ["c1"], "근거를 잃은 의미가 할 일이 되어야 한다");
});
