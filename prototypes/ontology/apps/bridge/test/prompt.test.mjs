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
  buildAssemblyPrompt,
  buildEvidenceBundle,
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

test("mode가 없으면 기존 isFirst 분기(full/incremental)를 그대로 쓴다", () => {
  const full = selectAnalyzePrompt(undefined, true, "/tmp/proj", EMPTY_WORK_SET, "(안 씀)");
  assert.match(full, /저장소를 직접 탐색하며/);
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
test("Assembly 프롬프트는 골격 요약을 포함하고 traceLinkRefs·1엣지-1시퀀스 규칙을 안내한다", () => {
  const summary = buildSkeletonSummary(evidenceGraph());
  const topology = "독립 실행 런타임 2개: traveler, admin";
  const prompt = buildAssemblyPrompt("/tmp/proj", summary, topology);
  assert.match(prompt, /submit_analysis_bundle/);
  assert.match(prompt, /traceLinkRefs/);
  assert.match(prompt, /1엣지-1시퀀스/);
  assert.match(prompt, /위치 · 추천 조회/);
  assert.match(prompt, /런타임 2개/);
  assert.match(prompt, /viewPlan/);
  assert.ok(prompt.includes(summary), "골격 요약이 프롬프트에 그대로 실린다");
});

test("describeSession은 Assembly 프롬프트를 식별한다", () => {
  const prompt = buildAssemblyPrompt("/tmp/proj", buildSkeletonSummary(evidenceGraph()), "독립 실행 런타임 0개");
  assert.equal(describeSession(prompt), "Architecture/Workflow/Sequence 조립");
});
