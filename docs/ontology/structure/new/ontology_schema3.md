# ontology_schema3.md — 통합 화면 / Architecture·Workflow·Sequence Bundle

> **상태: DRAFT.** 이 문서는 실제 사용 후 나온 재설계안이다. 확정되면 FROZEN으로 전환한다.
> 선행 문서는 [old/m0_m8/ontology_schema.md](../old/m0_m8/ontology_schema.md)(이하 `schema`),
> [old/m0_m8/implementation_plan.md](../old/m0_m8/implementation_plan.md)(이하 `plan`),
> [old/m9_m13/ontology_schema2.md](../old/m9_m13/ontology_schema2.md)(이하 `schema2`, FROZEN)다.
> 이 문서의 §는 자기 자신을 가리킨다. `I n`은 `schema`/`schema2`가 쌓아 온 불변식 번호 체계를
> 이어받아 **I18부터** 계속한다.

---

## 0. 문서 목적과 선행 문서와의 관계

`schema`가 Core(Evidence Engine, Semantic Memory, Validator, generation store)를,
`schema2`가 그 위의 Viewer 층(Reading Depth, Node Finder, ScenarioIR v2, ReachabilityIR,
Project Reader/Runtime Console 분리)을 확정했다. M9~M13으로 구현까지 끝났다.

이 문서는 **그 구현을 실제로 써 본 뒤** 나온 재설계다. `schema2`가 그랬듯 이번에도 이유는
관찰이다:

1. Project Reader와 Runtime Console을 화면으로 분리한 결과(`schema2` I17), 분석이 진행되는
   동안 사용자가 "지금 무슨 일이 일어나고 있는가"를 보려면 탭을 옮겨야 했다.
2. 프로젝트를 열면 `OverviewIR` 색인(`schema2` §4)을 먼저 보여주는 흐름이, 분석을 아직
   돌리지 않은 상태에서는 "분석해서 무엇을 알 수 있는가"를 보여주지 못하고 대신 explorer
   화면으로 사용자를 붙잡아 둔다.
3. Overview/Scenario View는 `requestHash` 단위로 여러 벌 존재할 수 있고, 그 캐시가
   `BridgeState.viewCache`라는 **in-memory Map**이라 프로세스가 재시작되면 사라진다.
   Trace/Reachability는 애초에 캐시가 없다. 결과적으로 화면을 오갈 때마다 재요청이 발생한다
   — 이는 프론트가 잘못 짠 게 아니라 **뷰마다 독립적으로 캐시 키를 갖는 API 형태 자체의
   설계**다.
4. 참고 삼아 다시 살펴본 archify 산출물(`reference/output_example/`)은 "아키텍처 다이어그램 +
   사용자 워크플로우 다이어그램 + (클릭 시) 시퀀스 다이어그램" 세 가지를 **한 번의 분석에서
   전부 만들어 즉시 보여준다.** `schema2`가 채택한 Overview/Scenario/Trace/Reachability
   4-View를 사용자가 직접 골라 들어가는 최상위 메뉴 구조는 이 결과물 형태를 자연스럽게
   만들어내지 못한다.

**I1~I17을 상속하고, 이 문서가 뒤집는 것은 명시적으로 표시한다.** `schema2` §6.3이 `plan §4`를
다시 열며 썼던 방식을 그대로 따른다 — 조용히 넘어가지 않는다. 이 문서가 실제로 다시 여는 것은
**I16/A13**(§4)과 **I17**(§2.3)이다. 나머지 — Evidence Engine의 주소 기반 grounding, Validator
5단계, `projectTrace`/`projectReachability`의 결정론적 투영, `SemanticConcept`에 전역 `type`을
두지 않는 것 — 은 그대로 유지한다.

---

## 1. 새 목표 화면

```
프로젝트 import
      ↓
[분석 시작] 단일 CTA           ← Overview/Explorer로 붙잡지 않는다
      ↓
분석 중 — 메인 화면 자체가 실시간 상황판   ← 별도 콘솔 탭 없음
      ↓
분석 완료 — 탭 2개: [아키텍처] [워크플로우]   ← 둘 다 이미 만들어져 있다, 탭 전환은 재요청 없음
      ↓                              ↓
  블록 클릭 → 우측 패널            엣지 라벨 클릭 → 우측 패널에 시퀀스
  (설명 / in·out / 연관 코드 파일)   (분석 시점에 이미 생성되어 있음)
```

이 흐름을 만드는 데 필요한 것은 네 가지다: (a) 상태 머신 재설계(§2), (b) 세 산출물을 한 번에
담는 IR과 Bundle(§3), (c) 그 산출물을 archify처럼 시각적으로 구분하기 위한 타입 축(§4),
(d) 그것들을 실제로 한 번의 분석 turn에서 만들어내는 파이프라인(§5).

---

## 2. 메인 화면 상태 전이

### 2.1 상태 머신

```text
NoProject
  └─ importProject() ──────────────▶ Indexing
Indexing   (indexOnly() 재사용 — 결정론적 reindex, LLM 없음, 수 초)
  └─ success ──────────────────────▶ ReadyToAnalyze
       explorer 없이 "분석 시작" 단일 CTA.
       EvidenceIndex는 이미 있으므로 파일·심볼·adapter 개수 같은 가벼운 결정론적
       통계는 CTA 옆에 보여줘도 된다 — 전체 explorer는 아니다.
ReadyToAnalyze
  └─ click(분석 시작) ─────────────▶ Analyzing
Analyzing
  메인 뷰포트 자체가 실시간 상황판이다 (§2.3)
  └─ task.completed & bundle 저장 완료 ──▶ Analyzed
  └─ task.error / task.interrupted ──────▶ AnalyzeFailed
                                            (같은 화면에 배너 + 재시도. 별도 에러 페이지 아님)
Analyzed
  탭: [아키텍처] [워크플로우]  ── 로컬 state 전환만. 이미 fetch한 AnalysisBundle을 읽는다.
  ├─ click(node) ─────────────▶ Analyzed + PanelOpen(nodeId)         (§6 Passport)
  └─ click(edge label, workflow 탭) ▶ Analyzed + SequenceOpen(sequenceRef) (같은 패널, 다른 렌더러)
  └─ (재인덱싱 트리거) ───────▶ Indexing
       완료 후 SemanticWorkSet이 비어 있지 않으면 기존 Bundle을 지우지 않고
       freshness = "needs_review" 배너만 얹는다 (`ViewFreshness`, schema2 §2.1 재사용).
```

핵심 결정: **"분석 시작" 버튼은 `/api/analyze` 단 한 번만 호출한다.** 탭 전환·블록 클릭·엣지
클릭은 이미 받아온 `AnalysisBundle`(§3.5)에 대한 로컬 상태 변경일 뿐, 추가 API 요청을 만들지
않는다. `schema2` §5.1이 지적한 "탭마다 개별 view turn"이라는 구조 자체가 사라진다.

**분석 완료 시점은 세 산출물(아키텍처/워크플로우/전체 시퀀스)이 전부 끝난 뒤 한 번에** Analyzed로
전이한다. 부분 완료 시점의 점진적 노출(예: 아키텍처만 먼저 보여주고 시퀀스는 뒤이어 채움)은
초기 분석 시간을 줄일 수 있지만, "탭을 눌러도 재요청이 없다"는 이번 재설계의 핵심 약속을
지키려면 화면 전환 시점에는 모든 것이 이미 준비돼 있어야 한다. 이번 개정 범위에서는 후자를
택한다.

### 2.2 Analyzing 상태 — 두 층

Analyzing 동안 메인 뷰포트가 곧 실시간 상황판이 된다. 기존 `AgentEvent` 스트림(WS `/events`)을
두 층으로 나눠 렌더링한다.

- **1층 — Phase Stepper (기본 노출)**: `analysis.progress { phase, message }`를 단계 목록으로
  매핑한다 — `indexing → skeleton(구조 파악) → semantic memory(의미 이해) →
  assembly(아키텍처/워크플로우 생성) → sequences(시퀀스 생성, n/m) → validating → done`.
  `agent.action.started/completed`는 각 단계 안의 세부 틱으로 렌더한다.
- **2층 — Diagnostics Drawer (기본 접힘, 아이콘으로 펼침)**: `mcp.tool.called`,
  `agent.file.explored`, `agent.usage`, `validation.failed` 등 "onto 자신이 무엇을 했는가"에
  해당하는 정보. 지금 `RuntimeConsole.tsx`가 보여주던 것과 같은 재료다.

### 2.3 I17을 다시 연다 — Console은 화면이 아니라 상태다

`schema2` I17은 "Project Reader와 Runtime Console은 화면을 공유하지 않는다"고 못박았다.
근거는 §3.2였다: 분석 *대상*의 구조와 분석기 *자신*의 상태를 한 캔버스에 섞으면, 메인 화면이
"내 프로젝트는 어떻게 동작하는가"가 아니라 "내 분석기는 잘 돌고 있는가"에 답하게 된다는 것.

**이 문서는 I17을 다시 열되, §3.2의 우려는 그대로 지킨다.** 다시 여는 부분은 오직 **배치**다.

- Analyzing 상태에는 애초에 "제품 캔버스"가 없다 — 아직 `AnalysisBundle`이 없으므로 보여줄
  아키텍처/워크플로우 노드 자체가 존재하지 않는다. 이 시점에 진행 상황을 보여주는 것은
  "분석기 상태가 제품 캔버스의 노드로 승격되어 섞이는 것"이 아니라, **아직 존재하지 않는
  캔버스의 자리를 진행 상황이 대신 채우는 것**이다. §3.2가 경계한 "섞임"이 성립하지 않는다.
- Analyzed 상태에서는 Diagnostics Drawer가 여전히 **접힌 보조 패널**로만 존재한다.
  아키텍처/워크플로우 탭의 노드·엣지 목록에 진단 정보가 섞여 들어가지 않는다 — 이 경계는
  그대로 유지한다.

즉 재해석은 "Console을 없앤다"가 아니라 **"Console이 언제나 별도 최상위 탭이어야 한다는
요구만 없앤다"**다. `RuntimeConsole.tsx`의 `useAgentEvents`/`describeEvent`/
`GET /api/tasks/:id/mcp-evidence` 로직은 삭제 대상이 아니라 Phase Stepper·Diagnostics
Drawer 컴포넌트로 이식하는 대상이다.

`Shell.tsx`의 최상위 `role="tablist"`(Project Reader ↔ Runtime Console 완전 언마운트 전환)는
제거한다.

---

## 3. 새 IR — `ArchitectureIR` / `WorkflowIR` / `SequenceIR` / `AnalysisBundle`

`packages/protocol/src/index.ts`의 기존 타입(`EntityRef`, `Evidence`, `ScenarioParticipant`,
`ScenarioActivation`, `ScenarioPhase`)을 재사용/확장한다. 새 타입을 지어내기보다 있는 어휘를
넓히는 쪽을 택했다 — `schema2` §5가 `ScenarioIR`에 필드 세 개만 더해 archify sequence 문법을
빌렸던 것과 같은 태도다.

### 3.1 `ComponentIO` — in/out 요소

```ts
type ComponentIO = {
  label: string;                 // "GET /api/bookings", "BookingCreated"
  kind: "route" | "event" | "db" | "call" | "config" | "other";
  direction: "in" | "out";
  entityRef?: EntityRef;         // 있으면 Stage 1 골격 그래프 노드로 역참조 가능 (§5.2)
  evidenceRefs: string[];        // 빈 배열 금지 — validator가 거부한다 (I9 재확인)
  description?: string;
};
```

### 3.2 `ArchitectureIR`

```ts
type ArchitectureComponent = {
  id: string;
  label: string;
  sublabel?: string;
  presentationType: PresentationType;       // §4
  presentationTypeConfidence?: number;
  boundaryId?: string;
  conceptRefs?: string[];        // SemanticConcept.id (있으면)
  entityRefs: string[];          // 이 컴포넌트가 요약하는 실제 골격 노드들 (entityKey[])
  evidenceRefs: string[];        // entityRefs가 근거로 삼는 Evidence.id 합집합
  description?: string;          // evidenceRefs 비었으면 validator가 거부 (I9)
  inputs?: ComponentIO[];
  outputs?: ComponentIO[];
  confidence?: number;
};

type ArchitectureBoundary = {
  id: string;
  label: string;
  kind: string;                  // 시각적 그룹 종류. 자유 문자열 (I3와 같은 이유)
  wraps: string[];                // 포함하는 component id
};

type ArchitectureConnection = {
  id: string;
  from: string;
  to: string;
  label?: string;
  role?: "sync" | "async" | "data" | "control";
  /**
   * Stage 1 골격 엣지 롤업 — AI가 지어낸 연결이 아님을 증명 (§5.2, I20).
   * `TraceLink` 자체는 `(fromId, toId, kind)`로만 식별되고 독립된 id가 없으므로,
   * 여기 들어가는 값은 그 골격 링크를 뒷받침하는 **link-role `Evidence.id`**다.
   */
  traceLinkRefs: string[];
  evidenceRefs: string[];
};

type ArchitectureIR = {
  title: string;
  components: ArchitectureComponent[];
  boundaries: ArchitectureBoundary[];
  connections: ArchitectureConnection[];
};
```

### 3.3 `WorkflowIR`

```ts
type WorkflowLane = { id: string; label: string; kind: "actor" | "system" };

type WorkflowNode = {
  id: string;
  laneId: string;
  label: string;
  sublabel?: string;
  presentationType: PresentationType;
  conceptRefs?: string[];
  entityRefs: string[];
  evidenceRefs: string[];
  description?: string;
  inputs?: ComponentIO[];
  outputs?: ComponentIO[];
};

type WorkflowEdge = {
  id: string;
  from: string;
  to: string;
  /** 화면에 보이는 문자열. 예: "위치 · 추천 조회" — 가운데점으로 여러 용어를 잇는다 (§3.4) */
  label?: string;
  /** ["위치", "추천 조회"] — 구조화된 형태. SequenceIR.phases[]와 1:1 매핑된다 */
  labelTerms?: string[];
  role: "main" | "error" | "async" | "return";
  /** 클릭 시 열릴 시퀀스. 분석 시점에 이미 생성되어 있다 — 클릭은 조회일 뿐 요청이 아니다 */
  sequenceRef?: string;
  /**
   * `traceLinkRefs`가 없다 — `ArchitectureConnection`과 달리 골격 엣지를 직접 롤업하지
   * 않는다. 대신 `from`/`to`가 가리키는 `WorkflowNode.entityRefs`가 이미 골격 노드로
   * 검증되어 있고(I20), 이 엣지 자신은 `evidenceRefs`로 근거를 댄다 (I9). 하나의 워크플로우
   * 전이가 여러 골격 hop을 압축한 것일 수 있어 1:1 링크 롤업을 강제하지 않는다 (§6.2).
   */
  evidenceRefs: string[];
};

type WorkflowIR = {
  title: string;
  lanes: WorkflowLane[];
  mainPath: string[];            // 해피패스 node id 순서
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};
```

### 3.4 엣지 라벨과 시퀀스의 관계

`WorkflowEdge.sequenceRef → SequenceIR.id`, 역방향은 `SequenceIR.triggeredByEdgeId →
WorkflowEdge.id`. 1엣지-1시퀀스로 단순하게 고정한다.

라벨이 여러 용어를 담을 때(`'위치 · 추천 조회'`처럼)는 새 개념을 만들지 않고 **기존
`ScenarioPhase`**로 분절한다 — 용어 하나당 phase 하나. archify sequence.json의 `segments[]`가
하던 역할을 `schema2` §5가 이미 `ScenarioPhase`로 옮겨 놨으므로 그대로 재사용한다.

### 3.5 `SequenceIR`과 `AnalysisBundle`

```ts
type SequenceMessage = {
  id: string;
  fromParticipantId: string;
  toParticipantId: string;
  /** 좌표가 아니다. 정수 전순서 — 렌더러가 y를 계산한다 (schema A7·A12, schema2 I14 재확인) */
  order: number;
  label: string;
  kind: "call" | "return" | "event";
  evidenceRefs: string[];
};

type SequenceIR = {
  id: string;
  title: string;
  triggeredByEdgeId: string;             // WorkflowEdge.id 역참조 (breadcrumb)
  participants: ScenarioParticipant[];   // 기존 타입 재사용
  messages: SequenceMessage[];
  activations?: ScenarioActivation[];    // 기존 타입 재사용 (schema2 §5)
  phases?: ScenarioPhase[];              // 기존 타입 재사용, labelTerms 분절에 쓴다
  evidenceRefs: string[];
  confidence?: number;
};

/** 분석 시점에 한 번에 생성되고 generation에 원자적으로 커밋되는 단위 (§5.4) */
type AnalysisBundle = {
  analysisVersion: number;
  semanticVersion: number;
  architecture: ArchitectureIR;
  workflow: WorkflowIR;
  sequences: SequenceIR[];       // WorkflowEdge.sequenceRef가 가리키는 전체 집합
  freshness: "current" | "needs_review";
};
```

---

## 4. `presentationType` — I16/A13을 다시 연다

### 4.1 원래 결정과 그 근거

`schema2` A13은 archify의 component type enum(`frontend`/`backend`/`database`/`cloud`/
`security`/`messagebus`/`external`)과 거기 걸린 색·아이콘 체계를 **명시적으로 차용하지 않기로**
했다. I16이 그 불변식이다 — "노드 색은 전역 semantic kind에서 오지 않는다." 근거는 §1.3이다:
`SemanticConcept`에는 `type`이 없고 `hints`만 있으며, `hints`는 "틀리거나 없어도 의미와
Grounding은 유효해야" 한다(I3). **틀릴 수 있는 값에 색을 걸면 화면이 조용히 거짓말한다.**

### 4.2 이번에 다시 여는 이유

`schema2`가 대신 제시한 대체 축(hop 거리, SCC 그룹, grounding 상태, freshness, story 진행)은
Trace/Reachability 같은 **코드 그래프 View**에는 잘 맞는다. 그러나 이번에 새로 만드는
`ArchitectureIR`/`WorkflowIR`는 archify의 architecture.json/workflow.json과 같은 자리를
차지하는 산출물이고, 그 형식의 가독성은 정확히 "이 블록이 프런트엔드인지 DB인지 외부
서비스인지 한눈에 색으로 구분된다"는 데서 나온다. 이 축 없이는 archify가 보여준 결과물 형태를
재현할 수 없다.

### 4.3 절충안

**`SemanticConcept`는 그대로 둔다 — 전역 `type` 필드를 추가하지 않는다 (I3, I16의 핵심은
그대로 유지).** 대신 `presentationType`(§3.2, §3.3)을 **View IR에만** 새로 둔다.

```ts
type PresentationType =
  | "external" | "frontend" | "backend" | "database"
  | "queue" | "security" | "job" | "cloud" | "unknown";
```

이것은 I16을 폐기하는 것이 아니라 **레이어를 나누는 것**이다. I16이 막은 것은 "Core identity가
전역 taxonomy를 갖는 것"이었지, "화면이 표시 목적의 분류를 갖는 것"이 아니었다 — `schema` §9
자체가 "고정되는 것 = View의 문법, 고정되지 않는 것 = 화면에 보이는 프로젝트 의미"라고 이미
구분해 뒀다(`schema2` §1.3이 인용). `presentationType`은 이 구분에서 **문법 쪽**에 속한다.

`schema2` §1.3이 경고한 "화면이 조용히 거짓말한다"는 위험은 다음 두 안전장치로 막는다.

- **`presentationType`은 Grounding·Concept로 역류하지 않는다.** Stage 3(§5.2)에서 매겨지는
  표시용 라벨일 뿐 identity가 아니며, 다음 분석에서 재분류될 수 있는 값으로 취급한다.
  `presentationTypeConfidence`를 항상 함께 노출해 "이건 추정"이라는 사실을 화면에서
  숨기지 않는다.
- **`"unknown"`을 항상 유효한 값으로 둔다.** 분류에 실패해도 컴포넌트를 숨기거나 렌더링을
  막지 않는다 — `schema` §9가 경계했던 "taxonomy 강제로 인한 의미 손실"이 재발하지 않게 한다.

### 4.4 새 불변식

**I18.** `presentationType`은 View IR(`ArchitectureIR`/`WorkflowIR`)에만 존재하며
`SemanticConcept`/`SemanticClaim`에는 절대 추가되지 않는다. Grounding·identity 판정은
`presentationType`을 참조하지 않는다.

---

## 5. 분석 파이프라인 재설계

### 5.1 현재와의 차이

현재는 `index(결정론)` → `analyze(LLM, 자유 형식 semantic memory 생성)` → 뷰 요청마다 개별
경로(Overview/Scenario는 LLM turn + in-memory 캐시, Trace/Reachability는 캐시 없이 매번
동기 재계산)로 나뉘어 있다. 새 파이프라인은 이 전부를 **`/api/analyze` 한 번의 task 안에서**
5단계로 실행하고, 그 결과인 `AnalysisBundle`을 generation에 영속시킨다.

### 5.2 다섯 단계

```text
Stage 0 — Reindex (기존 그대로 유지)
  reindex() → EvidenceIndex. 변경 없음.

Stage 1 — Deterministic Skeleton (신규, LLM 이전에 실행, LLM 미사용)
  entrypoint(route 등) 집합을 anchor로 기존 buildEvidenceGraph를 돌려 골격 그래프를 만든다.
  노드 = 실제 file/symbol/route/model, 엣지 = 실제 call/reference/api_handler/db_read/
  db_write/ui_event linkKind + evidenceRefs. 이것이 **AI가 절대 벗어날 수 없는 뼈대**다.

Stage 2 — Semantic Memory (기존 LLM turn, 그대로 유지)
  MCP로 골격 + 코드 탐색 → SemanticConcept/SemanticClaim/CanonicalScenario 제안
  → submit_semantic_patch → Validator ⓪~⑤.

Stage 3 — Assembly (신규, 제약된 LLM)
  Stage 1 골격 + Stage 2 semantic memory를 입력으로 "클러스터링 + 라벨링 + 역할 부여"만
  수행한다 — 근거 없는 컴포넌트/연결 생성이 스키마 레벨에서 불가능하다.
    - 골격 노드들을 ArchitectureComponent로 클러스터링
      (entityRefs로 반드시 실제 골격 노드를 참조해야 한다)
    - 골격 엣지들을 ArchitectureConnection.traceLinkRefs로 롤업
      (라벨·role만 AI가 부여, 연결의 존재 자체는 기계적으로 집계된 것)
    - CanonicalScenario + 골격을 결합해 WorkflowIR(lanes/nodes/mainPath/edges) 생성
    - 해석 가치가 있는 WorkflowEdge마다(2-hop 이상이거나 CanonicalScenario에 연결된 것)
      해당 구간의 골격 서브그래프를 SequenceIR로 펼친다
      — "상상"이 아니라 "이미 아는 경로를 시퀀스 형식으로 재배열"한 것
    - 신규 MCP 도구 submit_analysis_bundle(기존 submit_view_ir의 후계)로 Bundle 통짜 제출

Stage 4 — Validate & Persist (기존 Validator 확장)
  새 AJV 스키마(analysis-bundle) 검증 + grounding validator(evidenceRefs가 실제
  EvidenceIndex에 존재하는지, traceLinkRefs가 Stage 1에서 실제로 나온 엣지인지) 통과 시
  generation commit에 analysis-bundle.json으로 다른 상태 파일들과 원자적으로 함께 커밋한다.
```

### 5.3 Stage 1이 하는 일 — Trace/Reachability의 재배치

`projectTrace`/`buildEvidenceGraph`(BFS + Tarjan SCC, `schema` §37 R4: "AI가 만들지 않는다")는
폐기하지 않는다. 오히려 이번 재설계에서 **더 중심적인 역할**을 맡는다 — Architecture/Workflow의
connection·edge가 AI의 자유 서술이 아니라 결정론적 골격의 롤업이라는 것을 보장하는 근거가 된다.
동시에 §6의 Passport 패널에서 온디맨드 upstream/downstream 조회(`projectReachability`)로도
쓰인다.

### 5.4 캐시를 API 형태에서 없앤다

**캐시를 `BridgeState.viewCache`(in-memory `Map`)에서 generation 커밋(디스크, 버전 관리됨)으로
옮긴다.** `GET /api/analysis-bundle`은 HEAD generation의 `analysis-bundle.json`을 읽기만 하고
LLM turn을 절대 열지 않는다. 이것이 §0의 3번(탭 누를 때마다 재요청)을 프론트 캐싱이 아니라
**API 형태 자체에서** 제거하는 방법이다 — bridge가 재시작돼도 재분석이 강제되지 않는다.

### 5.5 새 불변식

**I19.** 분석은 프로젝트당 `semanticVersion`마다 정확히 하나의 `AnalysisBundle`을 만든다.
`ViewRequest.question` 같은 자유 질문 기반 재요청이나 anchor/scope별 다중 캐시 엔트리는
Architecture/Workflow/Sequence에는 존재하지 않는다 — 있는 것은 조회(`GET
/api/analysis-bundle`)뿐이다.

**I20.** `ArchitectureConnection`은 반드시 Stage 1 골격 엣지(`traceLinkRefs`, 빈 배열 금지)로
뒷받침되어야 한다. AI가 골격에 없는 연결을 새로 만들 수 없다 (`schema` R4의 정신을 Assembly
단계로 확장한 것). `WorkflowEdge`에는 `traceLinkRefs` 필드가 없다 — 대신 `from`/`to`가
가리키는 `WorkflowNode.entityRefs`가 골격 노드로 검증되고, 엣지 자신의 `evidenceRefs`가
비어 있지 않은 present evidence를 가리키는지로 근거를 확인한다(§3.3). 하나의 워크플로우 전이가
여러 골격 hop을 압축할 수 있어 `ArchitectureConnection`과 같은 1:1 링크 롤업을 강제하지 않는다.

---

## 6. 유지 / 폐기 판단

### 6.1 유지

- Evidence Engine identity 모델(주소 기반 id, `rawHash`/`normalizedFingerprint` 분리,
  `fileContentHash` 기반 freshness) — 손대지 않는다. Bundle의 grounding 전체가 이 위에 얹힌다.
- `buildEvidenceGraph`/`projectTrace`/`projectReachability`(BFS+Tarjan SCC) — 폐기가 아니라
  Stage 1 골격 생성기(§5.3) + Passport drill-down(§7)으로 역할 재배치.
- `GroundingStore`(Concept/Claim 근거 분리) — Stage 2에 그대로 유지.
- `SemanticConcept`의 전역 `type` 부재 — Core 불변으로 유지 (I3, I18).
- Validator 패턴(`annotatedPath`, `allErrors`, Diagnostic 모양) — 확장해서 재사용.
- `ViewFreshness`("current"/"needs_review") — Bundle에도 그대로 적용.

### 6.2 폐기 / 격하 — 실전에 안 맞았던 부분

| 대상 | 문제 | 처리 |
|---|---|---|
| 6-View 최상위 메뉴 (Overview/Scenario/Lifecycle/Impact/Trace/Drift → 실제로는 Overview/Scenario/Trace/Reachability) | 사용자가 직접 골라 들어가야 하고, archify류 결과물(아키텍처+워크플로우 두 다이어그램을 바로 보여주는 형태)을 만들지 못한다. Lifecycle/Impact/Drift는 `plan §4`가 이미 범위 밖으로 뒀고 현재 코드에도 구현이 없다 | Overview/Scenario는 Architecture/Workflow로 대체(§3). Trace/Reachability는 §7 Passport의 온디맨드 함수로 격하. Lifecycle/Impact/Drift는 이번 개정에서도 범위 밖 |
| `POST /api/views`(overview/scenario 경로) | 탭·질문마다 새 LLM turn을 연다 | Stage 3 Assembly(§5)로 대체. 뷰 요청 API 자체를 없앤다 |
| `ViewRequest.question`(자유 질문 기반 Overview) | 뷰마다 별도 캐시 엔트리를 만들어 "탭 누를 때마다 재요청" 문제의 원인 중 하나 | 제거. 첫 화면은 질문이 아니라 분석 결과 그 자체다 |
| `BridgeState.viewCache`의 in-memory 특성 | bridge 재시작 시 캐시가 사라져 재분석이 강제됨 | generation 커밋 기반 영속으로 교체(§5.4) |
| `Shell.tsx`의 최상위 tablist(Project Reader/Runtime Console 완전 분리) | 분석 중 실시간 상황을 보려면 화면을 옮겨야 함 | §2.3에서 I17을 재해석해 인라인 상황판 + Diagnostics Drawer로 재배치 |

`CanonicalScenarioEntry`(`schema` §26)에 `workflowNodeRefs`/`workflowEdgeRefs` 필드 추가를
권장한다 — 다음 분석에서도 "이 CanonicalScenario가 저번엔 이 워크플로우 경로였다"는 연속성을
유지하기 위해서다. 영속 스키마 변경이므로 확정은 구현 단계에서 한다.

---

## 7. 우측 패널(Passport) — 데이터 소스

archify의 Passport 패널(설명/근거/관계 목록)과 같은 자리이지만, 표시되는 값은 전부 이번 문서의
IR 필드에서 직접 온다 — 별도의 문자열 필드(archify의 `sources[].path/line`처럼 AI가 직접 쓰는
값)가 아니라 onto의 주소 기반 `Evidence`를 그대로 쓴다.

| 섹션 | 데이터 소스 |
|---|---|
| 헤더(라벨/아이콘) | `component.label`/`presentationType`(§4), `conceptRefs`로 `SemanticConcept.name` 보조 표시 |
| 설명 | `component.description` (Stage 3 작성, `evidenceRefs` 비어 있으면 validator가 애초에 거부 — 근거 없는 설명이 패널에 뜨는 것을 스키마 레벨에서 차단) |
| in/out 요소 분석 | `component.inputs[]`/`outputs[]`(`ComponentIO`, §3.1) 정적 렌더 + "더보기" 클릭 시 `entityRef`를 anchor로 `projectReachability(anchor, direction, hops: 1)`을 그 자리에서 호출해 upstream/downstream 실시간 표시 |
| 연관된 코드 파일 | `evidenceRefs[]` → `EvidenceIndex.evidence`에서 `filePath` + `location.startLine/endLine` + `excerpt` 조회, 파일별 그룹핑, 줄 범위로 소스 딥링크 (relocation 덕에 코드가 이동해도 끊기지 않는다 — archify의 문자열 `path@line` 인용보다 견고한 지점) |
| 관계 목록 | `ArchitectureConnection[]`/`WorkflowEdge[]`를 `from===id \|\| to===id`로 필터, 행 클릭 시 패널 재타겟. `WorkflowEdge` 행은 라벨 클릭 시 같은 패널 자리에서 Sequence 렌더러로 전환(`sequenceRef`, §3.4) |

---

## 8. 명시적으로 하지 않는 것

```text
- 전체 Semantic Memory를 하나의 Node-Link Graph로 렌더링         (schema I2, schema2 §8 재확인)
- agent가 좌표를 쓰는 것                                        (schema A7·A12, I14 재확인)
- SemanticConcept/SemanticClaim에 전역 type 필드를 추가하는 것    (I3, I18)
- Architecture/Workflow의 connection·edge를 골격(Stage 1) 근거 없이 AI가 새로 만드는 것 (I20)
- 뷰마다 개별 LLM turn을 여는 API (POST /api/views의 overview/scenario 경로)  (§6.2 재확인)
- Lifecycle View / Drift View                                  (plan §4, schema2 §6.3 재확인)
- 분석 완료 전 부분 결과의 점진적 노출                             (§2.1에서 이번 범위 밖으로 명시)
```

---

## 9. 다음 구현 단계에서 손댈 지점 — 진행 상태

이번 문서의 1차 실행 범위는 설계였고, 후속 세션에서 **Stage 1~4 파이프라인 배선과 그 기반
타입/검증 계층(대략 "M14+M15")**을 구현했다. 웹 UI(M16, §1의 상태 머신·탭·Passport 패널)는
아직 손대지 않았다 — 이 파이프라인이 실제로 `AnalysisBundle`을 만들어야 붙일 수 있는
다음 단계다.

**완료됨**:

- `prototypes/ontology/packages/protocol/src/index.ts` — `ArchitectureIR`/`WorkflowIR`/
  `SequenceIR`/`AnalysisBundle`/`PresentationType`/`ComponentIO` 추가. `SemanticVersion.source`에
  `"bundle"` 추가. `ViewKind`/`ViewRequest`는 아직 정리하지 않았다(overview/scenario 경로가
  당장 남아 있어야 기존 web이 계속 동작한다 — §6.2 참고).
- `prototypes/ontology/packages/protocol/src/node.ts` — `STATE_FILES`에
  `analysis-bundle.json` 추가, `MANIFEST_MEMBERS`에 포함.
- `prototypes/ontology/packages/protocol/src/agent.ts` — `TaskMode`에 `"assembly"`,
  `AgentEvent`에 `"bundle.ready"` 추가.
- `prototypes/ontology/packages/core/src/analysis-bundle-validator.ts` — I9/I20/§3.4 검증.
  **주의**: `traceLinkRefs`는 골격 link의 안정적 참조 대상이 없어(`TraceLink`가 `(fromId,toId,
  kind)`로만 식별됨) **link-role `Evidence.id`**를 쓰기로 이 파일의 헤더 주석에서 해석했다 —
  Stage 3 프롬프트도 이 규약대로 작성했다(아래). I20은 `ArchitectureConnection`에만
  적용되고 `WorkflowEdge`에는 `traceLinkRefs` 필드가 없다는 것도 여기서 확정했다(§3.3 참고,
  최초 문서 작성 당시의 불일치를 구현 검토 중 바로잡았다).
- `prototypes/ontology/packages/core/src/analysis-bundle-commit.ts` — `commitAnalysisBundle`.
  `commitPatch`(⓪ 재확인)와 달리 검증을 `store.commit()`의 mutate 클로저 **안에서** 돌려
  race 자체가 생기지 않게 했다 — `AnalyzeTransaction`이 없으므로 더 단순한 형태가 가능했다.
- `prototypes/ontology/packages/core/src/trace.ts` — `buildEvidenceGraph`(무앵커 전체
  골격)를 Stage 1 골격 생성기로 그대로 재사용(신규 코드 없음). Passport drill-down
  (§7의 `projectReachability` 온디맨드 호출)은 아직 웹 UI가 없어 미착수.
- `prototypes/ontology/apps/bridge/src/prompt.ts` — `buildSkeletonSummary`(골격 오리엔테이션
  요약: route/model 목록 + link kind 분포, 전체 evidence는 새지 않는다)와
  `buildAssemblyPrompt`(Stage 3) 추가.
- `prototypes/ontology/apps/bridge/src/index.ts` — `runAnalyzePipeline`을 신설해 `/api/analyze`
  가 하나의 taskId 아래서 Stage 2(analyze, 기존 유지) → Stage 3(assembly, 신규)를 순서대로
  잇는다. Stage 3에는 `AnalyzeSession`을 열지 않는다(`submit_analysis_bundle`이
  `propose_evidence`를 쓰지 않으므로 transaction이 필요 없다) — `task.mode === "assembly"`
  로만 게이트한다. `index-only` arm(§7.3)은 Stage 2에서 멈추고 Stage 3로 넘어가지 않는다.
  `/internal/submit-analysis-bundle`과 읽기 전용 `GET /api/analysis-bundle`(HEAD generation을
  읽기만 함, LLM turn 없음, §5.4) 신설. **`/api/views`(overview/scenario)는 아직 폐기하지
  않았다** — 기존 web이 여전히 그 경로를 쓰므로, 폐기는 M16(웹 UI가 `AnalysisBundle`로
  옮겨간 뒤)으로 미룬다.
- `prototypes/ontology/apps/bridge/src/state.ts` — `viewCache`(in-memory)는 아직 그대로다.
  AnalysisBundle은 애초에 이 캐시를 거치지 않고 바로 generation에 커밋되므로(§5.4) 이
  항목은 사실상 완료됐다 — Overview/Scenario용 `viewCache`를 없애는 것은 그 경로 자체를
  폐기할 M16 시점의 일이다.
- `prototypes/ontology/packages/mcp-server/src/index.ts` — `submit_analysis_bundle` tool 추가.
- `prototypes/ontology/packages/core/src/schema.ts`,
  `prototypes/ontology/packages/protocol/src/schemas.ts` — `analysis-bundle` AJV 스키마 +
  grounding validator(I20) 추가.
- 시험: `packages/core/test/analysis-bundle-validator.test.mjs`(19),
  `packages/core/test/analysis-bundle-commit.test.mjs`(4),
  `apps/bridge/test/analysis-bundle-wiring.test.mjs`(6), `apps/bridge/test/prompt.test.mjs`에
  Assembly 프롬프트 시험 추가. 전체 251개 통과, `npm run typecheck`/`npm run build` 클린
  (workspace 6개 전부, `apps/web` 포함).

**아직 손대지 않음 (M16)**:

- `prototypes/ontology/apps/web/src/Shell.tsx`, `App.tsx`, `RuntimeConsole.tsx` — 최상위
  tablist 제거, 콘솔을 Analyzing 인라인 뷰 + Diagnostics Drawer로 재배치(§2.3), 아키텍처/
  워크플로우 2탭 + Passport 우측 패널(§7) + 엣지 라벨 클릭 시퀀스 렌더러(§3.4).
- `/api/views`(overview/scenario) 및 관련 `viewCache` 경로 폐기 — 웹 UI가 `AnalysisBundle`로
  완전히 옮겨간 뒤에만 안전하다.
- `CanonicalScenarioEntry`에 `workflowNodeRefs`/`workflowEdgeRefs` 추가(§6.2의 확인 필요
  지점) — 아직 미착수.

---

## 10. 열린 질문

1. **Q15** — Stage 3 Assembly가 "해석 가치가 있는 WorkflowEdge"를 고르는 휴리스틱(2-hop 이상
   또는 CanonicalScenario 연결)이 실제로 사용자가 궁금해할 엣지와 일치하는가? 너무 적게
   고르면 라벨을 클릭해도 시퀀스가 없는 엣지가 많아지고, 너무 많이 고르면 초기 분석 시간이
   늘어난다.
2. **Q16** — `presentationType`(§4)을 Stage 3 LLM이 얼마나 안정적으로 매길 수 있는가?
   `schema2` Q12가 `activations`/`phases`에 대해 던진 것과 같은 질문이 색·아이콘 축에도
   적용된다 — 재분석마다 같은 컴포넌트의 타입이 바뀌면 화면이 흔들린다.
3. **Q17** — 전부 끝난 뒤 한 번에 전환하는 방식(§2.1)이 큰 프로젝트에서 체감 대기 시간을
   얼마나 늘리는가? 실측 후 필요하면 점진적 노출을 다시 열 수 있다.
4. **Q18** — `CanonicalScenarioEntry`에 `workflowNodeRefs`/`workflowEdgeRefs`를 추가하는 것
   (§6.2)이 실제로 재분석 간 연속성을 얼마나 지켜주는가? 워크플로우 구조 자체가 크게
   바뀌는 리팩터링 이후에는 이 참조가 무의미해질 수 있다.
