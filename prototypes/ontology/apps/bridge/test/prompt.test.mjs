/**
 * `buildEvidenceBundle` — §7.3 index-only arm이 받는 유일한 입력을 만든다.
 *
 * evidence.json에서 file/symbol만 뽑아 요약한다. missing evidence·다른 kind(route/db/call
 * 등)·excerpt/summary는 절대 새지 않아야 한다 — 새면 index-only arm이 사실상 agent-first가
 * 받는 것과 비슷한 정보를 받게 되어 §7.3의 비교가 무의미해진다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildArchitectureViewPrompt,
  buildArchitectureRepositoryBriefing,
  buildAssemblyPrompt,
  buildEvidenceBundle,
  buildFullAnalyzePrompt,
  buildIncrementalAssemblyPrompt,
  buildOverviewPrompt,
  buildScenarioPrompt,
  buildSkeletonSummary,
  describeSession,
  selectAnalyzePrompt,
} from "../dist/prompt.js";

const EMPTY_WORK_SET = {
  dirtyEvidence: [],
  affectedConceptIds: [],
  affectedClaimIds: [],
  affectedScenarioIds: [],
  ungroundedAppearedEvidenceIds: [],
};

function evidenceIndex(items) {
  return { analysisVersion: 1, fileHashes: {}, evidence: items, adapterReport: [] };
}

test("file/symbol만 파일별로 그룹핑된다", () => {
  const bundle = buildEvidenceBundle(
    evidenceIndex([
      { id: "ev:file:1", kind: "file", origin: "engine", filePath: "src/a.ts", status: "present" },
      {
        id: "ev:symbol:1",
        kind: "symbol",
        origin: "engine",
        filePath: "src/a.ts",
        symbolId: "src/a.ts#doThing",
        status: "present",
      },
      {
        id: "ev:symbol:2",
        kind: "symbol",
        origin: "engine",
        filePath: "src/a.ts",
        symbolId: "src/a.ts#other",
        status: "present",
      },
    ]),
  );
  assert.match(bundle, /1개 파일, 2개 심볼/);
  assert.match(bundle, /src\/a\.ts/);
  assert.match(bundle, /- doThing/);
  assert.match(bundle, /- other/);
});

test("status가 missing인 evidence는 새지 않는다", () => {
  const bundle = buildEvidenceBundle(
    evidenceIndex([
      {
        id: "ev:symbol:1",
        kind: "symbol",
        origin: "engine",
        filePath: "src/gone.ts",
        symbolId: "src/gone.ts#removed",
        status: "missing",
      },
    ]),
  );
  assert.doesNotMatch(bundle, /removed/);
  assert.match(bundle, /^0개 파일, 0개 심볼/);
});

test("file/symbol이 아닌 kind(route·call·db_read 등)는 번들에 들어가지 않는다", () => {
  const bundle = buildEvidenceBundle(
    evidenceIndex([
      {
        id: "ev:route:1",
        kind: "route",
        origin: "engine",
        filePath: "app/api/follow/route.js",
        status: "present",
        summary: "POST /api/follow",
      },
      {
        id: "ev:call:1",
        kind: "call",
        origin: "engine",
        status: "present",
      },
    ]),
  );
  assert.doesNotMatch(bundle, /follow/);
  assert.doesNotMatch(bundle, /POST/);
  assert.match(bundle, /^0개 파일, 0개 심볼/);
});

test("심볼이 하나도 없는 파일은 (심볼 없음)으로 표시된다", () => {
  const bundle = buildEvidenceBundle(
    evidenceIndex([
      { id: "ev:file:1", kind: "file", origin: "engine", filePath: "src/empty.ts", status: "present" },
    ]),
  );
  assert.match(bundle, /src\/empty\.ts\n\s+\(심볼 없음\)/);
});

/**
 * `selectAnalyzePrompt` — `/api/analyze`가 어떤 turn에 어떤 프롬프트를 쓰는지 고르는
 * 단 하나의 결정점. mode가 "index-only"면 isFirst와 무관하게 항상 index-only 프롬프트를
 * 써야 한다 — 아니면 §7.3 비교 arm이 agent-first와 같은 프롬프트를 받아 비교가 무의미해진다.
 */
test("mode가 index-only면 isFirst와 무관하게 항상 bundle 프롬프트를 쓴다", () => {
  const first = selectAnalyzePrompt("index-only", true, "/tmp/proj", EMPTY_WORK_SET, "1개 파일, 0개 심볼.");
  const notFirst = selectAnalyzePrompt("index-only", false, "/tmp/proj", EMPTY_WORK_SET, "1개 파일, 0개 심볼.");
  for (const prompt of [first, notFirst]) {
    assert.match(prompt, /Evidence Index 요약/);
    assert.match(prompt, /1개 파일, 0개 심볼\./);
    assert.doesNotMatch(prompt, /저장소를 직접 탐색하며/);
  }
});

test("mode가 없으면 isFirst를 유지하되 V4 full은 discovery gap부터 조사한다", () => {
  const full = selectAnalyzePrompt(undefined, true, "/tmp/proj", EMPTY_WORK_SET, "(안 씀)");
  assert.match(full, /discovery gap과 filePaths부터 조사/);
  assert.doesNotMatch(full, /Evidence Index 요약/);

  const incremental = selectAnalyzePrompt(undefined, false, "/tmp/proj", EMPTY_WORK_SET, "(안 씀)");
  assert.match(incremental, /코드가 바뀌었다/);
  assert.doesNotMatch(incremental, /Evidence Index 요약/);
});

/**
 * `buildOverviewPrompt` — M11 (schema2 §4) Entry map을 Canonical Scenario 색인으로.
 */
test("Overview 프롬프트는 Canonical Scenario를 item으로 먼저 올리라고 지시한다", () => {
  const prompt = buildOverviewPrompt("/tmp/proj", {});
  assert.match(prompt, /Canonical Scenario/);
  assert.match(prompt, /scenarioRefs/);
  assert.match(prompt, /여기서 어떤 일이 일어나는가/);
});

/**
 * `buildScenarioPrompt` — M11 (schema2 §5) activations/phases/kind는 선택이라고 명시한다.
 */
test("Scenario 프롬프트는 activations·phases·kind:return을 선택 사항으로 안내한다", () => {
  const prompt = buildScenarioPrompt("/tmp/proj", {});
  assert.match(prompt, /activations/);
  assert.match(prompt, /phases/);
  assert.match(prompt, /kind: "return"/);
  assert.match(prompt, /선택이다/);
});

/**
 * `buildSkeletonSummary` — schema3 §5.2 Stage 3의 오리엔테이션 입력.
 */
function evidenceGraph({ nodes = [], edges = [] } = {}) {
  return {
    nodes: new Map(nodes.map((node) => [node.key, node])),
    outgoing: new Map(),
    incoming: new Map(),
    edges,
  };
}

test("buildSkeletonSummary는 route/model만 나열하고 symbol/file은 개수에만 반영한다", () => {
  const graph = evidenceGraph({
    nodes: [
      { key: "route:GET /api/x", kind: "route", label: "GET /api/x" },
      { key: "model:User", kind: "model", label: "User" },
      { key: "symbol:svc#handle", kind: "symbol", label: "handle" },
    ],
    edges: [{ fromId: "route:GET /api/x", toId: "symbol:svc#handle", kind: "api_handler", evidenceRefs: ["ev-1"] }],
  });
  const summary = buildSkeletonSummary(graph);
  assert.match(summary, /entity 3개, link 1개/);
  assert.match(summary, /route \(1개\): GET \/api\/x/);
  assert.match(summary, /model \(1개\): User/);
  assert.doesNotMatch(summary, /\bhandle\b/, "symbol 라벨은 route/model 목록에 새지 않는다");
  assert.match(summary, /api_handler: 1/);
});

test("buildSkeletonSummary는 route/model/link가 없어도 (없음)으로 안전하게 표시한다", () => {
  const summary = buildSkeletonSummary(evidenceGraph());
  assert.match(summary, /entity 0개, link 0개/);
  assert.match(summary, /route \(0개\): \(없음\)/);
  assert.match(summary, /model \(0개\): \(없음\)/);
  assert.match(summary, /link kind 별 개수:\n {2}\(없음\)/);
});

/**
 * `buildAssemblyPrompt` — schema3 §5.2 Stage 3, §3.4의 1엣지-1시퀀스·I20 규칙을 지시한다.
 */
test("Assembly 프롬프트는 골격 요약과 목적별 userMap·1엣지-1시퀀스 규칙을 안내한다", () => {
  const summary = buildSkeletonSummary(evidenceGraph());
  const topology = "독립 실행 런타임 2개: traveler, admin";
  const prompt = buildAssemblyPrompt("/tmp/proj", summary, topology);
  assert.match(prompt, /submit_analysis_bundle/);
  assert.match(prompt, /systemLinkRefs/);
  assert.match(prompt, /I20-v4/);
  assert.match(prompt, /1엣지-1시퀀스/);
  assert.match(prompt, /위치 · 추천 조회/);
  assert.match(prompt, /런타임 2개/);
  assert.match(prompt, /viewPlan/);
  assert.match(prompt, /userMap\.journeys/);
  assert.match(prompt, /Canonical Scenario마다 하나씩/);
  assert.match(prompt, /workflow\.mainPath의 모든 인접 node 쌍/);
  assert.match(prompt, /sequences\[\]\.messages\[\]\.kind: `call` \| `return` \| `event`/);
  assert.match(prompt, /kind: "return"/);
  assert.match(prompt, /kind: "event"/);
  assert.match(prompt, /같은 call evidenceRefs를 인용해도 된다/);
  assert.match(prompt, /ui_event evidence/);
  assert.match(prompt, /call\(사용자→UI\) → call\(UI→API\) → return\(API→UI\) → event\(UI→사용자\)/);
  assert.match(prompt, /첫 자료 조회로 get_assembly_context를 정확히 1회 호출한다/);
  assert.match(prompt, /packet 누락 또는 validator diagnostics/);
  assert.match(prompt, /개별 read tool[\s\S]*fallback/);
  assert.doesNotMatch(prompt, /1\. get_project_semantic_memory/);
  assert.doesNotMatch(prompt, /2\. get_system_facts로 검증된/);
  assert.ok(prompt.includes(summary), "골격 요약이 프롬프트에 그대로 실린다");
});

test("packetEnabled=false면 Assembly 프롬프트가 get_assembly_context 이전(621dd1e 이전) 개별 tool 흐름으로 되돌아간다", () => {
  // ONTO_ASSEMBLY_CONTEXT_PACKET=off 롤백 레버의 회귀 테스트. v6 §6.3이 요구한 shadow
  // 검증 없이 이미 실서비스에 나간 get_assembly_context를 끌 수 있어야 하며, 껐을 때는
  // 그 packet을 아예 언급하지 않고 621dd1e 이전의 개별 tool 흐름(+ 그 뒤에 추가된 batch
  // tool들)으로 되돌아가야 한다 — 문구가 바이트 단위로 같을 필요는 없다.
  const summary = buildSkeletonSummary(evidenceGraph());
  const topology = "독립 실행 런타임 2개: traveler, admin";
  const prompt = buildAssemblyPrompt("/tmp/proj", summary, topology, false);
  assert.doesNotMatch(prompt, /get_assembly_context/);
  assert.match(prompt, /1\. get_project_semantic_memory 로 Concept·Scenario 전체를 훑는다/);
  assert.match(prompt, /2\. get_system_facts\(entityIds 배열\)로 검증된 System Entity와 System Link ID를/);
  assert.match(prompt, /get_impact_context_batch/);
  assert.match(prompt, /get_scenario_context_batch/);
  assert.match(prompt, /get_concept_context_batch/);
  assert.match(prompt, /systemLinkRefs에 2번에서 확인한 System Link ID를/);
  assert.match(prompt, /submit_analysis_bundle/);
});

test("V4 증분 Assembly 프롬프트는 기존 draft와 ImpactSet ID만 수정하게 한다", () => {
  const impact = {
    evidenceIds: ["ev-1"], systemEntityIds: [], systemLinkIds: ["link-1"], conceptIds: [], claimIds: [], scenarioIds: [],
    architectureComponentIds: ["component-1"], architectureConnectionIds: ["connection-1"], workflowNodeIds: [], workflowEdgeIds: [], sequenceIds: [],
    discoveryRoots: [], requiresFullDiscovery: false, requiresFullAssembly: false, reasons: [],
  };
  const prompt = buildIncrementalAssemblyPrompt("/tmp/proj", "draft-1", {
    mode: "incremental", semanticTurnRequired: true, assemblyTurnRequired: true,
    fullDiscovery: false, fullAssembly: false, reason: "local",
    impact,
    previousSystemDigest: { analysisVersion: 2, entityCount: 1, linkCount: 1, reusableEntityIds: [], reusableLinkIds: [], reviewEntityIds: [], reviewLinkIds: ["link-1"], impact },
    discoveryGaps: [], integrationCatalog: [],
  }, "entity 2개, link 1개");
  assert.match(prompt, /draft-1/);
  assert.match(prompt, /component-1/);
  assert.match(prompt, /connection-1/);
  assert.match(prompt, /전체 .*배열을 replace하지 마라/);
});

test("describeSession은 Assembly 프롬프트를 식별한다", () => {
  const prompt = buildAssemblyPrompt("/tmp/proj", buildSkeletonSummary(evidenceGraph()), "독립 실행 런타임 0개");
  assert.equal(describeSession(prompt), "Architecture/User Map/Sequence 조립");
});

test("EVIDENCE_RULES는 get_evidence를 여러 id 한 번에 불러오라고 지시한다", () => {
  const prompt = buildFullAnalyzePrompt("/tmp/project");
  assert.match(prompt, /get_evidence.*ids 배열에 한 번에/);
});

/**
 * `buildArchitectureViewPrompt` — V8 구조 지도 저작 turn. grounding 파이프라인과 분리하되
 * 저작 turn이다. get_assembly_context류 grounding tool을 지시하지 않고, 좌표를 AI가 직접
 * 쓰게 하며, validate/submit MCP tool 두 개만 언급해야 한다.
 */
test("Architecture 뷰 프롬프트는 grounding tool을 지시하지 않고 스키마·예시를 인라인한다", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/proj");
  assert.doesNotMatch(prompt, /get_assembly_context/);
  assert.match(prompt, /get_project_semantic_memory·get_system_facts·get_evidence 같은 grounding tool을 부르지/);
  assert.doesNotMatch(prompt, /submit_analysis_bundle/);
  assert.match(prompt, /validate_architecture_view/);
  assert.match(prompt, /submit_architecture_view/);
  assert.match(prompt, /"schemaVersion": 1/);
  assert.match(prompt, /좌표\(pos\)는 이 turn에서만 AI가 직접 쓴다/);
  assert.match(prompt, /6~12개/);
  assert.match(prompt, /1200×760/);
  assert.match(prompt, /프론트엔드가 백엔드를[\s\S]*HTTP로 호출하면 반드시 하나의 connection/);
  assert.match(prompt, /cards는 핵심 결론 3장/);
});

test("V8 구조 지도 브리핑은 runtime·생성 산출물·외부 서비스·HTTP 매칭을 구분한다", () => {
  const briefing = buildArchitectureRepositoryBriefing(
    {
      runtimes: [{ id: "runtime:web", label: "web", rootPath: "web", kind: "web-app", entrypointRefs: ["file:web/src/main.tsx"], evidenceRefs: [], origin: "manifest" }],
      dataStores: [{ id: "store:sample", label: "샘플 출력", rootPath: "data", format: "json", origin: "generated-artifact", entityRefs: [], evidenceRefs: [] }],
      routeSurfaces: [{ id: "route:api", filePath: "api/app.py", routeKeys: ["GET /health"], entityRefs: [], evidenceRefs: [] }],
      coverage: { detectedRuntimeCount: 1, representedRuntimeCount: 0, detectedDataStoreCount: 1, representedDataStoreCount: 0, detectedRouteSurfaceCount: 1, representedRouteSurfaceCount: 0, missingRuntimeIds: [], missingDataStoreIds: [], missingRouteSurfaceIds: [], sharedBoundaryRuntimeIds: [] },
    },
    {
      schemaVersion: 4,
      analysisVersion: 1,
      entities: [{ id: "resource:mail", ref: { kind: "resource", namespace: "npm", key: "mailer" }, kind: "resource", origin: "engine", certainty: "confirmed", evidenceRefs: [], dependsOnEvidenceRefs: [], status: "valid", firstSeenVersion: 1, lastValidatedVersion: 1 }],
      links: [{ id: "http:health", from: { kind: "file", filePath: "web/src/client.ts" }, to: { kind: "route", routeKey: "GET /health" }, kind: "http_call", mechanism: "HTTP GET /health", origin: "engine", certainty: "grounded", evidenceRefs: [], dependsOnEvidenceRefs: [], status: "valid", firstSeenVersion: 1, lastValidatedVersion: 1 }],
      diagnostics: [],
    },
  );
  assert.match(briefing, /root=web/);
  assert.match(briefing, /생성 산출물 — 샘플\/실행 출력이므로 독립 component로 만들지 말 것/);
  assert.match(briefing, /npm:mailer/);
  assert.match(briefing, /HTTP GET \/health · grounded/);
  const prompt = buildArchitectureViewPrompt("/tmp/proj", briefing);
  assert.match(prompt, /서버가 확인한 저장소 브리핑/);
  assert.match(prompt, /HTTP 호출 ↔ 라우트 매칭/);
});

test("describeSession은 Architecture 뷰 프롬프트를 식별한다", () => {
  const prompt = buildArchitectureViewPrompt("/tmp/proj");
  assert.equal(describeSession(prompt), "시스템 구조 지도 저작");
});
