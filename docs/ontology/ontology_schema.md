# ontology_schema.md

## 0. 문서 목적

이 문서는 프로젝트의 의미 구조를 어떻게 저장하고, 실제 코드와 어떻게 연결하며, 사용자의 질문에 따라 어떤 형태의 View로 보여줄지를 정의한다.

이 프로젝트는 Repository를 하나의 고정된 Node/Relation 그래프로 바꾸는 도구가 아니다. 대신 다음 구조를 따른다.

```text
AI가 프로젝트의 의미를 이해하고,
Core가 그 의미를 실제 코드 Evidence에 Grounding하며,
사용자의 질문에 따라 적절한 View IR로 재구성해 보여준다.
```

핵심 원칙은 세 가지다.

```text
Semantic understanding = AI-first
Evidence / Grounding / Persistence = deterministic-first
User experience = View-specific, Scenario-first
```

제품 언어로는 다음처럼 정리할 수 있다.

> AI가 Meaning을 만든다.
> Core가 Evidence와 Identity를 관리한다.
> View가 그 Meaning을 사람이 이해할 수 있는 형태로 바꾼다.

---

# 1. 왜 Universal Graph를 만들지 않는가

프로젝트 전체를 하나의 Semantic Graph로 만들고 모든 개념과 관계를 한 화면에 렌더링하면 다음 문제가 생긴다.

```text
- 모든 개념을 하나의 Node taxonomy로 강제 분류해야 한다.
- 모든 의미를 하나의 Relation vocabulary에 맞춰야 한다.
- 시간 순서, 인과관계, 상태 변화가 같은 edge처럼 보인다.
- 프로젝트가 커질수록 그래프가 난잡해진다.
- AI가 더 풍부하게 이해한 의미가 taxonomy에 맞추면서 손실된다.
- 잘못된 classification 하나가 전체 구조를 왜곡할 수 있다.
- “어떻게 동작하는가?”와 “어디에 영향이 가는가?” 같은 서로 다른 질문을 같은 그래프로 답하게 된다.
```

따라서 하나의 Universal Graph 대신 다음 구조를 사용한다.

```text
Persistent Semantic Memory
        ↓
사용자의 질문 / 현재 선택
        ↓
View Planner
        ↓
View-specific Typed IR
        ↓
Renderer
```

---

# 2. 전체 Architecture

```text
                           USER
                            │
                            ▼
                           APP
                            │
                       ViewRequest
                            │
                            ▼
                       View Planner
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
    OverviewIR          ScenarioIR           ImpactIR
                                                ...
        └───────────────────┼────────────────────┘
                            ▼
                          Viewer

                    Persistent Semantic Layer
                            ▲
                            │
                      Semantic Memory
                   ┌────────┴────────┐
                   ▼                 ▼
               Concepts           Claims
                   └────────┬────────┘
                            ▼
                        Grounding
                            ▲
                            │
                         Evidence
                            ▲
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
         Evidence Engine              AI Agent
    AST / Symbol / Git / DB      Semantic Understanding
       Routes / Events            Repository Exploration
               │                         │
               └────────────┬────────────┘
                            ▼
                        Repository
```

역할은 명확히 나눈다.

```text
AI
= 무엇이 중요한 의미인가?
= 이 프로젝트는 어떻게 작동하는가?
= 어떤 사용자 목적과 Scenario가 존재하는가?

Core
= 실제 코드에 무엇이 존재하는가?
= 그 의미의 근거가 어디에 있는가?
= 어떤 코드가 바뀌었는가?
= 이전 의미와 같은 Concept인가?
= AI가 허구의 Grounding을 만들지 않았는가?
```

---

# 3. 네 개의 정보 층

## 3.1 Repository Evidence

현재 코드에 실제로 존재하는 사실.

예:

```text
file
symbol
definition
reference
route
API handler
React event
DB model
DB read/write
config
Git change
external integration
```

가능한 한 deterministic하게 관리한다.

## 3.2 Intent / Decision

사용자가 원래 만들고 싶었던 것.

예:

```text
Requirement
Blueprint
Decision
Constraint
Deferred item
```

예:

```text
DEC-003
MVP 회원가입에서는 이메일 인증을 사용하지 않는다.
```

Intent는 현재 코드의 사실이 아니다. 현재 구현과 Intent의 차이가 Drift의 근거가 된다.

## 3.3 Semantic Memory

Repository + Evidence + Intent를 바탕으로 AI가 지속적으로 유지하는 프로젝트 의미 구조.

예:

```text
비공개 계정의 팔로우는 즉시 관계를 만들지 않고,
팔로우 요청을 생성한 뒤 상대 사용자의 승인을 기다린다.
```

Semantic Memory는 AI가 작성하지만 Evidence에 Grounding되어야 한다.

## 3.4 View / Projection

Semantic Memory를 특정 질문에 답하기 좋은 형태로 재구성한 derived artifact.

예:

```text
Overview
Scenario
Lifecycle
Impact
Implementation Trace
Intent / Drift
```

View는 Source of Truth가 아니다.

---

# 4. Core Semantic Model

Core Semantic Model은 얇게 유지한다.

```text
SemanticConcept
SemanticClaim
Evidence
Grounding
IntentRecord
SemanticVersion
```

Core에는 모든 의미를 강제로 분류하는 global Node Type과 global Relation Type을 두지 않는다.

---

# 5. SemanticConcept

SemanticConcept는 프로젝트를 이해하는 데 독립적으로 이름 붙이고 다시 참조할 가치가 있는 의미 단위다.

예:

```text
사용자
프로필
팔로우
팔로우 요청
팔로우 관계
비공개 계정
결제
주문
구독 플랜
추천 피드
Stripe
이메일 인증
```

초안:

```ts
interface SemanticConcept {
  id: string
  name: string
  description?: string
  aliases?: string[]
  hints?: string[]

  evidenceRefs: string[]
  intentRefs?: string[]

  confidence?: number

  status:
    | 'active'
    | 'uncertain'
    | 'deprecated'
    | 'needs_review'

  createdAtVersion: number
  updatedAtVersion: number
}
```

---

# 6. Concept에 Global Type을 강제하지 않는다

Concept에는 프로젝트 전체에서 통용되는 고정 Type을 붙이지 않는다.

Core가 저장하는 것은 다음이다.

```text
Concept의 이름
Concept의 설명
다른 Concept와의 Claim
실제 코드 Evidence
Intent와의 연결
Version / Identity
```

즉 Core는 다음 질문을 먼저 하지 않는다.

```text
"이 Concept는 어떤 종류인가?"
```

대신:

```text
"이 Concept는 이 프로젝트에서 무엇을 의미하는가?"
"어떤 Claim으로 다른 Concept와 연결되는가?"
"그 의미의 실제 코드 근거는 무엇인가?"
```

를 유지한다.

같은 Concept는 사용자가 무엇을 보고 싶은지에 따라 서로 다른 역할을 가질 수 있다.

예를 들어 `팔로우 요청`은:

```text
Overview
→ 팔로우 영역을 설명하는 핵심 항목

Scenario
→ 요청 생성/승인 흐름에서 다루는 대상

Lifecycle
→ 상태 변화의 중심 대상

Impact
→ 변경 영향 분석의 Anchor 또는 Affected Item

Trace
→ 실제 FollowRequest model / service / route에 Grounding된 의미
```

가 될 수 있다.

따라서 핵심 질문은:

```text
이 Concept의 전역 Type은 무엇인가?
```

가 아니라:

```text
현재 사용자의 질문에서 이 Concept를 어떤 역할로 보여줘야 하는가?
```

이다.

필요하다면 내부 검색·레이아웃·성능 최적화를 위한 `hints`를 둘 수 있지만,
이는 의미의 정답이 아니다.

예:

```text
hints:
- user-facing
- persistent
- external
- ui-related
```

`hint`가 틀리거나 없어도 Concept 자체의 의미와 Grounding은 유효해야 한다.

# 7. SemanticClaim

SemanticClaim은 Concept와 Concept 사이 또는 Concept와 값 사이의 의미 있는 주장이다.

예:

```text
비공개 계정은 팔로우 시 승인을 요구한다.
팔로우 승인이 완료되면 팔로우 관계가 생성된다.
피드 구성은 팔로우 관계를 사용한다.
좋아요가 생성되면 알림이 만들어진다.
```

초안:

```ts
interface SemanticClaim {
  id: string

  subjectConceptId: string
  predicate: string

  object:
    | { conceptId: string }
    | { value: string }

  description?: string
  semanticHint?: string

  evidenceRefs: string[]
  intentRefs?: string[]

  confidence?: number

  status:
    | 'active'
    | 'uncertain'
    | 'contradicted'
    | 'needs_review'

  createdAtVersion: number
  updatedAtVersion: number
}
```

---

# 8. Claim Predicate는 자유롭게 유지한다

Core는 Claim을 미리 정해진 관계 종류 중 하나로 normalize하도록 강제하지 않는다.

AI가 Repository를 보고 이해한 의미를 가능한 한 손실 없이 보존하는 것이 우선이다.

예:

```text
subject:
비공개 계정

predicate:
팔로우 시 상대 사용자의 승인을 요구한다

object:
팔로우 요청
```

또는:

```text
subject:
팔로우 승인

predicate:
완료되면 생성한다

object:
팔로우 관계
```

또는:

```text
subject:
팔로우 관계

predicate:
피드에 보여줄 게시물을 결정할 때 사용된다

object:
피드 구성
```

`predicate`는 프로젝트 의미에 맞게 AI가 작성할 수 있다.

필요하다면 기계 처리 보조용 `semanticHint`를 사용할 수 있다.

```text
causal
state-change
dependency
policy
presentation
```

그러나 이 Hint는 선택 사항이며, Claim의 원문 의미를 대체하지 않는다.

핵심 원칙:

> **Core는 의미를 vocabulary에 맞춰 축약하기보다, Claim의 의미와 Evidence를 먼저 보존한다.**

# 9. 기존 Node / Relation Vocabulary의 위치

이 설계에서는 과거에 사용했던 고정 Node Type과 제한된 Relation Type을 Core Schema에 포함하지 않는다.

또한 이들을 "공식 presentation vocabulary"로도 미리 예약하지 않는다.

사용자에게 보이는 용어는 현재 Repository와 Semantic Memory에서 나온 프로젝트 고유 의미를 사용한다.

예:

```text
프로필에서 팔로우 선택
비공개 계정인지 확인
팔로우 요청 생성
상대 사용자가 승인
팔로우 관계 생성
```

다른 프로젝트라면 전혀 다른 용어가 자연스럽게 등장할 수 있다.

```text
예약 슬롯 선택
결제 승인 요청
재고 확보
배포 승인
Build Job 재시도
Webhook 수신
```

즉 사용자 화면의 의미 단어는 전역 taxonomy에서 가져오는 것이 아니라:

```text
Repository의 이름/구조
+
AI가 이해한 프로젝트 의미
+
Intent / 사용자 언어
```

에서 생성한다.

다만 각 View에는 **표현 문법(structural grammar)** 이 존재한다.

예:

```text
Scenario View
→ participant / step / transition / branch / state change

Lifecycle View
→ state / transition

Impact View
→ anchor / impact item / impact path

Trace View
→ code entity / implementation link
```

이 구조 이름들은 프로젝트 의미를 분류하는 ontology가 아니라
Renderer와 Validator가 사용하는 **View IR의 구조적 슬롯**이다.

핵심 구분:

```text
고정되는 것
= View의 문법 / Schema

고정되지 않는 것
= 사용자가 보는 프로젝트 의미 / 이름 / 관계 설명
```

# 10. Evidence

Evidence는 Semantic Meaning을 대신 결정하지 않는다.

Evidence의 역할:

```text
왜 이 의미를 믿는가?
어느 코드가 근거인가?
코드가 바뀐 뒤에도 이 의미가 유효한가?
```

초기 Evidence 종류:

```text
file
symbol
source_range
definition
reference
call
route
api_handler
ui_event
render
db_entity
db_read
db_write
config
git_change
external_integration
intent
decision
```

초안:

```ts
interface Evidence {
  id: string
  kind: string

  filePath?: string
  symbolId?: string

  location?: {
    startLine?: number
    endLine?: number
  }

  summary?: string
  confidence?: number

  analysisVersion: number
}
```

---

# 11. Evidence Engine

AST / TypeChecker / Framework Adapter는 계속 사용한다.

하지만 목적은 Semantic Classification이 아니다.

```text
AST / TypeChecker / Framework Adapter
→ 이 Symbol은 어디에 있는가?
→ 무엇을 reference하는가?
→ 어떤 Route인가?
→ 어떤 UI Event인가?
→ 어떤 DB를 읽고 쓰는가?
→ 어떤 코드가 변경되었는가?
```

핵심:

> AST는 Semantic Classifier가 아니라 Evidence Indexer다.

MVP 우선순위:

```text
P0: file / symbol 주소화
P1: definition / reference
P2: route / API / UI event / DB / external integration
P3: Git change / diff
P4: 강한 dependency evidence
P5: 필요한 경우에만 고급 static analysis
```

완전한 runtime call graph 재구성을 제품 성공 조건으로 두지 않는다.

---

# 12. Grounding

Grounding은 Semantic Memory와 실제 Repository를 연결한다.

many-to-many를 기본으로 한다.

```text
Concept N
   ↕
Evidence N

Claim N
   ↕
Evidence N
```

초안:

```ts
interface ConceptGrounding {
  conceptId: string
  evidenceRefs: string[]
  confidence?: number
}

interface ClaimGrounding {
  claimId: string
  evidenceRefs: string[]
  confidence?: number
}
```

Concept 존재 근거와 Claim 관계 근거를 분리한다.

---

# 13. IntentRecord

```ts
interface IntentRecord {
  id: string

  kind:
    | 'requirement'
    | 'decision'
    | 'constraint'
    | 'blueprint'

  title: string
  content: string

  status?: string

  relatedConceptIds?: string[]
  relatedClaimIds?: string[]
}
```

Intent와 Current Implementation을 같은 truth로 취급하지 않는다.

---

# 14. Semantic Memory

Persistent Semantic Memory:

```text
Concepts
Claims
Groundings
Intent links
Versions
Confidence
History
```

논리적으로 graph-like하지만 제품 개념으로는 `Semantic Memory`가 더 정확하다.

이 Memory는 사람뿐 아니라 Agent의 장기 프로젝트 context로도 사용한다.

---

# 15. Semantic Identity

AI-first 구조에서는 같은 의미가 분석마다 새 Concept가 되는 문제를 막아야 한다.

Identity matching 후보:

```text
기존 name / alias
description similarity
Grounding overlap
Intent link
Scenario usage
implementation neighborhood
semantic similarity
previous version
```

기본 원칙:

> 새 Concept 생성보다 기존 Concept reuse를 우선한다.

---

# 16. Semantic Patch

코드 변경 때 Semantic Memory 전체를 재생성하지 않는다.

```ts
interface SemanticPatch {
  addedConcepts?: SemanticConcept[]
  updatedConcepts?: SemanticConcept[]
  removedConceptIds?: string[]

  addedClaims?: SemanticClaim[]
  updatedClaims?: SemanticClaim[]
  removedClaimIds?: string[]

  groundingUpdates?: unknown[]
}
```

변경 흐름:

```text
Previous Semantic Memory
+
Evidence Diff
+
Intent
        ↓
AI Agent
        ↓
Semantic Patch
        ↓
Validator
        ↓
Semantic Memory vNext
```

---

# 17. Semantic Validation

AI 자유도를 높이는 대신 Validator를 강화한다.

## Schema Validation

```text
필수 field
ID 형식
reference integrity
```

## Evidence Validation

```text
Evidence가 실제 존재하는가?
현재 analysis version인가?
file/symbol이 실제 존재하는가?
```

## Grounding Validation

```text
Concept/Claim이 실제 Evidence에 연결되는가?
```

## Stability Validation

```text
같은 의미를 새 Concept로 만들지 않았는가?
무관한 코드 변경으로 대량 semantic churn이 생기지 않았는가?
불필요한 split/merge가 발생하지 않았는가?
```

---

# 18. View란 무엇인가

View는 Graph filter가 아니다.

> View는 특정 사용자 질문에 답하기 위한 설명 구조다.

예:

| 사용자 질문 | View |
|---|---|
| 이 서비스는 뭐로 이루어져 있어? | Overview |
| 이 기능은 어떻게 작동해? | Scenario |
| 이 정보는 어떻게 상태가 바뀌어? | Lifecycle |
| 이걸 수정하면 어디 영향가? | Impact |
| 실제 코드는 어디야? | Implementation Trace |
| 처음 말한 것과 지금 뭐가 달라? | Intent / Drift |

같은 Semantic Memory에서 질문에 따라 전혀 다른 Typed IR이 만들어진다.

---

# 19. ViewRequest

사용자의 시작점을 미리 고정하지 않는다.

```ts
interface ViewRequest {
  viewKind:
    | 'overview'
    | 'scenario'
    | 'lifecycle'
    | 'impact'
    | 'trace'
    | 'drift'

  anchor?: ViewAnchor

  question?: string

  scope?: ViewScope
}
```

Anchor 후보:

```text
Semantic Concept
Intent
Decision
Code Change
File
Symbol
Scenario
Search Result
```

예:

```text
viewKind: scenario
anchor: 팔로우
```

```text
viewKind: impact
anchor: FollowService 변경
```

```text
viewKind: scenario
anchor: 알림
question: "이 알림이 왜 생기는지 보여줘"
```

핵심:

> 사용자의 시작점은 동적이고, View의 문법만 고정한다.

---

# 20. View Planner

```text
ViewRequest
+
Semantic Memory
+
Evidence
+
Intent
        ↓
현재 질문에 필요한 범위 선택
        ↓
View-specific Typed IR 생성
```

AI가 View planning을 담당할 수 있지만 Core가 모든 reference와 evidence를 검증한다.

---

# 21. View-specific IR

하나의 generic Graph IR을 모든 화면에 사용하지 않는다.

```text
OverviewIR
ScenarioIR
LifecycleIR
ImpactIR
TraceIR
DriftIR
```

각 View는 그 질문에 적합한 구조를 가진다.

---

# 22. Overview View

질문:

> 이 서비스에는 무엇이 있고 어떤 주요 영역과 사용자 목적이 있는가?

예:

```text
Instagram Clone

계정
 ├ 로그인
 └ 프로필 관리

콘텐츠
 ├ 피드 보기
 └ 게시물 작성

소셜
 ├ 좋아요
 ├ 댓글
 └ 팔로우

알림
 └ 알림 확인
```

Overview는 전체 Semantic Memory를 펼치지 않는다.

초안:

```ts
interface OverviewIR {
  title: string

  areas: Array<{
    id: string
    label: string

    items: Array<{
      id: string
      label: string
      conceptRefs?: string[]
      scenarioRefs?: string[]
    }>
  }>

  importantConnections?: Array<{
    from: string
    to: string
    label?: string
  }>
}
```

Area는 Presentation hierarchy이지 Core ontology가 아니다.

---

# 23. Scenario View

질문:

> 이 사용자 목적은 어떻게 작동하는가?

Scenario는 비전공자 관점의 핵심 View다.

기본 문법:

```text
Activity Flow
+
Semantic Participant Lanes
+
Branch
+
State Change Annotation
```

---

# 24. Scenario 정의

Scenario는 모든 가능한 execution path가 아니다.

> 하나의 사용자 목적 또는 시스템 목적을 설명하는 대표 흐름.

예:

```text
로그인하기
게시물 작성하기
좋아요 누르기
팔로우하기
결제하기
예약하기
```

---

# 25. User Scenario / System Scenario

User Scenario:

```text
로그인하기
팔로우하기
결제하기
예약하기
```

System Scenario:

```text
결제 완료 Webhook 처리
예약 만료 처리
추천 피드 갱신
자동 알림 발송
```

System Scenario를 억지로 사용자 행동으로 해석하지 않는다.

---

# 26. Canonical Scenario

모든 가능한 Scenario를 미리 생성하지 않는다.

대표 사용자 목적 중심의 작은 Scenario Index만 유지한다.

Canonical Scenario는 서비스의 유일한 정답 경로가 아니라:

```text
처음 읽기 좋은 대표 설명 경로
```

다.

---

# 27. On-demand Scenario

어떤 Concept에서도 시작할 수 있다.

예:

```text
[알림]
→ "이 알림이 왜 생겨?"
```

```text
[팔로우 관계]
→ "이 정보가 어떻게 만들어져?"
```

Anchor + Question을 중심으로 관련 Claim/Evidence를 탐색하여 Scenario를 만든다.

---

# 28. ScenarioIR

```ts
interface ScenarioIR {
  id: string
  name: string

  type:
    | 'user'
    | 'system'

  goal?: string
  outcome?: string

  participants: ScenarioParticipant[]
  steps: ScenarioStep[]
  transitions: ScenarioTransition[]
  branches?: ScenarioBranch[]
  stateChanges?: ScenarioStateChange[]

  evidenceRefs?: string[]
  confidence?: number
}
```

---

# 29. ScenarioParticipant

Sequence Diagram의 lane 아이디어를 차용한다.

`ScenarioParticipant`는 Scenario에서 서로 구분해서 보여줄 필요가 있는 참여 주체/맥락이다.

```ts
interface ScenarioParticipant {
  id: string

  label: string

  conceptRefs?: string[]

  // Renderer가 배치에 참고할 선택적 힌트.
  // Core semantic type이 아니며 사용자에게 노출할 필요도 없다.
  layoutHint?: string
}
```

중요한 것은 `label`이다.

예:

```text
사용자
프로필 화면
주문 시스템
판매자
Stripe
GitHub
배치 작업
```

이 label은 고정 vocabulary에서 선택하는 것이 아니라
Repository + Semantic Memory + Intent에서 프로젝트에 맞게 생성한다.

`layoutHint`가 필요하다면 Renderer가 lane 배치나 아이콘 선택에 참고할 수 있지만,
semantic correctness는 이에 의존하지 않는다.

기본 Scenario에서는 다음과 같은 저수준 기술 객체를 무조건 participant로 승격하지 않는다.

```text
FollowButton
FollowService
PrismaClient
```

사용자의 질문에 실제로 도움이 될 때만 표시하고,
일반적으로는 Trace View에서 자세히 보여준다.

# 30. ScenarioStep

```ts
interface ScenarioStep {
  id: string
  label: string

  participantId?: string

  conceptRefs: string[]
  claimRefs?: string[]

  evidenceRefs: string[]
  confidence?: number
}
```

Step은 Concept 하나와 1:1일 필요가 없다.

AI가 여러 Concept/Claim을 하나의 사용자 Step으로 압축할 수 있다.

---

# 31. ScenarioTransition

```ts
interface ScenarioTransition {
  fromStepId: string
  toStepId: string

  condition?: string

  evidenceRefs: string[]
  confidence?: number
}
```

중요:

```text
ScenarioTransition
≠ SemanticClaim
```

Transition은 흐름상 다음 단계이고 Claim은 의미적 주장이다.

---

# 32. ScenarioBranch

```ts
interface ScenarioBranch {
  sourceStepId: string

  conditionLabel: string

  conceptRefs?: string[]
  claimRefs?: string[]
  evidenceRefs: string[]

  paths: Array<{
    label: string
    nextStepId: string
  }>
}
```

Activity Diagram의 Decision / Guard 개념을 차용한다.

---

# 33. ScenarioStateChange

State Diagram의 개념을 차용하지만 State를 Core Node Type으로 만들지 않는다.

```ts
interface ScenarioStateChange {
  subjectConceptId: string

  from?: string
  to?: string

  changeKind?:
    | 'create'
    | 'update'
    | 'delete'
    | 'state_transition'

  causedByStepId: string

  evidenceRefs: string[]
}
```

예:

```text
팔로우 요청
없음 → 승인 대기
```

---

# 34. Scenario 예시

```text
사용자          프로필 화면           시스템            상대 사용자
  │                  │                  │                   │
  │ 팔로우 선택       │                  │                   │
  ├─────────────────▶│                  │                   │
  │                  │                  │                   │
  │                  ├─────────────────▶│                   │
  │                  │            ◇ 비공개 계정인가?       │
  │                  │             /            \           │
  │                  │          아니오            예        │
  │                  │            │               │         │
  │                  │       관계 생성          요청 생성    │
  │                  │                            │         │
  │                  │                            ├────────▶│
  │                  │                            │         │
  │                  │                            │     요청 승인
  │                  │                            │         │
  │                  │                       관계 생성 ◀──────┘
```

State annotation:

```text
요청 생성
팔로우 요청: 없음 → 승인 대기

승인
팔로우 요청: 승인 대기 → 승인됨

관계 생성
팔로우 관계: 없음 → 팔로잉
```

---

# 35. Lifecycle View

질문:

> 이 Concept는 어떤 상태를 거치는가?

예:

```text
팔로우 요청

[없음]
  ↓ 요청
[승인 대기]
 ├ 승인 → [승인됨]
 ├ 거절 → [거절됨]
 └ 취소 → [취소됨]
```

초안:

```ts
interface LifecycleIR {
  subjectConceptId: string

  states: Array<{
    id: string
    label: string
  }>

  transitions: Array<{
    fromStateId: string
    toStateId: string
    label?: string

    conceptRefs?: string[]
    claimRefs?: string[]
    evidenceRefs: string[]
  }>
}
```

---

# 36. Impact View

질문:

> 이걸 수정하면 어디에 영향이 갈 수 있는가?

Impact는 Semantic Claim만 따라가서 계산하지 않는다.

```text
Anchor
 ↓ Grounding
Evidence / Code
 ↓ implementation dependency
Affected Evidence
 ↓ reverse Grounding
Affected Concepts
 ↓
Human explanation
```

초안:

```ts
interface ImpactIR {
  anchor: string

  directImpacts: ImpactItem[]
  likelyImpacts: ImpactItem[]
  unknownImpacts?: ImpactItem[]

  paths?: Array<{
    from: string
    to: string
    evidenceRefs: string[]
  }>
}

interface ImpactItem {
  label: string
  conceptRefs?: string[]
  evidenceRefs: string[]
  explanation?: string
}
```

---

# 37. Implementation Trace View

질문:

> 이 의미는 실제 코드 어디에 구현되어 있는가?

예:

```text
프로필에서 팔로우
        ↓
FollowButton.tsx
        ↓
handleFollow()
        ↓
POST /api/follow
        ↓
FollowService
        ↓
FollowRequest
        ↓
NotificationService
```

초안:

```ts
interface TraceIR {
  anchorConceptIds?: string[]

  codeEntities: Array<{
    id: string
    kind: string
    label: string
    filePath?: string
    symbolId?: string
  }>

  links: Array<{
    from: string
    to: string
    kind: string
    evidenceRefs: string[]
  }>
}
```

---

# 38. Drift View

질문:

> 처음 원했던 것과 지금 구현이 어떻게 다른가?

```text
Intent / Decision
        ↕
Semantic Memory
        ↕
Repository Evidence
```

예:

```text
Decision:
MVP 회원가입에는 이메일 인증을 넣지 않는다.

Current Semantic Memory:
회원가입 이후 이메일 인증 과정이 존재한다.

Evidence:
EmailVerificationService
verification route
verification token
```

초안:

```ts
interface DriftIR {
  intentRef: string

  currentConceptRefs?: string[]
  currentClaimRefs?: string[]

  status:
    | 'aligned'
    | 'possible_drift'
    | 'confirmed_drift'
    | 'uncertain'

  explanation: string
  evidenceRefs: string[]
}
```

---

# 39. View-specific Classification

현재 설계에서 "분류"는 프로젝트 전체 의미에 대한 taxonomy가 아니라
**현재 View 안에서 데이터를 어떤 구조로 배치할지 결정하는 역할 분류**다.

예:

ScenarioIR:

```text
participant
step
transition
branch
stateChange
```

LifecycleIR:

```text
state
transition
```

ImpactIR:

```text
anchor
impact item
impact path
```

TraceIR:

```text
code entity
implementation link
```

이들은 `팔로우 요청은 항상 state다`, `Stripe는 항상 external node다` 같은 의미 분류가 아니다.

같은 Concept가 View에 따라 다른 슬롯에 들어갈 수 있다.

예:

```text
Concept: 팔로우 요청

Scenario
→ Step에서 다루는 대상 / StateChange subject

Lifecycle
→ Lifecycle subject

Impact
→ Anchor 또는 Impact Item

Trace
→ 실제 code entity들과 연결되는 상위 의미
```

따라서:

> **View IR의 구조는 고정되지만, 그 안에 들어가는 프로젝트 용어와 의미는 고정되지 않는다.**

사용자에게 보이는 문구는 코드 구조를 그대로 노출하는 것이 아니라,
코드에 Grounding된 프로젝트 의미를 AI가 읽기 쉬운 언어로 표현한 것이다.

# 40. View 선택과 시작점

사용자를 항상 Overview에서 시작하게 하지 않는다.

가능한 시작점:

```text
프로젝트 홈
검색 결과
Semantic Concept
Requirement
Decision
코드 변경
Git diff
Scenario
File
Symbol
```

대부분 View 선택은 UI context로 알 수 있다.

```text
프로젝트 최초 진입 → Overview
Scenario 목록 클릭 → Scenario
영향 보기 → Impact
실제 구현 보기 → Trace
상태 흐름 보기 → Lifecycle
```

자연어 질문만 Agent가 추가로 판단하면 된다.

---

# 41. Progressive Disclosure

비전공자에게 모든 기술 정보를 한 번에 보여주지 않는다.

대표 경로:

```text
Overview
  ↓
Scenario
  ↓
Step Detail
  ↓
Implementation Trace
```

또는:

```text
Scenario
  ↓
Lifecycle
```

또는:

```text
Change
  ↓
Impact
  ↓
Trace
```

---

# 42. Typed IR + Validator

AI가 HTML/SVG를 직접 생성하지 않는다.

항상:

```text
AI / View Planner
    ↓
Typed View IR
    ↓
Validator
    ↓
Renderer
```

구조를 사용한다.

장점:

```text
모델 교체
Renderer 교체
Schema test
View diff
E2E test
Hallucination validation
```

---

# 43. View는 Bounded해야 한다

Semantic Memory가 크다고 해서 모든 정보를 한 View에 보여주지 않는다.

Scenario에서는:

```text
대표 main path
중요한 branch
필요한 participant
필요한 state change
```

만 선택한다.

핵심:

> Semantic Memory의 완전성과 화면의 완전성을 동일시하지 않는다.

---

# 44. Agent와 Core의 책임 경계

AI가 결정:

```text
어떤 Concept가 중요한가?
어떤 Claim이 핵심인가?
어떤 사용자 목적이 존재하는가?
어떤 Step으로 묶을 것인가?
어떤 Detail을 숨길 것인가?
어떤 Branch가 의미 있는가?
어떻게 비전공자 언어로 표현할 것인가?
```

Core가 검증:

```text
Concept/Claim/Evidence ID가 존재하는가?
실제 file/symbol이 존재하는가?
Transition 근거가 있는가?
State change 근거가 있는가?
허구 Grounding이 들어갔는가?
Version conflict가 있는가?
```

---

# 45. Incremental Update

```text
Repository v1
   ↓
Semantic Memory v1
```

변경 후:

```text
Git Diff
   ↓
Evidence Diff
   ↓
Dirty Evidence
   ↓
관련 Semantic Memory 조회
   ↓
AI Semantic Patch
   ↓
Validation
   ↓
Semantic Memory v2
```

전체 재분석보다 local semantic update를 우선한다.

---

# 46. False Semantic Churn

AI-first 설계에서 반드시 평가해야 한다.

예:

```text
v1: 팔로우
v2: 사용자 관계
v3: Follower Relationship
```

실제 의미는 같은데 Concept가 계속 바뀌면 실패다.

평가:

```text
Concept identity preservation
Unchanged semantic stability
Unnecessary split
Unnecessary merge
Name-only churn
```

---

# 47. Semantic Diff와 Impact

Semantic Diff:

```text
실제로 무엇이 바뀌었는가?
```

Impact:

```text
그 변경으로 무엇이 영향을 받을 수 있는가?
```

둘은 분리한다.

Semantic Diff 후보:

```text
Concept added
Concept removed
Concept meaning changed
Claim added
Claim removed
Claim contradicted
Grounding changed
```

---

# 48. MCP / Agent 사용

Agent는 MCP를 통해 Semantic Memory와 Evidence에 접근할 수 있다.

예:

```text
get_project_semantic_memory
get_concept_context
search_claims
get_evidence
get_scenario_context
get_impact_context
submit_semantic_patch
submit_view_ir
```

사용자가:

```text
"팔로우 승인 방식 수정해줘."
```

라고 하면 Agent는:

```text
Semantic Memory 조회
 ↓
팔로우 Concept / Claim 조회
 ↓
Grounding 조회
 ↓
실제 file/symbol 확인
 ↓
코드 수정
 ↓
Evidence Diff
 ↓
Semantic Patch
```

를 수행할 수 있다.

---

# 49. Persistence

예:

```text
.project-intel/

project.json
intent.json
semantic-memory.json
grounding.json
evidence.json
versions.json
events.ndjson
views/
```

반드시 persistent:

```text
Intent
Concept
Claim
Grounding
Semantic versions
Identity
Evidence reference
```

선택적으로 persistent:

```text
ScenarioIR
OverviewIR
ImpactIR
TraceIR
LifecycleIR
DriftIR
```

View IR은 cache일 수 있으며 Source of Truth는 아니다.

---

# 50. Feature / Group / Level

Feature는 Core entity로 강제하지 않는다.

UI에서는 다음만으로 충분할 수 있다.

```text
Area
  ↓
Canonical Scenario
```

예:

```text
소셜
 ├ 좋아요 누르기
 ├ 댓글 작성하기
 └ 다른 사용자 팔로우하기
```

Group/Area는 UI navigation metadata다.

고정 Level 0~4도 ontology로 두지 않는다.

대신:

```text
Overview
Scenario
Step Detail
Implementation Trace
```

처럼 Progressive Disclosure로 깊이를 표현한다.

---

# 50.1 View에서 사용자에게 보이는 단어는 어떻게 정해지는가

View의 **구조적 문법**과 **사용자에게 보이는 의미 단어**를 반드시 분리한다.

예를 들어 ScenarioIR의 Schema는 다음처럼 고정될 수 있다.

```text
Participant
Step
Transition
Branch
StateChange
```

하지만 실제 화면에 보이는 단어는 고정되지 않는다.

Instagram-like 프로젝트:

```text
사용자
프로필
팔로우 요청
승인
팔로우 관계
```

Commerce 프로젝트:

```text
구매자
장바구니
재고 확보
결제 승인
주문 확정
```

Developer Tool 프로젝트:

```text
개발자
Pull Request
검증 작업
배포 승인
Build Job
```

즉 View에서 보이는 단어는 **코드 구조와 더 관련된 프로젝트 고유 용어**가 된다.

다만 여기서 "코드 구조와 관련된다"는 것은
파일명/함수명을 그대로 노출한다는 뜻이 아니다.

권장 변환:

```text
raw code
FollowButton / requestFollow() / FollowRequest

        ↓ AI semantic interpretation + grounding

user-facing meaning
팔로우 선택 / 팔로우 요청 / 승인 대기
```

따라서 사용자-facing label의 우선순위는 다음과 같다.

```text
1. 사용자의 Intent / Requirement에서 이미 사용한 용어
2. UI text / domain model / route / test 등 Repository에 나타나는 도메인 용어
3. 여러 코드 요소를 종합해 AI가 복원한 제품 의미
4. 기술 세부는 Trace View에서만 필요 시 노출
```

핵심:

> **사용자에게는 코드 자체가 아니라 코드에 Grounding된 프로젝트 언어를 보여준다.**

---

# 51. Core에서 하지 않는 것

```text
- 모든 Concept를 미리 정한 전역 Node Type 중 하나로 강제 분류
- 모든 Claim을 미리 정한 전역 Relation Type 중 하나로 강제 분류
- AST 결과를 곧바로 Semantic Truth로 취급
- 모든 가능한 Scenario 생성
- 전체 Semantic Memory를 하나의 Node-Link Graph로 렌더링
- 모든 dependency를 사용자에게 노출
- AI output을 Evidence validation 없이 저장
- 코드 변경 때 Semantic Memory 전체 재생성
- View IR을 Source of Truth로 취급
```

---

# 52. 반드시 유지할 원칙

```text
1. 실제 코드 Grounding
2. Intent와 Current Implementation 분리
3. Semantic Identity 안정성
4. Evidence versioning
5. Incremental update
6. AI hallucination validation
7. View-specific Typed IR
8. Dynamic Anchor
9. 비전공자 중심 Progressive Disclosure
10. Agent와 Human이 같은 프로젝트 의미를 공유
```

---

# 53. Evaluation

## Evidence Quality

```text
Symbol grounding correctness
Route detection
DB grounding
Git diff correctness
Evidence freshness
```

## Semantic Quality

```text
중요 Concept 누락
잘못된 Concept
Claim hallucination
Grounding coverage
Meaning correctness
```

## Stability

```text
Concept identity preservation
False semantic churn
Unnecessary merge
Unnecessary split
```

## Scenario Quality

```text
사용자 목적 명확성
핵심 Step coverage
불필요한 implementation detail
Branch correctness
State change correctness
```

## View Utility

```text
사용자 질문에 제대로 답하는가?
정보량이 과도하지 않은가?
시작점을 강요하지 않는가?
비전공자가 이해 가능한가?
```

## Impact Quality

```text
Direct impact correctness
False positive
Missing impact
Evidence-backed explanation
```

---

# 54. Prototype에서 검증할 질문

```text
1. AI가 Repository를 직접 탐색하는 방식이 classifier-first보다 의미 품질이 높은가?

2. Evidence Index는 어느 수준까지 만들어야 충분한가?

3. Concept/Claim만으로 Persistent Semantic Memory가 충분한가?

4. 자유 predicate Claim이 얼마나 안정적인가?

5. Semantic Identity를 얼마나 안정적으로 유지할 수 있는가?

6. ScenarioIR이 실제 비전공자 이해에 도움이 되는가?

7. View-specific IR 여러 개를 유지하는 비용이 감당 가능한가?

8. Canonical Scenario를 자동으로 안정적으로 찾을 수 있는가?

9. On-demand Anchor-based View가 자연스럽게 동작하는가?

10. Intent / Semantic / Evidence 분리가 Drift 탐지를 더 명확하게 만드는가?
```

---

# 55. 최종 Mental Model

```text
Repository
    │
    ├──────────────→ AI
    │                 │
    │          "이 프로젝트의 의미는?"
    │                 │
    │                 ▼
    │          Semantic Memory
    │
    └→ Evidence Engine
         │
         └────→ "그 의미의 실제 근거는?"
                       │
                       ▼
                   Grounding
                       │
                       ▼
                 View Planner
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
   Overview         Scenario          Impact
                       │
                 Lifecycle / Trace
                       │
                       ▼
                      User
```

---

# 56. 최종 핵심 문장

```text
AI가 Meaning을 만든다.

Core가 Evidence와 Identity를 관리한다.

Semantic Memory가 그 Meaning을 지속시킨다.

View Planner가 사용자의 질문과 Anchor에 맞게
Overview / Scenario / Lifecycle / Impact / Trace / Drift로 재구성한다.

View의 Schema는 고정되어도, 화면에 표시되는 프로젝트 용어는 고정하지 않는다.
그 용어는 Repository와 Intent에 Grounding된 의미에서 나온다.

Viewer는 그 구조를 비전공자가 읽을 수 있게 보여준다.
```

이것이 현재 프로젝트의 ontology / semantic architecture다.
