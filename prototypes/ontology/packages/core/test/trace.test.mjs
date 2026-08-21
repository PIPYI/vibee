/**
 * M2 — projectTrace (implementation_plan §6.6 S4 · T2 · U2).
 *
 * acceptance 12 · 13 · 13b · 14.
 *
 * evidence를 손으로 만든다 — 인덱서를 거치면 무엇이 그래프에 들어갔는지가 흐려지고,
 * cycle/DAG 같은 **정확한 모양**을 만들 수 없다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { projectTrace } from "@onto/core";

let seq = 0;

function symbolEntity(name) {
  seq += 1;
  return {
    id: `ev:symbol:${name}`,
    kind: "symbol",
    origin: "engine",
    filePath: "src/x.ts",
    symbolId: `src/x.ts#${name}`,
    rawHash: `raw-${name}`,
    normalizedFingerprint: `fp-${name}`,
    normalizationProfile: "code",
    graph: { role: "entity", entity: { kind: "symbol", symbolId: `src/x.ts#${name}` }, label: name },
    fileContentHash: "file-hash",
    observedAtVersion: 1,
    status: "present",
  };
}

function callLink(from, to, tag = "") {
  seq += 1;
  return {
    id: `ev:call:${from}->${to}${tag}`,
    kind: "call",
    origin: "engine",
    filePath: "src/x.ts",
    rawHash: `raw-${seq}`,
    normalizedFingerprint: `fp-${seq}`,
    normalizationProfile: "code",
    graph: {
      role: "link",
      from: { kind: "symbol", symbolId: `src/x.ts#${from}` },
      to: { kind: "symbol", symbolId: `src/x.ts#${to}` },
      linkKind: "call",
    },
    fileContentHash: "file-hash",
    observedAtVersion: 1,
    status: "present",
  };
}

function indexOf(...evidence) {
  return {
    analysisVersion: 1,
    fileHashes: { "src/x.ts": "file-hash" },
    evidence: [...evidence].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    adapterReport: [],
  };
}

const anchor = (name) => ({ kind: "symbol", symbolId: `src/x.ts#${name}` });
const linkFor = (ir, from, to) =>
  ir.links.find((link) => link.fromId === `symbol:src/x.ts#${from}` && link.toId === `symbol:src/x.ts#${to}`);

// ---------------------------------------------------------------------------

test("acceptance 12 — 같은 anchor 를 두 번 투영하면 바이트 단위로 동일하다", () => {
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    symbolEntity("d"),
    callLink("a", "b"),
    callLink("a", "c"),
    callLink("b", "d"),
    callLink("c", "d"),
  );

  const first = projectTrace(index, anchor("a"), { hops: 3 });
  const second = projectTrace(index, anchor("a"), { hops: 3 });
  assert.equal(JSON.stringify(second), JSON.stringify(first));

  // evidence 배열 순서를 뒤집어도 결과가 같아야 한다 — 순회 순서에 의존하지 않는다는 뜻이다.
  const shuffled = { ...index, evidence: [...index.evidence].reverse() };
  const third = projectTrace(shuffled, anchor("a"), { hops: 3 });
  assert.equal(JSON.stringify(third), JSON.stringify(first));
});

test("acceptance 13b — DAG 에서 nonForward 는 붙지만 cycle 은 붙지 않는다", () => {
  // A→B, A→C, B→C — DAG 다. hop(C)=1 <= hop(B)=1 이라 hop 비교만으로는 cycle 로 오판한다.
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    callLink("a", "b"),
    callLink("a", "c"),
    callLink("b", "c"),
  );

  const ir = projectTrace(index, anchor("a"), { hops: 3 });

  const bc = linkFor(ir, "b", "c");
  assert.ok(bc, "B→C 엣지가 있어야 한다");
  assert.equal(bc.nonForward, true, "hop(C) <= hop(B) 이므로 레이아웃상 앞으로 가지 않는다");
  assert.equal(bc.cycle, undefined, "그러나 이 그래프는 DAG 다 — cycle 이 붙으면 안 된다");

  // 어떤 엣지에도 cycle 이 붙지 않아야 한다.
  assert.deepEqual(ir.links.filter((link) => link.cycle), []);
  // SCC 가 전부 크기 1 이므로 sccId 도 없다.
  assert.deepEqual(ir.codeEntities.filter((entity) => entity.sccId), []);
});

test("acceptance 13 — 상호 재귀에서 종료하고 SCC 로 cycle 을 판정한다", () => {
  // a → b → c → b  (b, c 가 서로 맞물린다). d 는 바깥에 있다.
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    symbolEntity("d"),
    callLink("a", "b"),
    callLink("b", "c"),
    callLink("c", "b"),
    callLink("c", "d"),
  );

  const first = projectTrace(index, anchor("a"), { hops: 5 });
  const second = projectTrace(index, anchor("a"), { hops: 5 });

  // 1. 종료한다 (여기 도달했다는 것 자체가 증거다) 그리고 결정론이다.
  assert.equal(JSON.stringify(second), JSON.stringify(first));

  // 2. b, c 가 같은 SCC 에 묶인다.
  const b = first.codeEntities.find((entity) => entity.id === "symbol:src/x.ts#b");
  const c = first.codeEntities.find((entity) => entity.id === "symbol:src/x.ts#c");
  assert.ok(b.sccId, "b 가 SCC 에 속해야 한다");
  assert.equal(b.sccId, c.sccId, "b 와 c 가 같은 컴포넌트여야 한다");

  // 3. 그 안의 엣지 둘 다 cycle 이다 — 방향과 무관하게.
  assert.equal(linkFor(first, "b", "c").cycle, true);
  assert.equal(linkFor(first, "c", "b").cycle, true);

  // 4. 바깥으로 나가는 엣지는 cycle 이 아니다.
  assert.equal(linkFor(first, "c", "d").cycle, undefined);
  assert.equal(linkFor(first, "a", "b").cycle, undefined);

  // 5. cycle 과 nonForward 는 별개다 — c→b 는 둘 다지만 b→c 는 cycle 만이다.
  assert.equal(linkFor(first, "c", "b").nonForward, true);
  assert.equal(linkFor(first, "b", "c").nonForward, undefined);
});

test("13 — self-loop 는 selfLoop 와 cycle 을 함께 받는다", () => {
  const index = indexOf(symbolEntity("a"), symbolEntity("b"), callLink("a", "b"), callLink("b", "b"));
  const ir = projectTrace(index, anchor("a"), { hops: 3 });
  const loop = linkFor(ir, "b", "b");
  assert.equal(loop.selfLoop, true);
  assert.equal(loop.cycle, true);
  // 크기 1 SCC 이므로 sccId 는 붙지 않는다 — 묶어서 보여줄 것이 없다.
  const b = ir.codeEntities.find((entity) => entity.id === "symbol:src/x.ts#b");
  assert.equal(b.sccId, undefined);
});

test("acceptance 14 — 같은 쌍의 호출부 여러 개가 엣지 하나 + refs 여러 개로 접힌다", () => {
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    callLink("a", "b", ":1"),
    callLink("a", "b", ":2"),
    callLink("a", "b", ":3"),
  );

  const ir = projectTrace(index, anchor("a"), { hops: 2 });

  const edges = ir.links.filter((link) => link.toId === "symbol:src/x.ts#b");
  assert.equal(edges.length, 1, "엣지는 하나여야 한다");
  assert.deepEqual(edges[0].evidenceRefs, [
    "ev:call:a->b:1",
    "ev:call:a->b:2",
    "ev:call:a->b:3",
  ]);
});

test("acceptance 14 — 끝점이 실재하지 않는 링크는 그래프에 들어가지 않는다", () => {
  // b entity 가 없다. 링크만 있다.
  const index = indexOf(symbolEntity("a"), callLink("a", "b"));
  const ir = projectTrace(index, anchor("a"), { hops: 3 });

  assert.deepEqual(ir.links, []);
  assert.deepEqual(
    ir.codeEntities.map((entity) => entity.id),
    ["symbol:src/x.ts#a"],
  );
});

test("기본 순회는 양방향이되 링크 방향은 코드에 있는 그대로다", () => {
  // caller → target. anchor 는 target 이다.
  const index = indexOf(symbolEntity("caller"), symbolEntity("target"), callLink("caller", "target"));

  const both = projectTrace(index, anchor("target"), { hops: 2 });
  assert.equal(both.codeEntities.length, 2, "역방향으로 caller 를 찾아야 한다");
  const link = both.links[0];
  assert.equal(link.fromId, "symbol:src/x.ts#caller", "방향을 뒤집지 않는다");
  assert.equal(link.toId, "symbol:src/x.ts#target");

  const outgoingOnly = projectTrace(index, anchor("target"), { hops: 2, direction: "outgoing" });
  assert.equal(outgoingOnly.codeEntities.length, 1, "outgoing 만 보면 caller 가 보이지 않는다");

  const incomingOnly = projectTrace(index, anchor("target"), { hops: 2, direction: "incoming" });
  assert.equal(incomingOnly.codeEntities.length, 2);
});

test("hop 은 BFS 최단 거리이고 절단은 hop 경계에서 일어난다", () => {
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    symbolEntity("d"),
    callLink("a", "b"),
    callLink("b", "c"),
    callLink("a", "c"), // c 로 가는 지름길 — 최단 거리는 1 이다
    callLink("c", "d"),
  );

  const ir = projectTrace(index, anchor("a"), { hops: 3 });
  const hopOf = (name) =>
    ir.codeEntities.find((entity) => entity.id === `symbol:src/x.ts#${name}`).hop;
  assert.equal(hopOf("a"), 0);
  assert.equal(hopOf("b"), 1);
  assert.equal(hopOf("c"), 1, "지름길이 있으므로 최단 거리는 1 이다");
  assert.equal(hopOf("d"), 2);

  // ceiling 을 넘기면 hop 경계에서 접고 그 사실을 남긴다.
  const truncated = projectTrace(index, anchor("a"), { hops: 3, ceiling: 3 });
  assert.equal(truncated.truncatedAtHop, 2);
  assert.equal(truncated.codeEntities.length, 3, "hop 1 까지만 남는다");
  assert.ok(truncated.codeEntities.every((entity) => entity.hop <= 1));
});

test("hops 를 넘어가는 노드는 들어오지 않는다", () => {
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    callLink("a", "b"),
    callLink("b", "c"),
  );
  const ir = projectTrace(index, anchor("a"), { hops: 1 });
  assert.deepEqual(
    ir.codeEntities.map((entity) => entity.id),
    ["symbol:src/x.ts#a", "symbol:src/x.ts#b"],
  );
});

test("missing evidence 는 그래프에 들어가지 않는다", () => {
  const gone = { ...symbolEntity("b"), status: "missing", missingSinceVersion: 2 };
  const index = indexOf(symbolEntity("a"), gone, callLink("a", "b"));
  const ir = projectTrace(index, anchor("a"), { hops: 3 });

  assert.deepEqual(
    ir.codeEntities.map((entity) => entity.id),
    ["symbol:src/x.ts#a"],
    "없어진 코드를 있는 것처럼 그리면 안 된다",
  );
  assert.deepEqual(ir.links, []);
});
