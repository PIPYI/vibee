/**
 * §7.2 S6 — 구조 검사는 hard, smoke는 warning, semantic은 리뷰 큐일 뿐이다.
 *
 * 실제 fixture(`fixtures/fixture-app/expectations.json`)와 live agent 출력에 의존하지
 * 않는다 — 이 시험은 `checkCoverage` 자체의 판정 로직만 본다. 그것은 `npm run eval`의 몫이다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkCoverage } from "./coverage.mjs";

function evidence(overrides) {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "symbol",
    origin: "engine",
    filePath: overrides.filePath,
    symbolId: overrides.symbolId,
    rawHash: "h",
    normalizedFingerprint: "f",
    normalizationProfile: "code",
    fileContentHash: "fc",
    observedAtVersion: 1,
    status: "present",
    ...(overrides.graph ? { graph: overrides.graph } : {}),
  };
}

function baseState({ concepts = [], claims = [], canonicalScenarios = [], evidenceList = [] }) {
  return {
    evidence: { evidence: evidenceList, analysisVersion: 1, fileHashes: {}, adapterReport: [] },
    memory: { semanticVersion: 1, concepts, claims, canonicalScenarios },
  };
}

const REQUEST_SYMBOL = evidence({ id: "ev-request", symbolId: "src/services/follow.js#requestFollow" });
const USER_MODEL = evidence({
  id: "ev-user-model",
  kind: "db_entity",
  filePath: "prisma/schema.prisma",
  graph: { role: "entity", entity: { kind: "model", modelKey: "prisma:User" }, label: "User" },
});

const EXPECTATIONS = {
  requiredConcepts: [
    {
      key: "follow-request",
      acceptableNames: ["팔로우 요청", "친구 신청"],
      mustGroundIn: ["src/services/follow.js#requestFollow"],
    },
    {
      key: "private-account",
      acceptableNames: ["비공개 계정"],
      mustGroundIn: ["prisma/schema.prisma#User"],
    },
  ],
  requiredClaims: [
    {
      key: "private-account→follow-request",
      subjectKey: "private-account",
      objectKey: "follow-request",
      mustGroundIn: ["src/services/follow.js#requestFollow"],
      meaningKeywords: ["승인"],
    },
  ],
  forbiddenConcepts: ["PrismaClient"],
  requiredScenarios: [{ key: "follow", mustIncludeConceptKeys: ["follow-request"] }],
};

function concept(id, name, evidenceRefs) {
  return { id, name, evidenceRefs, status: "active", createdAtVersion: 1, updatedAtVersion: 1 };
}

test("structural — 필요한 concept·claim·scenario가 전부 grounding되어 있으면 통과한다", () => {
  const state = baseState({
    evidenceList: [REQUEST_SYMBOL, USER_MODEL],
    concepts: [
      concept("cpt-follow", "팔로우 요청", ["ev-request"]),
      concept("cpt-private", "비공개 계정", ["ev-user-model"]),
    ],
    claims: [
      {
        id: "clm-1",
        subjectConceptId: "cpt-private",
        predicate: "팔로우 시 상대의 승인을 요구한다",
        object: { conceptId: "cpt-follow" },
        evidenceRefs: ["ev-request"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
    canonicalScenarios: [
      {
        id: "scn-1",
        name: "팔로우하기",
        type: "user",
        anchorConceptIds: ["cpt-follow"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
  });

  const result = checkCoverage(state, EXPECTATIONS);
  assert.deepEqual(result.hardFailures, []);
  assert.equal(result.structuralPass, true);
  assert.deepEqual(result.warnings, []);
  // §7.3 비교 표 — 전부 통과했으면 matched === total이어야 한다.
  assert.deepEqual(result.counts, {
    concepts: { matched: 2, total: 2 },
    claims: { matched: 1, total: 1 },
    forbiddenPromoted: 0,
  });
});

test("structural — 같은 subject/object 사이에 claim이 여럿이면, 그 중 하나만 grounding되어도 통과한다", () => {
  const state = baseState({
    evidenceList: [REQUEST_SYMBOL, USER_MODEL],
    concepts: [
      concept("cpt-follow", "팔로우 요청", ["ev-request"]),
      concept("cpt-private", "비공개 계정", ["ev-user-model"]),
    ],
    claims: [
      {
        // 같은 관계를 말하지만 grounding이 약한 claim이 먼저 온다 — 이것만 보면 실패해야 맞다.
        id: "clm-weak",
        subjectConceptId: "cpt-private",
        predicate: "관련된 요청 목록을 확인할 수 있다",
        object: { conceptId: "cpt-follow" },
        evidenceRefs: ["ev-user-model"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
      {
        // 같은 관계를 mustGroundIn 이 요구하는 곳에 실제로 grounding한 claim.
        id: "clm-strong",
        subjectConceptId: "cpt-private",
        predicate: "팔로우 시 상대의 승인을 요구한다",
        object: { conceptId: "cpt-follow" },
        evidenceRefs: ["ev-request"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
    canonicalScenarios: [
      {
        id: "scn-1",
        name: "팔로우하기",
        type: "user",
        anchorConceptIds: ["cpt-follow"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
  });

  const result = checkCoverage(state, EXPECTATIONS);
  assert.deepEqual(
    result.hardFailures,
    [],
    "grounding이 강한 claim이 있는데도 첫 번째(약한) claim만 보고 실패시키면 안 된다",
  );
  assert.equal(result.structuralPass, true);
});

test("structural — concept가 없으면 hard failure다", () => {
  const state = baseState({ evidenceList: [REQUEST_SYMBOL, USER_MODEL], concepts: [] });
  const result = checkCoverage(state, EXPECTATIONS);
  assert.equal(result.structuralPass, false);
  assert.ok(result.hardFailures.some((line) => line.includes("follow-request")));
  // §7.3 비교 표 — 못 찾은 concept는 matched에 들어가지 않는다 (0/1, hardFailures와 별개 축)
  assert.equal(result.counts.concepts.matched, 0);
  assert.equal(result.counts.concepts.total, 2);
});

test("structural — 이름은 맞지만 mustGroundIn evidence에 grounding되어 있지 않으면 hard failure다 (이름만으로는 통과하지 않는다)", () => {
  const state = baseState({
    evidenceList: [REQUEST_SYMBOL, USER_MODEL],
    concepts: [concept("cpt-follow", "팔로우 요청", []), concept("cpt-private", "비공개 계정", ["ev-user-model"])],
  });
  const result = checkCoverage(state, EXPECTATIONS);
  assert.equal(result.structuralPass, false);
  assert.ok(result.hardFailures.some((line) => line.includes("grounding되어 있지 않다")));
});

test("forbidden concept가 승격되면 hard failure다", () => {
  const state = baseState({
    evidenceList: [REQUEST_SYMBOL, USER_MODEL],
    concepts: [
      concept("cpt-follow", "팔로우 요청", ["ev-request"]),
      concept("cpt-private", "비공개 계정", ["ev-user-model"]),
      concept("cpt-bad", "PrismaClient", []),
    ],
  });
  const result = checkCoverage(state, EXPECTATIONS);
  assert.equal(result.structuralPass, false);
  assert.ok(result.hardFailures.some((line) => line.includes("PrismaClient")));
  assert.equal(result.counts.forbiddenPromoted, 1);
});

test("smoke — meaningKeywords가 없어도 warning일 뿐 게이트를 막지 않는다", () => {
  const state = baseState({
    evidenceList: [REQUEST_SYMBOL, USER_MODEL],
    concepts: [
      concept("cpt-follow", "팔로우 요청", ["ev-request"]),
      concept("cpt-private", "비공개 계정", ["ev-user-model"]),
    ],
    claims: [
      {
        id: "clm-1",
        subjectConceptId: "cpt-private",
        predicate: "팔로우 요청을 무시한다",
        object: { conceptId: "cpt-follow" },
        evidenceRefs: ["ev-request"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
  });
  const result = checkCoverage(state, EXPECTATIONS);
  const claimFailure = result.hardFailures.filter((line) => line.includes("private-account→follow-request"));
  assert.deepEqual(claimFailure, [], "claim 구조는 맞는데 키워드 부재만으로 hard failure가 되면 안 된다 (S6)");
  assert.ok(result.warnings.some((line) => line.includes("승인")));
});

test("semantic — predicate는 자동 판정하지 않고 리뷰 큐에만 올린다", () => {
  const state = baseState({
    evidenceList: [REQUEST_SYMBOL, USER_MODEL],
    concepts: [
      concept("cpt-follow", "팔로우 요청", ["ev-request"]),
      concept("cpt-private", "비공개 계정", ["ev-user-model"]),
    ],
    claims: [
      {
        id: "clm-1",
        subjectConceptId: "cpt-private",
        predicate: "팔로우 시 상대의 승인을 요구한다",
        object: { conceptId: "cpt-follow" },
        evidenceRefs: ["ev-request"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
    canonicalScenarios: [
      {
        id: "scn-1",
        name: "팔로우하기",
        type: "user",
        anchorConceptIds: ["cpt-follow"],
        status: "active",
        createdAtVersion: 1,
        updatedAtVersion: 1,
      },
    ],
  });
  const result = checkCoverage(state, EXPECTATIONS);
  assert.equal(result.structuralPass, true);
  assert.deepEqual(result.semanticQueue, [
    { claimKey: "private-account→follow-request", predicate: "팔로우 시 상대의 승인을 요구한다" },
  ]);
});
