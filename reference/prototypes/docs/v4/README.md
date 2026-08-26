# Ontology Structure V4 — Open-world System Intelligence

## 0. 문서 상태와 버전 경계

- 상태: 구현 완료 — Phase 0~8 완료
- 기준 구현: V3.2
- 문서 역할: V4의 분석 권한 모델, IR, 증분 상태, I20 대체 규칙과 구현 순서를 정의하는
  source of truth
- 기준 사례:
  - README가 없는 Next.js + Python 프로젝트 `building-law-agent-main`
  - Core 전용 adapter가 없다고 가정한 SvelteKit 프로젝트

V3까지의 기본 구조는 다음과 같다.

```text
Evidence Engine이 Stage 1 골격을 만든다
→ Vibee가 Semantic Memory를 만든다
→ Vibee가 골격을 클러스터링해 AnalysisBundle을 만든다
→ Core가 I20과 기타 불변식을 검증하고 커밋한다
```

이 구조는 근거 없는 연결을 막는 데 강하지만, Core가 먼저 모델링하지 못한 프레임워크·SDK·외부
서비스는 Vibee가 코드에서 정확히 이해해도 시스템 구조에 승격할 수 없다는 폐쇄 세계 문제가 있다.

V4는 다음 원칙으로 이 권한 모델을 바꾼다.

> **Core가 모르는 것을 Vibee가 보완하되, Vibee가 한 번 알아낸 사실도 Core의 증분 상태로
> 편입한다.**

V3 문서는 당시 구현 기록으로 유지한다. V4 구현 과정에서 V3의 안정적인 Evidence ID,
Semantic Memory, RepositoryTopology, AnalysisBundle, 사용자 여정과 검증·커밋 원칙을 폐기하지
않는다.

### 0.1 구현 체크포인트 — 2026-08-24

완료:

- README가 없는 adapter 미지원 SvelteKit과 Python external SDK fixture를 추가했다.
- `ResourceEntityRef`, `SystemEntity`, `SystemLink`, origin/certainty/status 계약을 protocol에 추가했다.
- `system-facts.json`을 generation manifest의 해시 대상에 포함했다.
- 기존 V3 generation은 빈 store와 `system-facts/migration-required` 진단으로 안전하게 읽는다.
- Entity/Link stable ID, resource canonicalization, entity/link 조회 API를 구현했다.
- 기존 engine Evidence Graph를 `engine + confirmed` System Fact로 변환한다.
- 실제 repository re-index에서 Evidence와 System Fact를 같은 generation에 원자적으로 커밋한다.
- `GET /api/system-facts`로 provider turn 없이 현재 fact를 조회할 수 있다.
- `propose_system_facts`가 source anchor, 신규 entity, 신규 link를 batch 하나로 검증한다.
- batch 내부 local ID로 신규 entity를 즉시 link endpoint로 참조할 수 있다.
- 경로·파일·범위·endpoint 오류는 batch 전체를 거절하고 pending 상태를 남기지 않는다.
- fact kind별 최소 source contract가 부족한 grounded 제안은 `inferred + needs_review`로 낮춰 보존한다.
- pending Evidence와 Vibee System Fact를 Semantic Patch와 같은 generation에 원자적으로 커밋한다.
- `get_system_facts` MCP 조회를 추가해 Assembly가 현재 generation의 발급 ID만 사용하게 했다.
- `ArchitectureConnection.systemLinkRefs`와 I20-v4를 구현했다.
- multi-hop 연속성, component membership, 방향, certainty/status, present Evidence를 검증한다.
- V3 `traceLinkRefs` Bundle은 동일 link Evidence를 가진 SystemLink로 읽기 migration한다.
- runtime wire identity를 protocol `4.0`으로 올렸다.
- agent Evidence를 같은 파일 안의 줄 이동뿐 아니라 유일한 fingerprint로 확인되는 파일 이동까지
  carry/relocate한다.
- System Fact를 `valid | relocated | needs_review | stale | missing`으로 재계산하고, 검토 완료
  version과 Bundle의 잔존 참조를 분리한다.
- dirty Evidence에서 System Fact, Semantic Memory, Scenario, Architecture, Workflow, Sequence까지
  닫히는 `SystemImpactSet`을 구현했다.
- no-op·cosmetic·구조와 무관한 CSS 변경은 Semantic/Assembly provider turn 0회 fast path로
  기존 Bundle을 현재 generation에 승계한다.
- `PreviousSystemDigest`와 증분 실행 계획을 만들고, 전체 discovery/assembly 선택 이유를
  generation history와 Stage ledger에 기록한다.
- Semantic Patch와 AnalysisBundle Patch가 ImpactSet 밖의 기존 ID/section을 수정하면 거절한다.
- 기존 AnalysisBundle을 서버 draft로 보존하고 증분 Assembly는 전체 Bundle 재출력 없이
  RFC 6902 부분 patch만 제출한다.
- manifest dependency, 실제 import/call, config consumer, framework boundary, adapter degradation을
  provider 중립 integration catalog와 discovery gap으로 계산한다.
- `get_incremental_analysis_context` MCP로 gap file, stable ID, patch scope, draft ID를 한 번에
  조회하고, 영향받은 Bundle 조각의 현재 JSON path/value를 `bundleTargets`로 제공한다.
- README 이름만 있는 서비스와 manifest가 없는 Node/Python built-in import는 discovery 후보에서
  제외한다.
- Component/Connection Passport에서 `확인됨 | 코드 근거로 복원 | 확인 필요`와 발견 주체,
  현재 검증 상태를 확인할 수 있다.
- 분석 계획과 완료 리포트에 재사용/재분석 fact, provider turn, token, full 실행 이유를 표시한다.
- `system-intelligence-v4=off|shadow|on` rollout flag와 동일 snapshot V3 계약 투영 비교를 구현했다.
- rollout report를 프로젝트의 append-only event log에 영속화하고 Web/API에서 다시 읽는다.
- 과거 generation은 HEAD를 되감지 않고 새 generation으로 copy-forward 복원한다.

운영에서 계속 축적할 항목:

- 실제 프로젝트별 shadow report 표본과 provider/model별 비용 분포
- 전환 조건을 만족하지 못한 프로젝트의 blocker 분류

현재 `system-facts.json`에는 결정론적 engine fact와 Core가 source contract를 검증한 Vibee fact가
같은 증분 수명 규칙으로 들어간다. 기존 agent Evidence를 `engine-confirmed`로 자동 승격하지 않는다.
`stale | missing` fact는 감사와 이전 generation 복원을 위해 남기되, 관련 Bundle 참조가 제거되고
검토 version이 따라잡으면 같은 사유로 provider를 반복 호출하지 않는다.

### 0.2 Phase 2~3 구현 결정 — 2026-08-24

- `propose_system_facts`의 성공은 즉시 generation을 만들지 않는다. 검증 결과는 현재
  `AnalyzeTransaction`의 pending 상태에 머물고, `submit_semantic_patch`가 성공할 때 Evidence,
  System Fact, Semantic Memory가 함께 커밋된다.
- 신규 entity/link identity는 모델이 보낸 local ID가 아니라 Core의 canonical EntityRef와
  endpoint/kind/mechanism 해시로 발급한다.
- source contract 불충분은 경로 조작이나 허구 endpoint와 다르다. 전자는 warning과 함께 inferred로
  강등하고, 후자는 batch 전체를 거절한다.
- `systemLinkRefs`가 신규 Bundle의 source of truth다. 레거시 `traceLinkRefs`는 link-role Evidence를
  통해 migration할 수 있을 때만 승인한다.
- 확정 Architecture connection은 `confirmed | grounded`이면서 `valid | relocated`인 Link만 사용할
  수 있고, Link의 모든 직접 Evidence가 현재 `present`여야 한다.

### 0.3 Phase 4~6 구현 결정 — 2026-08-24

- relocation은 semantic dirty와 독립이다. exact relocation은 `relocated`로 자동 승인하고,
  degraded relocation은 `needs_review`로 올린다.
- direct Evidence가 전부 사라지면 `missing`, 일부 direct 또는 dependency가 사라지면 `stale`,
  normalized fingerprint가 바뀌면 `needs_review`다.
- missing/stale fact를 즉시 삭제하지 않는다. Semantic 검토가 끝나면 `lastValidatedVersion`을
  전진시키고, 이전 Bundle이 계속 참조하는 동안에만 patch 대상에 남긴다.
- 작은 Bundle은 한 Link가 전체 비율의 대부분을 차지할 수 있으므로 비율만으로 full Assembly를
  선택하지 않는다. 20개 이상인 Bundle에서 impact closure가 60%를 넘을 때만 full로 올린다.
- incremental Semantic/Bundle patch는 ImpactSet 밖 ID를 수정할 수 없다. 신규 항목은 dirty 또는
  discovery Evidence와 직접 연결될 때만 범위 안으로 인정한다.
- provider-neutral catalog는 서비스 이름 목록을 hard-code하지 않는다. manifest dependency와
  실제 source import/call/config를 묶어 후보를 만들며 README는 입력에서 제외한다.
- `mode: full` 또는 `index-only`는 사용자의 명시적 전체 실행으로 기록한다. 그 외 같은 snapshot,
  cosmetic, 구조와 무관한 CSS 변경은 provider turn 0회다.

### 0.4 Phase 7~8 구현 결정 — 2026-08-24

- 기본 지도는 engine/vibee origin으로 색을 양분하지 않는다. 검증 상태가 나쁜 fact만 카드에
  경고하고 provenance는 Passport에서 설명한다.
- shadow mode는 같은 저장소를 V3/V4 provider로 두 번 읽어 비용과 비결정성을 키우지 않는다.
  커밋된 동일 snapshot을 V3의 Trace-link 진입 계약으로 결정론적으로 투영하고 V4 coverage와
  비교한다. 사용자 여정 coverage는 같은 Bundle 기준으로 하락 여부를 검사한다.
- `off`는 V3 호환 arm이다. V4 Store 읽기/migration은 유지하지만 open-world discovery gap과
  신규 `propose_system_facts`를 차단한다. `shadow`와 `on`은 같은 V4 결과를 제공한다.
- rollback은 HEAD를 과거 번호로 옮기지 않는다. 선택 generation의 상태를 현재 HEAD 다음
  generation에 복제해 이후 history와 rollback 행위 자체를 보존한다.
- provider turn/token/duration과 fact·connection·external integration·journey coverage는
  `.project-intel/events.ndjson`에 `v4.rollout-report`로 남긴다.

## 1. 문제 정의

### 1.1 `building-law-agent-main`에서 확인된 표현력 공백

해당 프로젝트의 Python 코드는 다음 사실을 명시한다.

- `openai` 패키지를 의존한다.
- `OPENAI_API_KEY`와 `OPENAI_MODEL` 설정을 사용한다.
- OpenAI Responses API로 질문을 구조화한다.
- 매칭된 규정과 계산 결과를 OpenAI에 보내 근거 답변을 만든다.
- OpenAI가 실패하면 규칙 기반 답변으로 대체한다.

Vibee의 Semantic Memory는 이 의미를 복원했지만 최종 Architecture에서는 OpenAI가 별도 외부
시스템으로 나타나지 않고 로컬 `계산·근거 답변 생성` 컴포넌트에 합쳐졌다.

원인은 모델 독해력이 아니라 V3 기준 계약이었다.

1. Python adapter는 프로젝트 안에서 유일한 직접 함수 호출만 골격 링크로 만든다.
2. `client.responses.create(...)` 같은 attribute call과 외부 SDK 대상은 골격에 없다.
3. V3 `EntityRef`는 `file | symbol | route | model`만 표현한다.
4. agent가 제안한 graph endpoint가 기존 인덱스에 없으면 Core는 graph 역할을 제거한다.
5. I20은 모든 Architecture connection이 Stage 1의 기존 link Evidence를 가리키도록 강제한다.

결과적으로 의미 이해는 성공했지만 시스템 구조 표현은 실패했다.

### 1.2 폐쇄 세계 adapter의 한계

OpenAI 전용 adapter 하나를 추가하는 것은 이 사례만 고친다. 이후 SvelteKit, 새로운 Python
프레임워크, 사내 SDK, 생소한 큐·스토리지·인증 서비스가 등장하면 같은 문제가 반복된다.

다음 명제는 V4에서 금지한다.

```text
Core adapter가 없다
→ 시스템 구조로 표현할 수 없다
```

adapter는 분석 가능 여부를 결정하는 필수 조건이 아니라 비용·속도·정확도를 높이는 최적화여야
한다.

### 1.3 무제한 AI 탐색의 반대쪽 위험

폐쇄 세계 문제를 피하기 위해 매 분석마다 Vibee가 저장소 전체를 처음부터 조사하게 만들면
Archify와 같은 문제가 생긴다.

- 작은 변경에도 전체 저장소 탐색이 반복된다.
- 이전에 찾은 프레임워크와 외부 연동 사실을 다시 발견해야 한다.
- 토큰과 시간이 저장소 크기에 비례해 반복된다.
- 모델이나 실행 시점에 따라 구조가 흔들릴 수 있다.

따라서 open-world discovery와 증분 상태 편입은 하나의 기능으로 함께 구현해야 한다. 둘 중 하나만
먼저 출시하지 않는다.

## 2. V4 목표와 비목표

### 2.1 목표

1. Core adapter가 없는 프레임워크·SDK도 Vibee가 실제 코드 근거로 시스템 구조에 제안할 수 있다.
2. Core는 제안된 의미를 대신 판단하지 않고 경로·범위·지문·참조·상태를 결정론적으로 검증한다.
3. 검증된 Vibee 제안은 generation에 영속화되어 다음 분석의 입력이 된다.
4. 코드 변경 시 근거가 바뀐 System Fact와 그 하위 산출물만 재검토한다.
5. Architecture connection은 engine 또는 Vibee 중 누가 발견했는지가 아니라 검증된 현재 근거가
   있는지로 승인한다.
6. 확정 사실, 코드 근거가 있는 Vibee 해석, 근거가 부족한 추론을 구분한다.
7. V3의 사용자 여정 품질과 Evidence 모달, 안정적인 ID, 원자적 generation 커밋을 유지한다.
8. 미지원 프레임워크의 첫 분석은 Vibee가 보완하되, 이후 분석은 변경 범위만 다시 본다.

### 2.2 비목표

- Core가 모든 프레임워크와 SDK의 의미를 자체 구현하는 것
- Vibee가 근거 없이 외부 시스템이나 런타임을 자유롭게 만드는 것
- 주석 또는 README에 이름만 등장한 서비스를 확정 시스템으로 표시하는 것
- 모든 외부 호출을 첫 화면의 주요 컴포넌트로 승격하는 것
- Vibee가 좌표나 픽셀 레이아웃을 생성하는 것
- 작은 코드 변경을 이유로 전체 Semantic Memory와 AnalysisBundle을 재생성하는 것
- 정적 코드만으로 실제 운영 배포 상태나 장애 인과를 보장하는 것

## 3. 핵심 역할 분리

V4의 핵심은 Core와 Vibee 중 누가 더 똑똑한지를 정하는 것이 아니라 서로 다른 종류의 판단을
분리하는 것이다.

### 3.1 Core의 역할

Core는 **사실 검증기, 상태 관리자, 증분 계산기**다.

- 저장소 snapshot과 파일 hash를 관리한다.
- 결정론적 adapter로 file, symbol, route, model, dependency, config, 외부 호출 등을 우선 탐지한다.
- Vibee가 제안한 repo-relative 경로와 line range가 실제로 존재하는지 검증한다.
- 제안 범위를 직접 읽고 raw hash와 normalized fingerprint를 계산한다.
- 새로운 System Entity/Link의 endpoint와 Evidence 참조 무결성을 검사한다.
- 안정적인 Entity/Link ID를 발급한다.
- engine과 Vibee가 만든 System Fact를 동일한 generation 상태로 보존한다.
- Evidence diff로 fact의 `valid | relocated | stale | missing | needs_review` 상태를 계산한다.
- 영향 그래프를 따라 재검토할 Concept, Claim, Scenario, Component, Connection, Sequence를 계산한다.
- patch를 기존 상태에 merge하고 전체 불변식을 검증한 뒤 원자적으로 커밋한다.
- 분석 예산, 재시도, 동시 실행, provenance와 diagnostics를 관리한다.

Core는 다음을 하지 않는다.

- 모든 프레임워크의 제품 의미를 hard-code하지 않는다.
- 처음 보는 SDK라는 이유만으로 실재하는 코드 근거를 버리지 않는다.
- 비전공자에게 보여줄 이름과 설명 순서를 결정하지 않는다.
- 사용자 목적과 시스템 목적을 대신 구성하지 않는다.
- 코드 근거만으로 확정할 수 없는 의미를 사실로 승격하지 않는다.

### 3.2 Vibee의 역할

Vibee는 **open-world 조사자, 의미 복원자, 구조 편집자**다.

- manifest, entrypoint, route, config, import, call site와 도메인 코드를 조사한다.
- Core adapter가 모르는 프레임워크·SDK·사내 라이브러리를 해석한다.
- System Entity/Link 후보와 그 후보를 뒷받침하는 정확한 source range를 제안한다.
- 동일 외부 시스템의 여러 호출을 하나의 안정적인 시스템 개념으로 묶는다.
- business concept, claim, canonical scenario와 사용자 여정을 구성한다.
- 검증된 System Graph를 6~12개의 거시 Architecture component로 클러스터링한다.
- 중요한 동작만 Workflow와 Sequence로 펼친다.
- Core diagnostics가 가리키는 영향 범위만 수정한다.

Vibee는 다음을 하지 않는다.

- Evidence ID, Entity ID, Link ID를 임의로 확정하지 않는다.
- 실재하지 않는 경로·줄·심볼·호출을 만든다.
- 변경되지 않은 저장소 전체를 매번 다시 조사하지 않는다.
- `inferred` 관계를 확정 Architecture connection으로 제출하지 않는다.
- generation을 직접 merge하거나 커밋하지 않는다.

### 3.3 Renderer의 역할

Renderer는 의미를 재해석하지 않는다.

- Core가 커밋한 component, connection, boundary, journey, sequence를 배치한다.
- provenance와 confidence를 색·선·배지·상세 패널로 표현한다.
- `confirmed`, `grounded`, `needs_review`를 사용자가 구분할 수 있게 한다.
- 가로·세로 overflow, edge occlusion, label collision을 결정론적으로 해결한다.

## 4. V4 분석 모델

### 4.1 네 층의 source of truth

V4는 Evidence와 최종 View 사이에 영속적인 `System Fact Store`를 둔다.

```text
Evidence Index
  실제 파일·범위·지문
        ↓
System Fact Store
  런타임·라우트·외부 서비스·저장소·호출 관계
        ↓
Semantic Memory
  제품 의미·주장·사용자/시스템 목적
        ↓
AnalysisBundle
  Architecture·Workflow·UserMap·Sequence
```

각 층의 책임은 다음과 같다.

| 층 | 질문 | 대표 데이터 |
|---|---|---|
| Evidence Index | 코드 어디에서 관찰했는가? | file, range, hash, excerpt |
| System Fact Store | 어떤 시스템 대상과 관계가 존재하는가? | runtime, route, external, call, config |
| Semantic Memory | 이것이 제품에서 무슨 의미인가? | Concept, Claim, Canonical Scenario |
| AnalysisBundle | 비전공자에게 어떻게 보여줄 것인가? | component, edge, journey, sequence |

`System Fact Store`는 `.project-intel/gen/<generation>/system-facts.json`에 저장하고 manifest hash의
대상이 된다. AnalysisBundle에만 존재하는 임시 해석으로 두지 않는다.

### 4.2 provenance와 확실성

`origin`과 `certainty`를 분리한다.

```ts
type FactOrigin = "engine" | "vibee";

type FactCertainty =
  | "confirmed"    // Core adapter가 명시적 선언·호출로 확인
  | "grounded"     // Vibee가 제안하고 Core가 source contract를 검증
  | "inferred";    // 코드만으로 확정할 수 없는 해석
```

- `engine + confirmed`: 정식 System Graph에 즉시 포함한다.
- `vibee + grounded`: 정식 System Graph에 포함하며 engine fact와 동일하게 증분 관리한다.
- `vibee + inferred`: assumptions/unknowns에 보존하되 기본 Architecture connection으로 사용하지
  않는다.

`confidence` 숫자는 보조 정보다. provenance나 검증 상태를 대신하지 않는다. 높은 confidence라도
근거가 없으면 `grounded`가 될 수 없다.

## 5. System Fact Store 계약

### 5.1 확장 가능한 EntityRef

V3의 `file | symbol | route | model`은 그대로 유지하되, Core가 미리 알지 못한 시스템 자원을
표현할 수 있는 주소를 추가한다.

```ts
type ResourceEntityRef = {
  kind: "resource";
  namespace: string;
  key: string;
};

type EntityRef =
  | FileEntityRef
  | SymbolEntityRef
  | RouteEntityRef
  | ModelEntityRef
  | ResourceEntityRef;
```

권장 namespace는 다음과 같지만 닫힌 enum으로 만들지 않는다.

```text
runtime       framework      external      queue
storage       auth           observability config
job           protocol       unknown
```

예:

```text
resource:runtime:sveltekit-app
resource:framework:sveltekit
resource:external:openai-responses
resource:queue:kafka/orders
resource:storage:s3/uploads
resource:config:OPENAI_MODEL
```

표시 label은 identity에 넣지 않는다. 모델이나 언어가 달라져 label이 바뀌어도 같은 자원을 가리켜야
한다.

### 5.2 System Entity와 Link

```ts
type SystemEntity = {
  id: string;
  ref: EntityRef;
  kind: string;
  origin: FactOrigin;
  certainty: FactCertainty;
  evidenceRefs: string[];
  dependsOnEvidenceRefs: string[];
  status: "valid" | "relocated" | "stale" | "missing" | "needs_review";
  firstSeenVersion: number;
  lastValidatedVersion: number;
};

type SystemLink = {
  id: string;
  from: EntityRef;
  to: EntityRef;
  kind: string;
  mechanism?: string;
  origin: FactOrigin;
  certainty: FactCertainty;
  evidenceRefs: string[];
  dependsOnEvidenceRefs: string[];
  status: "valid" | "relocated" | "stale" | "missing" | "needs_review";
  firstSeenVersion: number;
  lastValidatedVersion: number;
};
```

`dependsOnEvidenceRefs`는 증분 무효화의 입력이다. `evidenceRefs`는 사용자에게 보여줄 직접 근거이고,
`dependsOnEvidenceRefs`에는 identity나 분류를 결정하는 dependency, import, config 근거도 포함할
수 있다.

### 5.3 안정적인 ID

ID는 줄 번호, label, 모델이 작성한 설명으로 만들지 않는다.

```text
System Entity ID
  = entityKey(ref)

System Link ID
  = hash(kind + fromEntityKey + toEntityKey + normalized mechanism)
```

source range가 이동하면 Evidence location만 relocate한다. 호출 본문이 일부 바뀌어도 동일 endpoint와
mechanism이면 Link ID는 유지하고 `needs_review`로 보낸다. endpoint나 mechanism이 실제로 바뀌면
새 Link로 취급한다.

## 6. Vibee 제안 계약

### 6.1 현재 `propose_evidence`의 한계

V3의 `propose_evidence`는 파일·범위를 안전하게 검증하고 agent Evidence를 다음 generation으로
carry/relocate한다. 이 기반은 유지한다.

하지만 graph endpoint가 기존 index에 없으면 graph 역할을 제거한다. 따라서 다음 제안은 한 번에
성립하지 않는다.

```text
새 외부 Entity: OpenAI Responses API
새 Link: generate_grounded_answer → OpenAI Responses API
```

V4는 Evidence 하나씩의 제안과 별도로 원자적 `propose_system_facts` 계약을 추가한다.

### 6.2 원자적 graph proposal

```ts
type SourceAnchorProposal = {
  localId: string;
  kind: string;
  filePath: string;
  location: SourceRange;
  symbolHint?: string;
  summary: string;
  normalizationProfile?: "code" | "prose";
};

type SystemFactProposal = {
  baseAnalysisVersion: number;
  anchors: SourceAnchorProposal[];
  entities: Array<{
    localId: string;
    ref: EntityRefWithoutIssuedId;
    kind: string;
    anchorLocalIds: string[];
    certainty: "grounded" | "inferred";
  }>;
  links: Array<{
    localId: string;
    from: ProposedOrExistingEntityRef;
    to: ProposedOrExistingEntityRef;
    kind: string;
    mechanism?: string;
    anchorLocalIds: string[];
    dependencyAnchorLocalIds?: string[];
    certainty: "grounded" | "inferred";
  }>;
};
```

Core 처리 순서:

1. 모든 source anchor의 경로·실재 파일·범위·지문을 검증한다.
2. 하나라도 잘못되면 batch 전체를 거절한다.
3. 새 EntityRef의 형식과 key 안정성을 검증하고 ID를 발급한다.
4. 기존 entity와 batch 안의 신규 entity를 합쳐 link endpoint를 해석한다.
5. `grounded` link에는 실제 동작을 보여주는 code anchor가 있는지 검사한다.
6. `inferred` fact에는 graph traversal 권한을 주지 않고 assumptions로 저장한다.
7. 발급된 Evidence/System Fact ID 매핑을 Vibee에 반환한다.
8. Semantic patch와 함께 같은 generation transaction에서 원자적으로 커밋한다.

Vibee가 제안한 label과 summary는 표시 후보일 뿐 identity가 아니다.

### 6.3 source contract

Core는 프레임워크의 전체 의미를 이해하려 하지 않는다. 대신 fact kind별 최소 source contract를
검증한다.

| 주장 | 최소 근거 |
|---|---|
| 외부 SDK 호출 | call expression 범위 + 외부 대상의 dependency/import/config 중 하나 |
| HTTP 외부 호출 | 호출 범위 + 정적 URL/host 또는 검증된 base URL config |
| route/handler | route 선언 범위 + handler symbol 또는 handler body |
| runtime | manifest/config/entrypoint 중 둘 이상, 또는 명시적 실행 script |
| queue publish/consume | 호출 범위 + topic/queue/channel 식별 근거 |
| datastore read/write | 호출 범위 + 저장소 client/model/config 근거 |
| fallback | 예외·조건 분기와 대체 호출이 함께 보이는 범위 |

정적 코드만으로 계약을 만족하지 못하면 거절하지 않고 `inferred` 또는 `needs_review`로 낮출 수
있다. 단, 기본 Architecture의 확정 edge에는 사용할 수 없다.

## 7. I20-v4 — 검증된 System Link 불변식

### 7.1 기존 I20

V3 I20:

> 모든 `ArchitectureConnection`은 Stage 1의 기존 link-role Evidence를 하나 이상
> `traceLinkRefs`로 가져야 한다.

장점은 근거 없는 연결을 차단하는 것이다. 문제는 `Stage 1 engine이 먼저 알아야 한다`는 조건이
사실성 검증과 결합되어 있다는 점이다.

### 7.2 대체 규칙

V4 I20:

> 모든 확정 `ArchitectureConnection`은 현재 generation에서 `valid | relocated` 상태인
> `SystemLink`를 하나 이상 요약해야 한다. 해당 SystemLink는 engine-confirmed 또는
> Core-validated Vibee-grounded 중 하나일 수 있다.

세부 규칙:

1. `ArchitectureConnection.systemLinkRefs`는 실재하는 SystemLink ID만 가리킨다.
2. 참조된 SystemLink는 `certainty: confirmed | grounded`여야 한다.
3. `inferred`, `stale`, `missing`, `needs_review` Link는 확정 connection의 근거가 될 수 없다.
4. 각 SystemLink의 `evidenceRefs`는 현재 존재하는 Evidence를 하나 이상 포함해야 한다.
5. connection의 방향은 SystemLink 방향과 모순되면 안 된다.
6. connection이 여러 hop을 요약하면 모든 hop이 연속된 경로를 이루어야 한다.
7. from/to component의 `entityRefs`는 요약 경로의 시작과 끝 entity를 포함하거나, 해당 entity를
   포함하는 동일 component membership을 증명해야 한다.
8. engine과 Vibee origin에 서로 다른 시각적 진실 값을 부여하지 않는다. 둘 다 Core 검증을
   통과하면 정식 구조다.
9. provenance는 상세 패널에서 공개하되 기본 지도는 의미와 certainty를 우선한다.
10. 근거가 부족한 관계는 `assumptions` 또는 `unknowns`로 분리하며 일반 edge처럼 그리지 않는다.

`traceLinkRefs`는 V4 migration 동안 읽기 호환을 위해 유지할 수 있지만 신규 Bundle의 source of
truth는 `systemLinkRefs`다.

### 7.3 I20-v4가 허용하고 금지하는 것

허용:

```text
Core Python adapter가 만든 local call
Vibee가 발견하고 Core가 검증한 SvelteKit route
Vibee가 발견하고 Core가 검증한 OpenAI SDK call
여러 검증된 hop을 압축한 거시 connection
```

금지:

```text
README에만 이름이 등장한 외부 서비스
존재하지 않는 줄 범위를 근거로 한 연결
config key만 있고 실제 호출이 없는 confirmed external call
방향이 반대인 SystemLink를 끼워 맞춘 연결
needs_review 상태의 fact를 조용히 재사용한 연결
```

## 8. 초기 분석 파이프라인

```text
1. Repository snapshot
2. 결정론적 Evidence indexing
3. engine-confirmed System Fact 생성
4. Discovery Gap 계산
5. Vibee가 gap 범위만 저장소 조사
6. propose_system_facts
7. Core source contract 검증
8. System Fact Store 커밋 후보 구성
9. Semantic Memory 생성
10. AnalysisBundle 조립
11. I20-v4 + coverage + cross-view 검증
12. generation 원자 커밋
```

`Discovery Gap`은 다음 신호로 만든다.

- manifest에는 의존성이 있지만 연결된 System Fact가 없음
- import한 외부 package의 attribute call이 미해석 상태
- config/env key가 있으나 소비 지점이 미연결
- route 또는 entrypoint 주변에 graph에서 단절된 중요 symbol이 있음
- adapter report가 unsupported 또는 degraded를 보고함
- Semantic Concept은 외부 동작을 설명하지만 System Graph에 대응 entity/link가 없음
- RepositoryTopology의 runtime/data/external coverage가 기준 미달

Vibee는 저장소 전체를 무조건 다시 읽는 대신 gap과 인접 파일을 우선 조사한다.

## 9. 증분 분석 파이프라인

### 9.1 기본 흐름

```text
Repository re-index
→ EvidenceDiff
→ agent Evidence carry/relocate
→ System Fact 상태 계산
→ SystemImpactSet 계산
→ 영향 범위에 한정된 Vibee 재검토
→ System Fact patch
→ Semantic patch
→ AnalysisBundle patch
→ 전체 불변식 검증
→ 새 generation 원자 커밋
```

### 9.2 Fact 상태 전이

```text
근거가 그대로       → valid, Vibee 호출 없음
위치만 이동         → relocated, Core가 위치 갱신
본문이 의미 있게 변경 → needs_review
일부 의존 근거 소실  → stale
직접 근거 소실       → missing
새 근거 등장         → discovery candidate
```

`relocated`는 의미 변경이 아니므로 기본적으로 Vibee 재검토를 요구하지 않는다. degraded relocation,
endpoint 변경, mechanism 변경은 `needs_review`로 올린다.

### 9.3 SystemImpactSet

```ts
type SystemImpactSet = {
  evidenceIds: string[];
  systemEntityIds: string[];
  systemLinkIds: string[];
  conceptIds: string[];
  claimIds: string[];
  scenarioIds: string[];
  architectureComponentIds: string[];
  architectureConnectionIds: string[];
  workflowNodeIds: string[];
  workflowEdgeIds: string[];
  sequenceIds: string[];
  discoveryRoots: string[];
  requiresFullDiscovery: boolean;
  requiresFullAssembly: boolean;
  reasons: string[];
};
```

영향 계산 순서:

```text
dirty Evidence
→ dependsOnEvidenceRefs가 겹치는 System Fact
→ 해당 fact를 grounding하는 Concept/Claim
→ anchor Concept가 바뀐 Scenario
→ entity/systemLink ref가 겹치는 Bundle 조각
→ 직접 연결된 Sequence와 사용자 여정 단계
```

### 9.4 Vibee에 주는 증분 입력

Vibee에게 전체 기존 Bundle과 전체 저장소를 기본 입력으로 주지 않는다.

- 변경된 Evidence와 source excerpt
- `needs_review | stale | missing` System Fact
- 새 discovery candidate
- 영향받은 entity 기준 주변 1~2 hop System Graph
- 영향받은 Concept·Claim·Scenario digest
- 수정 가능한 Bundle section과 ID
- 재사용해야 하는 stable ID 목록

Vibee는 영향받지 않은 영역을 다시 작성하지 않는다. Core는 patch가 ImpactSet 밖을 수정하면
거절한다.

### 9.5 전체 재분석 조건

다음 경우에만 전체 discovery 또는 Assembly를 허용한다.

- 첫 V4 분석
- System Fact/AnalysisBundle schema 또는 planner version 변경
- runtime manifest·entrypoint·boundary가 대규모로 변경됨
- 프레임워크 교체 또는 lockfile의 핵심 runtime dependency 대규모 변경
- 이전 generation이 무결성 검증을 통과하지 못함
- impact closure를 안전하게 계산할 수 없음
- system coverage가 설정된 하한 아래로 떨어짐
- 사용자가 명시적으로 전체 재분석을 요청함

전체 경로를 선택하면 이유와 예상 범위를 Stage ledger에 기록한다. 단순 source file 한 개 변경은
전체 재분석 이유가 될 수 없다.

## 10. Architecture와 사용자 여정의 결합

V4에서도 사용자 여정은 Semantic Memory와 Canonical Scenario가 source of truth다. System Fact
Store가 사용자 여정을 대체하지 않는다.

- System Graph는 “어떤 시스템이 연결되는가”를 설명한다.
- Semantic Memory는 “제품에서 무슨 의미인가”를 설명한다.
- UserMap은 “사용자가 목적을 달성하는 과정”을 설명한다.

한쪽이 다른 쪽을 압도하지 않도록 다음 참조를 유지한다.

```text
User journey step
  → conceptRefs/evidenceRefs
  → 관련 System Entity/Link
  → Architecture component/connection 강조
```

외부 서비스가 여정에 실질적으로 관여하면 해당 단계에서 연결하되, 단순 dependency 존재만으로
사용자 여정 participant로 승격하지 않는다.

## 11. 기준 프로젝트의 기대 결과

### 11.1 `building-law-agent-main`

최소 System Fact:

```text
FastAPI POST /api/ask
→ 건축법 사전 검토

건축법 사전 검토
→ OpenAI Responses API: 질문 조건 구조화
→ 샘플 조례 데이터: 규정 조회
→ 계산기: 건폐율·용적률 계산
→ OpenAI Responses API: 근거 답변 생성

OpenAI 실패
→ 규칙 기반 답변 fallback
```

OpenAI Entity의 직접 근거:

- `requirements.txt`의 `openai`
- `from openai import OpenAI`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `client.responses.parse(...)`
- `client.responses.create(...)`

두 호출은 동일 외부 Entity를 참조하되 서로 다른 SystemLink로 보존한다. fallback은 실제 예외 처리와
대체 답변 호출 근거가 있을 때만 표시한다.

### 11.2 adapter가 없는 SvelteKit 프로젝트

첫 분석:

1. Core가 `package.json`, source file, config를 Evidence로 만든다.
2. adapter가 route 의미를 모르면 Discovery Gap으로 표시한다.
3. Vibee가 `+page.svelte`, `+server.ts`, `hooks.server.ts`, `svelte.config.*`를 조사한다.
4. source-validated System Entity/Link를 제안한다.
5. Core가 안정적인 fact로 커밋한다.

두 번째 분석:

- 변경되지 않은 SvelteKit runtime과 route fact를 그대로 재사용한다.
- 한 `+server.ts`만 바뀌면 해당 route와 인접 외부 호출만 재검토한다.
- Vibee에게 프로젝트 전체를 다시 설명하게 하지 않는다.

## 12. 구현 단계

### Phase 0 — V4 기준선과 평가 fixture

산출물:

- V3.2 `building-law-agent-main` 결과 snapshot
- adapter가 없는 SvelteKit fixture
- 작은 TS/JS, Python, 복합 runtime fixture
- 변경 유형별 baseline: cosmetic, prompt, route, external call, runtime replacement
- 첫 분석과 재분석의 시간·토큰·호출 수 기록

검증:

- OpenAI 의미는 Semantic Memory에 있지만 Architecture 외부 Entity가 없다는 현재 공백을 재현한다.
- SvelteKit adapter를 끈 상태에서도 Core Evidence와 Vibee 탐색 결과를 분리해 측정한다.

### Phase 1 — System Fact Protocol과 Store

산출물:

- 확장 가능한 `ResourceEntityRef`
- `SystemEntity`, `SystemLink`, provenance, certainty, status schema
- `system-facts.json` generation 저장과 manifest 연결
- stable ID와 read/query API
- 기존 Evidence Graph에서 engine-confirmed fact를 만드는 adapter

검증:

- label·줄 번호가 바뀌어도 entity identity가 유지된다.
- generation hash와 HEAD 전환이 원자적이다.
- V3 state를 읽을 때 migration diagnostic이 명확하다.

### Phase 2 — 원자적 Vibee System Fact 제안

구현 상태: **완료** (2026-08-24)

산출물:

- `propose_system_facts`
- batch 안의 신규 entity를 link endpoint로 참조하는 local ID 해석
- source contract validator
- inferred/grounded 분리
- pending fact를 Semantic patch와 함께 커밋하는 transaction

검증:

- 기존 index에 없는 OpenAI Entity와 두 external call Link를 한 transaction에서 등록한다.
- 존재하지 않는 파일·범위·endpoint 제안은 전체 batch가 거절된다.
- config만 있고 call이 없는 제안은 confirmed external call이 되지 않는다.
- unused proposal은 조용히 버려지지 않고 진단에 남는다.

### Phase 3 — I20-v4와 Bundle 계약

구현 상태: **완료** (2026-08-24)

산출물:

- `systemLinkRefs`
- I20-v4 validator
- multi-hop continuity와 component membership 검사
- inferred/needs_review Link 차단
- V3 `traceLinkRefs` 읽기 호환과 migration

검증:

- engine Link와 Vibee-grounded Link가 동일한 기준으로 Architecture에 사용된다.
- 골격에 없던 진짜 SvelteKit/OpenAI 연결이 승인된다.
- 근거 없는 외부 서비스와 방향이 뒤집힌 연결은 거절된다.

### Phase 4 — 증분 System Fact 수명

구현 상태: **완료** (2026-08-24)

산출물:

- agent anchor carry/relocate를 System Fact dependency까지 확장
- Fact 상태 전이
- `SystemImpactSet`
- discovery gap과 변경 root 계산
- no-op/cosmetic fast path

검증:

- 파일 위치 이동만으로 Vibee turn이 발생하지 않는다.
- prompt 문자열 변경은 관련 external call/semantic description만 재검토한다.
- CSS 변경은 시스템 구조 분석 turn을 만들지 않는다.
- source call 삭제 시 해당 Link와 연결된 Bundle 조각만 stale/missing이 된다.

### Phase 5 — 증분 Semantic/Bundle Patch

구현 상태: **완료** (2026-08-24)

산출물:

- `PreviousSystemDigest`
- System/Semantic/Bundle ImpactSet 연결
- section/ID 단위 `AnalysisBundlePatch`
- patch 범위 enforcement
- 전체 재분석 조건과 이유 ledger

검증:

- 한 Link 변경에 전체 Bundle을 다시 출력하지 않는다.
- patch가 ImpactSet 밖 component를 수정하면 거절된다.
- 이전 유효 generation은 patch 실패 중에도 유지된다.
- 첫 분석 이후 같은 코드 재분석은 provider turn 0회를 허용한다.

### Phase 6 — Open-world Discovery

증분 기반을 먼저 완성한 뒤 open-world 탐색을 기본 경로에 켠다.

구현 상태: **완료** (2026-08-24)

산출물:

- discovery gap planner
- manifest/import/config/call 중심 조사 prompt
- 미지원 framework/SDK 제안 계약
- provider-neutral external integration catalog
- language adapter는 discovery 비용을 줄이는 최적화로 배치

검증:

- 전용 adapter가 없는 SvelteKit 구조를 Vibee-grounded fact로 복원한다.
- 처음 보는 사내 SDK도 실제 import/call/config 근거가 있으면 외부 resource로 표현한다.
- 문서에만 등장하는 서비스는 기본 지도에 포함하지 않는다.

### Phase 7 — UI와 설명 가능성

구현 상태: **완료** (2026-08-24)

산출물:

- Component/Connection Passport에 발견 주체와 검증 상태 표시
- `확인됨`, `코드 근거로 복원`, `확인 필요` 설명
- needs_review/stale fact 경고와 재검토 범위
- 분석 완료 후 재사용 fact 수와 재분석 fact 수 표시
- 전체 재분석이 선택된 경우 명확한 이유 표시

기본 지도에서는 engine/vibee origin 색을 과도하게 나누지 않는다. 두 origin 모두 검증된 사실이면
동일한 구조적 위상을 갖는다. provenance는 신뢰 상세에서 확인한다.

### Phase 8 — Shadow rollout과 V4 전환

구현 상태: **완료** (2026-08-24)

산출물:

- feature flag `system-intelligence-v4`
- 동일 snapshot에 V3/V4 결과를 만드는 shadow mode
- fact/connection coverage와 비용 비교 리포트
- V4 schema migration과 rollback

구현 메모:

- feature flag 환경 변수는 `ONTO_SYSTEM_INTELLIGENCE_V4=off|shadow|on`이며 기본값은 `on`이다.
- `GET /api/rollout-report`에서 누적/최신 비교 리포트를, `GET /api/generations`에서 migration과
  history 상태를 읽는다.
- `POST /api/generations/rollback`은 분석 task가 없을 때만 copy-forward 복원을 수행한다.
- `shadow`의 V3 결과는 별도 AI 재실행이 아니라 같은 snapshot의 V3 계약 투영이다.

전환 조건:

- V4가 기준 프로젝트의 외부 연동을 더 많이 찾는다.
- 확정 지도에 ungrounded connection이 0개다.
- 국소 변경 재분석 비용이 V3 전체 Assembly보다 낮다.
- 기존 사용자 여정의 step·branch·loop coverage가 하락하지 않는다.

## 13. 테스트 전략

### 13.1 단위 테스트

- ResourceEntityRef canonicalization과 stable ID
- 원자적 proposal의 local ID 해석
- source contract별 accept/downgrade/reject
- System Fact 상태 전이와 relocation
- SystemImpactSet closure
- I20-v4 single-hop/multi-hop/direction/membership
- inferred fact의 기본 graph 진입 차단
- patch scope enforcement

### 13.2 통합 테스트

- Engine Fact + Vibee proposal → System Fact Store → Semantic patch → Bundle commit
- 신규 external entity와 link의 한 transaction bootstrap
- 코드 변경 → carry/relocate → ImpactSet → 부분 patch
- provider 실패 시 이전 generation 유지
- stale fact가 Architecture에서 조용히 재사용되지 않음
- Web 재연결 후 provenance와 impact 상태 복원

### 13.3 실제 프로젝트 변경 행렬

| 변경 | 기대 동작 |
|---|---|
| 공백·포맷만 변경 | provider turn 없음 |
| CSS만 변경 | 시스템 구조 turn 없음 |
| LLM prompt 문자열 변경 | 관련 Concept/Sequence 설명만 재검토 |
| 외부 SDK 호출 하나 추가 | 해당 runtime root와 인접 graph만 discovery |
| route 하나 삭제 | 해당 route·journey·sequence만 patch |
| 파일 이동, 내용 동일 | relocation만 수행 |
| runtime dependency 교체 | 해당 runtime 전체 discovery, 다른 runtime은 재사용 |
| schema version 변경 | 명시적 full migration/assembly |

### 13.4 적대적 테스트

- 존재하지 않는 파일·줄·심볼 제안
- dependency만 있고 호출은 없는 외부 서비스
- README에만 등장하는 SaaS
- 같은 이름의 서로 다른 SDK client
- 동적 endpoint로 대상이 확정되지 않는 HTTP call
- source range는 실재하지만 summary가 코드와 모순되는 제안
- 모델이 ImpactSet 밖 ID를 수정하려는 patch

## 14. 성능·비용 목표

첫 분석의 open-world discovery 비용은 별도로 측정한다. V4 성공은 첫 분석 품질만이 아니라 재분석
재사용률로 판단한다.

권장 목표:

- no-op 또는 cosmetic 재분석: provider turn 0회
- 변경되지 않은 System Fact 재사용률: 95% 이상
- 단일 파일 국소 변경: 전체 저장소 source 재전송 금지
- 단일 Link 변경: 전체 AnalysisBundle 재출력 금지
- 모든 provider 호출에 discovery/semantic/assembly 목적과 영향 ID 기록
- full discovery 비율과 선택 이유를 영구 계측
- 같은 snapshot을 반복 분석할 때 stable System Entity/Link ID 유지율 100%

정확한 토큰 상한은 fixture baseline을 측정한 뒤 확정한다. 임의 숫자를 먼저 목표로 두고 중요한
근거를 생략하지 않는다.

## 15. 완료 조건

V4는 다음을 모두 만족할 때 완료로 본다.

- Core adapter가 없는 SvelteKit fixture에서 Vibee가 source-grounded runtime과 route를 제안한다.
- 제안된 fact가 다음 generation에 남고, 변경되지 않은 재분석에서 다시 발견할 필요가 없다.
- `building-law-agent-main` 지도에 OpenAI가 별도 external component로 나타난다.
- 질문 구조화와 근거 답변 생성이 서로 다른 검증된 SystemLink로 표시된다.
- OpenAI 실패 시 규칙 기반 fallback이 실제 코드 근거와 함께 표현된다.
- I20-v4가 engine과 Vibee-grounded Link를 동일하게 승인한다.
- inferred 또는 stale Link는 확정 Architecture connection으로 들어가지 않는다.
- CSS·포맷 변경에서 시스템 구조 AI turn이 발생하지 않는다.
- 국소 코드 변경에서 영향받지 않은 System Fact, Concept, Journey, Bundle 조각이 재생성되지 않는다.
- full discovery/assembly는 명시된 조건에서만 실행되고 이유가 UI와 이벤트에 남는다.
- 기존 V3 사용자 여정의 대표 경로·분기·루프·Evidence 탐색 품질이 유지된다.
- 모든 커밋은 source range, stable ID, provenance, generation hash로 추적 가능하다.

## 16. 권장 구현 순서와 금지 순서

권장 순서:

```text
System Fact Store
→ 원자적 Vibee proposal
→ I20-v4
→ Fact invalidation/ImpactSet
→ Bundle patch
→ Open-world discovery 기본 활성화
→ UI와 rollout
```

금지 순서:

```text
AI에게 저장소 전체 자유 탐색을 먼저 활성화
→ 결과를 AnalysisBundle에만 저장
→ 다음 재분석에서 다시 전체 탐색
```

V4의 핵심 산출물은 더 영리한 한 번의 다이어그램이 아니다. 처음 보는 구조를 Vibee가 발견하고,
Core가 검증해 기억하며, 이후 변경에서는 필요한 부분만 다시 판단하는 지속 가능한 분석 상태다.
