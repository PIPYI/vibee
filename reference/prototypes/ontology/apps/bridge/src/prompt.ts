/**
 * turn 프롬프트 (implementation_plan §6.9).
 *
 * spike가 확인한 것: **agent는 MCP를 자발적으로 부르지 않는다**(SPIKE_FINDINGS §6.5).
 * 그래서 무엇을 부를지 명시적으로 지시한다.
 *
 * C9의 evidence-first 제약을 넣되 한 줄을 바꾼다 — CoderMind의 "실재하는 노드만"을 그대로
 * 쓰면 엔진이 못 본 근거를 agent가 **버리게** 된다. 우리는 대신 제안하게 한다.
 */
import { architectureViewExampleText, architectureViewSchemaText } from "@onto/architecture-view";
import type { EvidenceGraph } from "@onto/core";
import {
  analysisContractDigest,
  type EntityRef,
  type EvidenceIndex,
  type IncrementalAnalysisPlan,
  type RepositoryTopology,
  type SemanticWorkSet,
  type SystemFactStore,
  type ViewRequest,
} from "@onto/protocol";

const EVIDENCE_RULES = [
  "규칙:",
  "1. 경로·심볼·줄번호를 지어내지 마라. 모든 evidenceRefs 는 get_evidence 로 확인한 실재 id여야 한다.",
  "   여러 id를 확인할 때는 get_evidence 를 여러 번 부르지 말고 ids 배열에 한 번에 담아 불러라.",
  "2. 엔진이 인덱싱하지 못한 근거를 발견했다면 **버리지 말고** propose_evidence 로 등록을 요청하라.",
  "   Core 가 검증한 뒤 id 를 발급하며, 발급받은 id 에만 grounding 할 수 있다.",
  "3. Core adapter가 모르는 runtime·route·외부 SDK·저장소와 실제 호출 관계를 발견했다면",
  "   source anchor + 신규 entity + link를 propose_system_facts로 한 번에 제안하라.",
  "   config나 README 이름만으로 grounded 외부 호출을 주장하지 마라. source contract가 부족하면 inferred로 제출하라.",
  "   System Fact를 제안했다면 의미 변경이 없어도 빈 Semantic Patch를 제출해 같은 generation에 커밋하라.",
  "4. 사용자에게 보이는 label 은 파일명·함수명이 아니라 이 순서로 고른다:",
  "   ① Intent 에서 이미 쓴 용어  ② 저장소의 도메인 용어  ③ 네가 복원한 제품 의미",
  "   기술 세부는 Trace View 에서만 노출한다.",
  "5. 새 Concept 를 만들기 전에 get_concept_context 로 재사용 후보를 확인하라.",
  "   같은 의미가 분석마다 새 Concept 가 되면 실패다.",
].join("\n");

/** 첫 분석 — 아직 Semantic Memory가 없다. */
export function buildFullAnalyzePrompt(projectPath: string): string {
  return [
    "이 프로젝트의 의미 구조를 처음으로 만든다.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "순서:",
    "1. get_project_semantic_memory 로 현재 상태를 확인한다 (비어 있을 것이다).",
    "2. get_incremental_analysis_context의 discovery gap과 filePaths부터 조사한다.",
    "   manifest·entrypoint·route와 gap의 인접 파일 밖으로 확장할 때는 이유가 있어야 한다.",
    "3. 비전공자가 이해할 수 있는 Concept 와 Claim 을 만든다.",
    "4. 대표적인 사용자/시스템 목적(예: \"팔로우하기\")을 하나 이상 Scenario 로 등록한다.",
    "   submit_semantic_patch 의 addedScenarios 에 { id, name, type, goal?, anchorConceptIds, status }",
    "   만 싣는다 — 얇은 포인터일 뿐이다. anchorConceptIds 는 이미 만든 Concept id 를 가리켜야 한다.",
    "",
    EVIDENCE_RULES,
  ].join("\n");
}

/**
 * 증분 분석 — 두 목록을 **구별해서** 준다 (U1).
 *
 * 뜻이 다르고 지시도 다르다. 섞으면 새 기능 발견을 놓친다.
 */
export function buildIncrementalAnalyzePrompt(projectPath: string, work: SemanticWorkSet): string {
  const affected = [
    ...work.affectedConceptIds.map((id) => `  Concept ${id}`),
    ...work.affectedClaimIds.map((id) => `  Claim ${id}`),
    ...work.affectedScenarioIds.map((id) => `  Scenario ${id}`),
  ];
  const appeared = work.ungroundedAppearedEvidenceIds;

  return [
    "코드가 바뀌었다. 의미를 따라잡아야 한다.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "## 재검토할 기존 의미",
    affected.length > 0
      ? [
          "이것들의 근거가 바뀌었거나 사라졌다. 여전히 참인지 확인하고 갱신하거나 철회하라.",
          ...affected.slice(0, 40),
          affected.length > 40 ? `  ... 외 ${affected.length - 40}개` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "  (없음)",
    "",
    "## 아직 의미가 없는 새 근거",
    appeared.length > 0
      ? [
          "여기 새 기능이 있을 수 있다. get_evidence 로 살펴보고 필요하면 Concept 를 새로 만들라.",
          ...appeared.slice(0, 30).map((id) => `  ${id}`),
          appeared.length > 30 ? `  ... 외 ${appeared.length - 30}개 (전체 ${appeared.length}개)` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "  (없음)",
    "",
    EVIDENCE_RULES,
  ].join("\n");
}

/**
 * §7.3 index-only arm이 받는 유일한 입력 — evidence.json에서 뽑은 **file/symbol 요약**뿐이다.
 *
 * excerpt·summary·call/reference 그래프·route/db 세부는 넣지 않는다. 그것들을 못 받았을 때
 * agent-first 대비 의미 품질이 얼마나 떨어지는가가 §7.3이 측정하려는 격차 그 자체이므로,
 * 여기서 미리 메워 주면 비교가 무의미해진다.
 */
export function buildEvidenceBundle(evidence: EvidenceIndex): string {
  const symbolsByFile = new Map<string, Set<string>>();
  for (const item of evidence.evidence) {
    if (item.status !== "present" || !item.filePath) continue;
    if (item.kind !== "file" && item.kind !== "symbol") continue;
    if (!symbolsByFile.has(item.filePath)) symbolsByFile.set(item.filePath, new Set());
    if (item.kind === "symbol" && item.symbolId) {
      symbolsByFile.get(item.filePath)!.add(item.symbolId.slice(item.symbolId.indexOf("#") + 1));
    }
  }
  const files = [...symbolsByFile.keys()].sort();
  const symbolCount = files.reduce((sum, file) => sum + symbolsByFile.get(file)!.size, 0);
  const lines = [`${files.length}개 파일, ${symbolCount}개 심볼.`, ""];
  for (const file of files) {
    lines.push(file);
    const names = [...symbolsByFile.get(file)!].sort();
    if (names.length === 0) {
      lines.push("  (심볼 없음)");
    } else {
      for (const name of names) lines.push(`  - ${name}`);
    }
  }
  return lines.join("\n");
}

/**
 * §7.3의 비교 arm — 저장소를 직접 탐색하지 않고 미리 만든 Evidence 요약만 준다.
 *
 * **탐색을 금지하지 않는다.** Codex 에 파일 도구를 확실히 끊을 방법이 없으므로,
 * 강제 대신 **탐색했는지를 측정한다.** 탐색했다면 그 자체가 findings 다.
 */
export function buildIndexOnlyPrompt(projectPath: string, bundle: string): string {
  return [
    "아래는 이 프로젝트의 Evidence Index 요약이다. **이것만으로** 의미 구조를 만들어라.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "```",
    bundle,
    "```",
    "",
    EVIDENCE_RULES,
  ].join("\n");
}

/**
 * `/api/analyze`가 매 turn 어떤 프롬프트를 쓸지 고르는 단 하나의 결정점.
 *
 * §6.9의 isFirst 분기와 §7.3의 index-only arm 분기를 한 곳에 모은다 — `reindex()` 안에
 * 인라인 삼항으로 두면 조용히 틀려도(§8 "조용한 성공") 실제 agent turn을 끝까지 태워야만
 * 드러난다. 순수 함수로 빼면 agent 없이 바로 검증할 수 있다.
 */
export function selectAnalyzePrompt(
  mode: "full" | "incremental" | "index-only" | undefined,
  isFirst: boolean,
  projectPath: string,
  work: SemanticWorkSet,
  bundle: string,
  plan?: IncrementalAnalysisPlan,
): string {
  const base = mode === "index-only"
    ? buildIndexOnlyPrompt(projectPath, bundle)
    : isFirst
      ? buildFullAnalyzePrompt(projectPath)
      : buildIncrementalAnalyzePrompt(projectPath, work);
  if (!plan) return base;
  const gapLines = plan.discoveryGaps.slice(0, 20).flatMap((gap) => [
    `- ${gap.id} [${gap.priority}/${gap.kind}] ${gap.reason}`,
    `  files: ${gap.filePaths.join(", ") || "(adapter/global)"}`,
  ]);
  return [
    base,
    "",
    "## V4 증분 실행 계약",
    `mode: ${plan.mode} · fullDiscovery: ${plan.fullDiscovery} · 이유: ${plan.reason}`,
    "먼저 get_incremental_analysis_context를 호출하라. 아래 gap과 영향 ID 밖을 다시 조사하거나 수정하지 마라.",
    ...(gapLines.length > 0 ? gapLines : ["- discovery gap 없음"]),
    `재검토 System Entity: ${plan.impact.systemEntityIds.join(", ") || "(없음)"}`,
    `재검토 System Link: ${plan.impact.systemLinkIds.join(", ") || "(없음)"}`,
    `재검토 Concept/Claim/Scenario: ${[
      ...plan.impact.conceptIds,
      ...plan.impact.claimIds,
      ...plan.impact.scenarioIds,
    ].join(", ") || "(없음)"}`,
  ].join("\n");
}

const VIEW_RULES = [
  "규칙:",
  "1. conceptRefs·claimRefs·evidenceRefs·scenarioRefs는 전부 실재하는 id여야 한다 — 지어내지 마라.",
  "   get_project_semantic_memory / get_concept_context / get_scenario_context 로 실재하는 id를 확인하라.",
  "2. 좌표(x/y)를 넣지 마라. layout은 렌더러가 계산한다 (A7).",
  "3. 개수 제한은 없지만, 한 화면에서 따라갈 수 있는 정도로 추려라 — 넘치면 warning으로",
  "   돌아오고 그래도 제출은 성공하지만, 정말 중요한 것만 남기는 편이 낫다.",
  "4. 실패하면 diagnostics 를 보고 같은 turn 에서 고쳐 다시 submit_view_ir 하라.",
].join("\n");

function requestContext(request: ViewRequest): string[] {
  const lines: string[] = [];
  if (request.anchor) lines.push(`anchor: ${JSON.stringify(request.anchor)}`);
  if (request.question) lines.push(`사용자 질문: ${request.question}`);
  return lines;
}

/**
 * Overview View Planner (§22, §6.9 [C]).
 *
 * Trace와 달리 **AI가 만든다** — 그 안의 어떤 것도 Evidence 그래프에서 결정론적으로
 * 나오지 않기 때문이다(R4의 반대 방향: Overview는 "무엇이 중요한가"라는 판단 자체다).
 */
export function buildOverviewPrompt(projectPath: string, request: ViewRequest): string {
  return [
    "이 프로젝트가 무엇을 하는지 비전공자가 한눈에 볼 수 있는 Overview를 만든다.",
    `프로젝트 경로: ${projectPath}`,
    ...requestContext(request),
    "",
    "순서:",
    "1. get_project_semantic_memory 로 Concept·Scenario 전체를 훑는다.",
    "2. Canonical Scenario(canonicalScenarios)가 있으면 그것부터 item으로 올린다 —",
    "   item.scenarioRefs 에 그 Canonical Scenario id를 넣는다. Overview는 \"코드가 무엇으로",
    "   이루어져 있는가\"가 아니라 \"여기서 어떤 일이 일어나는가\"를 보여주는 자리다 (schema2 §4).",
    "3. Canonical Scenario로 표현되지 않는 중요한 의미만 item.conceptRefs로 보충한다.",
    "4. 의미 있는 단위로 Area를 나눈다. Area는 presentation hierarchy일 뿐이다 —",
    "   새 Core ontology를 만드는 것이 아니다.",
    "5. submit_view_ir 로 { viewKind: \"overview\", ir: OverviewIR } 를 제출한다.",
    "",
    VIEW_RULES,
  ].join("\n");
}

/**
 * Scenario View Planner (§28~§33, §6.8).
 *
 * **DAG를 강요하지 않는다(R5)** — 재시도·재신청 루프는 `loop: true` + `condition`으로
 * back edge를 표시하면 된다. 같은 행동을 반복된 step으로 펼치지 마라.
 */
export function buildScenarioPrompt(projectPath: string, request: ViewRequest): string {
  return [
    "하나의 목적을 설명하는 대표 흐름(Scenario)을 만든다.",
    `프로젝트 경로: ${projectPath}`,
    ...requestContext(request),
    "",
    "순서:",
    "1. anchor가 있으면 get_scenario_context 로, 없으면 get_project_semantic_memory 로",
    "   이 흐름에 관련된 Concept·Claim을 모은다.",
    "2. 참여자(participants)와 순서가 있는 step으로 흐름을 구성한다.",
    "   **step은 Concept 하나와 1:1일 필요가 없다** — 여러 개를 하나로 압축해도 된다.",
    "3. entryStepId(시작)와 outcomeStepIds(하나 이상의 종료 지점)를 정한다.",
    "   흐름이 DAG일 필요는 없다 — 재시도/재신청 루프는 그 transition에",
    "   `loop: true` 와 반드시 `condition` 을 함께 표시한다. 같은 행동을 반복된 step으로",
    "   펼치지 마라 — 그것은 step 하나 + back edge다.",
    "4. **모든 step은 evidenceRefs 가 하나 이상 있어야 하고, entryStepId에서 도달할 수 있어야",
    "   한다** — 둘 다 없으면 거절된다.",
    "5. (선택, schema2 §5) 참여자가 특정 구간 동안 계속 관여하는 것이 의미가 있으면",
    "   activations에 { participantId, fromStepId, toStepId, evidenceRefs } 를 추가한다.",
    "   흐름이 뚜렷한 국면으로 나뉘면 phases에 { id, label, fromStepId, toStepId,",
    "   evidenceRefs } 를 추가한다. 응답/반환에 해당하는 transition은",
    "   kind: \"return\" 으로 표시한다 — `loop`(재시도)와는 다른 것이니 섞지 마라.",
    "   셋 다 선택이다 — 안 써도 흐름은 그대로 유효하다.",
    "6. submit_view_ir 로 { viewKind: \"scenario\", ir: ScenarioIR } 를 제출한다.",
    "",
    VIEW_RULES,
  ].join("\n");
}

/**
 * schema3 §5.2 Stage 3 — Stage 1 골격(`EvidenceGraph`)의 오리엔테이션 요약.
 *
 * 전체 evidence를 다시 나열하지 않는다(§7.3 index-only arm과 다른 목적이다) — Stage 3
 * agent는 이미 Stage 2에서 Semantic Memory를 만들며 저장소를 봤으므로, 여기서는 route/model
 * 목록과 link kind 분포만 줘서 "이런 골격이 있다"는 지도를 제공하고, 실제 세부는
 * `get_impact_context`/`get_scenario_context`로 필요할 때 가져오게 한다.
 */
export function buildSkeletonSummary(graph: EvidenceGraph): string {
  const routes: string[] = [];
  const models: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.kind === "route") routes.push(node.label);
    else if (node.kind === "model") models.push(node.label);
  }
  routes.sort();
  models.sort();

  const edgeKindCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    edgeKindCounts.set(edge.kind, (edgeKindCounts.get(edge.kind) ?? 0) + 1);
  }
  const kindLines = [...edgeKindCounts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return [
    `entity ${graph.nodes.size}개, link ${graph.edges.length}개.`,
    "",
    `route (${routes.length}개): ${routes.length > 0 ? routes.join(", ") : "(없음)"}`,
    `model (${models.length}개): ${models.length > 0 ? models.join(", ") : "(없음)"}`,
    "",
    "link kind 별 개수:",
    ...(kindLines.length > 0 ? kindLines.map(([kind, count]) => `  ${kind}: ${count}`) : ["  (없음)"]),
  ].join("\n");
}

/**
 * `packetEnabled=false`는 `ONTO_ASSEMBLY_CONTEXT_PACKET=off` 롤백 레버다. `get_assembly_context`가
 * shadow-first 검증 없이(§v6 §6.3의 계획과 달리) 이미 실서비스에 나가 있으므로, 사후에라도
 * 결과가 달라졌다는 게 확인되면 즉시 621dd1e 이전의 개별 tool 호출 흐름으로 되돌릴 수 있어야
 * 한다 — off일 때는 rule 1도 get_assembly_context를 언급하지 않는다.
 */
function assemblyRules(packetEnabled: boolean): string {
  return [
  "규칙:",
  "1. entityRefs·systemLinkRefs·evidenceRefs 는 전부 실재해야 한다 — 지어내지 마라.",
  ...(packetEnabled
    ? [
        "   full assembly는 get_assembly_context packet의 현재 System Entity/Link를 우선 쓰고,",
        "   packet 누락 또는 validator diagnostics를 확인할 때만 get_system_facts를 fallback으로 쓴다.",
        "   증분 assembly는 get_incremental_analysis_context와 get_system_facts 지시를 따른다.",
      ]
    : [
        "   get_system_facts 로 현재 generation의 System Entity/Link를 확인한 뒤에만",
        "   그 값을 architecture component/connection에 쓴다.",
      ]),
  "2. architecture.connections 는 valid|relocated인 System Link의 연속된 방향 경로를",
  "   요약해야 한다(I20-v4). status가 stale|missing|needs_review인 Link는 여전히 쓸 수 없다.",
  "   certainty가 inferred인 Link는 이제 거부되지 않는다 — Core가 connection.certainty를",
  "   \"inferred\"로 자동으로 낮추고 warning만 남긴다. 확실하지 않다고 연결 자체를 생략하지",
  "   말고, confirmed|grounded System Link가 없으면 inferred Link라도 연결해 그 관계가",
  "   존재한다는 사실 자체는 남겨라. workflow.edges 는 대신 evidenceRefs 로만 근거를 댄다",
  "   (하나의 워크플로우 전이가 여러 골격 hop 을 압축할 수 있기 때문이다).",
  "3. 좌표(x/y)를 넣지 마라. layout은 렌더러가 계산한다 (A7).",
  "4. presentationType 은 화면 표시용 분류일 뿐이다(schema3 §4) — 확신이 없으면 \"unknown\"",
  "   을 쓴다. 틀려도 Core identity 에는 영향이 없다. Core 토폴로지에서 origin=generated-artifact로",
  "   표시된 데이터 저장소는 파이프라인이 실행마다 스스로 만든 산출물일 가능성이 높다 — 그",
  "   저장소를 감싸는 component의 presentationType은 \"cloud\"보다 서비스 자체의 산출물임을",
  "   드러내는 값(예: \"database\"·\"unknown\")을 우선 검토한다.",
  "5. 모든 architecture.component 에 layer(actor/interface/service/state/data/external)를, 모든",
  "   connection 에 role(sync/async/data/control)을 넣는다. 이는 레이아웃과 범례의 입력이다.",
  "6. 독립 실행 런타임은 서로 다른 boundary로 표현한다. 하나의 boundary에 여러 런타임을",
  "   합치지 말고, 각 런타임의 entrypoint와 로컬 데이터 저장소를 적어도 한 component의",
  "   entityRefs/evidenceRefs로 포함한다. 매니페스트가 없어도 route Evidence가 있는 파일",
  "   (Core 토폴로지의 route surface)도 마찬가지로 어떤 component의 entityRefs에는 들어가야",
  "   한다. 누락하면 Core가 제출을 거절한다(runtime-not-represented, data-store-not-represented,",
  "   route-surface-not-represented).",
  "7. 전체 지도는 6~12개의 거시 component가 중심이어야 한다. 화면·훅·작은 모듈을 같은",
  "   수준으로 늘어놓지 말고 viewPlan.groups로 묶는다. primaryPath에는 사용자가 처음 읽을",
  "   3~7개의 component id를 순서대로 넣는다.",
  "8. 해석 가치가 있는 workflow.edges 에만 SequenceIR 을 만든다 — 모든 edge 에 만들 필요는",
  "   없다. edge.sequenceRef 와 그 SequenceIR.triggeredByEdgeId 는 반드시 서로를 가리켜야",
  "   한다(1엣지-1시퀀스, schema3 §3.4) — 어긋나면 거절된다.",
  "   동기 호출이 의미 있는 결과를 돌려주면 반대 방향의 kind: \"return\" 메시지를 그 call과",
  "   짝으로 넣고, return은 그 호출을 만든 같은 call evidenceRefs를 인용해도 된다.",
  "   비동기 발행/구독·웹훅·UI 이벤트는 kind: \"event\"이며 ui_event evidence를 인용한다.",
  "   예: call(사용자→UI) → call(UI→API) → return(API→UI) → event(UI→사용자).",
  "9. userMap.journeys 는 active Canonical Scenario마다 하나씩 만든다. 서로 다른 사용자 목적과",
  "   시스템 목적을 한 journey에 합치지 않는다. journey.id는 Canonical Scenario id를 그대로",
  "   쓰고 goal·entryStepId·outcomeStepIds·branch/loop를 보존한다. 모든 step은 근거가 있어야 한다.",
  "10. workflow.mainPath의 모든 인접 node 쌍에는 실제 workflow.edges 항목이 정확히 하나 이상",
  "   있어야 한다. mainPath를 제출하기 전에 인접 쌍을 순서대로 대조한다.",
  "11. 증분 assembly는 기존 draftId로 patch_analysis_bundle을 바로 사용한다. 전체 assembly의",
  "   최초 submit_analysis_bundle이 실패하면 응답의 draftId와 diagnostics로 실패 경로만 고쳐라.",
  "   어느 경우에도 전체 Bundle을 다시 출력하지 마라.",
  "   retryable=false면 자동 보정 한도를 쓴 것이므로 더 제출하지 마라.",
  "12. workflow.node와 architecture.component에 sublabel을 쓸 수 있다 — label이 짧은 이름일",
  "   때, 배포 종류(cloud/on-prem 등)나 구체적 기술(예: \"OpenAI gpt-4o-mini\", \"PostgreSQL\")처럼",
  "   근거가 있는 보조 설명을 sublabel에 넣는다. label을 대신하지 않는다.",
  ].join("\n");
}

/**
 * Assembly Prompt (schema3 §5.2 Stage 3).
 *
 * `analyze`(Stage 2)가 방금 커밋한 Semantic Memory와, `analyze` 이전에도 존재하는 Stage 1
 * 골격을 입력으로 "클러스터링 + 라벨링 + 역할 부여"만 지시한다 — 구조 자체를 상상하게
 * 하지 않는다(§5.2 R4의 정신을 Assembly로 확장한 것).
 */
export function buildAssemblyPrompt(
  projectPath: string,
  skeletonSummary: string,
  topologySummary: string,
  packetEnabled: boolean = true,
): string {
  return [
    "지금까지 만든 Semantic Memory와 Evidence 골격을 클러스터링·라벨링해서 " +
      "ArchitectureIR + WorkflowIR + UserMapIR + SequenceIR 한 벌(AnalysisBundle)을 만든다.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "## Evidence 골격 요약",
    "```",
    skeletonSummary,
    "```",
    "",
    "## Core가 탐지한 저장소 토폴로지 (반드시 모두 표현)",
    "```",
    topologySummary,
    "```",
    "",
    "## 제출 계약 핵심",
    analysisContractDigest(),
    "",
    "순서:",
    ...(packetEnabled
      ? [
          "1. 첫 자료 조회로 get_assembly_context를 정확히 1회 호출한다. 이 compact packet에서",
          "   Concept·Claim·CanonicalScenario와 검증된 System Entity·System Link 참조 후보 전체를 받는다.",
          "2. packet의 관계·goal·anchor·evidenceRefs를 조립 재료로 쓴다. 개별 read tool",
          "   (get_project_semantic_memory/get_system_facts/get_impact_context_batch/get_impact_context/",
          "   get_scenario_context/get_concept_context/get_evidence)은 packet 누락 또는 validator",
          "   diagnostics의 특정 참조를 확인할 때만 fallback으로 호출한다. 초기 자료를 다시 조립하려고",
          "   반복 호출하지 마라.",
        ]
      : [
          "1. get_project_semantic_memory 로 Concept·Scenario 전체를 훑는다.",
          "2. get_system_facts(entityIds 배열)로 검증된 System Entity와 System Link ID를 한 번에",
          "   가져온다. CanonicalScenario·Concept anchor가 둘 이상이면 get_impact_context_batch·",
          "   get_scenario_context_batch·get_concept_context_batch로 각각 한 번에 조회한다.",
          "   하나만 더 확인할 때만 개별 get_impact_context/get_scenario_context/get_concept_context를 쓴다.",
        ]),
    "3. architecture.components 를 만든다. 각 component 는 entityRefs 로 실제 골격 entity를",
    "   하나 이상 가리켜야 하고, evidenceRefs 는 그 entity 들의 근거를 합친 것이다.",
    "   description 을 쓰려면 evidenceRefs 가 반드시 있어야 한다(I9).",
    "4. Core 토폴로지의 런타임별로 boundary를 만들고 entrypoint·로컬 데이터 저장소가",
    "   component.entityRefs에 들어갔는지 확인한다. 화면은 기능별 group으로 압축하고",
    "   architecture.viewPlan에 primaryPath와 groups를 만든다.",
    `5. architecture.connections 를 만든다 — systemLinkRefs에 ${packetEnabled ? "packet에서" : "2번에서"} 확인한 System Link ID를`,
    "   from component → to component 방향의 연속 경로 순서로 넣는다.",
    "6. workflow.nodes/edges 를 만든다. workflow.edges 의 label 은 사용자에게 보이는 문장으로",
    "   쓰고, 여러 용어를 다룰 때는 가운데점(·)으로 잇는다(예: \"위치 · 추천 조회\").",
    "   labelTerms 에는 그 용어들을 배열로도 넣는다.",
    "7. 해석 가치가 있는 workflow.edges 마다 그 구간을 SequenceIR 로 펼쳐 sequences 에",
    "   추가하고, edge.sequenceRef 와 SequenceIR.triggeredByEdgeId 를 서로 맞춘다.",
    "   동기 call의 의미 있는 결과는 반대 방향 kind: \"return\"으로 짝을 이루게 하고 같은 call",
    "   evidenceRefs를 인용해도 된다. 비동기 발행/구독·웹훅·UI 이벤트는 kind: \"event\"로",
    "   만들고 ui_event evidence를 인용한다. 예: call → call → return → event.",
    "8. 각 active Canonical Scenario를 하나의 ScenarioIR로 펼쳐 userMap.journeys에 넣는다.",
    "   사용자 목적과 시스템 목적을 섞지 말고, participants·phases·branches·stateChanges 중",
    "   코드 근거가 있는 것만 쓴다. entry에서 모든 step이 도달 가능해야 한다.",
    "9. submit_analysis_bundle 로 { architecture, workflow, userMap, sequences } 를 제출한다.",
    "",
    assemblyRules(packetEnabled),
  ].join("\n");
}

/** Phase 5 — 기존 Bundle draft에서 ImpactSet의 ID만 고치는 assembly turn. */
export function buildIncrementalAssemblyPrompt(
  projectPath: string,
  draftId: string,
  plan: IncrementalAnalysisPlan,
  skeletonSummary: string,
  packetEnabled: boolean = true,
): string {
  return [
    "기존 AnalysisBundle 전체를 다시 만들지 말고, 영향받은 지도 조각만 증분 보정한다.",
    `프로젝트 경로: ${projectPath}`,
    `서버가 보존한 draftId: ${draftId}`,
    "",
    "## Evidence 골격 변화 요약",
    "```",
    skeletonSummary,
    "```",
    "",
    "순서:",
    "1. get_incremental_analysis_context를 호출해 정확한 ImpactSet, draftId와 bundleTargets의",
    "   현재 path/value를 확인한다. 배열 index를 추측하지 마라.",
    "2. get_system_facts에서 needs_review/stale/missing 및 그 주변 1~2 hop만 확인한다.",
    "3. 아래 ID에 해당하는 항목만 RFC 6902 operation으로 만든다.",
    `   architecture components: ${plan.impact.architectureComponentIds.join(", ") || "(없음)"}`,
    `   architecture connections: ${plan.impact.architectureConnectionIds.join(", ") || "(없음)"}`,
    `   workflow nodes: ${plan.impact.workflowNodeIds.join(", ") || "(없음)"}`,
    `   workflow edges: ${plan.impact.workflowEdgeIds.join(", ") || "(없음)"}`,
    `   user journeys: ${plan.impact.scenarioIds.join(", ") || "(없음)"}`,
    `   sequences: ${plan.impact.sequenceIds.join(", ") || "(없음)"}`,
    `4. patch_analysis_bundle({ draftId: ${JSON.stringify(draftId)}, operations })로 제출한다.`,
    "   전체 architecture/workflow/userMap/sequences 배열을 replace하지 마라.",
    "5. 검증 실패 시 같은 draftId와 diagnostics 경로만 다시 고친다.",
    "",
    assemblyRules(packetEnabled),
  ].join("\n");
}

function referenceLabel(ref: EntityRef): string {
  switch (ref.kind) {
    case "file": return ref.filePath;
    case "symbol": return ref.symbolId;
    case "route": return ref.routeKey;
    case "model": return ref.modelKey;
    case "resource": return `${ref.namespace}:${ref.key}`;
  }
}

function currentSystemFact(status: SystemFactStore["entities"][number]["status"]): boolean {
  return status === "valid" || status === "relocated";
}

function limitLines(items: readonly string[], max: number = 8): string[] {
  if (items.length <= max) return [...items];
  return [...items.slice(0, max), `- … 외 ${items.length - max}개`];
}

/**
 * Architecture 저작 turn에만 넣는 결정론적 저장소 브리핑. 이것은 grounding gate가 아니라
 * agent가 먼저 살펴볼 후보를 정확히 알려 주는 orientation 자료다.
 */
export function buildArchitectureRepositoryBriefing(
  topology: RepositoryTopology,
  systemFacts?: SystemFactStore,
): string {
  const runtimeLines = topology.runtimes.map((runtime) => {
    const entrypoints = runtime.entrypointRefs.length > 0 ? runtime.entrypointRefs.join(", ") : "(탐지 없음)";
    return `- ${runtime.label} · ${runtime.kind} · root=${runtime.rootPath || "."} · entrypoint=${entrypoints} · origin=${runtime.origin}`;
  });
  const routeLines = topology.routeSurfaces.map((surface) => {
    const keys = surface.routeKeys.slice(0, 6).join(", ");
    const more = surface.routeKeys.length > 6 ? ` 외 ${surface.routeKeys.length - 6}개` : "";
    return `- ${surface.filePath}: ${keys || "(route key 없음)"}${more}`;
  });
  const storeLines = topology.dataStores.map((store) => {
    const origin = store.origin === "generated-artifact"
      ? "생성 산출물 — 샘플/실행 출력이므로 독립 component로 만들지 말 것"
      : `선언된 ${store.format.toUpperCase()} 저장소`;
    return `- ${store.label} · root=${store.rootPath} · ${origin}`;
  });

  const currentEntities = (systemFacts?.entities ?? []).filter((item) => currentSystemFact(item.status));
  const currentLinks = (systemFacts?.links ?? []).filter((item) => currentSystemFact(item.status));
  const externalLines = currentEntities
    .filter((item) => item.ref.kind === "resource")
    .map((item) => `- ${referenceLabel(item.ref)} (${item.certainty})`)
    .sort();
  const usesLines = currentLinks
    .filter((item) => item.kind === "uses" && (item.from.kind === "resource" || item.to.kind === "resource"))
    .map((item) => `- ${referenceLabel(item.from)} → ${referenceLabel(item.to)}${item.mechanism ? ` · ${item.mechanism}` : ""}`)
    .sort();
  const httpLines = currentLinks
    .filter((item) => item.kind === "http_call")
    .map((item) => `- ${referenceLabel(item.from)} → ${referenceLabel(item.to)} · ${item.mechanism ?? "HTTP"} · ${item.certainty}`)
    .sort();

  return [
    "## 서버가 확인한 저장소 브리핑 (후보이며 hard gate가 아님)",
    "### 독립 런타임",
    ...(runtimeLines.length > 0 ? limitLines(runtimeLines) : ["- (탐지 없음)"]),
    "### 라우트 표면",
    ...(routeLines.length > 0 ? limitLines(routeLines) : ["- (탐지 없음)"]),
    "### 로컬 데이터",
    ...(storeLines.length > 0 ? limitLines(storeLines) : ["- (탐지 없음)"]),
    "### 외부 라이브러리·서비스 (System Fact)",
    ...(externalLines.length > 0 ? limitLines(externalLines) : ["- (현재 fact 없음 — 코드에서 직접 확인)"]),
    ...(usesLines.length > 0 ? ["### 외부 사용 관계", ...limitLines(usesLines)] : []),
    "### HTTP 호출 ↔ 라우트 매칭",
    ...(httpLines.length > 0 ? limitLines(httpLines, 12) : ["- (확인된 매칭 없음)"]),
    "이 목록은 존재가 확인된 후보를 요약한 것이다. 전부를 component로 그리라는 뜻은 아니지만,",
    "프론트엔드↔백엔드 HTTP와 외부 서비스 관계는 구조 지도에서 반드시 검토한다.",
  ].join("\n");
}

/**
 * 세션 미리보기를 사람이 읽을 이름으로 바꾼다.
 *
 * provider 가 주는 미리보기는 "첫 사용자 메시지"인데 우리가 보낸 첫 메시지는 위의 래퍼다.
 * 그대로 보여주면 모든 세션이 똑같아 보여서 고를 수가 없다. 우리가 감쌌으므로 우리가 푼다.
 */
export function describeSession(preview: string): string {
  const text = preview.trim();
  if (!text) return "(빈 대화)";
  if (text.startsWith("이 프로젝트의 의미 구조를 처음으로")) return "전체 분석";
  if (text.startsWith("코드가 바뀌었다")) return "증분 분석";
  if (text.startsWith("아래는 이 프로젝트의 Evidence Index 요약")) return "분석 (index-only arm)";
  if (text.startsWith("이 프로젝트가 무엇을 하는지")) return "Overview 생성";
  if (text.startsWith("하나의 목적을 설명하는 대표 흐름")) return "Scenario 생성";
  if (text.startsWith("지금까지 만든 Semantic Memory와 Evidence 골격을")) return "Architecture/User Map/Sequence 조립";
  if (text.startsWith("기존 AnalysisBundle 전체를 다시 만들지 말고")) return "증분 Architecture/User Map/Sequence 보정";
  if (text.startsWith("이 프로젝트의 시스템 구조 지도를 직접 저작한다.")) return "시스템 구조 지도 저작";
  return text.replace(/\s+/gu, " ").slice(0, 80);
}

/**
 * 채널 검증 전용 프롬프트 (acceptance 2·3).
 *
 * **의미를 만들지 않는다.** `submit_semantic_patch` 는 M4 에서 붙으므로, 그 전에 분석
 * 프롬프트를 쓰면 agent 가 만들 수는 있는데 낼 곳이 없어 혼란스러운 결과를 낸다.
 *
 * 이 프롬프트가 증명하려는 것은 하나다 — **agent 가 MCP tool 을 실제로 부르는가, 그리고
 * 그 호출이 bridge 에 도달하는가.** 그래서 두 tool 을 명시적으로 지시하고 끝낸다.
 * spike 가 확인했듯 agent 는 MCP 를 자발적으로 부르지 않는다(§6.5).
 */
export function buildVerifyPrompt(projectPath: string): string {
  return [
    "MCP 연결을 확인하는 중이다. 코드를 고치지 마라. 파일을 쓰지 마라.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "정확히 이 순서로 하라:",
    "1. `get_project_semantic_memory` 를 부른다 (인자 없이).",
    "2. `get_evidence` 를 `{ \"kind\": \"symbol\" }` 로 부른다.",
    "3. 두 응답에서 본 것을 3줄 이내로 요약하고 끝낸다.",
    "",
    "tool 을 부르지 못했다면 그 사실과 오류 메시지를 그대로 보고하라. 지어내지 마라.",
  ].join("\n");
}

/**
 * V8 — 시스템 구조 지도 저작 turn.
 *
 * `buildAssemblyPrompt`와 근본적으로 다르다: `get_assembly_context`/`get_evidence`/
 * `get_system_facts` 등 grounding MCP tool을 전혀 지시하지 않는다. 대신 archify SKILL.md의
 * "Fast authoring path"(스키마 1개 + 예시 1개만 읽고, 최대 12개 컴포넌트로 저작, validate 후
 * 반복 수정, 두 라운드 연속 무개선이면 중단하고 보고)를 그대로 프롬프트 텍스트로 옮긴다.
 *
 * 저장소 탐색은 이 turn의 native Read/Grep/Glob(모든 TaskMode에 이미 부여됨)로 한다 — 새
 * evidence 도구를 만들지 않는다. 서버가 미리 계산한 저장소 브리핑은 탐색 우선순위를 주되
 * grounding gate가 아니다 — agent가 코드로 대표 여부를 판단한다.
 */
export function buildArchitectureViewPrompt(projectPath: string, repositoryBriefing?: string): string {
  const maxRounds = 6;
  return [
    "이 프로젝트의 시스템 구조 지도를 직접 저작한다.",
    `프로젝트 경로: ${projectPath}`,
    "",
    "이것은 기존 core+ai 분석(semantic memory/System Fact grounding)과 완전히 다른 경로다.",
    "get_project_semantic_memory·get_system_facts·get_evidence 같은 grounding tool을 부르지",
    "마라 — 이 turn에는 없다. 대신 네가 가진 Read/Grep/Glob으로 저장소를 직접 읽는다.",
    "",
    repositoryBriefing ?? "## 서버가 확인한 저장소 브리핑\n(브리핑을 만들 수 없었다. 코드에서 직접 구조를 확인한다.)",
    "",
    "## 산출물 스키마 (JSON Schema, draft 2020-12)",
    "```json",
    architectureViewSchemaText().trim(),
    "```",
    "",
    "## 예시 (이 모양을 그대로 따른다 — 내용은 참고용일 뿐이다)",
    "```json",
    architectureViewExampleText().trim(),
    "```",
    "",
    "순서 (Fast authoring path):",
    "1. Read/Grep/Glob으로 저장소의 진입점·주요 런타임(프론트/백엔드/DB/외부 서비스)과",
    "   그 사이의 실제 호출 관계를 파악한다. 파일 전체를 다 읽을 필요는 없다 — 구조를",
    "   드러내는 지점(entrypoint, 라우트 선언, 설정, 주요 클라이언트 호출)만 본다.",
    "2. 위 스키마를 만족하는 ArchitectureViewDocument를 저작한다.",
    "   - components는 6~12개의 거시 단위로 묶는다 — 파일/함수 단위로 늘어놓지 않는다.",
    "   - 기본 viewBox는 1200×760이다. 사용자 → 프론트엔드 → API → 서비스 → 저장소/외부의",
    "     좌→우 계층 밴드를 우선하고, component는 대체로 145~200×70~80, 열 간 통로는 60px 이상,",
    "     행 간 통로는 24px 이상 남긴다. 모든 component에 pos/size를 직접 정한다.",
    "   - 독립 런타임과 외부 서비스는 boundary로 감싼다. variant는 emphasis=주 경로,",
    "     security=인증/비밀 경유, dashed=비동기·추정 관계다. cards는 핵심 결론 3장으로 쓴다.",
    "   - 근거가 있는 component에는 sources[]에 { path, line?, endLine? }로 실제 파일 위치를",
    "     적는다. 지어내지 마라 — 존재하지 않는 경로/줄 범위는 제출 후 error로 거절된다.",
    "   - connections는 실제로 코드에서 확인한 호출/의존 관계만 넣는다. 프론트엔드가 백엔드를",
    "     HTTP로 호출하면 반드시 하나의 connection으로 그리고, 외부 SaaS/LLM/스토리지는",
    "     external/cloud component 후보로 반드시 검토한다.",
    "3. validate_architecture_view로 문서를 검증한다. diagnostics의 severity:\"error\"는",
    "   반드시 고친다. severity:\"warning\"(예: 탐지된 런타임/데이터 저장소/라우트를 인용하는",
    "   component가 없다는 completeness 경고)은 근거가 있으면 반영하고, 근거가 없거나 정말",
    "   대표할 component가 없으면 남겨도 된다 — 저작을 막지 않는다.",
    `4. error가 남아 있으면 고쳐서 다시 validate한다. 단, 같은 이유로 연속 2라운드 동안`,
    "   error 개수가 줄지 않으면 멈추고 남은 diagnostics를 그대로 보고한다 — 무한히 왕복하지",
    `   마라(validate와 submit 합산 최대 ${maxRounds}회).`,
    "5. error가 없으면(또는 4번 조건으로 멈췄으면) submit_architecture_view로 제출한다.",
    "",
    "규칙:",
    "1. 좌표(pos)는 이 turn에서만 AI가 직접 쓴다 — 다른 뷰(Workflow 등)의 \"AI는 좌표를 쓰지",
    "   않는다\" 규칙은 여기 적용되지 않는다. Architecture 뷰 전용 예외다.",
    "2. sources[]의 path/line은 실재해야 한다(허구 grounding 0) — 확인 없이 줄 번호를",
    "   추측하지 마라. 확신이 없으면 line/endLine을 생략하고 path만 남긴다.",
    "3. label은 파일명이 아니라 사용자가 이해할 수 있는 이름을 쓴다. sublabel에는 구체적",
    "   기술(예: \"PostgreSQL\", \"Redis\")이나 배포 형태를 적을 수 있다.",
    "4. 전체 지도가 아니라 이 프로젝트를 처음 보는 사람이 5분 안에 이해할 수 있는 지도를",
    "   만든다는 것이 목표다 — 6~12개 노드를 벗어나지 않는다.",
  ].join("\n");
}
