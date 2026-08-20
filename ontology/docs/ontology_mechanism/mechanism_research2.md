# Ontology Mechanism Research 2 — 구현 전 추가 기술 조사

> 상태: **구현 계획 작성 전 참고용 조사 문서**
>
> 목적: 기존 `mechanism.md`, `mechanism_byGPT`에서 정리한
>
> `Repository → Implementation Analysis → CodeUnit IR → Context Assembly → Semantic Lifting → Validation → Product-level Compression → Semantic Project Graph`
>
> 구조를 실제 구현 가능한 수준으로 구체화하기 위해, Work/Codex로 넘어가기 전에 남아 있던 8개 기술 주제를 조사한다.
>
> 이 문서는 `ontology_schema.md`의 Node/Relation ontology를 수정하거나 확정하는 문서가 아니다.  
> **기존 schema는 입력 조건으로 두고, 그 schema를 실제 코드에서 어떻게 생성·유지할 것인지에만 집중한다.**
>
> 참고 대상:
>
> - Microsoft RPG-ZeroRepo / RPG-Encoder / CoderMind
> - TypeScript Compiler API
> - ts-morph
> - Tree-sitter
> - CodeQL JavaScript/TypeScript 분석 문서
> - React / Next.js 공식 문서
> - Prisma 공식 문서
> - MCP 2026-07-28 specification

---

# 0. 이번 조사에서 내리는 큰 결론

현재 목표를 기준으로 보면 MVP 기술 방향은 다음과 같이 잡는 것이 가장 현실적이다.

```text
MVP 대상
TypeScript / TSX
React / Next.js

        ↓

tsconfig 기반 Project 로딩
        ↓
TypeScript semantic analysis
(TypeChecker / Symbol / Type)
        ↓
ts-morph를 편의 wrapper로 사용
        ↓
공통 CodeUnit IR
        ↓
Implementation Graph
        ↓
React / Next.js / DB Framework Adapter
        ↓
Context Builder
        ↓
MCP
        ↓
Claude Code / Codex
        ↓
Semantic Candidate
        ↓
Validation
        ↓
Product-level Compression
        ↓
Semantic Project Graph
```

Tree-sitter는 버리는 것이 아니라 **후속 다중 언어 지원 / 빠른 syntax parsing / incremental parsing adapter** 후보로 둔다.

가장 중요한 설계 원칙은 다음이다.

```text
Parser ≠ Resolver
Syntax Fact ≠ Semantic Meaning
Implementation Relation ≠ Semantic Relation
LLM Result ≠ Truth
Full Re-analysis ≠ Incremental Update
```

---

# 1. Parser + Symbol Resolver

## 1.1 문제

AST를 읽는 것만으로는 다음 코드를 정확하게 연결할 수 없다.

```ts
import { toggleLike } from "@/services/like"

function onClick() {
  toggleLike(postId)
}
```

AST만 보면:

```text
CallExpression
callee = toggleLike
```

까지는 알 수 있다.

하지만 우리가 실제로 필요한 것은:

```text
이 toggleLike가
어느 파일의
어느 선언을
가리키는가?
```

이다.

즉 두 단계가 필요하다.

```text
Syntax Parsing
    ↓
Symbol Resolution
```

---

## 1.2 TypeScript Compiler API에서 얻을 수 있는 것

TypeScript Compiler API의 중심 개념:

```text
Program
 ├ SourceFile
 └ TypeChecker
      ├ Symbol
      └ Type
```

`Program`은 프로젝트 전체의 SourceFile과 compiler option을 가진다.

`TypeChecker`는 AST node를 실제 symbol/type과 연결한다.

대표 API:

```ts
program.getTypeChecker()

checker.getSymbolAtLocation(node)
checker.getTypeAtLocation(node)
checker.getTypeOfSymbolAtLocation(symbol, node)
checker.typeToString(type)
```

이 구조 때문에 TypeScript/TSX에서는 단순 AST parser보다 TypeScript 자체 semantic model을 사용하는 것이 유리하다.

### 우리에게 중요한 의미

```text
AST
toggleLike()

        ↓ TypeChecker

Symbol
toggleLike

        ↓ declaration

src/services/like.ts
export function toggleLike(...)
```

형태의 Grounding이 가능해진다.

---

## 1.3 TypeScript Language Service

Language Service는 장시간 살아 있는 프로젝트 분석 환경으로 사용할 수 있다.

특징:

```text
on-demand processing
reference resolution
file version tracking
incremental update
definition/reference query
```

TypeScript 문서에서는 Language Service가 필요한 정보만 계산하는 방식으로 큰 프로젝트에서 빠르게 응답하도록 설계되어 있다고 설명한다.

또한 import/reference를 따라 프로젝트의 dependency를 구성한다.

우리 프로젝트가 장기적으로 Viewer를 실행해놓고 코드 변화를 계속 따라가야 하므로 이 특성은 중요하다.

---

## 1.4 ts-morph

`ts-morph`는 TypeScript Compiler API를 감싼 wrapper다.

장점:

```text
Project(tsconfig)
SourceFile 탐색
AST node navigation
TypeChecker 접근
findReferences()
getDefinitions()
resolved signature
imports
```

예:

```ts
const project = new Project({
  tsConfigFilePath: "tsconfig.json"
})
```

tsconfig에 포함된 SourceFile과 dependency를 자동으로 project에 추가할 수 있다.

Reference:

```ts
declaration.findReferences()
declaration.findReferencesAsNodes()
identifier.getDefinitions()
identifier.getDefinitionNodes()
```

Call-like expression에는 TypeChecker의 resolved signature도 사용할 수 있다.

### 우리에게 적합한 이유

우리는 AST 변환 도구가 아니라 **코드 분석 도구**를 만드는 것이므로 compiler API의 저수준 boilerplate를 직접 다루는 것보다 ts-morph를 이용해:

```text
SourceFile
Function
Class
Import
CallExpression
Reference
Definition
Type
```

을 얻는 것이 초기 구현 속도 측면에서 유리하다.

---

## 1.5 Tree-sitter

Tree-sitter의 강점:

```text
다중 언어
빠른 parsing
syntax error가 있어도 유용한 tree 생성
incremental parsing
changed range 계산 가능
```

Tree-sitter는 concrete syntax tree를 만들며 source position과 grammar node type을 안정적으로 제공한다.

하지만 Tree-sitter 자체가 TypeScript Compiler의 TypeChecker 같은 **프로젝트 수준 symbol/type resolver**를 제공하는 것은 아니다.

따라서 현재 프로젝트에서는 역할을 다음처럼 보는 것이 좋다.

```text
TS / TSX MVP

ts-morph / TypeScript Compiler
        ↓
Syntax + Symbol Resolution


다중 언어 확장

Tree-sitter
        ↓
Syntax IR
        +
언어별 Resolver
```

---

## 1.6 결론 — MVP 권장안

### 권장

```text
TypeScript / TSX
→ ts-morph
→ TypeScript TypeChecker / Language Service
→ CodeUnit IR
```

### 나중

```text
Python / Java / Rust / ...
→ Tree-sitter 또는 언어 native parser
→ Language-specific Resolver
→ 동일 CodeUnit IR
```

즉 처음부터 모든 언어를 하나의 parser로 해결하려 하지 않는다.

---

## 1.7 Parser Adapter와 Resolver Adapter를 분리

추천 interface:

```text
LanguageAnalyzer
 ├ SyntaxExtractor
 └ SymbolResolver
```

예:

```text
TsSyntaxExtractor
TsSymbolResolver

PythonSyntaxExtractor
PythonSymbolResolver

...
```

공통 output:

```text
CodeUnit IR
ImplementationRelation
```

---

## 1.8 CodeUnit ID

Line number만 ID로 사용하면 안 된다.

예:

```text
src/a.ts:35
```

는 위에 import 한 줄만 추가돼도 변한다.

따라서 안정적인 identity가 필요하다.

초기 제안:

```text
file_path
+
kind
+
qualified_name
```

예:

```text
src/services/like.ts::function::toggleLike
src/auth.ts::class::AuthService.login
```

anonymous callback 등 이름이 없는 경우:

```text
parent unit
+
syntax role
+
normalized source hash
```

fallback을 사용할 수 있다.

별도 저장:

```text
location.start
location.end
code_hash
```

ID와 location을 분리한다.

---

# 2. Implementation Relation 추출

## 2.1 왜 중요한가

Semantic Graph만으로 영향 범위를 계산하면 추론에 지나치게 의존한다.

실제 영향 분석의 근거는:

```text
Implementation Graph
```

이어야 한다.

예:

```text
LikeButton
   ↓ CALLS
toggleLike
   ↓ WRITES
Like
   ↓
NotificationService
```

이를 비전공자에게:

```text
[좋아요]
 → [좋아요 정보]
 → [알림]
```

로 번역한다.

---

## 2.2 Relation 저장 구조 제안

```text
ImplementationRelation {
  id

  type
  source_unit_id
  target_unit_id | external_target

  evidence {
    file
    start
    end
    expression?
  }

  resolution
  confidence
  origin
}
```

### resolution

```text
exact
probable
unresolved
```

### origin

```text
typescript
react-adapter
next-adapter
prisma-adapter
heuristic
agent
```

중요:

> `confidence`와 `origin`을 같이 저장해야 나중에 영향 분석에서 신뢰 수준을 다르게 취급할 수 있다.

---

## 2.3 MVP Implementation Relation 후보

### IMPORTS

```text
File/Module → Module/File
```

TypeScript module resolution을 통해 비교적 정확하게 추출 가능.

---

### REFERENCES

```text
CodeUnit → CodeUnit / Symbol
```

TypeScript symbol reference.

CALLS보다 넓은 개념.

예:

```ts
const fn = toggleLike
```

이 코드는 toggleLike를 reference하지만 현재 시점에서 직접 call하지 않는다.

---

### CALLS

```text
Callable → Callable
```

CallExpression의 callee를 TypeChecker / resolved signature로 declaration과 연결한다.

#### exact 후보

```ts
foo()
importedFoo()
service.save()
```

에서 resolved declaration이 하나로 결정되는 경우.

#### probable 후보

```text
interface method
polymorphic method
dynamic property
higher-order function
```

등.

#### unresolved

```ts
obj[name]()
unknownFn()
```

처럼 target을 확정하기 어려운 경우.

---

## 2.4 CALLS를 과대 추론하지 않는다

JavaScript/TypeScript의 call graph는 dynamic typing, higher-order function, runtime dispatch 때문에 완전하게 정적으로 계산하기 어렵다.

CodeQL도 JavaScript 분석에서:

```text
Call Graph
Control Flow
Data Flow
Type Inference
Framework Model
```

을 별도 계층으로 제공한다.

또 global data flow는 local data flow보다 강력하지만:

```text
더 느리고
더 많은 메모리를 사용하고
spurious flow 가능성이 높다
```

고 설명한다.

따라서 MVP에서:

```text
"모든 runtime call을 정확히 알아낸다"
```

를 목표로 하면 안 된다.

대신:

```text
확실한 relation을 최대한 수집
+
불확실성을 명시
```

하는 것이 좋다.

---

## 2.5 full global data flow는 MVP에서 제외하는 것을 권장

초기에는 다음 정도면 충분하다.

```text
imports
references
calls
React renders
event binding
routes
DB read/write
```

전체 프로그램의 변수 값 flow를 계산하는 것은 영향 분석에 유용할 수 있지만 비용과 오탐이 크다.

필요해질 때:

```text
특정 Source → Sink
```

에 한정한 query로 확장한다.

---

## 2.6 데이터 Read / Write

generic AST만으로:

```text
이 함수가 "게시물 데이터"를 읽는다
```

를 판단하기 어렵다.

따라서 Framework Adapter가 중요하다.

예: Prisma

```ts
prisma.post.findMany()
```

→

```text
READS_DATA
target = PrismaModel(Post)
```

```ts
prisma.post.create()
```

→

```text
WRITES_DATA
target = PrismaModel(Post)
```

Prisma schema 자체에서 model과 relation을 deterministic하게 읽을 수 있다.

즉:

```text
generic call graph
+
ORM adapter
```

조합이 현실적이다.

---

## 2.7 Relation confidence 활용

Impact 분석 예:

```text
exact relation       weight high
probable relation    "함께 확인 필요"
unresolved relation  개발자/Agent용 evidence만 보존
```

비전공자 화면에서는:

```text
직접 영향
함께 확인 필요
```

로 번역 가능하다.

이렇게 하면 분석 불확실성을 숨기지 않고 사용자 언어로 표현할 수 있다.

---

# 3. React / Next.js Framework Adapter

# 3.1 Generic Analyzer만으로 부족한 이유

다음은 모두 TypeScript function일 수 있다.

```text
FeedPage
PostCard
LikeButton
useFeed
AuthProvider
```

하지만 역할은 다르다.

언어 parser 입장에서는 전부 function이지만 제품 의미는:

```text
화면
UI 조각
사용자 interaction
hook
provider
```

이다.

따라서 구조:

```text
Language Analyzer
       +
Framework Adapter
```

가 필요하다.

---

# 3.2 React Adapter

React 공식 문서에서 component는 기본적으로 JavaScript function이며 UI markup(JSX)을 반환한다.

대표 signal:

```text
Capitalized function/class name
JSX return
JSX에서 custom component로 사용됨
```

하지만 이름 하나만으로 component를 확정하지 않는다.

추천:

```text
is_component_candidate =
  JSX return
  OR JSX element symbol로 사용
  OR known React component class
```

이후 Semantic Lifting에서 실제 Surface인지 판단한다.

---

## 3.3 RENDERS relation

예:

```tsx
function Feed() {
  return (
    <div>
      <PostCard />
      <LikeButton />
    </div>
  )
}
```

React Adapter:

```text
Feed --RENDERS--> PostCard
Feed --RENDERS--> LikeButton
```

`PostCard` identifier는 TypeScript Symbol Resolver로 실제 declaration과 연결한다.

HTML intrinsic element:

```text
div
button
input
```

은 일반 Implementation Node로 만들 필요가 없다.

예외:

UI와 Semantic Surface 연결 연구를 위해 DOM region 정보가 필요해질 경우 별도 UI Evidence로 보존할 수 있다.

---

# 3.4 Event Handler

React에서 event handler는 JSX prop으로 function을 전달한다.

예:

```tsx
<button onClick={handleLike}>
```

추출:

```text
LikeButton --HANDLES_EVENT(click)--> handleLike
```

그리고:

```text
handleLike --CALLS--> toggleLike
```

까지 연결된다.

inline:

```tsx
<button onClick={() => toggleLike(id)}>
```

의 경우 anonymous CodeUnit 또는 inline handler evidence를 만든 뒤:

```text
LikeButton
  --HANDLES_EVENT(click)-->
anonymous handler
  --CALLS-->
toggleLike
```

처럼 표현할 수 있다.

이 relation은 Product Semantic Action을 찾는 데 매우 강한 signal이 된다.

---

# 3.5 React State

React `useState`:

```ts
const [liked, setLiked] = useState(false)
```

Adapter가 다음 framework fact를 만들 수 있다.

```text
StateUnit: liked
Setter: setLiked
Owner: LikeButton
```

reference 분석:

```text
liked reference
→ READS_STATE

setLiked(...)
→ WRITES_STATE
```

단, React state는 Implementation Graph에서만 사용한다.

모든 state가 Semantic Information Node가 되는 것은 아니다.

예:

```text
modalOpen
hovered
loading
```

같은 UI state는 사용자 Semantic Graph에서 제거될 가능성이 높다.

---

# 3.6 Next.js Adapter

Next.js App Router는 file convention이 강하므로 deterministic한 signal이 많다.

## page.tsx

공식 문서:

```text
page file = 특정 route의 unique UI
```

따라서:

```text
app/feed/page.tsx
```

에서:

```text
Route: /feed
PageUnit
Surface candidate
```

를 만들 수 있다.

---

## layout.tsx

Layout은 하위 route에서 공유되는 UI다.

Adapter:

```text
LayoutUnit
covers route subtree
```

Viewer에서는 나중에 Surface/Group 분석의 signal로 사용 가능.

---

## route.ts

Next Route Handler는 HTTP method export를 이용한다.

예:

```ts
export async function GET() {}
export async function POST() {}
```

Adapter:

```text
RouteUnit /api/posts

GET handler
POST handler
```

relation:

```text
RouteUnit --HANDLED_BY--> GET function
RouteUnit --HANDLED_BY--> POST function
```

또는 Route 자체를 CodeUnit kind로 두고 handler를 child로 둘 수 있다.

---

## Dynamic Route

```text
app/posts/[id]/page.tsx
```

→

```text
/posts/:id
```

처럼 normalize한다.

Catch-all:

```text
[...slug]
[[...slug]]
```

도 canonical route 표현으로 변환한다.

---

## Route Group

```text
app/(marketing)/about/page.tsx
```

의 `(marketing)`은 URL에 포함되지 않는다.

그러므로 route path 생성 시 반드시 제거한다.

반면 organizational hint로는 보존할 수 있다.

---

# 3.7 use client / use server

Next.js 공식 문서상:

```text
"use client"
```

는 Client Component entry boundary다.

이 파일의 imports / child component는 client bundle에 포함될 수 있다.

Adapter metadata:

```text
execution_boundary = client_entry
```

`use server`:

```text
server function / server file
```

metadata:

```text
execution_boundary = server
```

이는 Semantic Node type을 직접 결정하지 않지만 Context Builder에 중요한 힌트다.

예:

```text
Client event
   ↓
Server Action
   ↓
DB write
```

은 사용자 Action 추론에 매우 좋은 경로다.

---

# 3.8 Prisma Adapter

Prisma schema의 model은 application domain entity를 나타내며 DB table/collection에 mapping된다.

예:

```prisma
model User { ... }
model Post { ... }
```

CodeUnit:

```text
DBEntity User
DBEntity Post
```

Prisma relation:

```text
User 1:N Post
```

도 Implementation Evidence로 저장 가능하다.

Client operation:

```text
findUnique/findMany/count → READS_DATA
create/update/delete/upsert → WRITES_DATA
```

MVP에서는 Prisma부터 지원하는 것이 구현 난이도 대비 효과가 높을 수 있다.

Supabase / Firebase / Drizzle 등은 후속 adapter.

---

# 3.9 Framework Adapter 구조

```text
Generic TypeScript Analyzer

        ↓

CodeUnit IR

        ↓

Framework Detector

        ├ ReactAdapter
        ├ NextAdapter
        └ PrismaAdapter

        ↓

IR enrichment
+
Implementation Relations
+
Framework Facts
```

Adapter가 Semantic Node를 직접 만들게 하지 않는다.

---

# 4. Context Assembly 규칙

# 4.1 CoderMind에서 확인한 전략

CoderMind/RPG-Encoder의 Semantic Lifting은 repo 전체를 prompt에 넣지 않는다.

`CodeSnippetBuilder`가 target CodeUnit을 중심으로 다음을 남긴다.

```text
target source
file path
imports
top-level assignments
parent class header
```

큰 batch는 skeleton으로 줄이고 token budget을 관리한다.

Class는:

```text
class + methods
```

를 함께 처리한다.

Standalone function은 function group을 token budget에 맞게 batch한다.

또 결과 파일 summary를 다시 별도 LLM 단계로 만든다.

---

# 4.2 CoderMind에 없는 부분

현재 CoderMind context는 주로 **local file context** 중심이다.

우리 목표는 product meaning까지 추론하는 것이므로 다음도 필요하다.

```text
caller/callee
route
React event
React rendering
DB entity
Original Blueprint
이미 분석된 neighbor semantics
```

---

# 4.3 Semantic Context Packet

권장 논리 구조:

```text
SemanticContextPacket

analysis
  project_id
  graph_version
  batch_id

target
  CodeUnit(s)
  full source
  code hash

project_context
  short project purpose

blueprint_context
  relevant intent/features only

local_context
  file path
  imports
  constants
  parent class/component
  framework metadata

implementation_context
  callers
  callees
  references
  routes
  render parent/children
  event bindings
  data reads/writes

neighbor_semantics
  previously accepted summaries

ontology
  allowed node types
  allowed relation types
  source-target restrictions
```

---

# 4.4 Context Priority

모든 것을 한 번에 넣지 않는다.

권장 우선순위:

```text
P0 Target source
P1 Parent / file / import context
P2 Direct implementation neighbors
P3 Route / Surface / Event / Data framework evidence
P4 Relevant Blueprint context
P5 Accepted neighbor semantic summaries
P6 2-hop 이상의 dependency summary
```

---

# 4.5 Neighbor 정보는 축약한다

```text
Target
→ full source

Direct neighbor
→ qualified name
→ kind
→ signature
→ relation
→ accepted semantic summary

Distant neighbor
→ id/name
→ relation path
```

필요할 경우 Agent가 추가 tool로 특정 neighbor context를 요청하게 한다.

---

# 4.6 Token Budget Strategy

정확한 숫자는 prototype에서 실험해야 한다.

하지만 degradation order는 미리 정해둘 수 있다.

```text
1. target full source 유지

2. unrelated comments / implementation detail 축약

3. direct neighbor source
   → signature + semantic summary

4. 2-hop neighbor
   → relation only

5. Blueprint
   → 현재 feature와 관련된 일부만
```

**target source보다 주변 코드 때문에 target이 truncate되는 상황을 피한다.**

---

# 4.7 Context는 code hash/version을 포함

Semantic result가 반환되는 동안 코드가 바뀔 수 있다.

따라서 packet:

```text
code_hash
graph_version
analysis_version
```

을 포함한다.

Agent가 결과를 제출할 때도 이 값을 echo하도록 한다.

불일치:

```text
STALE_ANALYSIS
```

로 거부하고 재분석한다.

---

# 4.8 Project Context와 Blueprint 충돌

Blueprint는 truth가 아니라 **intent evidence**다.

예:

```text
Blueprint:
좋아요 알림을 보낸다.

Code:
알림 호출이 없음.
```

Agent에게:

```text
코드가 Blueprint와 일치한다고 가정하지 말 것.
Blueprint는 의미 후보를 이해하기 위한 의도 정보일 뿐.
현재 구현 evidence를 우선 보고 mismatch를 명시할 것.
```

을 contract에 넣는다.

이 차이가 나중에:

```text
계획 vs 구현
```

diff를 가능하게 한다.

---

# 5. Product-level Semantic Compression

# 5.1 CoderMind의 Structure Reorganization

RPG-Encoder는 Semantic Lifting으로 얻은 low-level feature를 바로 최종 구조로 쓰지 않는다.

먼저 repository feature summary를 바탕으로 Functional Area를 계획한다.

그 후 feature를:

```text
FunctionalArea / SubCategory / Feature
```

의 엄격한 3단계 path에 배치한다.

프로그램에서:

```text
path depth = 정확히 3
FunctionalArea = 사전에 계획된 값 중 하나
feature = 실제 입력 feature 중 하나
```

인지 검증한다.

잘못된 path / 빠진 feature는 feedback으로 다시 LLM에 보낸다.

`processed_features`를 추적해 모든 feature가 배치될 때까지 반복한다.

### 우리가 가져올 핵심

```text
LLM이 그룹을 제안
+
Tool이 형식/coverage/evidence를 강제
```

---

# 5.2 우리 Compression은 CoderMind보다 한 단계 더 높아야 함

Semantic Lifting output:

```text
render feed posts
load followed user ids
rank feed posts
record post like
update like count
create like notification
```

우리가 원하는 최종 수준:

```text
[피드 보기]
[팔로우 관계]
[좋아요 누르기]
[좋아요 정보]
[알림 만들기]
```

즉:

```text
Implementation Meaning
→ Product Meaning
```

이라는 추가 압축이 필요하다.

---

# 5.3 Embedding similarity만 사용하면 안 됨

예:

```text
save like
save comment
save profile
```

텍스트 상으로는 유사하다.

하지만 사용자 목적은:

```text
좋아요
댓글
프로필
```

로 다르다.

반대로:

```text
onClick like
toggleLike API
likes table write
notify author
```

는 표현은 다르지만 사용자 입장에서는 하나의 좋아요 흐름에 속한다.

따라서 clustering evidence는 최소 다음을 함께 봐야 한다.

```text
semantic meaning
implementation neighborhood
route
surface/component
user event
shared data entity
shared implementation refs
blueprint feature
```

---

# 5.4 추천 Compression Pipeline

```text
Semantic Candidates

        ↓

1. Normalize
   중복 표현 정리
   atomic responsibility 유지

        ↓

2. Intent Anchor
   Blueprint가 있으면 관련 Feature 후보 연결

        ↓

3. Interaction / Route / Data Scope
   같은 사용자 event/route/surface/data neighborhood 묶음 탐색

        ↓

4. Agent Merge Proposal
   "이 candidates는 하나의 사용자 개념이다" 제안

        ↓

5. Tool Validation
   evidence/ontology/coverage 검사

        ↓

6. Semantic Node 생성

        ↓

7. Relation Projection
```

---

# 5.5 Agent Merge Proposal 계약 예

```json
{
  "proposals": [
    {
      "name": "좋아요 누르기",
      "node_type": "Action",
      "candidate_ids": [
        "c_12",
        "c_14",
        "c_21"
      ],
      "reason": "same user interaction and route",
      "evidence_unit_ids": [
        "u_like_button",
        "u_handle_like",
        "u_toggle_like"
      ]
    }
  ]
}
```

Tool 검증:

```text
candidate IDs 실제 존재?
implementation evidence 실제 존재?
node type 허용?
candidate 중복 소유 허용 여부?
grounding union 가능?
```

---

# 5.6 Coverage를 강제

Compression 중 candidate가 조용히 사라지면 안 된다.

각 candidate 최종 상태:

```text
merged_into_node
discarded_as_implementation_detail
discarded_as_duplicate
needs_review
```

중 하나여야 한다.

즉:

```text
모든 Candidate는 accounting 된다.
```

CoderMind가 processed feature coverage를 추적하는 방식에서 차용한 아이디어다.

---

# 5.7 "버리기"도 중요한 Compression

예:

```text
check null
toggle loading
close modal
parse integer
format date
```

이런 candidate는 최종 Semantic Graph에 필요하지 않을 수 있다.

그러므로 compression은 단순 clustering이 아니라:

```text
merge
keep
discard
```

세 가지 판단이다.

discard에도 evidence/reason을 보존하면 디버깅이 쉽다.

---

# 5.8 Grounding은 merge 후 union

```text
Candidate A
 refs = U1 U2

Candidate B
 refs = U3

        ↓ merge

Semantic Node
 refs = U1 U2 U3
```

그리고 reverse index:

```text
CodeUnit → Semantic Nodes
```

도 유지한다.

many-to-many가 기본이다.

---

# 6. MCP Semantic Contract

# 6.1 현재 MCP 2026-07-28에서 중요한 점

2026-07-28 MCP specification에서 Tools는:

```text
inputSchema
outputSchema
structuredContent
```

을 사용할 수 있다.

`inputSchema` / `outputSchema`는 JSON Schema 2020-12를 사용한다.

`structuredContent`는 outputSchema가 있으면 그 schema를 따라야 한다.

따라서 Semantic Candidate나 Graph Patch를 자유 텍스트로 받을 이유가 없다.

---

# 6.2 2026 spec에서 특히 중요한 변화

2026-07-28 spec은 이전 session handshake 구조를 제거하고 stateless request 방향으로 바뀌었다.

또 Sampling은 deprecated 상태다.

### 우리 설계에 주는 의미

좋다.

우리 MCP server가:

```text
스스로 Claude API를 호출
```

하는 구조를 만들 필요가 없다.

대신:

```text
Claude Code / Codex = Host의 Agent

Agent
→ 우리 MCP Tool 호출
→ context 획득
→ Agent가 reasoning
→ 결과를 MCP Tool로 제출
```

구조를 사용한다.

---

# 6.3 MCP Server가 LLM workflow state를 숨겨서 가지지 않도록 설계

stateless-friendly contract:

```text
project_id
analysis_version
batch_id
code_hash
```

를 모든 write-like semantic submission에 넣는다.

Server는 persistent store에서 해당 batch를 조회한다.

즉:

```text
conversation session
```

에 의존하지 않는다.

---

# 6.4 Tool 후보

구현 세부는 변경될 수 있으나 책임 기준으로 다음 tool contract를 고려한다.

## prepare_analysis

```text
Repository scan / parse / implementation graph 갱신
```

결과:

```text
analysis_version
dirty_units
semantic_batches
```

---

## get_semantic_batch

Agent가 의미 분석할 Context Packet 조회.

입력:

```text
batch_id
```

출력:

```text
SemanticContextPacket
```

---

## submit_semantic_candidates

Agent의 semantic lifting 결과 제출.

입력:

```text
batch_id
analysis_version
target hashes
candidates
```

Server:

```text
schema validation
evidence validation
persist
```

---

## get_compression_batch

압축할 candidate와 graph neighborhood 제공.

---

## submit_semantic_graph_patch

Agent가 제안한:

```text
nodes
relations
candidate disposition
grounding
```

제출.

Server가 ontology validation 후 적용.

---

## get_project_graph

현재 Semantic Project Graph 읽기.

---

## get_feature_context / explore_impact

향후 Agent 편의용 graph query.

---

# 6.5 MCP에서 outputSchema 적극 사용

예:

```json
{
  "type": "object",
  "properties": {
    "batch_id": { "type": "string" },
    "analysis_version": { "type": "integer" },
    "context": { "$ref": "#/$defs/context" }
  },
  "required": [
    "batch_id",
    "analysis_version",
    "context"
  ]
}
```

Agent 결과도 별도 submit tool inputSchema로 강제한다.

장점:

```text
JSON parsing 실패 감소
schema 위반 즉시 차단
model마다 다른 text format 최소화
implementation agent가 contract를 그대로 코드화 가능
```

---

# 6.6 Tool을 너무 많이 쪼개지 않는다

CoderMind MCP는 현재 주요 query를:

```text
search_rpg
explore_rpg
get_node_detail
list_rpg_tree
```

처럼 목적 단위로 제공한다.

우리도 internal function 하나마다 MCP tool을 만들지 않는다.

권장:

```text
Analysis lifecycle tools
Semantic reasoning tools
Graph query tools
```

정도의 책임 경계를 유지한다.

---

# 6.7 Error contract

예:

```text
STALE_ANALYSIS
INVALID_CANDIDATE_ID
ONTOLOGY_VIOLATION
MISSING_EVIDENCE
UNKNOWN_CODE_UNIT
GRAPH_VERSION_CONFLICT
```

MCP tool result에서 error를 Agent가 이해할 수 있게 구조적으로 반환한다.

Agent가 수정해서 재제출 가능해야 한다.

---

# 7. Incremental Update

# 7.1 CoderMind에서 확인

CoderMind/RPG-Encoder는:

```text
full encode
update
```

두 모드를 제공한다.

CoderMind에서는 `rpg.json`과 `dep_graph.json`을 함께 유지하며 commit 이후 incremental RPG update를 수행한다.

일반 사용에서는 post-commit hook이 있고 수동 `/cmind.update_rpg`도 제공한다.

RPG-Encoder 논문은 incremental topology evolution을 주요 메커니즘으로 제시한다.

---

# 7.2 TypeScript에서 차용할 것

TypeScript의 BuilderProgram / watch API는 이전 compilation 결과를 cache하고:

```text
변경된 file
또는 dependency 변화의 영향을 받는 file
```

만 다시 검사하는 incremental strategy를 제공한다.

우리 semantic analyzer도 비슷하게:

```text
무조건 repo 전체 re-lift
```

하지 않도록 설계해야 한다.

---

# 7.3 Tree-sitter에서 차용할 것

Tree-sitter는 old tree를 edit한 뒤 다시 parse하면 old tree 구조를 재사용한다.

또 old/new tree의 syntactic changed range를 구할 수 있다.

다중 언어 단계에서는:

```text
file changed
≠ entire file changed
```

라는 최적화에 사용할 수 있다.

MVP ts-morph 단계에서는 먼저 CodeUnit hash/diff로 충분할 가능성이 높다.

---

# 7.4 필요한 Persistent Snapshot

```text
ProjectAnalysisSnapshot

files
  path
  file_hash

code_units
  id
  code_hash
  signature_hash

implementation_relations
  id
  evidence

semantic_candidates
  source unit hashes

semantic_nodes
  grounding

graph_version
analysis_version
```

---

# 7.5 Update Pipeline

```text
Code Change
   ↓
File Hash Diff
   ↓
Changed Files
   ↓
Reparse Changed Files
   ↓
Old/New CodeUnit matching
   ↓
Added / Modified / Deleted Units
   ↓
Implementation Relation repair
   ↓
Dirty Semantic Grounding
   ↓
Selective Semantic Lifting
   ↓
Local Semantic Compression
   ↓
Semantic Project Graph vNext
   ↓
Semantic Diff
```

---

# 7.6 Dirty Unit 종류

```text
DIRECT_DIRTY
DEPENDENCY_DIRTY
FRAMEWORK_DIRTY
SEMANTIC_DIRTY
```

### DIRECT_DIRTY

source code가 직접 바뀐 CodeUnit.

### DEPENDENCY_DIRTY

참조 target이 바뀌거나 삭제되어 관계 재해석 필요.

### FRAMEWORK_DIRTY

route/schema/component convention 변화로 adapter 결과가 바뀜.

### SEMANTIC_DIRTY

Blueprint / semantic neighborhood 변경으로 코드가 같아도 re-compression이 필요한 경우.

---

# 7.7 변경 유형별 invalidation

## 함수 body 변경, signature 동일

```text
Target CodeUnit re-lift
Target grounding node 재검토
Caller symbol resolution은 대부분 유지
```

단 impact analysis는 caller 관계를 그대로 활용할 수 있다.

---

## export/signature 변경

```text
Target reparse
References 재resolve
Reverse dependents dirty
```

---

## 파일 이동/rename

stable symbol identity가 유지될 수 있으면 old/new unit mapping을 시도.

Grounding path 갱신.

---

## delete

```text
CodeUnit 제거
incoming/outgoing Implementation Relation 제거
grounded Semantic Node evidence 감소
evidence 0인 Node → delete/review
```

---

## Prisma schema 변경

```text
DB Entity / relation adapter 재분석
해당 entity를 읽고/쓰는 units dirty
관련 Semantic Information/Action 재검토
```

---

## Next route 변경

```text
Route Unit 변경
Page/handler grounding 갱신
관련 Surface / Action 재검토
```

---

# 7.8 분석 Dirty와 사용자 Impact는 다르다

중요.

```text
Dirty Propagation
= 어떤 분석 결과를 다시 계산해야 하는가?

Impact Traversal
= 사용자 기능 변경이 어디에 영향을 줄 가능성이 있는가?
```

둘을 같은 traversal로 만들지 않는다.

예:

```text
DB schema 수정
```

때문에 분석상 많은 unit이 dirty할 수 있지만 사용자에게 의미 있는 영향 Node는 일부일 수 있다.

반대도 가능하다.

---

# 7.9 Incremental 결과 검증

개발 중 중요한 test:

```text
incremental update 결과
≈
clean full re-analysis 결과
```

이어야 한다.

이를 Evaluation 항목에 넣는다.

---

# 8. Evaluation 방법

# 8.1 왜 평가가 필요한가

Semantic Graph는 결과가 "그럴듯해 보인다"는 이유만으로 품질을 판단하기 어렵다.

다음이 따로 실패할 수 있다.

```text
CodeUnit extraction
Symbol resolution
Implementation relation
Semantic lifting
Grounding
Compression
Semantic relation
Incremental update
```

따라서 stage별 평가가 필요하다.

---

# 8.2 CoderMind/RPG-Encoder의 평가에서 참고할 점

RPG-Encoder 논문은 repository understanding / localization과 reconstruction coverage를 평가한다.

논문 abstract 기준:

```text
SWE-bench Verified Acc@5
RepoCraft reconstruction coverage
incremental overhead reduction
```

등을 사용한다.

RepoCraft는 repository-level code generation을:

```text
Coverage
Accuracy
Code Statistics
```

등으로 평가한다.

우리는 최종 목표가 다르므로 같은 metric을 그대로 쓰지 않는다.

핵심 아이디어만 차용:

> **Graph fidelity와 downstream usefulness를 둘 다 평가한다.**

---

# 8.3 Gold Fixture Repository를 먼저 만든다

초기에는 거대한 real repo보다 **작지만 의도가 명확한 fixture**가 좋다.

추천 4종:

```text
A. Google Sheet Dashboard
B. Instagram-like SNS
C. Shopping Mall
D. Reservation Service
```

각 repo는 의도적으로 다음 패턴을 포함한다.

```text
React pages/components
user event
API route
service call
DB read/write
cross-feature dependency
external service
rule/condition
```

가능하면 Next.js + Prisma 기반 fixture로 통일하면 analyzer를 집중 검증할 수 있다.

---

# 8.4 Gold Annotation

사람이 직접 일부 정답을 만든다.

```text
Gold CodeUnits
Gold Implementation Relations
Gold Semantic Candidates
Gold Semantic Nodes
Gold Semantic Relations
Gold Groundings
```

모든 code line을 annotate할 필요는 없다.

핵심 Feature 5~10개만 정확하게 만든다.

---

# 8.5 Implementation Analysis Metric

## CodeUnit Extraction Precision

```text
추출된 unit 중 실제 unit 비율
```

## CodeUnit Extraction Recall

```text
Gold unit 중 추출한 비율
```

## Symbol Resolution Coverage

```text
resolve 가능한 call/reference 중
target을 찾은 비율
```

## Exact Relation Precision

```text
exact로 표시한 relation 중
실제로 맞는 비율
```

`probable`은 별도 평가한다.

---

# 8.6 Semantic Lifting Metric

완전한 string exact match는 적절하지 않다.

사람 평가 또는 semantic rubric:

```text
Correct Purpose
Atomicity
No Implementation Noise
No Hallucination
Coverage
```

후보 metric:

```text
Meaning Correct Rate
Hallucination Rate
Missing Responsibility Rate
```

---

# 8.7 Grounding Metric

이 프로젝트에서 특히 중요하다.

## Grounding Precision

```text
Semantic Node에 붙은 implementation ref 중
정말 그 Node를 구현하는 비율
```

## Grounding Recall

```text
Gold implementation refs 중
Node에 연결된 비율
```

예:

```text
[좋아요 누르기]

Gold:
LikeButton
handleLike
toggleLike
/api/like

Predicted:
LikeButton
toggleLike

Recall 부족
```

---

# 8.8 Compression Metric

단순히 Node 수가 적다고 좋은 것은 아니다.

## Compression Ratio

```text
Semantic Candidate 수 / 최종 Node 수
```

관찰용 metric.

높을수록 무조건 좋지 않다.

---

## Merge Purity

한 최종 Node에 합쳐진 Candidate가 실제로 같은 사용자 개념에 속하는 비율.

예:

```text
[좋아요]

record like
toggle like
notify like author
```

는 높은 purity일 수 있다.

```text
[사용자 관리]

login
like
profile
```

은 낮다.

---

## Over-merge Rate

서로 다른 Gold concept를 하나로 합친 비율.

## Under-merge Rate

하나의 Gold concept가 여러 불필요한 Node로 쪼개진 비율.

---

# 8.9 Semantic Graph Metric

## Node Precision / Recall

Gold semantic concept 기준.

## Relation Precision / Recall

Relation type별 평가:

```text
실행한다
보여준다
사용한다
변경한다
발생시킨다
제한한다
```

schema가 바뀌면 metric도 update.

---

# 8.10 Hallucinated Node Rate

매우 중요.

```text
implementation evidence도 없고
Blueprint intent에도 없는
Semantic Node
```

비율.

가능하면 0에 가까워야 한다.

---

# 8.11 Stability / Churn Metric

사용자가 unrelated CSS만 수정했다고 하자.

Semantic Graph가:

```text
Node 이름 10개 변경
Group 재배치
Relation 대량 변경
```

되면 제품을 신뢰할 수 없다.

### Unchanged Semantic Stability

```text
실질적으로 영향 없는 commit 전/후
동일 Node가 동일 identity를 유지하는 비율
```

### False Semantic Churn

```text
실제 제품 의미 변화가 없는데
생긴 semantic diff 비율
```

이 metric은 우리 Viewer의 변경 전/후 기능 때문에 특히 중요하다.

---

# 8.12 Incremental Correctness

동일 repo version에 대해:

```text
A = 이전 Graph + incremental update
B = repository full clean analysis
```

canonicalize 후 비교.

```text
Node difference
Relation difference
Grounding difference
```

가 매우 작아야 한다.

---

# 8.13 Incremental Efficiency

관찰:

```text
전체 CodeUnit 수
재분석 CodeUnit 수
전체 token 예상량
incremental token 예상량
실행 시간
```

목표:

```text
품질 유지하면서 재분석 범위 감소
```

---

# 8.14 사용자 중심 평가

최종 제품 특성 때문에 반드시 나중에 필요하다.

비전공자에게 다음 task를 준다.

### 구조 이해

```text
"로그인과 관련된 기능을 찾아보세요."
```

### 영향 파악

```text
"팔로우 방식을 바꾸면 어디가 같이 바뀔 것 같나요?"
```

### 변경 이해

```text
"이번 수정에서 무엇이 달라졌나요?"
```

비교:

```text
Viewer 사용
vs
README/File tree만 사용
```

측정 후보:

```text
task success
time
잘못된 판단 수
```

MVP contest prototype에서는 소규모 인터뷰/사용성 테스트로도 충분히 의미 있다.

---

# 8.15 Agent Utility 평가

우리 MCP는 사람뿐 아니라 Agent에도 context를 주므로 확인할 가치가 있다.

Task:

```text
"좋아요 기능을 수정하라"
```

비교:

```text
Agent + 일반 file search
vs
Agent + Semantic Project Graph context
```

측정:

```text
correct files touched
unnecessary files touched
task success
context token usage
```

장기 평가.

---

# 9. 8개 조사 결과를 합친 추천 MVP Architecture

```text
┌────────────────────────────────────────────┐
│ Repository                                 │
│ Next.js / React / TypeScript / Prisma      │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│ TypeScript Analysis                        │
│                                            │
│ ts-morph Project                           │
│ TypeChecker / Symbol / Definition          │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│ CodeUnit IR                                │
│ function/class/component/route/db entity   │
└──────────────────┬─────────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
┌─────────────────┐  ┌────────────────────────┐
│ Impl Relations  │  │ Framework Adapters     │
│ import/call/ref │  │ React/Next/Prisma      │
└────────┬────────┘  └──────────┬─────────────┘
         └──────────┬───────────┘
                    ▼
┌────────────────────────────────────────────┐
│ Context Builder                            │
│ target + local + dependency + blueprint    │
└──────────────────┬─────────────────────────┘
                   │ MCP
                   ▼
┌────────────────────────────────────────────┐
│ Claude Code / Codex                        │
│ Semantic Lifting                           │
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│ Candidate Validator                        │
│ schema + evidence + version                │
└──────────────────┬─────────────────────────┘
                   │ MCP reasoning loop
                   ▼
┌────────────────────────────────────────────┐
│ Product-level Compression                  │
│ merge / keep / discard                     │
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│ Semantic Project Graph                     │
│ Node + Semantic Relation                   │
│ ↕ Implementation Grounding                 │
└──────────────────┬─────────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
      Viewer              MCP Query
```

---

# 10. 구현 전에 확정해둘 것 / Prototype에서 결정할 것

## 문서에서 확정해도 될 것

```text
1. TS/TSX MVP에서는 semantic compiler 정보를 사용한다.
2. CodeUnit IR은 언어 중립 형태로 둔다.
3. Implementation Relation에 evidence와 confidence를 저장한다.
4. React/Next/DB 분석은 Framework Adapter로 분리한다.
5. Context Builder는 raw repo 전체가 아니라 선택된 packet을 만든다.
6. LLM output은 MCP schema + tool validation을 통과해야 한다.
7. Semantic Candidate와 Node는 many-to-many Grounding을 지원한다.
8. Incremental analysis와 user impact traversal을 분리한다.
9. Semantic Graph quality를 stage별로 평가한다.
```

---

## Prototype으로 결정할 것

```text
1. ts-morph 성능이 실제 target repo에서 충분한가?
2. Call relation의 exact/probable threshold
3. React component detection heuristic
4. Prisma 외 DB adapter 우선순위
5. Context token budget
6. Dependency neighbor depth
7. Semantic compression prompt/protocol
8. Agent 한 번에 처리할 batch 크기
9. Incremental dirty propagation 깊이
10. Gold dataset annotation 난이도
```

---

# 11. Work / Codex에게 넘길 때 필요한 최소 구현 순서 제안

이 문서는 구현계획이 아니지만, 조사 결과상 dependency order는 다음에 가깝다.

```text
Phase A
TS Project Loader
↓
CodeUnit IR
↓
Symbol Resolver

Phase B
Implementation Relations
↓
React Adapter
↓
Next Adapter
↓
Prisma Adapter

Phase C
Context Builder
↓
Context Packet Inspector

Phase D
MCP Semantic Contract
↓
Semantic Candidate Submit/Validation

Phase E
Product Compression
↓
Semantic Project Graph

Phase F
Incremental Update
↓
Semantic Diff

Phase G
Viewer
```

중요:

> Viewer를 먼저 만들지 말고, 먼저 Graph 생성 quality를 확인할 수 있는 JSON/CLI inspector를 만든 뒤 Viewer로 넘어가는 것이 안전하다.

---

# 12. 추천 Prototype Acceptance Criteria

Work/Codex가 첫 prototype을 만들었을 때 최소한 다음 test가 가능해야 한다.

## Test 1 — Symbol Resolution

```ts
LikeButton.tsx
→ handleLike
→ toggleLike
→ likeService.ts
```

실제 declaration까지 연결되는가?

---

## Test 2 — React Flow

```text
LikeButton
 HANDLES_EVENT click
      ↓
handleLike
 CALLS
      ↓
toggleLike
```

이 만들어지는가?

---

## Test 3 — Next Route

```text
app/api/posts/[id]/like/route.ts
POST
```

→ canonical route를 만들 수 있는가?

---

## Test 4 — DB Grounding

```text
toggleLike
 WRITES_DATA
 Like
```

를 Prisma adapter가 뽑는가?

---

## Test 5 — Agent Lifting

위 implementation evidence만 이용해:

```text
좋아요 누르기
좋아요 정보 변경
```

후보를 낼 수 있는가?

---

## Test 6 — Hallucination Rejection

Agent가 존재하지 않는 CodeUnit ID를 grounding에 넣으면 Tool이 거부하는가?

---

## Test 7 — Compression

```text
allow user to like post
record post like
update like count
```

을 과도하게 분리하지 않고 사용자 의미로 압축할 수 있는가?

---

## Test 8 — Incremental

좋아요 코드만 수정했을 때:

```text
전체 repo re-lift 없이
관련 unit/node만 갱신
```

되는가?

---

# 13. 연구 기준 최종 결론

CoderMind에서 가장 차용할 가치가 있는 것은 특정 Graph schema가 아니라 다음 구조다.

```text
1. code entity를 먼저 안정적으로 식별
2. semantic lifting 전에 context를 엄격히 구성
3. LLM output을 프로그램이 검증
4. low-level feature를 별도 단계에서 상위 hierarchy로 재구성
5. semantic meaning과 code grounding을 계속 연결
6. dependency graph를 별도로 유지
7. graph를 incremental하게 evolution
8. agent가 graph를 query할 수 있는 interface 제공
```

우리 프로젝트에서는 이를 다음처럼 변형한다.

```text
CoderMind
Repository → Functional Repository Model

우리
Repository
   ↓
Implementation Evidence
   ↓
Agent Semantic Lifting
   ↓
Product-level Compression
   ↓
Non-developer Semantic Product Model
```

그리고 기존 Blueprint가 있는 경우:

```text
          Original Intent
             ↓      ↑
Repository → Semantic Project Graph
```

이라는 양방향 anchor를 추가한다.

이것이 단순 코드 시각화 도구와 가장 크게 갈리는 지점이다.

---

# 14. Primary Sources

## CoderMind / RPG-Encoder

- RPG-ZeroRepo repository  
  https://github.com/microsoft/RPG-ZeroRepo

- RPG-Encoder paper  
  https://arxiv.org/abs/2602.02084

- CoderMind commands  
  https://github.com/microsoft/RPG-ZeroRepo/blob/main/CoderMind/docs/commands.md

- CoderMind configuration / MCP tools  
  https://github.com/microsoft/RPG-ZeroRepo/blob/main/CoderMind/docs/configuration.md

- Semantic parsing implementation  
  https://raw.githubusercontent.com/microsoft/RPG-ZeroRepo/main/zerorepo/rpg_encoder/rpg_parsing/semantic_parsing.py

- CodeSnippetBuilder  
  https://raw.githubusercontent.com/microsoft/RPG-ZeroRepo/main/zerorepo/rpg_gen/base/unit/snippt_builder.py

- CodeUnit / ParsedFile  
  https://raw.githubusercontent.com/microsoft/RPG-ZeroRepo/main/zerorepo/rpg_gen/base/unit/code_unit.py

- RefactorTree / semantic structure reorganization  
  https://raw.githubusercontent.com/microsoft/RPG-ZeroRepo/main/zerorepo/rpg_encoder/rpg_parsing/refactor_tree.py

- Semantic parsing prompts  
  https://raw.githubusercontent.com/microsoft/RPG-ZeroRepo/main/zerorepo/rpg_encoder/rpg_parsing/prompts/parse.py

---

## TypeScript / ts-morph

- TypeScript Compiler API  
  https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API

- TypeScript Language Service API  
  https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API

- ts-morph  
  https://ts-morph.com/

- ts-morph Project / tsconfig  
  https://ts-morph.com/setup/

- ts-morph finding references  
  https://ts-morph.com/navigation/finding-references

- ts-morph TypeChecker  
  https://ts-morph.com/navigation/type-checker

---

## Tree-sitter

- Introduction  
  https://tree-sitter.github.io/tree-sitter/

- Basic parsing  
  https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html

- Advanced / incremental parsing  
  https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html

---

## Static analysis reference

- CodeQL JavaScript library  
  https://codeql.github.com/docs/codeql-language-guides/codeql-library-for-javascript/

- JavaScript / TypeScript data flow  
  https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/

---

## React / Next.js

- React components  
  https://react.dev/learn/your-first-component

- React events  
  https://react.dev/learn/responding-to-events

- React useState  
  https://react.dev/reference/react/useState

- Next.js App Router  
  https://nextjs.org/docs/app

- Next.js page  
  https://nextjs.org/docs/app/api-reference/file-conventions/page

- Next.js layout  
  https://nextjs.org/docs/app/api-reference/file-conventions/layout

- Next.js route handler  
  https://nextjs.org/docs/app/api-reference/file-conventions/route

- Next.js route groups  
  https://nextjs.org/docs/app/api-reference/file-conventions/route-groups

- Next.js use client  
  https://nextjs.org/docs/app/api-reference/directives/use-client

- Next.js use server  
  https://nextjs.org/docs/app/api-reference/directives/use-server

---

## Prisma

- Prisma models  
  https://docs.prisma.io/docs/orm/prisma-schema/data-model/models

- Prisma relations  
  https://www.prisma.io/docs/orm/prisma-schema/data-model/relations

---

## MCP

- MCP 2026-07-28 Tools specification  
  https://modelcontextprotocol.io/specification/2026-07-28/server/tools

- MCP 2026-07-28 release notes  
  https://blog.modelcontextprotocol.io/posts/2026-07-28/
