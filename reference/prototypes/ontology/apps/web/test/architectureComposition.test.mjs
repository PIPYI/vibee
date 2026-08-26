/**
 * `computeArchitectureComposition` — v2 §2. "구성 개요" 탭이 쓰는 화면/중간 로직/핵심
 * 서비스 3단 분류가 `computeArchitectureLayout`의 rank를 그대로 재해석한 것인지, 그리고
 * flat-graph·다중 boundary 같은 예외 케이스를 억지로 3단 분류하지 않는지 검증한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeArchitectureComposition } from "../src/layout/architectureComposition.ts";

function component(id, presentationType = "unknown") {
  return { id, label: id, presentationType, entityRefs: [], evidenceRefs: [] };
}

function connection(from, to, id = `${from}-${to}`) {
  return { id, from, to, traceLinkRefs: [], evidenceRefs: [] };
}

function ir(components, connections, boundaries = []) {
  return { title: "아키텍처", components, boundaries, connections };
}

test("실측 chungnam-mission-app 분포(12/3/4)를 rank 재해석만으로 재현한다", () => {
  // 실측 구조: session-store·review-service는 화면에서만 호출을 받고(out=0) rank 1에 머물지만,
  // verification-reward-service는 화면 호출을 받으면서(rank 1) 핵심 서비스 4개 전부로 나가는
  // 유일한 통로라 그 4개를 rank 2로 끌어올린다 — 그래서 핵심 서비스도 화면에서 직접 많이
  // 불리지만(높은 in-degree) rank는 2가 된다.
  const screens = Array.from({ length: 12 }, (_, i) => `screen-${i}`);
  const logic = ["review-service", "session-store", "verification-reward-service"];
  const core = ["location-map-service", "mission-catalog-service", "mission-progress-service", "reward-services"];
  const components = [...screens, ...logic, ...core].map((id) => component(id, "frontend"));
  const connections = [
    connection("screen-6", "review-service"),
    ...screens.slice(0, 6).map((s) => connection(s, "session-store")),
    ...screens.slice(7, 10).map((s) => connection(s, "verification-reward-service")),
    ...core.map((serviceId) => connection("verification-reward-service", serviceId)),
    // 핵심 서비스는 화면에서 직접도 많이 불린다(실측 in-degree 10/10/8/6) — rank는
    // verification-reward-service를 거치는 경로가 더 길어서(2) 여전히 2로 유지된다.
    ...screens.map((s) => connection(s, "location-map-service", `${s}-loc`)),
  ];
  const [group] = computeArchitectureComposition(ir(components, connections));
  assert.equal(group.boundaryId, null);
  const counts = Object.fromEntries(group.tiers.map((t) => [t.tier, t.components.length]));
  assert.equal(counts.screen, 12);
  assert.equal(counts.logic, 3);
  assert.equal(counts.core, 4);
});

test("컴포넌트 간 연결이 없으면(flat) 3단으로 억지로 나누지 않는다", () => {
  const components = [component("a"), component("b"), component("c")];
  const [group] = computeArchitectureComposition(ir(components, []));
  assert.equal(group.tiers.length, 1);
  assert.equal(group.tiers[0].components.length, 3);
});

test("boundary가 2개 이상이면 boundary별로 따로 티어링한다", () => {
  const traveler = [component("t-screen"), component("t-service")];
  const admin = [component("a-screen"), component("a-service")];
  const components = [...traveler, ...admin];
  const connections = [connection("t-screen", "t-service"), connection("a-screen", "a-service")];
  const boundaries = [
    { id: "b-traveler", label: "여행자 앱", kind: "application", wraps: ["t-screen", "t-service"] },
    { id: "b-admin", label: "관리자 웹", kind: "application", wraps: ["a-screen", "a-service"] },
  ];
  const groups = computeArchitectureComposition(ir(components, connections, boundaries));
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => g.boundaryLabel),
    ["여행자 앱", "관리자 웹"],
  );
  for (const group of groups) {
    // 2-hop 체인(화면 -> 서비스)이라 rank는 0/1까지만 나온다 — rank 1은 "중간 로직" 티어다.
    const counts = Object.fromEntries(group.tiers.map((t) => [t.tier, t.components.length]));
    assert.equal(counts.screen, 1);
    assert.equal(counts.logic, 1);
  }
});

test("boundary에 안 감싸인 컴포넌트는 버려지지 않고 '그 외' 그룹으로 남는다", () => {
  const boundaries = [
    { id: "b1", label: "A", kind: "application", wraps: ["x"] },
    { id: "b2", label: "B", kind: "application", wraps: ["y"] },
  ];
  const components = [component("x"), component("y"), component("orphan")];
  const groups = computeArchitectureComposition(ir(components, [], boundaries));
  assert.equal(groups.length, 3);
  const orphanGroup = groups.at(-1);
  assert.equal(orphanGroup.boundaryLabel, "그 외");
  assert.equal(orphanGroup.tiers[0].components[0].id, "orphan");
});

test("명시된 layer가 있으면 flat graph에서도 rank 대신 의미 layer로 나눈다", () => {
  const components = [
    { ...component("screen", "frontend"), layer: "interface" },
    { ...component("service", "backend"), layer: "service" },
    { ...component("store", "database"), layer: "data" },
  ];
  const [group] = computeArchitectureComposition(ir(components, []));
  assert.deepEqual(group.tiers.map((tier) => tier.label), ["화면", "중간 로직", "상태 · 데이터"]);
});
