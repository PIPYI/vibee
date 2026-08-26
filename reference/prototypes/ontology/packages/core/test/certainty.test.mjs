/**
 * V5 A4 — certainty(confirmed/grounded/inferred)와 status(valid/relocated 등)는 서로 다른
 * 축이다. "확정(confirmed로 표시)"과 "화면에 나타남"을 분리한다:
 * - status가 낡은(stale/missing/needs_review) Link는 여전히 hard reject된다 — 근거 자체를
 *   신뢰할 수 없기 때문이다.
 * - certainty가 inferred인 것만으로는 더 이상 connection을 거부하지 않는다 — 대신
 *   connection.certainty가 "inferred"로 낮아지고 warning으로만 알린다.
 * - component.certainty는 entityRefs가 가리키는 System Entity의 최저 certainty를 Core가
 *   그대로 기록한다(장식이 아니라 Core가 계산한 값).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateAnalysisBundle } from "@onto/core";

function evidenceItem(id, overrides = {}) {
  return {
    id,
    kind: "symbol",
    origin: "engine",
    rawHash: "h",
    normalizedFingerprint: "f",
    normalizationProfile: "code",
    fileContentHash: "fc",
    observedAtVersion: 1,
    status: "present",
    ...overrides,
  };
}

// route:GET /api/x는 평범한 engine evidence로 만든다 — comp-1/connection.from은 항상 confirmed다.
const EV_ROUTE = evidenceItem("ev-route", {
  kind: "route",
  graph: { role: "entity", entity: { kind: "route", routeKey: "GET /api/x" }, label: "GET /api/x" },
});
// graph가 없다 — entity로 승격되지 않는다. symbol:svc#handle은 오직 vibee-origin System Fact로만
// 존재하게 해서(engine 투영과 충돌 없이) certainty를 자유롭게 조작할 수 있게 한다.
const EV_SUPPORT = evidenceItem("ev-support");

const EVIDENCE_INDEX = {
  analysisVersion: 1,
  fileHashes: {},
  evidence: [EV_ROUTE, EV_SUPPORT],
  adapterReport: [],
};
const MEMORY = { semanticVersion: 1, concepts: [], claims: [], canonicalScenarios: [] };

function vibeeEntity(certainty) {
  return {
    id: "symbol:svc#handle",
    ref: { kind: "symbol", symbolId: "svc#handle" },
    kind: "symbol",
    origin: "vibee",
    certainty,
    evidenceRefs: [EV_SUPPORT.id],
    dependsOnEvidenceRefs: [EV_SUPPORT.id],
    status: "valid",
    firstSeenVersion: 1,
    lastValidatedVersion: 1,
  };
}

function vibeeLink(certainty, status = "valid") {
  return {
    id: "system-link:test",
    from: { kind: "route", routeKey: "GET /api/x" },
    to: { kind: "symbol", symbolId: "svc#handle" },
    kind: "external_call",
    origin: "vibee",
    certainty,
    evidenceRefs: [EV_SUPPORT.id],
    dependsOnEvidenceRefs: [EV_SUPPORT.id],
    status,
    firstSeenVersion: 1,
    lastValidatedVersion: 1,
  };
}

function previousStoreWith({ entity, link }) {
  return {
    schemaVersion: 4,
    analysisVersion: 1,
    entities: entity ? [entity] : [],
    links: link ? [link] : [],
    diagnostics: [],
  };
}

function baseBundle(connections) {
  return {
    architecture: {
      title: "아키텍처",
      components: [
        {
          id: "comp-1",
          label: "프론트",
          presentationType: "frontend",
          entityRefs: ["route:GET /api/x"],
          evidenceRefs: [EV_ROUTE.id],
        },
        {
          id: "comp-2",
          label: "핸들러",
          presentationType: "backend",
          entityRefs: ["symbol:svc#handle"],
          evidenceRefs: [EV_SUPPORT.id],
        },
      ],
      boundaries: [],
      connections,
    },
    workflow: { title: "흐름", lanes: [], mainPath: [], nodes: [], edges: [] },
    sequences: [],
  };
}

function validate(bundle, systemFacts) {
  return validateAnalysisBundle({ bundle, evidence: EVIDENCE_INDEX, memory: MEMORY, systemFacts });
}

test("V5 A4 — component.certainty는 entityRefs가 가리키는 System Entity의 certainty를 그대로 기록한다", () => {
  const result = validate(baseBundle([]), previousStoreWith({ entity: vibeeEntity("grounded") }));
  assert.ok(result.bundle);
  const comp1 = result.bundle.architecture.components.find((c) => c.id === "comp-1");
  const comp2 = result.bundle.architecture.components.find((c) => c.id === "comp-2");
  assert.equal(comp1.certainty, "confirmed", "engine evidence로만 만들어진 entity는 confirmed다");
  assert.equal(comp2.certainty, "grounded");
});

test("V5 A4 — inferred System Link를 쓰는 connection은 더 이상 hard reject되지 않고 certainty:inferred로 통과한다", () => {
  const bundle = baseBundle([
    { id: "conn-1", from: "comp-1", to: "comp-2", systemLinkRefs: ["system-link:test"], evidenceRefs: [EV_SUPPORT.id] },
  ]);
  const systemFacts = previousStoreWith({ entity: vibeeEntity("grounded"), link: vibeeLink("inferred", "valid") });
  const result = validate(bundle, systemFacts);

  assert.ok(result.bundle, "hard error 없이 커밋되어야 한다");
  const codes = result.diagnostics.map((item) => item.code);
  assert.equal(codes.includes("bundle/system-link-not-authoritative"), false);
  assert.ok(codes.includes("bundle/connection-uses-inferred-link"));
  assert.equal(result.diagnostics.find((d) => d.code === "bundle/connection-uses-inferred-link").severity, "warning");
  assert.equal(result.bundle.architecture.connections[0].certainty, "inferred");
});

test("V5 A4 — status가 stale인 System Link는 certainty와 무관하게 여전히 hard reject된다", () => {
  const bundle = baseBundle([
    { id: "conn-1", from: "comp-1", to: "comp-2", systemLinkRefs: ["system-link:test"], evidenceRefs: [EV_SUPPORT.id] },
  ]);
  const systemFacts = previousStoreWith({ entity: vibeeEntity("confirmed"), link: vibeeLink("confirmed", "stale") });
  const result = validate(bundle, systemFacts);

  assert.equal(result.bundle, undefined, "status가 낡은 Link는 여전히 커밋을 막아야 한다");
  const codes = result.diagnostics.map((item) => item.code);
  assert.ok(codes.includes("bundle/system-link-not-authoritative"));
});

test("V5 A4 — confirmed/grounded Link만 쓰는 connection은 warning 없이 confirmed로 통과한다", () => {
  const bundle = baseBundle([
    { id: "conn-1", from: "comp-1", to: "comp-2", systemLinkRefs: ["system-link:test"], evidenceRefs: [EV_SUPPORT.id] },
  ]);
  const systemFacts = previousStoreWith({ entity: vibeeEntity("grounded"), link: vibeeLink("grounded", "valid") });
  const result = validate(bundle, systemFacts);

  assert.ok(result.bundle);
  const codes = result.diagnostics.map((item) => item.code);
  assert.equal(codes.includes("bundle/connection-uses-inferred-link"), false);
  assert.equal(result.bundle.architecture.connections[0].certainty, "grounded");
});
