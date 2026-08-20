# Implementation Plan — Non-developer Semantic Project Graph

> 상태: **구현용 1차 계획서**
>
> 이 문서는 `ontology_schema.md`, `mechanism.md`, `mechanism_research.md`, `mechanism_research2.md`를 통합해 실제 Coding Agent가 구현을 시작할 수 있도록 정리한 계획이다.
>
> 중요한 원칙:
>
> - `ontology_schema.md`는 제품의 의미 모델을 정의한다.
> - 이 문서는 그 의미 모델을 **실제 Repository에서 생성·검증·갱신하는 구현 메커니즘**을 정의한다.
> - 아직 가설인 ontology 항목은 구현 과정에서 임의로 확정하지 않는다.
> - 외부 Claude Code / Codex 같은 Coding Agent가 semantic reasoning을 담당하고, 로컬 Tool은 deterministic analysis / validation / persistence를 담당한다.

---

# 1. 제품 목표

## 1.1 핵심 목표

코드베이스의 파일/함수/컴포넌트/API/DB 구조를 그대로 시각화하지 않는다.

대신 다음 파이프라인을 통해 **비전공자가 이해할 수 있는 Semantic Project Graph**를 만든다.

```text
Repository
   ↓
Implementation Analysis
   ↓
Implementation Evidence / Graph
   ↓
Semantic Context Assembly
   ↓
External AI Agent Semantic Lifting
   ↓
Semantic Candidates
   ↓
Validation
   ↓
Product-level Semantic Compression
   ↓
Semantic Project Graph
   ↕
Implementation Grounding
```

최종적으로:

```text
사람에게
→ Semantic Graph

Agent에게
→ Semantic Graph + Implementation Grounding + Implementation Graph
```

을 제공한다.

---

## 1.2 사용자가 얻어야 하는 것

MVP 이후 Viewer에서 사용자는 코드 구조를 읽지 않고도 다음 질문에 답할 수 있어야 한다.

```text
이 서비스는 무엇으로 구성되어 있는가?
사용자는 무엇을 할 수 있는가?
정보는 어디에서 와서 어디로 가는가?
이 기능을 수정하면 어디까지 영향을 주는가?
이번 수정에서 제품 수준에서 무엇이 달라졌는가?
```

---

# 2. 비목표 / 하지 않을 것

MVP에서는 다음을 목표로 하지 않는다.

```text
- 모든 프로그래밍 언어 완벽 지원
- 완전한 JavaScript runtime call graph 복원
- 전체 프로그램 global data flow 분석
- 모든 React state를 Semantic Information으로 승격
- 모든 if문/조건문을 Rule Node로 승격
- 파일/함수 하나당 Semantic Node 하나 생성
- LLM에게 Repository 전체를 던져 Graph 전체를 한 번에 생성
- Tool 내부에서 특정 상용 LLM API를 하드코딩
- Viewer를 Graph 생성 엔진보다 먼저 구현
```

---

# 3. 확정 설계와 가설을 분리

# 3.1 현재 구현 계획에서 확정해도 되는 설계

다음은 현재 조사 결과를 기준으로 구현 방향으로 채택한다.

```text
1. Semantic Project Graph의 핵심은 Node + Semantic Relation이다.
2. Semantic Node는 실제 코드와 Implementation Grounding을 유지한다.
3. Grounding은 many-to-many를 지원한다.
4. Implementation Relation과 Semantic Relation을 별도로 관리한다.
5. 영향 분석의 근거는 가능한 한 Implementation Graph로 한다.
6. TS/TSX MVP에서는 TypeScript semantic compiler 정보를 사용한다.
7. CodeUnit IR은 언어 중립 형태로 설계한다.
8. Parser/Syntax와 Symbol Resolution 책임을 분리한다.
9. React / Next.js / DB 분석은 Framework Adapter로 분리한다.
10. Framework Adapter가 Semantic Node를 직접 생성하지 않는다.
11. Context Builder가 raw Repository 대신 선택된 Semantic Context Packet을 만든다.
12. AI Agent는 의미 판단 / semantic compression을 담당한다.
13. Tool은 사실 추출 / schema validation / evidence validation / persistence를 담당한다.
14. Agent 결과는 구조화된 MCP contract를 통해 제출한다.
15. Candidate가 최종 압축 과정에서 조용히 사라지지 않도록 disposition을 추적한다.
16. Incremental dirty propagation과 사용자 impact traversal은 서로 다른 알고리즘으로 둔다.
17. Viewer보다 먼저 JSON/CLI Inspector로 Graph 생성 품질을 검증한다.
18. Graph 품질은 단계별 fixture/evaluation으로 평가한다.
```

---

# 3.2 아직 ontology 가설로 유지할 것

다음은 Coding Agent가 임의로 확정하면 안 된다.

```text
- Node type이 정확히 Actor / Surface / Action / Information / External / Rule 6종인가?
- Semantic Relation이 정확히 현재 6종인가?
- Feature를 실제 persisted entity로 둘 것인가?
- Group에는 Node만 포함되는가?
- Level은 항상 0~4인가?
- Information의 범위는 어디까지인가?
- Group이 graph core인가 presentation metadata인가?
```

### 구현 원칙

초기 코드는 위 가설이 바뀌어도 수정하기 쉬운 형태로 만든다.

예:

```text
NodeType = enum/configuration
RelationType = schema registry
Relation source/target rule = validation table
```

ontology를 코드 곳곳의 `if/else`에 하드코딩하지 않는다.

---

# 3.3 이번 계획에서 정리해둘 개념 경계

## Semantic Project Graph Core

```text
SemanticNode
SemanticRelation
Grounding
```

## Presentation / Navigation Metadata

```text
Group / Area
View
Level
Layout
```

현재 `Group`은 Semantic Graph의 존재론적 사실이라기보다 사용자 탐색을 위한 보조 정보로 취급한다.

즉 저장은 가능하지만 **Graph Core와 분리된 metadata**로 설계한다.

`Feature`도 현재는 독립 persisted entity로 확정하지 않는다.
필요하면 이후 Semantic Node 여러 개를 묶는 상위 abstraction으로 추가한다.

---

# 4. MVP 기술 범위

## 4.1 지원 Repository

초기 목표:

```text
TypeScript / TSX
React
Next.js App Router
Prisma
```

JavaScript/JSX는 TypeScript analyzer와 호환되는 범위에서 지원할 수 있으나, 1차 acceptance 기준은 TypeScript/TSX로 둔다.

---

## 4.2 분석 엔진 권장 조합

```text
tsconfig
   ↓
ts-morph Project
   ↓
TypeScript TypeChecker / Symbol / Type / Definition
   ↓
CodeUnit IR
```

Tree-sitter는 MVP 필수 dependency로 두지 않는다.

후속 다중 언어 확장에서:

```text
Tree-sitter / language native parser
       +
language-specific resolver
       ↓
공통 CodeUnit IR
```

형태로 확장한다.

---

# 5. 전체 시스템 아키텍처

```text
┌─────────────────────────────────────────────┐
│ Repository                                  │
│ Next.js / React / TypeScript / Prisma       │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ Repository Scanner / Project Loader         │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ TypeScript Analyzer                         │
│ - syntax                                    │
│ - symbol resolution                         │
│ - references                                │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ CodeUnit IR                                 │
└───────────────────┬─────────────────────────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
┌──────────────────┐  ┌───────────────────────────┐
│ Impl Graph       │  │ Framework Adapters        │
│ import/ref/call  │  │ React / Next / Prisma     │
└────────┬─────────┘  └────────────┬──────────────┘
         └──────────────┬──────────┘
                        ▼
┌─────────────────────────────────────────────┐
│ Context Builder                             │
│ → Semantic Context Packet                   │
└───────────────────┬─────────────────────────┘
                    │ MCP
                    ▼
┌─────────────────────────────────────────────┐
│ Claude Code / Codex                         │
│ Semantic Lifting                            │
└───────────────────┬─────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│ Candidate Validator                         │
│ schema / evidence / version                 │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ Product-level Semantic Compression          │
│ normalize / merge / keep / discard          │
└───────────────────┬─────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│ Semantic Project Graph                      │
│ Node + Relation + Grounding                 │
└───────────────┬─────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
   MCP Queries      JSON/CLI Inspector
                         ↓
                       Viewer
```

---

# 6. 코드베이스 모듈 구조 제안

실제 언어/패키지 구조는 구현 Agent가 프로젝트 scaffold 상황에 맞게 조정할 수 있으나 책임 경계는 유지한다.

```text
src/
  core/
    repository/
      repository-scanner
      project-loader
      file-snapshot

    config/
      project-config
      ontology-config

  analysis/
    ir/
      code-unit
      code-location
      code-reference

    language/
      analyzer-interface
      typescript/
        ts-project-loader
        syntax-extractor
        symbol-resolver
        relation-extractor

    graph/
      implementation-graph
      implementation-relation
      implementation-evidence

    framework/
      adapter-interface
      detector
      react-adapter
      next-adapter
      prisma-adapter

    context/
      context-builder
      semantic-context-packet
      batch-builder

  semantic/
    candidate/
      semantic-candidate
      candidate-store

    validation/
      ontology-validator
      evidence-validator
      version-validator

    compression/
      compression-batch
      disposition
      graph-patch-validator

  graph/
    semantic-node
    semantic-relation
    grounding
    project-graph
    graph-version
    graph-diff

  incremental/
    snapshot
    dirty-detector
    invalidation
    updater

  mcp/
    server
    contracts/
    tools/

  inspector/
    cli
    json-export

  viewer/
    # core graph engine 안정화 후 구현
```

---

# 7. Core Data Model

# 7.1 CodeUnit IR

언어 중립 implementation entity.

```ts
interface CodeUnit {
  id: string

  language: string
  kind: string
  name: string
  qualifiedName?: string

  location: {
    filePath: string
    startLine: number
    endLine: number
  }

  parentId?: string

  source: {
    signature?: string
    code?: string
    docComment?: string
    codeHash: string
  }

  structure?: {
    parameters?: Array<unknown>
    returnType?: string
    annotations?: string[]
    decorators?: string[]
  }

  frameworkHints?: Record<string, unknown>

  parser: string
}
```

### ID 원칙

Line number만 ID에 사용하지 않는다.

Named declaration 기본:

```text
normalized-file-path
+
kind
+
qualified-name
```

예:

```text
src/services/like.ts::function::toggleLike
src/auth.ts::method::AuthService.login
```

anonymous entity fallback:

```text
parent unit id
+
syntax role
+
normalized source hash
```

location과 identity를 분리한다.

---

# 7.2 ImplementationRelation

```ts
interface ImplementationRelation {
  id: string

  type: string
  sourceUnitId: string
  targetUnitId?: string
  externalTarget?: string

  evidence: {
    filePath: string
    startLine?: number
    endLine?: number
    expression?: string
  }

  resolution: 'exact' | 'probable' | 'unresolved'
  confidence?: number

  origin:
    | 'typescript'
    | 'react-adapter'
    | 'next-adapter'
    | 'prisma-adapter'
    | 'heuristic'
}
```

초기 relation 후보:

```text
IMPORTS
REFERENCES
CALLS
RENDERS
HANDLES_EVENT
HANDLED_BY
READS_DATA
WRITES_DATA
READS_STATE     # optional internal evidence
WRITES_STATE    # optional internal evidence
```

Relation 집합은 Implementation Graph 내부 구현 용도이며 사용자 Semantic Relation과 별개다.

---

# 7.3 SemanticCandidate

AI Agent의 첫 semantic lifting 결과.

```ts
interface SemanticCandidate {
  id: string

  label: string
  description?: string
  responsibility: string

  sourceUnitIds: string[]
  evidenceRelationIds?: string[]

  suggestedNodeType?: string
  confidence?: number

  analysisVersion: number
  sourceHashes: string[]

  status:
    | 'pending'
    | 'accepted'
    | 'rejected'
    | 'needs_review'
}
```

Candidate는 최종 Semantic Node와 동일하지 않다.

---

# 7.4 Candidate Disposition

Compression 단계에서 모든 Candidate는 반드시 상태를 가진다.

```text
merged_into_node
kept_as_node
discarded_as_implementation_detail
discarded_as_duplicate
needs_review
```

최종 Graph에 들어가지 않은 Candidate도 왜 사라졌는지 추적 가능해야 한다.

---

# 7.5 SemanticNode

ontology schema는 configurable registry를 사용한다.

```ts
interface SemanticNode {
  id: string

  type: string
  name: string
  description?: string

  properties?: Record<string, unknown>

  confidence?: number

  implementationRefs: string[]
  candidateRefs: string[]

  createdAtVersion: number
  updatedAtVersion: number
}
```

현재 type 후보:

```text
Actor
Surface
Action
Information
External
Rule
```

하지만 구현상 enum/config registry로 관리하여 변경 가능하게 만든다.

---

# 7.6 SemanticRelation

```ts
interface SemanticRelation {
  id: string

  type: string
  sourceNodeId: string
  targetNodeId: string

  confidence?: number
  implementationEvidenceRefs?: string[]
}
```

현재 relation 후보:

```text
실행한다
보여준다
사용한다
변경한다
발생시킨다
제한한다
```

source/target 허용 규칙도 별도 registry.

예:

```text
실행한다
Actor → Action

사용한다
Action → Information | External
```

전체 matrix는 prototype fixture에서 ontology를 검증한 뒤 확정한다.

---

# 7.7 Grounding

SemanticNode 안에 `implementationRefs`를 둘 수 있지만, many-to-many query와 이력 관리를 위해 별도 entity/index도 유지한다.

```ts
interface Grounding {
  semanticNodeId: string
  codeUnitId: string

  candidateIds?: string[]
  evidenceRelationIds?: string[]

  confidence?: number
  graphVersion: number
}
```

reverse index 필수:

```text
SemanticNode → CodeUnits
CodeUnit → SemanticNodes
```

---

# 7.8 Presentation Metadata

Graph Core와 분리.

```ts
interface GraphPresentationMetadata {
  groups?: Array<unknown>
  levels?: Record<string, unknown>
  viewHints?: Record<string, unknown>
}
```

MVP core engine은 Group 자동화보다 Semantic Graph 정확도를 우선한다.

---

# 8. Phase A — Repository Loader + CodeUnit IR + Symbol Resolver

## 8.1 목표

TS/TSX 프로젝트를 읽고 실제 declaration/reference를 안정적으로 주소화한다.

---

## 8.2 구현

```text
1. tsconfig 위치 탐색
2. ts-morph Project 생성
3. 분석 대상 SourceFile 필터링
4. declaration 추출
5. CodeUnit 생성
6. TypeChecker 기반 Symbol/Definition 연결
```

분석 대상 초기 entity:

```text
function declaration
arrow function assigned to variable
class
method
React component candidate
hook candidate
```

framework-specific unit은 Phase B에서 enrich한다.

---

## 8.3 제외 파일

기본 제외 후보:

```text
node_modules
.next
dist
build
coverage
generated code
lock files
```

configurable ignore를 둔다.

---

## 8.4 Acceptance

```text
LikeButton.tsx
→ handleLike
→ toggleLike
→ src/services/like.ts actual declaration
```

까지 symbol resolution 가능.

CLI:

```text
inspect unit <id>
inspect refs <id>
```

로 확인할 수 있어야 한다.

---

# 9. Phase B — Implementation Graph + Framework Adapters

# 9.1 Generic TS Relations

추출:

```text
IMPORTS
REFERENCES
CALLS
```

### CALLS 정책

runtime 완전성을 목표로 하지 않는다.

```text
resolved declaration 1개
→ exact

interface/dynamic/ambiguous target
→ probable

cannot resolve
→ unresolved
```

unresolved call을 임의 target에 연결하지 않는다.

---

# 9.2 React Adapter

## Component Candidate

signal:

```text
JSX를 반환
또는 JSX custom element symbol로 사용
또는 React component class
```

Capitalized name 단독으로 확정하지 않는다.

---

## RENDERS

```tsx
<Feed>
  <PostCard />
</Feed>
```

→

```text
Feed --RENDERS--> PostCard
```

HTML intrinsic element는 Implementation Node로 만들지 않는다.

---

## HANDLES_EVENT

```tsx
<button onClick={handleLike}>
```

→

```text
LikeButton --HANDLES_EVENT(click)--> handleLike
```

inline callback은 anonymous CodeUnit fallback 사용.

---

## React State

`useState`는 Implementation Evidence로 추출 가능.

```text
READS_STATE
WRITES_STATE
```

하지만 Semantic Information 생성 근거로 자동 승격하지 않는다.

---

# 9.3 Next.js Adapter

App Router 우선.

## page.tsx

```text
app/feed/page.tsx
→ route /feed
→ PageUnit / Surface strong hint
```

## layout.tsx

```text
LayoutUnit
→ route subtree metadata
```

## route.ts

```text
GET / POST / PUT / DELETE ...
```

handler와 canonical route를 생성.

Dynamic route:

```text
[id] → :id
[...slug] → catch-all canonical form
[[...slug]] → optional catch-all canonical form
```

Route Group `(group)`은 URL에서 제외하고 metadata로 보존.

`use client` / `use server` boundary도 framework metadata로 저장.

---

# 9.4 Prisma Adapter

Prisma schema에서:

```text
model
relation
```

추출.

예:

```text
DBEntity User
DBEntity Post
User 1:N Post
```

Prisma Client operation:

```text
findUnique/findFirst/findMany/count/... → READS_DATA
create/createMany/update/upsert/delete/... → WRITES_DATA
```

정확한 method registry는 구현 중 공식 Prisma API에 맞춰 작성.

---

# 9.5 Acceptance

Instagram-like fixture에서 최소 다음 chain이 나와야 한다.

```text
LikeButton
  HANDLES_EVENT(click)
handleLike
  CALLS
toggleLike
  WRITES_DATA
Like
```

그리고 Next route가 존재한다면:

```text
POST /api/posts/:id/like
```

와 handler가 Grounding되어야 한다.

---

# 10. Phase C — Context Builder

# 10.1 목표

LLM에게 Repository 전체를 주지 않는다.

Tool이 의미 판단에 필요한 evidence를 조립한다.

---

# 10.2 SemanticContextPacket

```ts
interface SemanticContextPacket {
  projectId: string
  analysisVersion: number
  graphVersion: number
  batchId: string

  targets: Array<{
    codeUnit: CodeUnit
    sourceHash: string
  }>

  projectContext?: {
    purpose?: string
  }

  blueprintContext?: unknown

  localContext: {
    filePath: string
    imports?: unknown[]
    constants?: unknown[]
    parentUnits?: unknown[]
    frameworkHints?: Record<string, unknown>
  }

  implementationContext: {
    callers?: unknown[]
    callees?: unknown[]
    references?: unknown[]
    routes?: unknown[]
    renderRelations?: unknown[]
    eventRelations?: unknown[]
    dataRelations?: unknown[]
  }

  neighborSemantics?: unknown[]

  ontologyConstraints: unknown
}
```

---

# 10.3 Context Priority

```text
P0 Target source
P1 Parent / File / Imports
P2 Direct implementation neighbors
P3 Route / UI event / rendering / DB evidence
P4 relevant Blueprint intent
P5 accepted neighbor semantics
P6 2-hop+ relation summary
```

---

# 10.4 Token degradation

prototype에서 숫자는 조정하되 순서는 고정한다.

```text
Target
→ full source 우선 유지

Direct neighbor
→ name + signature + relation + semantic summary

Distant neighbor
→ id + relation path
```

context 부족 시 target source를 먼저 truncate하지 않는다.

---

# 10.5 Blueprint 처리 원칙

Blueprint는 **truth가 아니라 intent evidence**다.

Agent prompt/contract에 반드시 명시:

```text
Blueprint와 코드가 일치한다고 가정하지 말 것.
현재 구현 의미는 code evidence로 판단할 것.
Blueprint는 의도 이해용 anchor로만 사용할 것.
차이가 있으면 mismatch 후보로 남길 것.
```

---

# 10.6 Stale Result 방지

Context Packet:

```text
analysisVersion
sourceHash
```

포함.

Agent submit에도 echo.

불일치하면:

```text
STALE_ANALYSIS
```

으로 거부.

---

# 10.7 Inspector

Viewer 전에 CLI/JSON으로 packet을 볼 수 있어야 한다.

```text
inspect context <batch-id>
```

이 기능은 semantic 품질 디버깅의 핵심이다.

---

# 11. Phase D — MCP Semantic Lifting Contract

# 11.1 책임

```text
Tool
= context 생성
= validation
= persistence
= version control

Agent
= semantic interpretation
= candidate generation
= compression proposal
```

Tool 내부에서 특정 LLM API 직접 호출을 필수 dependency로 두지 않는다.

---

# 11.2 MCP Tools 제안

실제 명칭은 구현 시 조정 가능하나 책임은 유지한다.

## prepare_analysis

Repository scan / parse / implementation graph 갱신.

출력:

```text
analysisVersion
dirtyUnitIds
semanticBatchIds
```

---

## get_semantic_batch

입력:

```text
batchId
```

출력:

```text
SemanticContextPacket
```

---

## submit_semantic_candidates

입력:

```text
projectId
batchId
analysisVersion
sourceHashes
candidates
```

server:

```text
schema validation
version validation
evidence reference validation
persist
```

---

## get_compression_batch

Semantic Candidate + neighborhood + Blueprint anchor 제공.

---

## submit_semantic_graph_patch

Agent가 제안:

```text
node proposals
relation proposals
candidate dispositions
grounding refs
```

server가 validation 후 적용.

---

## get_project_graph

현재 Semantic Project Graph 반환.

---

## get_concept_context

특정 Semantic Node/Feature 관련 implementation grounding 제공.

---

## explore_impact

Semantic Node에서 implementation graph를 이용해 영향 후보 계산.

---

# 11.3 Structured Contract

자유 텍스트 parser에 의존하지 않는다.

MCP의 JSON Schema 기반 input/output contract를 적극 사용한다.

server-side에서는 MCP schema 외에도 domain validation 실행.

---

# 11.4 Error Codes

```text
STALE_ANALYSIS
UNKNOWN_CODE_UNIT
INVALID_CANDIDATE_ID
MISSING_EVIDENCE
ONTOLOGY_VIOLATION
GRAPH_VERSION_CONFLICT
INVALID_GROUNDING
```

Agent가 오류를 읽고 수정 제출할 수 있도록 구조화된 message/context를 같이 반환한다.

---

# 12. Semantic Lifting Protocol

# 12.1 Agent에게 요구할 것

CoderMind에서 차용:

```text
- 구현 방법보다 코드가 무엇을 하는지
- 짧고 atomic한 책임
- domain 의미 우선
- framework/library detail 최소화
- handle/process 같은 모호한 표현 회피
- 한 CodeUnit에 여러 책임이 있으면 여러 Candidate 허용
```

우리 추가 요구:

```text
- 비전공자 제품 개념으로 이어질 수 있는 semantic responsibility를 우선
- 모든 Candidate에 source CodeUnit ID 필수
- 없는 CodeUnit/Relation을 발명하지 않음
- Blueprint를 현재 구현 사실로 오인하지 않음
```

---

# 12.2 Candidate coverage

분석 batch의 target CodeUnit이 모두 의미 Candidate를 가져야 한다는 뜻은 아니다.

하지만 각 target에 대해 최소:

```text
candidate generated
또는
no meaningful product responsibility
```

상태를 반환하게 한다.

누락과 의도적 discard를 구분한다.

---

# 12.3 Retry

Tool validation 실패 유형:

```text
missing target handling
unknown CodeUnit
invalid schema
missing evidence
```

Agent에게 구체적인 feedback과 함께 재제출 요청.

---

# 13. Phase E — Product-level Semantic Compression

# 13.1 목적

저수준 semantic feature를 최종 비전공자 mental model로 압축한다.

예:

```text
allow user to like post
record post like
update like count
create like notification
```

을 그대로 Node 4개로 만들지 않는다.

가능한 최종 예:

```text
[좋아요 누르기]
[좋아요 정보]
[알림 만들기]
```

---

# 13.2 Compression Evidence

단순 text similarity로 clustering하지 않는다.

같이 고려:

```text
semantic meaning
implementation neighborhood
route
surface/component
user event
shared data entity
shared implementation refs
Blueprint feature
```

---

# 13.3 Compression Pipeline

```text
Semantic Candidates
        ↓
Normalize
        ↓
Intent Anchor
        ↓
Interaction / Route / Data Scope
        ↓
Agent Merge Proposal
        ↓
Tool Validation
        ↓
merge / keep / discard
        ↓
Semantic Node 생성
        ↓
Semantic Relation Projection
```

---

# 13.4 Merge Proposal

```ts
interface MergeProposal {
  name: string
  nodeType: string
  candidateIds: string[]
  evidenceUnitIds: string[]
  reason?: string
}
```

Tool 검증:

```text
candidate 실제 존재?
evidence unit 실제 존재?
node type 허용?
Grounding union 가능한가?
모든 candidate disposition 결정됐는가?
```

---

# 13.5 Semantic Node 폭발 방지

Compression 단계의 핵심은 `merge`뿐 아니라 `discard`다.

예:

```text
check null
toggle loading
format date
close modal
```

서비스 이해에 독립적인 의미가 없다면:

```text
discarded_as_implementation_detail
```

로 처리.

단 evidence는 debug용으로 보존 가능.

---

# 13.6 Node 생성 원칙

Semantic Node가 되려면 현재 ontology 기준으로 최소 다음 질문을 통과해야 한다.

```text
비전공자가 이름을 보고 이해할 수 있는가?
따로 설명/수정할 가치가 있는가?
변화가 서비스 동작 설명에 의미 있는가?
다른 중요한 요소와 의미 있는 관계가 있는가?
```

명사/동사는 생성 기준이 아니라 **표현 규칙**이다.

---

# 14. Semantic Relation Projection

현재 ontology relation vocabulary를 registry에서 가져온다.

Agent가 아무 relation 이름이나 만들 수 없다.

```text
allowed relation types
allowed source node types
allowed target node types
```

검증.

Implementation Relations를 단순 1:1 rename하지 않는다.

예:

```text
LikeButton --HANDLES_EVENT--> handleLike
handleLike --CALLS--> toggleLike
toggleLike --WRITES_DATA--> Like
```

이 경로를 semantic reasoning/compression 후:

```text
Actor --실행한다--> 좋아요 누르기
좋아요 누르기 --변경한다--> 좋아요 정보
```

로 투영할 수 있다.

---

# 15. Phase F — Incremental Update

# 15.1 Snapshot

```ts
interface AnalysisSnapshot {
  analysisVersion: number
  graphVersion: number

  files: Array<{
    path: string
    hash: string
  }>

  codeUnitHashes: Record<string, string>
  implementationRelationIds: string[]
  semanticCandidateIds: string[]
  semanticNodeIds: string[]
}
```

실제 persistence 모델은 구현 환경에 맞춰 조정 가능.

---

# 15.2 Update Pipeline

```text
Code change
   ↓
File hash diff
   ↓
Changed files
   ↓
Reparse
   ↓
Old/New CodeUnit matching
   ↓
Added / Modified / Deleted
   ↓
Repair Implementation Relations
   ↓
Dirty Semantic Grounding
   ↓
Selective semantic lifting
   ↓
Local compression
   ↓
Semantic Project Graph vNext
   ↓
Semantic Diff
```

---

# 15.3 Dirty Types

```text
DIRECT_DIRTY
DEPENDENCY_DIRTY
FRAMEWORK_DIRTY
SEMANTIC_DIRTY
```

### DIRECT_DIRTY
source code 직접 변경.

### DEPENDENCY_DIRTY
symbol/reference target 변화.

### FRAMEWORK_DIRTY
route/schema/component convention 분석 결과 변화.

### SEMANTIC_DIRTY
Blueprint 또는 주변 semantic context 변화로 re-compression 필요.

---

# 15.4 Dirty Propagation ≠ Impact Traversal

반드시 별도 구현.

```text
Dirty Propagation
= 무엇을 다시 계산해야 하는가?

Impact Traversal
= 사용자 기능 변경이 어디까지 영향을 줄 가능성이 있는가?
```

---

# 15.5 삭제 처리

CodeUnit 삭제:

```text
Implementation Relations 제거
Grounding evidence 감소
```

Semantic Node가 grounding 0이 되면 즉시 삭제하지 않고:

```text
removed_candidate
needs_review
```

중 하나로 처리할 수 있게 설계한다.

Blueprint에만 존재하는 intent node와 실제 implementation node를 장기적으로 구분할 가능성이 있기 때문이다.

MVP에서는 실제 구현 Graph 기준 정책을 명시적으로 선택한다.

---

# 15.6 Incremental Correctness Test

동일 repository version에 대해:

```text
A = previous graph + incremental update
B = clean full analysis
```

canonicalize 후:

```text
Node
Relation
Grounding
```

차이를 비교한다.

---

# 16. Semantic Diff

최종 Viewer의 비전공자용 변경 전후 기능을 위해 Graph version diff를 만든다.

기본 diff:

```text
added semantic nodes
removed semantic nodes
changed semantic nodes
added semantic relations
removed semantic relations
grounding changes
```

Viewer 표현 예:

```text
추가됨
+ 비공개 계정
+ 팔로우 요청

변경됨
~ 팔로우 방식

영향 가능
~ 피드
~ 알림
```

사용자용 문장 생성은 Agent 도움을 받을 수 있지만 diff source of truth는 Graph version comparison이다.

---

# 17. Impact Analysis

# 17.1 입력

```text
Semantic Node ID
```

Grounding을 통해 관련 CodeUnit으로 내려간다.

```text
Semantic Node
   ↓ Grounding
CodeUnits
   ↓
Implementation Graph traversal
   ↓
Affected CodeUnits
   ↓ reverse grounding
Affected Semantic Nodes
```

---

# 17.2 Impact Levels

초기 정책 후보:

```text
Direct
Likely / 함께 확인 필요
Unknown
```

ImplementationRelation의:

```text
resolution
confidence
relation type
traversal distance
```

를 기반으로 분류.

정확한 threshold는 prototype으로 결정.

---

# 18. Phase G — Viewer

Core Graph 생성 engine과 Incremental/Diff가 안정화된 뒤 구현.

초기 Viewer 범위:

```text
1. 서비스 지도
2. 사용자 흐름
3. 정보 흐름
4. Node focus
5. 관련된 것만 보기
6. 영향 범위 보기
7. 최근 semantic diff
```

View는 별도 Graph가 아니다.

```text
Semantic Project Graph
   ↓ projection/filter
Graph View
```

---

# 18.1 Viewer에서 숨길 것

기본 화면에서는:

```text
file path
class/function
API implementation detail
AST
raw dependency
```

숨김.

선택적 advanced/implementation detail에서만 노출 가능.

---

# 19. Persistence

세부 storage 엔진은 prototype에서 선택할 수 있다.

단 반드시 다음 논리 객체는 persistent해야 한다.

```text
Project config
File snapshots
CodeUnits
Implementation Relations
Semantic Candidates
Candidate dispositions
Semantic Nodes
Semantic Relations
Groundings
Analysis versions
Graph versions
Semantic diffs
```

### 초기 구현 제안

MVP는 debugging/portability를 위해 사람이 확인 가능한 JSON 기반 persistence로 시작해도 된다.

단 query/performance가 문제가 되면 storage layer interface 뒤에서 SQLite 등으로 교체할 수 있게 한다.

storage 구현을 domain object와 결합하지 않는다.

---

# 20. Evaluation Fixture

최소 fixture 4종을 준비한다.

```text
A. Google Sheet Dashboard
B. Instagram-like SNS
C. Shopping Mall
D. Reservation Service
```

단 1차 구현 acceptance는 Instagram-like fixture 하나로 시작 가능.

각 fixture는 최소 포함:

```text
React page/component
user event
API route
service call
DB read/write
cross-feature dependency
external service
rule/condition
```

---

# 20.1 Gold Annotation

핵심 Feature 일부만 수작업 정답을 만든다.

```text
Gold CodeUnits
Gold Implementation Relations
Gold Semantic Candidates
Gold Semantic Nodes
Gold Semantic Relations
Gold Groundings
```

---

# 20.2 핵심 Metric

Implementation:

```text
CodeUnit precision / recall
Symbol resolution coverage
Exact relation precision
```

Semantic Lifting:

```text
Meaning correctness
Hallucination rate
Missing responsibility rate
```

Grounding:

```text
Grounding precision / recall
```

Compression:

```text
Merge purity
Over-merge rate
Under-merge rate
Compression ratio (관찰용)
```

Final Graph:

```text
Node precision / recall
Relation precision / recall
Hallucinated node rate
```

Stability:

```text
Unchanged semantic stability
False semantic churn
```

Incremental:

```text
Incremental vs full-analysis difference
re-analyzed units
estimated/actual token cost
runtime
```

---

# 21. Prototype Acceptance Criteria

# Test 1 — Symbol Resolution

```text
LikeButton.tsx
→ handleLike
→ toggleLike
→ actual declaration
```

통과.

---

# Test 2 — React Event Flow

```text
LikeButton
 HANDLES_EVENT(click)
     ↓
handleLike
 CALLS
     ↓
toggleLike
```

생성.

---

# Test 3 — Next Route

```text
app/api/posts/[id]/like/route.ts
POST
```

→ canonical route 생성.

---

# Test 4 — DB Grounding

```text
toggleLike
 WRITES_DATA
 Like
```

Prisma adapter 추출.

---

# Test 5 — Semantic Context Packet

`toggleLike` 관련 packet에 최소:

```text
target source
parent/file/import
React event 또는 route
DB relation
caller/callee summary
```

가 필요한 범위로 포함되는지 Inspector에서 확인.

---

# Test 6 — Agent Lifting

위 evidence로:

```text
좋아요 누르기
좋아요 정보 변경
```

같은 product-relevant candidate 생성.

---

# Test 7 — Hallucination Rejection

존재하지 않는 CodeUnit ID를 Agent가 Grounding에 넣으면 reject.

---

# Test 8 — Compression

```text
allow user to like post
record post like
update like count
```

을 과도하게 3개 독립 사용자 Node로 만들지 않음.

---

# Test 9 — Grounding

최종 `[좋아요 누르기]` Node에서 실제 관련:

```text
LikeButton
handleLike
toggleLike
route handler
```

로 탐색 가능.

---

# Test 10 — Impact

`[좋아요 누르기]` 또는 `[팔로우 관계]`에서 Implementation Graph를 거쳐 관련 Semantic Node를 반환 가능.

---

# Test 11 — Incremental

좋아요 코드만 수정할 때 Repository 전체 semantic re-lift 없이 dirty boundary만 갱신.

---

# Test 12 — Incremental Correctness

incremental 결과와 clean full analysis Graph가 실질적으로 동일.

---

# 22. 구현 Milestone

## Milestone 0 — Scaffold + Contracts

Deliverable:

```text
project skeleton
core interfaces
ontology registry
IR schemas
JSON serialization
basic CLI
```

Acceptance:

```text
empty project load
schema validation unit test
```

---

## Milestone 1 — TypeScript Analyzer

Deliverable:

```text
ts-morph project loader
CodeUnit extraction
stable IDs
symbol resolver
IMPORTS / REFERENCES / CALLS
```

Acceptance:

Test 1 통과.

---

## Milestone 2 — Framework Evidence

Deliverable:

```text
React Adapter
Next Adapter
Prisma Adapter
Implementation Graph Inspector
```

Acceptance:

Test 2~4 통과.

---

## Milestone 3 — Context Assembly

Deliverable:

```text
batch builder
SemanticContextPacket
context inspector
token trimming strategy
version/hash
```

Acceptance:

Test 5 통과.

---

## Milestone 4 — MCP Semantic Lifting

Deliverable:

```text
MCP server
get semantic batch
submit candidate
candidate validation
retry/error contract
```

Acceptance:

Test 6~7 통과.

---

## Milestone 5 — Semantic Compression + Graph

Deliverable:

```text
compression batch
merge/keep/discard
Semantic Node/Relation
Grounding + reverse index
project graph JSON
```

Acceptance:

Test 8~9 통과.

---

## Milestone 6 — Impact Analysis

Deliverable:

```text
semantic→implementation traversal
implementation graph traversal
reverse grounding
impact classification
```

Acceptance:

Test 10 통과.

---

## Milestone 7 — Incremental + Semantic Diff

Deliverable:

```text
snapshot
dirty detection
selective re-analysis
graph versioning
semantic diff
```

Acceptance:

Test 11~12 통과.

---

## Milestone 8 — Viewer MVP

Deliverable:

```text
localhost viewer
service map
user flow
information flow
node focus
impact view
semantic diff view
```

이 단계에서 Graph UI를 본격 설계한다.

---

# 23. Prototype으로 결정해야 하는 Parameter

Coding Agent가 임의의 정답으로 고정하지 말고 config/constant로 분리하고 실험 기록을 남긴다.

```text
1. ts-morph 성능이 target repo에서 충분한가?
2. CALLS exact/probable threshold
3. React component detection heuristic
4. Prisma 외 DB adapter 우선순위
5. Context token budget
6. Dependency neighbor depth
7. Semantic lifting batch size
8. Compression prompt/protocol
9. Incremental dirty propagation depth
10. Gold annotation 범위
11. Impact traversal depth/weight
12. Semantic Node stable identity strategy
```

결정 시 `decision log`에 기록한다.

---

# 24. Decision Log 구조

```text
/docs/decisions/
  001-parser-stack.md
  002-codeunit-identity.md
  003-call-confidence.md
  004-context-budget.md
  ...
```

각 문서:

```text
Context
Options
Decision
Reason
Experiment/Evidence
Consequences
```

AI Agent가 prototype 결과를 보고 architecture를 조용히 변경하는 것을 방지한다.

---

# 25. Testing Strategy

## Unit Tests

```text
CodeUnit identity
source span
symbol resolution
relation extraction
route canonicalization
Prisma operation classification
ontology validation
grounding validation
version conflict
```

## Fixture Tests

Repository 전체를 분석해 expected JSON snapshot과 비교.

## Semantic Agent Tests

Agent output 자체가 stochastic할 수 있으므로:

```text
schema validity
evidence validity
coverage
hallucination
```

을 우선 자동 평가.

semantic quality는 Gold annotation과 별도 비교.

## Incremental Regression

모든 fixture에서:

```text
full analysis
→ small commit
→ incremental
→ clean full analysis
→ canonical diff
```

테스트.

---

# 26. CLI / Inspector 우선 기능

Viewer 구현 전에 다음이 있어야 한다.

```text
project analyze
project update

inspect units
inspect unit <id>
inspect relation <id>
inspect graph implementation
inspect context <batch-id>
inspect candidates
inspect semantic-graph
inspect grounding <semantic-node-id>
inspect impact <semantic-node-id>
inspect diff <version-a> <version-b>
```

정확한 CLI naming은 구현 언어/framework에 맞게 변경 가능.

핵심은 각 pipeline stage 결과를 사람과 Agent가 디버깅할 수 있어야 한다는 것이다.

---

# 27. Logging / Observability

Semantic pipeline은 LLM이 포함되므로 결과 재현과 debugging이 중요하다.

각 semantic batch에 저장:

```text
analysis version
source hashes
context packet hash
agent/host metadata if available
candidate output
validation result
retry count
compression decision
```

개인/민감 source를 별도 telemetry로 외부 전송하지 않는다.
기본은 local project data로 둔다.

---

# 28. Open-source / Agent-independent 원칙

Core project는 특정 Claude/OpenAI model API에 직접 종속되지 않는다.

```text
Core Analyzer
Semantic Graph
MCP Contracts
Viewer
```

는 모두 로컬/오픈소스 구현 대상.

AI semantic reasoning은 MCP를 사용할 수 있는 Host Agent가 수행한다.

따라서 Agent 교체 가능성을 유지한다.

```text
Claude Code
Codex
other compatible agent
```

---

# 29. 구현 Agent에게 주는 작업 원칙

1. `ontology_schema.md`의 가설을 임의로 확정하지 않는다.
2. ontology vocabulary는 registry/config로 격리한다.
3. LLM inference를 deterministic fact처럼 저장하지 않는다.
4. 모든 Semantic Candidate/Node에는 가능한 Grounding evidence를 유지한다.
5. 실제 존재하지 않는 CodeUnit reference는 reject한다.
6. dynamic call을 임의 exact edge로 만들지 않는다.
7. Framework Adapter는 Implementation Evidence만 enrich한다.
8. Blueprint를 현재 구현 truth로 사용하지 않는다.
9. Viewer 구현을 위해 core semantic model을 왜곡하지 않는다.
10. 단계별 Inspector를 유지한다.
11. Incremental 최적화를 위해 full-analysis correctness를 희생하지 않는다.
12. 중요한 heuristic은 config/decision log로 남긴다.
13. prototype에서 얻은 수치는 계획 문서에 역으로 반영한다.

---

# 30. 첫 구현 작업 Backlog

## Epic A — Core IR

```text
A1 project scaffold
A2 ontology registry
A3 CodeUnit schema
A4 ImplementationRelation schema
A5 SemanticCandidate schema
A6 SemanticNode / Relation / Grounding schema
A7 JSON serializer
```

## Epic B — TypeScript Analysis

```text
B1 tsconfig loader
B2 SourceFile filter
B3 function/class/method extraction
B4 arrow function extraction
B5 stable CodeUnit identity
B6 symbol resolver
B7 imports
B8 references
B9 calls
```

## Epic C — Framework Analysis

```text
C1 adapter interface
C2 React component candidate
C3 JSX renders
C4 event handler
C5 Next page/layout/route
C6 route canonicalization
C7 Prisma schema model
C8 Prisma read/write
```

## Epic D — Inspection

```text
D1 implementation graph JSON
D2 CodeUnit CLI
D3 relation CLI
D4 context packet inspector
```

## Epic E — MCP Semantic

```text
E1 MCP server skeleton
E2 prepare_analysis
E3 get_semantic_batch
E4 submit_semantic_candidates
E5 validation errors
E6 candidate persistence
```

## Epic F — Semantic Graph

```text
F1 compression batch
F2 submit graph patch
F3 merge/keep/discard accounting
F4 ontology validation
F5 grounding union
F6 reverse grounding index
F7 graph JSON
```

## Epic G — Evolution

```text
G1 file snapshots
G2 CodeUnit diff
G3 dirty propagation
G4 partial re-analysis
G5 graph version
G6 semantic diff
G7 impact traversal
```

## Epic H — Evaluation

```text
H1 Instagram-like fixture
H2 Gold implementation relation
H3 Gold semantic graph subset
H4 full-analysis regression
H5 incremental regression
H6 hallucination metrics
H7 stability/churn metrics
```

---

# 31. 구현 시작 전 최종 체크리스트

```text
[ ] ontology_schema.md를 Agent context에 포함
[ ] implementation_plan.md를 Agent context에 포함
[ ] mechanism research 문서는 필요할 때 reference로 사용
[ ] TS/TSX/React/Next/Prisma MVP scope를 명시
[ ] 첫 fixture repository 준비
[ ] Core ontology vocabulary를 config로 분리
[ ] Viewer는 Milestone 8임을 명시
[ ] 각 milestone acceptance test 명시
[ ] Agent가 architecture 결정 시 decision log 작성하도록 지시
```

---

# 32. 최종 구현 순서 요약

```text
1. TypeScript Project Loader
        ↓
2. CodeUnit IR
        ↓
3. Symbol Resolver
        ↓
4. Implementation Relations
        ↓
5. React / Next / Prisma Adapters
        ↓
6. JSON / CLI Inspector
        ↓
7. Context Builder
        ↓
8. MCP Semantic Lifting Contract
        ↓
9. Candidate Validation
        ↓
10. Product-level Compression
        ↓
11. Semantic Project Graph + Grounding
        ↓
12. Impact Analysis
        ↓
13. Incremental Update + Semantic Diff
        ↓
14. Viewer MVP
```

이 순서를 기준으로 Work/Codex에서 구현을 시작한다.

---

# 33. 입력 문서 역할

## ontology_schema.md

제품의 의미 모델 / 사용자 관점 Graph 정의.

## mechanism.md

Semantic Project Graph 생성의 짧은 핵심 구조.

## mechanism_research.md

CoderMind/RPG-Encoder에서 차용한 구현 아이디어와 CodeUnit / Context / Lifting / Grounding 조사.

## mechanism_research2.md

TS/TSX parser stack, framework adapter, MCP contract, compression, incremental, evaluation에 대한 구현 전 기술 조사.

본 `implementation_plan.md`는 네 문서를 통합한 **실행용 계획**이다.
