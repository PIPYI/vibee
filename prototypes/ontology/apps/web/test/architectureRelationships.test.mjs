import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backendReplacementSeams,
  computeRelationshipLanes,
  matchArchitectureSequences,
  primaryConnectionIds,
} from "../src/layout/architectureRelationships.ts";

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

test("Core가 확인한 로컬 data store와 겹치는 컴포넌트만 백엔드 교체 후보가 된다", () => {
  const local = { ...component("local-store", "data"), label: "여행자 데이터", entityRefs: ["file:src/data/missions.json"] };
  const remote = { ...component("postgres", "data"), label: "PostgreSQL", entityRefs: ["file:db/schema.sql"] };
  const ir = {
    title: "map",
    components: [component("screen", "interface"), local, remote],
    boundaries: [],
    connections: [
      { id: "local-data", from: "screen", to: "local-store", role: "data", traceLinkRefs: ["ev:data:1"], evidenceRefs: ["ev:data:1"] },
      { id: "remote-data", from: "screen", to: "postgres", role: "data", traceLinkRefs: ["ev:data:2"], evidenceRefs: ["ev:data:2"] },
    ],
  };
  const topology = {
    runtimes: [],
    dataStores: [{
      id: "store:local",
      label: "앱 로컬 JSON",
      rootPath: "src/data",
      format: "json",
      entityRefs: ["file:src/data/missions.json"],
      evidenceRefs: ["ev:file:1"],
    }],
    coverage: {
      detectedRuntimeCount: 0,
      representedRuntimeCount: 0,
      detectedDataStoreCount: 1,
      representedDataStoreCount: 1,
      missingRuntimeIds: [],
      missingDataStoreIds: [],
      sharedBoundaryRuntimeIds: [],
    },
  };
  const seams = backendReplacementSeams(ir, topology);
  assert.deepEqual([...seams.keys()], ["local-store"]);
  assert.deepEqual(seams.get("local-store").connectionIds, ["local-data"]);
  assert.match(seams.get("local-store").reason, /로컬 JSON/);
});

test("시퀀스는 동기 edge의 정확한 trace evidence가 메시지와 겹칠 때만 연결한다", () => {
  const ir = {
    title: "map",
    components: [component("verify", "service"), component("reward", "service"), component("store", "data")],
    boundaries: [],
    connections: [
      { id: "verified", from: "verify", to: "reward", role: "sync", label: "인증 후 보상", traceLinkRefs: ["ev:call:award"], evidenceRefs: ["ev:call:award"] },
      { id: "same-label-only", from: "reward", to: "verify", role: "sync", label: "인증 후 보상", traceLinkRefs: ["ev:call:other"], evidenceRefs: ["ev:call:other"] },
      { id: "data-edge", from: "reward", to: "store", role: "data", traceLinkRefs: ["ev:call:award"], evidenceRefs: ["ev:call:award"] },
    ],
  };
  const sequence = {
    id: "seq:award",
    title: "인증 판정 후 보상",
    triggeredByEdgeId: "wf:award",
    participants: [{ id: "p1", label: "verificationService" }, { id: "p2", label: "pointService" }],
    messages: [
      { id: "m1", fromParticipantId: "p1", toParticipantId: "p2", order: 1, label: "포인트 지급", kind: "call", evidenceRefs: ["ev:call:award"] },
      { id: "m2", fromParticipantId: "p2", toParticipantId: "p1", order: 2, label: "지급 결과", kind: "return", evidenceRefs: ["ev:return:award"] },
    ],
    evidenceRefs: ["ev:call:award"],
  };
  const matches = matchArchitectureSequences(ir, [sequence]);
  assert.deepEqual([...matches.keys()], ["verified"]);
  assert.deepEqual(matches.get("verified").sharedEvidenceRefs, ["ev:call:award"]);
});
