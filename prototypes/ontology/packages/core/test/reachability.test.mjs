/**
 * M12 — projectReachability (schema2 §6). Trace(§6.6)와 같은 결정론 보장을 authored
 * reachability에도 요구한다: 같은 anchor+direction은 항상 같은 결과, anchor에서 authored
 * edge로 실제 도달 가능한 것만 나온다, direction을 뒤집으면 결과가 뒤집힌다.
 *
 * evidence를 손으로 만든다 — trace.test.mjs와 같은 이유다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { projectReachability } from "@onto/core";

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

function missingSymbolEntity(name) {
  const item = symbolEntity(name);
  item.status = "missing";
  return item;
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
const nodeIds = (ir) => ir.nodes.map((n) => n.id).sort();

// a → b → c → d 체인
function chainIndex() {
  return indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    symbolEntity("d"),
    callLink("a", "b"),
    callLink("b", "c"),
    callLink("c", "d"),
  );
}

test("같은 anchor+direction을 두 번 투영하면 바이트 단위로 동일하다", () => {
  const index = chainIndex();
  const first = projectReachability(index, anchor("b"), "downstream");
  const second = projectReachability(index, anchor("b"), "downstream");
  assert.deepEqual(first, second);
});

test("downstream — anchor에서 outgoing edge로 도달 가능한 것만 나온다", () => {
  const ir = projectReachability(chainIndex(), anchor("b"), "downstream");
  assert.deepEqual(nodeIds(ir), ["symbol:src/x.ts#b", "symbol:src/x.ts#c", "symbol:src/x.ts#d"]);
});

test("upstream — anchor로 향하는 incoming edge로 도달 가능한 것만 나온다", () => {
  const ir = projectReachability(chainIndex(), anchor("c"), "upstream");
  assert.deepEqual(nodeIds(ir), ["symbol:src/x.ts#a", "symbol:src/x.ts#b", "symbol:src/x.ts#c"]);
});

test("direction을 뒤집으면 결과가 뒤집힌다", () => {
  const index = chainIndex();
  const down = projectReachability(index, anchor("b"), "downstream");
  const up = projectReachability(index, anchor("b"), "upstream");
  assert.notDeepEqual(nodeIds(down), nodeIds(up));
  assert.deepEqual(nodeIds(down), ["symbol:src/x.ts#b", "symbol:src/x.ts#c", "symbol:src/x.ts#d"]);
  assert.deepEqual(nodeIds(up), ["symbol:src/x.ts#a", "symbol:src/x.ts#b"]);
});

test("anchor 필드는 요청 자체를 나타낸다 — BFS가 우연히 처음 찾은 entity가 아니다", () => {
  const ir = projectReachability(chainIndex(), anchor("b"), "downstream");
  assert.equal(ir.anchor, "symbol:src/x.ts#b");
});

test("hop은 anchor로부터의 거리다", () => {
  const ir = projectReachability(chainIndex(), anchor("a"), "downstream");
  const hopOf = (id) => ir.nodes.find((n) => n.id === `symbol:src/x.ts#${id}`).hop;
  assert.equal(hopOf("a"), 0);
  assert.equal(hopOf("b"), 1);
  assert.equal(hopOf("c"), 2);
  assert.equal(hopOf("d"), 3);
});

test("hops 옵션으로 거리를 제한할 수 있다", () => {
  const ir = projectReachability(chainIndex(), anchor("a"), "downstream", { hops: 1 });
  assert.deepEqual(nodeIds(ir), ["symbol:src/x.ts#a", "symbol:src/x.ts#b"]);
});

test("ceiling을 넘으면 hop 경계에서 접히고 truncatedAtHop이 사실을 말한다", () => {
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    symbolEntity("d"),
    symbolEntity("e"),
    callLink("a", "b"),
    callLink("a", "c"),
    callLink("a", "d"),
    callLink("a", "e"),
  );
  const ir = projectReachability(index, anchor("a"), "downstream", { ceiling: 2 });
  assert.equal(ir.truncatedAtHop, 1);
  assert.deepEqual(nodeIds(ir), ["symbol:src/x.ts#a"]);
});

test("missing 상태인 evidence는 그래프에 들어가지 않는다", () => {
  const index = indexOf(
    symbolEntity("a"),
    missingSymbolEntity("b"),
    symbolEntity("c"),
    callLink("a", "b"),
    callLink("b", "c"),
  );
  const ir = projectReachability(index, anchor("a"), "downstream");
  assert.deepEqual(nodeIds(ir), ["symbol:src/x.ts#a"]);
});

test("두 노드 사이 authored edge는 hop 관계와 무관하게 links에 나온다", () => {
  // a → b, a → c, b → c. downstream(a)는 {a,b,c} 전부 도달 가능하고 b→c 엣지도 authored다.
  const index = indexOf(
    symbolEntity("a"),
    symbolEntity("b"),
    symbolEntity("c"),
    callLink("a", "b"),
    callLink("a", "c"),
    callLink("b", "c"),
  );
  const ir = projectReachability(index, anchor("a"), "downstream");
  const hasLink = (from, to) =>
    ir.links.some((l) => l.fromId === `symbol:src/x.ts#${from}` && l.toId === `symbol:src/x.ts#${to}`);
  assert.ok(hasLink("a", "b"));
  assert.ok(hasLink("a", "c"));
  assert.ok(hasLink("b", "c"));
});

test("memory를 넘기면 역 grounding으로 conceptRefs가 채워진다", () => {
  const a = symbolEntity("a");
  const index = indexOf(a, symbolEntity("b"), callLink("a", "b"));
  const memory = {
    semanticVersion: 1,
    concepts: [{ id: "cpt-1", name: "A", evidenceRefs: [a.id], status: "active", createdAtVersion: 1, updatedAtVersion: 1 }],
    claims: [],
    canonicalScenarios: [],
  };
  const ir = projectReachability(index, anchor("a"), "downstream", { memory });
  const nodeA = ir.nodes.find((n) => n.id === "symbol:src/x.ts#a");
  assert.deepEqual(nodeA.conceptRefs, ["cpt-1"]);
});

test("memory를 안 넘기면 conceptRefs는 항상 빈 배열이다", () => {
  const ir = projectReachability(chainIndex(), anchor("a"), "downstream");
  assert.ok(ir.nodes.every((n) => Array.isArray(n.conceptRefs) && n.conceptRefs.length === 0));
});

test("도달할 수 없는 노드는 나오지 않는다 (분리된 컴포넌트)", () => {
  const index = indexOf(symbolEntity("a"), symbolEntity("b"), symbolEntity("isolated"), callLink("a", "b"));
  const ir = projectReachability(index, anchor("a"), "downstream");
  assert.ok(!nodeIds(ir).includes("symbol:src/x.ts#isolated"));
});
