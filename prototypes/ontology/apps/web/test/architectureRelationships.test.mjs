import assert from "node:assert/strict";
import { test } from "node:test";

import { computeRelationshipLanes, primaryConnectionIds } from "../src/layout/architectureRelationships.ts";

function component(id, layer, boundaryId) {
  return {
    id,
    label: id,
    presentationType: layer === "interface" ? "frontend" : layer === "data" ? "database" : "backend",
    layer,
    ...(boundaryId ? { boundaryId } : {}),
    entityRefs: [],
    evidenceRefs: [],
  };
}

test("관계 지도는 모든 컴포넌트를 합치지 않고 정확히 한 런타임 행에 배치한다", () => {
  const ir = {
    title: "map",
    components: [component("app-ui", "interface", "app"), component("app-service", "service", "app"), component("admin-ui", "interface", "admin")],
    boundaries: [
      { id: "app", label: "여행자 앱", kind: "mobile-app", wraps: ["app-ui", "app-service", "admin-ui"] },
      { id: "admin", label: "관리자 웹", kind: "web-app", wraps: ["admin-ui"] },
    ],
    connections: [],
  };
  const { lanes } = computeRelationshipLanes(ir);
  assert.deepEqual(lanes.map((lane) => lane.label), ["여행자 앱", "관리자 웹"]);
  const allIds = lanes.flatMap((lane) => [...lane.componentsByLayer.values()].flat().map((item) => item.id));
  assert.deepEqual(allIds.sort(), ["admin-ui", "app-service", "app-ui"]);
  assert.equal(new Set(allIds).size, 3);
});

test("명시 layer를 고정 열 순서로 유지하고 소유되지 않은 항목도 보존한다", () => {
  const ir = {
    title: "map",
    components: [component("store", "data"), component("screen", "interface"), component("service", "service")],
    boundaries: [],
    connections: [],
  };
  const { lanes, layers } = computeRelationshipLanes(ir);
  assert.deepEqual(layers, ["interface", "service", "data"]);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].label, "공통 · 외부");
});

test("핵심 관계 모드는 primaryPath의 실제 연속 엣지만 선택한다", () => {
  const ir = {
    title: "map",
    components: [component("a", "interface"), component("b", "service"), component("c", "data")],
    boundaries: [],
    connections: [
      { id: "ab", from: "a", to: "b", traceLinkRefs: [], evidenceRefs: [] },
      { id: "bc", from: "b", to: "c", traceLinkRefs: [], evidenceRefs: [] },
      { id: "ac", from: "a", to: "c", traceLinkRefs: [], evidenceRefs: [] },
    ],
    viewPlan: { primaryPath: ["a", "b", "c"], groups: [] },
  };
  assert.deepEqual([...primaryConnectionIds(ir)].sort(), ["ab", "bc"]);
});
