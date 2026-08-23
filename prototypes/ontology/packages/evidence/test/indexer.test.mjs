/**
 * M1 — Evidence Engine P0~P1 + ID/freshness + EvidenceDiff.
 *
 * 여기서 증명해야 하는 것은 acceptance 1 · 16(engine 절반) · 17(engine 절반) · 18c다.
 *
 * **16과 17은 한 쌍으로만 의미가 있다.** 16만 있으면 "아무것도 dirty로 만들지 않는" 구현이
 * 통과하고, 17만 있으면 "전부 dirty로 만드는" 구현이 통과한다.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { buildWorkSet, diffEvidence, indexProject, summarizeDiff } from "@onto/evidence";

const roots = [];

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function scratch(files) {
  const root = mkdtempSync(join(tmpdir(), "onto-ev-"));
  roots.push(root);
  write(root, files);
  return root;
}

function write(root, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = join(root, relPath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
}

const EMPTY_MEMORY = { semanticVersion: 0, concepts: [], claims: [], canonicalScenarios: [] };
const EMPTY_GROUNDING = { conceptGroundings: [], claimGroundings: [] };

/** 같은 caller → callee 사이에 **구별되는** 호출부가 셋 있는 fixture. */
const CALLER = `import { requestFollow } from "./follow.js";

export function handle() {
  requestFollow("a");
  requestFollow("b");
  requestFollow("c");
}
`;

const FOLLOW = `export function requestFollow(userId) {
  return { userId, status: "pending" };
}
`;

function callIds(index) {
  return index.evidence.filter((item) => item.kind === "call").map((item) => item.id).sort();
}

// ---------------------------------------------------------------------------

test("acceptance 1 — 인덱싱이 evidence를 만들고 analysisVersion 을 싣는다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const index = indexProject(root, { analysisVersion: 1 });

  assert.equal(index.analysisVersion, 1);
  assert.ok(index.evidence.length > 0);
  assert.deepEqual(Object.keys(index.fileHashes).sort(), ["src/follow.js", "src/service.js"]);
  assert.deepEqual(index.adapterReport, []);

  // P0 — file / symbol
  const files = index.evidence.filter((item) => item.kind === "file");
  assert.equal(files.length, 2);
  const symbols = index.evidence.filter((item) => item.kind === "symbol");
  assert.deepEqual(
    symbols.map((item) => item.symbolId).sort(),
    ["src/follow.js#requestFollow", "src/service.js#handle"],
  );

  // P1 — call 세 개 (구별되는 호출부)
  assert.equal(index.evidence.filter((item) => item.kind === "call").length, 3);

  // 모든 evidence 가 두 해시와 프로파일을 갖는다 (T1 이 이것 위에서 돈다)
  for (const item of index.evidence) {
    assert.ok(item.rawHash, `${item.id} 에 rawHash 가 없다`);
    assert.ok(item.normalizedFingerprint, `${item.id} 에 지문이 없다`);
    assert.ok(item.fileContentHash);
    assert.equal(item.observedAtVersion, 1);
    assert.equal(item.status, "present");
    assert.equal(item.origin, "engine");
  }

  // id 로 정렬되어 있다 — 결정론의 일부다
  const ids = index.evidence.map((item) => item.id);
  assert.deepEqual(ids, [...ids].sort());
});

test("같은 입력을 두 번 인덱싱하면 결과가 동일하다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const first = indexProject(root, { analysisVersion: 1 });
  const second = indexProject(root, { analysisVersion: 1 });
  assert.deepEqual(second.evidence, first.evidence);
});

test("로컬 데이터 자산과 그 import를 file→file 골격 링크로 인덱싱한다", () => {
  const root = scratch({
    "src/main.ts": `import missions from "../data/missions.json";\nexport const count = missions.length;\n`,
    "data/missions.json": `[{"id":1}]`,
  });
  const index = indexProject(root, { analysisVersion: 1 });

  assert.ok(index.evidence.some((item) => item.kind === "file" && item.filePath === "data/missions.json"));
  const link = index.evidence.find((item) => item.kind === "data_import");
  assert.equal(link?.graph?.role, "link");
  assert.deepEqual(link?.graph?.from, { kind: "file", filePath: "src/main.ts" });
  assert.deepEqual(link?.graph?.to, { kind: "file", filePath: "data/missions.json" });
});

test("링크 evidence 는 실재하는 entity 를 양 끝점으로 갖는다 (T2 의 P1 부분)", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const index = indexProject(root, { analysisVersion: 1 });

  const entityKeys = new Set(
    index.evidence
      .filter((item) => item.graph?.role === "entity")
      .map((item) => {
        const entity = item.graph.entity;
        return entity.kind === "file" ? `file:${entity.filePath}` : `symbol:${entity.symbolId}`;
      }),
  );

  const links = index.evidence.filter((item) => item.graph?.role === "link");
  assert.ok(links.length > 0);
  for (const link of links) {
    const from = link.graph.from;
    const to = link.graph.to;
    const fromKey = from.kind === "file" ? `file:${from.filePath}` : `symbol:${from.symbolId}`;
    const toKey = to.kind === "file" ? `file:${to.filePath}` : `symbol:${to.symbolId}`;
    assert.ok(entityKeys.has(fromKey), `${link.id} 의 from 이 실재하지 않는다: ${fromKey}`);
    assert.ok(entityKeys.has(toKey), `${link.id} 의 to 가 실재하지 않는다: ${toKey}`);
  }
});

// ---------------------------------------------------------------------------
// 16 / 17 — 쌍으로만 의미가 있다
// ---------------------------------------------------------------------------

test("acceptance 16(engine) — 포매팅만 바꾸면 dirty set 이 비고 id 가 하나도 안 바뀐다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const before = indexProject(root, { analysisVersion: 1 });

  // prettier 재정렬 + 따옴표 스타일 + 주석 추가 + 후행 콤마 + 들여쓰기
  write(root, {
    "src/follow.js": `// 팔로우 요청을 만든다.
export function requestFollow(userId) {
    return {
        userId,
        status: 'pending',
    };
}
`,
  });

  const after = indexProject(root, { analysisVersion: 2 });
  const diffs = diffEvidence(before, after);
  const summary = summarizeDiff(diffs);

  assert.equal(summary.dirty, 0, `dirty 가 있으면 안 된다: ${JSON.stringify(summary)}`);
  assert.equal(summary.contentChange.modified, 0);
  assert.equal(summary.contentChange.appeared, 0);
  assert.equal(summary.contentChange.missing, 0);
  // 바이트는 바뀌었으므로 cosmetic 이 실제로 잡혀야 한다 — 아무것도 안 본 것이 아니다.
  assert.ok(summary.contentChange.cosmetic > 0, "cosmetic 이 하나도 없으면 시험이 헛돈 것이다");

  // evidence id 가 하나도 바뀌지 않았다 (R1)
  assert.deepEqual(
    after.evidence.map((item) => item.id),
    before.evidence.map((item) => item.id),
  );

  const work = buildWorkSet(diffs, EMPTY_MEMORY, EMPTY_GROUNDING);
  assert.deepEqual(work.dirtyEvidence, []);
  assert.deepEqual(work.ungroundedAppearedEvidenceIds, []);
});

test("acceptance 17(engine) — 본문 의미를 바꾸면 modified 로 잡혀 dirty set 에 들어간다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const before = indexProject(root, { analysisVersion: 1 });

  // id 는 그대로 살아남는 변경 — 이름도 시그니처도 그대로이고 본문 의미만 바뀐다.
  write(root, {
    "src/follow.js": `export function requestFollow(userId) {
  return { userId, status: "accepted" };
}
`,
  });

  const after = indexProject(root, { analysisVersion: 2 });
  const diffs = diffEvidence(before, after);

  const symbolId = "src/follow.js#requestFollow";
  const symbolEvidence = after.evidence.find((item) => item.symbolId === symbolId && item.kind === "symbol");
  const symbolDiff = diffs.find((diff) => diff.evidenceId === symbolEvidence.id);

  assert.equal(symbolDiff.contentChange, "modified");

  const work = buildWorkSet(diffs, EMPTY_MEMORY, EMPTY_GROUNDING);
  assert.ok(
    work.dirtyEvidence.some((diff) => diff.evidenceId === symbolEvidence.id),
    "의미가 바뀐 evidence 가 dirty set 에 없다 — 조용한 부패다",
  );

  // id 는 살아남는다. 주소가 그대로이기 때문이다.
  assert.ok(before.evidence.some((item) => item.id === symbolEvidence.id));
});

test("17 — grounding 된 Concept 가 할 일 목록에 나타난다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const before = indexProject(root, { analysisVersion: 1 });
  write(root, {
    "src/follow.js": `export function requestFollow(userId) {
  return { userId, status: "accepted" };
}
`,
  });
  const after = indexProject(root, { analysisVersion: 2 });
  const diffs = diffEvidence(before, after);

  const symbolEvidence = after.evidence.find(
    (item) => item.kind === "symbol" && item.symbolId === "src/follow.js#requestFollow",
  );

  const memory = {
    ...EMPTY_MEMORY,
    concepts: [
      {
        id: "cpt-follow-request",
        name: "팔로우 요청",
        evidenceRefs: [symbolEvidence.id],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
    canonicalScenarios: [
      {
        id: "scn-follow",
        name: "팔로우하기",
        type: "user",
        anchorConceptIds: ["cpt-follow-request"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
  };

  const work = buildWorkSet(diffs, memory, EMPTY_GROUNDING);
  assert.deepEqual(work.affectedConceptIds, ["cpt-follow-request"]);
  assert.deepEqual(work.affectedScenarioIds, ["scn-follow"]);
});

test("acceptance 18 — 심볼을 삭제하면 그 evidence만 missing이 되고, grounding된 Concept가 할 일 목록에 나타난다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const before = indexProject(root, { analysisVersion: 1 });

  const symbolEvidence = before.evidence.find(
    (item) => item.kind === "symbol" && item.symbolId === "src/follow.js#requestFollow",
  );
  assert.ok(symbolEvidence, "fixture 에 requestFollow 심볼 evidence 가 있어야 시험이 성립한다");

  // 심볼을 삭제한다 (파일 자체는 남는다 — "그 evidence만" missing 이어야 한다).
  write(root, { "src/follow.js": `export const FOLLOW_MODULE = true;\n` });
  const after = indexProject(root, { analysisVersion: 2 });
  const diffs = diffEvidence(before, after);

  const symbolDiff = diffs.find((diff) => diff.evidenceId === symbolEvidence.id);
  assert.equal(symbolDiff.contentChange, "missing", "삭제된 심볼은 missing 이어야 한다");

  const memory = {
    ...EMPTY_MEMORY,
    concepts: [
      {
        id: "cpt-follow-request",
        name: "팔로우 요청",
        evidenceRefs: [symbolEvidence.id],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
  };

  const work = buildWorkSet(diffs, memory, EMPTY_GROUNDING);
  assert.deepEqual(
    work.affectedConceptIds,
    ["cpt-follow-request"],
    "근거를 잃은 Concept 가 할 일 목록에 나타나지 않는다 — missing 도 dirty 에 기여해야 한다(U1)",
  );
  assert.ok(
    work.dirtyEvidence.some((diff) => diff.evidenceId === symbolEvidence.id && diff.contentChange === "missing"),
  );
});

// ---------------------------------------------------------------------------
// 18b / 18c
// ---------------------------------------------------------------------------

test("acceptance 18b — 기능 파일을 새로 추가하면 ungroundedAppearedEvidenceIds 가 채워진다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const before = indexProject(root, { analysisVersion: 1 });

  write(root, {
    "src/notification.js": `export function notifyFollowRequest(userId) {
  return { userId, kind: "follow_request" };
}
`,
  });

  const after = indexProject(root, { analysisVersion: 2 });
  const diffs = diffEvidence(before, after);
  const work = buildWorkSet(diffs, EMPTY_MEMORY, EMPTY_GROUNDING);

  // 기존 의미에 걸린 것이 하나도 없어도 할 일이 생겨야 한다 — 새 기능 발견 (U1)
  assert.deepEqual(work.affectedConceptIds, []);
  assert.ok(
    work.ungroundedAppearedEvidenceIds.length > 0,
    "새 파일이 통째로 들어왔는데 할 일 목록이 비어 있다 — 새 기능을 놓친다",
  );
  const appearedSymbol = after.evidence.find(
    (item) => item.kind === "symbol" && item.symbolId === "src/notification.js#notifyFollowRequest",
  );
  assert.ok(work.ungroundedAppearedEvidenceIds.includes(appearedSymbol.id));
});

test("acceptance 18c — 앞쪽에 호출부를 추가해도 기존 call evidence id 가 그대로다", () => {
  const root = scratch({ "src/follow.js": FOLLOW, "src/service.js": CALLER });
  const before = indexProject(root, { analysisVersion: 1 });
  const idsBefore = callIds(before);
  assert.equal(idsBefore.length, 3);

  // **앞쪽에** 새 호출부 하나를 끼워 넣는다. ordinal 기반 id 였다면 셋 다 밀린다.
  write(root, {
    "src/service.js": `import { requestFollow } from "./follow.js";

export function handle() {
  requestFollow("z");
  requestFollow("a");
  requestFollow("b");
  requestFollow("c");
}
`,
  });

  const after = indexProject(root, { analysisVersion: 2 });
  const idsAfter = callIds(after);

  assert.equal(idsAfter.length, 4);
  for (const id of idsBefore) {
    assert.ok(idsAfter.includes(id), `기존 call evidence id 가 사라졌다: ${id}`);
  }

  const diffs = diffEvidence(before, after);
  const callDiffs = diffs.filter((diff) => idsAfter.includes(diff.evidenceId));
  const appeared = callDiffs.filter((diff) => diff.contentChange === "appeared");
  const missing = diffs.filter((diff) => diff.contentChange === "missing");

  assert.equal(appeared.length, 1, "새로 생긴 것은 하나여야 한다");
  assert.equal(missing.length, 0, "기존 호출부가 사라진 것으로 잡히면 안 된다");

  // 기존 셋은 위치만 밀렸다 — 내용은 그대로다.
  const shifted = callDiffs.filter((diff) => idsBefore.includes(diff.evidenceId));
  assert.equal(shifted.length, 3);
  for (const diff of shifted) {
    assert.equal(diff.contentChange, "unchanged");
    assert.equal(diff.relocated, true, "위치는 실제로 밀렸으므로 relocated 여야 한다");
  }
});

test("V3 — contentChange 와 relocated 는 독립이다", () => {
  const root = scratch({ "src/follow.js": FOLLOW });
  const before = indexProject(root, { analysisVersion: 1 });

  // 위에 줄만 늘린다: 내용 그대로 + 위치 이동
  write(root, {
    "src/follow.js": `const UNRELATED = 1;
const ALSO_UNRELATED = 2;

${FOLLOW}`,
  });
  const after = indexProject(root, { analysisVersion: 2 });
  const diffs = diffEvidence(before, after);

  const symbolEvidence = after.evidence.find(
    (item) => item.kind === "symbol" && item.symbolId === "src/follow.js#requestFollow",
  );
  const diff = diffs.find((item) => item.evidenceId === symbolEvidence.id);

  assert.equal(diff.contentChange, "unchanged", "내용은 그대로다");
  assert.equal(diff.relocated, true, "위치는 바뀌었다");
  // 두 축이 독립이므로 이 조합이 표현된다. 단일 enum 이었다면 불가능하다.
});
