/**
 * `computeClusteredArchitectureIR` — v2 §4-1. "전체 구조" 탭이 쓰는 노드 클러스터링이
 * exact-match가 아니라 Jaccard 유사도 threshold + Union-Find로 근사 중복까지 잡아내는지,
 * threshold 미만은 안 합치는지, `excludeFromClustering`(펼치기)과 `MIN_CLUSTER_SIZE`(소규모
 * tier는 억지로 안 합침)가 제대로 동작하는지 검증한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeClusteredArchitectureIR } from "../src/layout/architectureClustering.ts";

function component(id, presentationType = "unknown") {
  return { id, label: id, presentationType, entityRefs: [], evidenceRefs: [] };
}

function connection(from, to, id = `${from}-${to}`) {
  return { id, from, to, traceLinkRefs: [], evidenceRefs: [] };
}

function ir(components, connections, boundaries = []) {
  return { title: "아키텍처", components, boundaries, connections };
}

test("이웃 집합이 완전히 같지 않아도 Jaccard 유사도가 threshold 이상이면 클러스터링된다", () => {
  // s1/s2/s3는 공통 서비스 3개(shared-1..3)는 같이 부르지만 각자 고유한 서비스도 하나씩
  // 더 부른다 — 이웃 집합 크기 4, 교집합 3, 합집합 5 → 유사도 3/5=0.6으로 정확히 threshold.
  // exact-match였다면 절대 안 합쳐졌을 케이스다.
  const screens = ["s1", "s2", "s3"];
  const shared = ["shared-1", "shared-2", "shared-3"];
  const unique = ["unique-s1", "unique-s2", "unique-s3"];
  const components = [...screens, ...shared, ...unique].map((id) => component(id));
  const connections = screens.flatMap((s, i) => [
    ...shared.map((sv) => connection(s, sv)),
    connection(s, unique[i]),
  ]);
  const { ir: clusteredIr, clusters } = computeClusteredArchitectureIR(ir(components, connections));

  const clusterEntries = [...clusters.entries()].filter(([, members]) => members.some((m) => screens.includes(m.id)));
  assert.equal(clusterEntries.length, 1);
  const [clusterId, members] = clusterEntries[0];
  assert.deepEqual(
    members.map((m) => m.id).sort(),
    screens,
  );
  assert.ok(clusteredIr.components.some((c) => c.id === clusterId));
  assert.equal(
    screens.every((s) => !clusteredIr.components.some((c) => c.id === s)),
    true,
  );
});

test("유사도가 threshold 미만이면 합치지 않는다", () => {
  // t1/t2/t3는 서로 1개 노드만 공유하고 나머지 2개는 전부 다르다 — 이웃 집합 크기 3,
  // 교집합 1, 합집합 5 → 유사도 1/5=0.2로 threshold(0.6) 미달.
  const screens = ["t1", "t2", "t3"];
  const components = [
    ...screens.map((id) => component(id)),
    component("shared"),
    component("u1a"),
    component("u1b"),
    component("u2a"),
    component("u2b"),
    component("u3a"),
    component("u3b"),
  ];
  const connections = [
    connection("t1", "shared"),
    connection("t1", "u1a"),
    connection("t1", "u1b"),
    connection("t2", "shared"),
    connection("t2", "u2a"),
    connection("t2", "u2b"),
    connection("t3", "shared"),
    connection("t3", "u3a"),
    connection("t3", "u3b"),
  ];
  const { ir: clusteredIr, clusters } = computeClusteredArchitectureIR(ir(components, connections));

  for (const [, members] of clusters) {
    assert.ok(!members.some((m) => screens.includes(m.id)));
  }
  for (const s of screens) {
    assert.ok(clusteredIr.components.some((c) => c.id === s));
  }
});

test("excludeFromClustering에 넣은 노드는 클러스터링 대상에서 빠지고 원본 그대로 통과한다(펼치기)", () => {
  const screens = ["s1", "s2", "s3"];
  const components = [...screens.map((id) => component(id)), component("a"), component("b")];
  const connections = screens.flatMap((s) => [connection(s, "a"), connection(s, "b")]);

  const { ir: clusteredIr, clusters } = computeClusteredArchitectureIR(ir(components, connections), {
    excludeFromClustering: new Set(["s1"]),
  });

  // s1이 빠지면 s2/s3만 남아 MIN_CLUSTER_SIZE(3) 미만이라 아무도 안 합쳐진다.
  assert.equal(clusters.size, 0);
  for (const s of screens) {
    assert.ok(clusteredIr.components.some((c) => c.id === s));
  }
});

test("클러스터 크기가 MIN_CLUSTER_SIZE 미만이면(소규모 tier) 완전히 동일해도 안 합친다", () => {
  // entry(screen) -> mid(logic) -> core-a, core-b(core). core-a/core-b는 이웃 집합이
  // {mid}로 완전히 같지만(유사도 1.0) 딱 2개뿐이라 MIN_CLUSTER_SIZE(3) 미만.
  const components = [component("entry"), component("mid"), component("core-a"), component("core-b")];
  const connections = [connection("entry", "mid"), connection("mid", "core-a"), connection("mid", "core-b")];
  const { ir: clusteredIr, clusters } = computeClusteredArchitectureIR(ir(components, connections));

  assert.equal(clusters.size, 0);
  assert.ok(clusteredIr.components.some((c) => c.id === "core-a"));
  assert.ok(clusteredIr.components.some((c) => c.id === "core-b"));
});

test("viewPlan group은 연결 모양과 무관하게 우선되고 합친 근거를 보존한다", () => {
  const members = ["s1", "s2", "s3"].map((id, index) => ({
    ...component(id, "frontend"),
    layer: "interface",
    entityRefs: [`file:${id}.tsx`],
    evidenceRefs: [`ev-${index}`],
  }));
  const input = {
    ...ir(members, []),
    viewPlan: { primaryPath: [], groups: [{ id: "screens", label: "여행 화면", componentIds: members.map((item) => item.id) }] },
  };
  const { ir: clusteredIr, clusters } = computeClusteredArchitectureIR(input);
  assert.equal(clusters.size, 1);
  const cluster = clusteredIr.components.find((item) => item.id === "cluster:group:screens");
  assert.equal(cluster.label, "여행 화면");
  assert.deepEqual(cluster.entityRefs, ["file:s1.tsx", "file:s2.tsx", "file:s3.tsx"]);
  assert.deepEqual(cluster.evidenceRefs, ["ev-0", "ev-1", "ev-2"]);
});

test("이웃이 같아도 서로 다른 runtime boundary의 컴포넌트는 한 클러스터로 합치지 않는다", () => {
  const left = ["a1", "a2", "a3"].map((id) => component(id));
  const right = ["b1", "b2", "b3"].map((id) => component(id));
  const components = [...left, ...right, component("shared")];
  const connections = [...left, ...right].map((item) => connection(item.id, "shared"));
  const boundaries = [
    { id: "app-a", label: "A", kind: "runtime", wraps: left.map((item) => item.id) },
    { id: "app-b", label: "B", kind: "runtime", wraps: right.map((item) => item.id) },
  ];
  const { clusters } = computeClusteredArchitectureIR(ir(components, connections, boundaries));
  assert.equal(clusters.size, 2);
  assert.ok([...clusters.values()].every((members) => members.length === 3));
});
