
> 목적: 이 문서는 최종 구현계획을 바로 확정하기 위한 문서가 아니라, `ontology_schema.md`와 별개로 **Semantic Project Graph 생성 메커니즘을 설계할 때 참고할 기술 조사 노트**다.
>
> 주요 참고 대상은 Microsoft `RPG-ZeroRepo / RPG-Encoder / CoderMind`이며, 아래 내용은 **(1) CoderMind/RPG-Encoder에서 실제로 확인한 구현 패턴**과 **(2) 우리 도구에 적용할 제안**을 구분해서 기록한다.
>
> 우리의 최종 목표는 CoderMind를 복제하는 것이 아니라, 그 구현에서 재사용 가능한 아이디어를 차용하여 **비전공자용 Semantic Project Graph**를 만들고, 최종적으로 Claude Code / Codex 같은 외부 AI Agent가 MCP를 통해 이 구조를 활용하도록 하는 것이다.

---

# 0. 현재 전체 메커니즘

현재 설계 중인 전체 흐름은 다음과 같다.

```text
Repository
   ↓
Implementation Analysis
   ↓
Implementation Evidence
   ↓
Semantic Lifting
   ↓
Semantic Candidates
   ↓
Candidate Validation
   ↓
Product-level Semantic Compression
   ↓
Semantic Project Graph
   ↕
Implementation Grounding
   ↕
Repository
```

조금 더 기술적으로 분해하면:

```text
Repository
   ↓
Language Parser / AST
   ↓
CodeUnit IR
   ├──────────────→ Implementation Relations
   │                  imports / calls / reads / writes / routes ...
   │
   ↓
Context Assembly
   ↓
Semantic Context Packet
   ↓
AI Agent Semantic Lifting
   ↓
Semantic Candidates
   ↓
Validation / Retry
   ↓
Product-level Compression
   ↓
Semantic Node + Semantic Relation
   ↕
Implementation References
   ↓
Semantic Project Graph
```

핵심 책임 분리:

```text
Deterministic Tool
= 실제 코드에 무엇이 존재하는지 추출
= 구조 / relation / validation / persistence 담당

AI Agent
= 그 코드가 의미적으로 무엇을 하는지 해석
= 여러 저수준 의미를 상위 사용자 개념으로 압축
```

---

# 1. CoderMind / RPG-Encoder에서 확인한 큰 구조

RPG-ZeroRepo 공식 문서에서는 기존 Repository를 RPG로 변환하는 과정을 크게 다음 3가지 메커니즘으로 설명한다.

```text
1. Semantic Lifting
   raw code entity → semantic feature

2. Semantic Structure Reorganization
   semantic feature → functional hierarchy

3. Artifact Grounding
   semantic hierarchy ↔ actual file / class / function
   + dependency graph
```

이 구조에서 중요한 점은 **코드를 바로 최종 그래프로 만들지 않는다는 것**이다.

```text
Raw Code
   ↓
의미 추출
   ↓
의미 재구성
   ↓
실제 코드와 다시 Grounding
```

우리 구조에서는 이 마지막 결과를 개발자용 `Repository Planning Graph`가 아니라 **비전공자용 Product Mental Model**로 한 번 더 압축하는 방향으로 확장한다.

```text
CoderMind level

Like Handling
Like Persistence
Notification Handling

        ↓ 추가 압축

우리 level

[좋아요 누르기]
    ├─ 변경한다 → [좋아요 정보]
    └─ 발생시킨다 → [알림 만들기]
```

---

# 2. Implementation Analysis: CoderMind의 CodeUnit 개념

## 2.1 CodeUnit의 목적

CoderMind/RPG-Encoder에서 `CodeUnit`은 Semantic Node가 아니다.

`CodeUnit`은:

> Repository에 실제 존재하는 코드 단위를 안정적으로 주소화하기 위한 중간 표현

에 가깝다.

대략 다음과 같은 정보를 가진다.

```text
CodeUnit

name
node              # AST node
unit_type
file_path
parent
extra
```

`extra`에는 entity 종류에 따라 argument, return type, docstring 등의 정보가 들어간다.

핵심은 이 단계에서는 아직:

```text
"로그인"
"팔로우"
"알림"
```

같은 제품 의미를 판단하지 않는다는 것이다.

---

# 3. AST 단계에서 무엇을 추출하는가

RPG-Encoder의 Python 분석은 AST를 사용해 파일 안의 구조적 entity를 분리한다.

주요 대상:

```text
import
assignment
function
async function
class
method
```

또한 함수/클래스가 top-level에만 존재한다고 가정하지 않고, 일부 control-flow 내부에 정의된 entity도 재귀적으로 탐색한다.

예:

```python
import database

MAX_RETRY = 3

class FollowService:
    def follow(...):
        ...

    def unfollow(...):
        ...

def create_notification(...):
    ...
```

구조적으로는 대략:

```text
Import
  database

Assignment
  MAX_RETRY

Class
  FollowService

Method
  FollowService.follow

Method
  FollowService.unfollow

Function
  create_notification
```

로 분해할 수 있다.

## 중요한 원칙

AST 분석 단계에서는:

```text
실제 코드 사실 추출
```

만 한다.

다음과 같은 판단은 하지 않는다.

```text
FollowService = 소셜 기능
create_notification = 사용자 알림 기능
```

이 의미 판단은 다음 Semantic Lifting 단계의 책임이다.

---

# 4. 우리 도구의 CodeUnit IR 제안

CoderMind는 현재 RPG-Encoder의 reverse pipeline이 Python 중심이므로, 우리의 웹 프로젝트 대상에는 그대로 쓰기 어렵다.

우리 도구는 처음부터 **언어 중립적인 CodeUnit IR**을 두는 것이 좋다.

초안:

```text
CodeUnit
────────────────────────

identity
  id
  language
  kind
  name
  qualified_name

location
  file_path
  start_line
  end_line
  parent_id

source
  signature
  source_code
  doc_comment

structure
  parameters
  return_type
  decorators
  annotations

references
  imports
  calls
  reads
  writes

framework
  framework_hints

analysis
  parser
  confidence
```

모든 언어가 모든 필드를 채울 필요는 없다.

예:

```text
Python Parser ───────┐
TypeScript Parser ───┤
JavaScript Parser ───┼──→ CodeUnit IR
TSX / JSX Parser ────┘
```

---

# 5. CodeUnit의 `kind`

CoderMind 수준:

```text
function
class
method
assignment
import
```

우리 프로젝트는 웹 기반 바이브코딩 프로젝트가 많을 가능성이 높기 때문에 Implementation IR 단계에서 더 많은 kind가 필요할 수 있다.

후보:

```text
function
class
method

component
hook

route
api_endpoint

model
schema
db_entity

config
import
external_call
```

주의:

```text
kind = component
```

라고 해서 즉시

```text
Semantic Type = Surface
```

라고 확정하면 안 된다.

예를 들어 React Component가 실제로는:

- 화면
- layout wrapper
- provider
- invisible logic component

중 무엇일지 알 수 없기 때문이다.

`kind`는 Implementation 사실이고, Semantic Node type은 Lifting 이후 결정한다.

---

# 6. CodeUnit과 LLM 요청 단위는 다르다

CoderMind에서 중요한 구현 패턴:

> CodeUnit은 주소화의 최소 단위이지, 반드시 LLM 요청의 최소 단위는 아니다.

예를 들어 Class가 있다면:

```text
Class A
 ├ method 1
 ├ method 2
 └ method 3
```

각 method를 완전히 독립된 prompt로 보내기보다 Class + Methods를 의미 있는 하나의 context로 묶는다.

Standalone function은 함수 단위로 그룹화하되 여러 function group을 token budget에 맞춰 batch 처리한다.

우리도 같은 원칙을 가져갈 수 있다.

```text
IR Unit
= 정확한 코드 주소 단위

Semantic Analysis Batch
= 의미를 판단하기 좋은 문맥 단위
```

---

# 7. Context Assembly: CoderMind의 CodeSnippetBuilder 전략

CoderMind는 target function 하나만 LLM에게 던지지 않는다.

선택된 entity의 source를 중심으로 **같은 파일에서 의미 판단에 도움이 되는 주변 context**를 같이 보존한다.

확인된 주요 context:

```text
Target source code
+ File path
+ Imports
+ Top-level assignments/constants
+ Parent class context (method인 경우)
```

개념적 예:

원본:

```python
import jwt
from database import db

TOKEN_EXPIRE = 3600

def helper():
    ...

def login(email, password):
    user = db.find_user(email)
    ...
    return jwt.encode(...)
```

`login()`만 의미 분석하더라도 대략:

```text
File: services/auth.py

import jwt
from database import db

TOKEN_EXPIRE = 3600

...

def login(email, password):
    ...
```

형태로 문맥을 만든다.

---

# 8. 왜 Imports / Assignments / Parent Context가 중요한가

함수 자체만 보면 의미를 놓칠 수 있다.

예:

```python
client.sign_in(...)
```

만 보면 `client`가 무엇인지 불분명할 수 있다.

하지만:

```python
from auth import client
```

가 함께 있으면 의미 추론이 쉬워진다.

Assignment도 비슷하다.

```python
PRIVATE_ACCOUNT = True
MAX_RETRY = 5
```

같은 값은 동작 의도를 이해하는 데 도움이 될 수 있다.

Method는 parent class 이름이 중요하다.

```python
def approve(...)
```

보다:

```python
class FollowRequestService:
    def approve(...)
```

가 훨씬 높은 semantic signal을 제공한다.

---

# 9. Context Compression

CoderMind는 context가 클수록 무조건 좋다고 가정하지 않는다.

큰 class/function batch에서는 source를 skeleton 형태로 줄이거나 일정 token budget으로 제한한다.

중요한 것은:

```text
의미 판단에 필요한 구조와 doc/import context는 보존
구현 세부는 필요시 축약
```

이라는 전략이다.

우리도 다음 원칙을 고려해야 한다.

```text
Target code = 상대적으로 상세
Neighbor code = 구조화된 요약
Distant dependency = 이름/signature/relation만
```

---

# 10. Semantic Lifting: LLM에게 무엇을 요구하는가

CoderMind는 LLM에게 단순히:

```text
"이 함수 설명해줘"
```

라고 하지 않는다.

Semantic feature 생성 규칙을 강하게 제한한다.

주요 철학:

```text
구현 방법이 아니라 무엇을 하는지 설명
짧고 atomic한 책임
verb + object 형태
framework/library detail 최소화
loop/condition 등의 구현 세부 배제
모호한 handle/process 표현 회피
가능하면 domain 의미 사용
```

예:

나쁜 feature:

```text
execute query
process data
update dict
handle value
```

좋은 feature 방향:

```text
authenticate user
record post like
create follow notification
manage user session
```

즉 CoderMind의 Semantic Lifting은:

```text
Code Syntax / Implementation
        ↓
Short Functional Meaning
```

으로 올리는 단계이다.

---

# 11. 함수 1개 = 의미 1개가 아니다

한 implementation entity가 여러 semantic responsibility를 가질 수 있다.

예:

```python
def like_post(...):
    save_like(...)
    create_notification(...)
```

의 semantic feature 후보는:

```text
record post like
create like notification
```

처럼 2개일 수 있다.

반대로 여러 implementation entity가 하나의 semantic concept를 구현할 수도 있다.

따라서 우리 Implementation Grounding은 **many-to-many**를 전제로 설계하는 것이 좋다.

```text
Implementation Entity N개
        ↕
Semantic Candidate N개
        ↕
Semantic Node N개
```

예:

```text
[좋아요 누르기]

Implementation References:
- LikeButton.tsx
- handleLike()
- POST /api/likes
- toggleLike()
- likes table
```

또 `toggleLike()` 하나가:

```text
[좋아요 누르기]
[좋아요 정보]
```

두 Node의 근거가 될 수도 있다.

---

# 12. Validation / Retry

CoderMind의 중요한 실용 패턴:

> LLM은 의미를 판단하지만, 무엇이 실제 코드에 존재하는지는 프로그램이 판단한다.

예를 들어 LLM에게 실제 함수 목록을 분석하게 했을 때:

- 일부 function을 누락
- 실제로 없는 이름 생성
- 일부 method 미응답

등이 생길 수 있다.

CoderMind는 실제 CodeUnit 목록과 LLM 결과를 비교해:

```text
missing
invalid
unparsed
```

항목을 감지한 뒤 누락된 부분만 retry한다.

우리도 같은 패턴을 가져가야 한다.

예:

```text
Code Evidence

toggleLike()
createNotification()

LLM Candidates

좋아요 변경          ✓
알림 생성            ✓
회원 탈퇴            ? evidence 없음
```

`회원 탈퇴` 같은 후보는 validation 단계에서 차단하거나 낮은 confidence를 부여해야 한다.

---

# 13. 우리 Candidate Validation 제안

Validation은 최소한 두 층으로 생각할 수 있다.

## Structural Validation

```text
허용 Node type인가?
허용 Relation type인가?
Source → Target type 조합이 유효한가?
필수 field가 있는가?
```

예:

```text
Actor --실행한다--> Action
```

만 허용.

## Evidence Validation

```text
Candidate가 어떤 CodeUnit에서 나왔는가?
해당 의미를 뒷받침하는 source/call/read/write evidence가 있는가?
실제 코드에는 없는 개념을 새로 만들지 않았는가?
```

완전히 deterministic하게 판별하기 어려운 경우:

```text
confidence
evidence_count
evidence_types
```

를 저장할 수 있다.

---

# 14. Semantic Structure Reorganization

CoderMind는 함수/class에서 semantic feature를 추출하고 끝내지 않는다.

저수준 semantic feature들을 다시 분석해 상위 functional structure로 재구성한다.

예:

```text
authenticate user
create session
revoke session
reset password

       ↓

Account Management
```

이때 raw code 전체를 다시 보는 것보다 앞 단계에서 만들어진 **semantic summaries**를 이용한다.

즉 계단식 lifting이다.

```text
Raw Code
   ↓
Local Semantic Meaning
   ↓
Higher Semantic Meaning
   ↓
Functional Structure
```

---

# 15. 우리 도구에서는 한 단계 더 필요함: Product-level Compression

CoderMind의 최종 추상화 목표:

```text
Repository Architecture / Functional Structure
```

우리의 최종 목표:

```text
Non-developer Product Mental Model
```

따라서 CoderMind 수준의 lifting 이후 한 단계 더 압축한다.

예:

```text
CoderMind-like candidates

Like Handling
Like Persistence
Notification Handling

        ↓

우리 Product-level compression

[좋아요 누르기]
      ├─ 변경한다 → [좋아요 정보]
      └─ 발생시킨다 → [알림 만들기]
```

이 단계가 우리 제품의 핵심 차별화 후보다.

---

# 16. Artifact Grounding

Semantic Node가 만들어져도 실제 코드와의 연결을 잃으면 안 된다.

CoderMind 역시 semantic feature와 실제:

```text
file
class
method
function
```

위치를 metadata로 연결한다.

우리 Semantic Node에도 Implementation References를 처음부터 유지한다.

예:

```text
SemanticNode {
  id
  type
  name
  description

  implementation_refs: [
    CodeUnitRef,
    CodeUnitRef,
    ...
  ]
}
```

이 정보는 기본 Viewer에는 숨길 수 있다.

하지만 다음 기능에 필수다.

```text
영향 범위 분석
변경 전/후 비교
Agent context 전달
Semantic Node → 실제 코드 탐색
코드 변경 후 해당 Node만 재분석
```

---

# 17. Implementation Relations와 Semantic Relations를 분리

CoderMind는 semantic hierarchy와 별개로 dependency graph를 관리한다.

우리 역시 두 relation 층을 분리하는 것이 좋다.

## Implementation Relations

코드 수준 사실:

```text
imports
calls
reads
writes
renders
routes_to
depends_on
```

예:

```text
LikeButton
  calls
likeService

likeService
  writes
likes table

likeService
  calls
NotificationService
```

## Semantic Relations

사용자가 보는 관계:

```text
실행한다
보여준다
사용한다
변경한다
발생시킨다
제한한다
```

예:

```text
[좋아요 누르기]
      ├─ 변경한다 → [좋아요 정보]
      └─ 발생시킨다 → [알림 만들기]
```

중요:

> 영향 분석은 가능한 한 Implementation Relations를 근거로 계산하고, 최종 결과를 Semantic Relations / 자연어로 번역해서 사용자에게 보여준다.

---

# 18. Dependency-aware Context: 우리 도구에서 추가할 아이디어

CoderMind의 Semantic Lifting source context는 주로:

```text
target source
imports
assignments
parent class
file context
```

중심이다.

우리 목표는 더 높은 product meaning을 알아내는 것이므로, **dependency context를 구조화해서 추가 제공하는 방식**을 고려할 가치가 있다.

예:

```ts
async function toggleFollow(userId, targetId) {
  return repository.toggle(userId, targetId)
}
```

함수 하나만 보면:

```text
팔로우 상태 변경
```

정도만 알 수 있다.

하지만 주변 dependency를 보면:

```text
CALLERS
FollowButton.onClick
POST /users/:id/follow

CALLEES
followRepository.toggle
notificationService.createFollowNotification

DATA
FollowRelationship

ROUTE
POST /users/:id/follow
```

더 높은 의미를 추론하기 쉽다.

---

# 19. 단, dependency source 전체를 넣으면 안 됨

caller/callee를 무작정 source code 전체로 확장하면 context 폭발 문제가 생긴다.

따라서:

```text
Target
= full source

Local context
= imports / constants / parent

Direct neighbors
= name + signature + relation + semantic summary

Farther neighbors
= relation / ID 수준
```

처럼 depth에 따라 정보량을 줄이는 것이 좋다.

---

# 20. Semantic Context Packet 제안

`CodeUnit IR`과 AI Agent 사이에 의미 분석용 입력 객체를 하나 두는 설계를 고려한다.

```text
CodeUnit IR
      ↓
Context Builder
      ↓
Semantic Context Packet
      ↓
AI Agent
```

초안:

```text
SemanticContextPacket

target
  CodeUnit

project_context
  project name
  project description
  blueprint / original intent

local_context
  file path
  imports
  constants
  parent class/component

dependency_context
  callers
  callees
  reads
  writes
  routes
  rendered_by / renders

neighbor_semantics
  이미 분석된 관련 CodeUnit의 semantic summary

ontology_constraints
  allowed node types
  allowed relations
  source/target rules
```

이 객체를 반드시 하나의 실제 class로 만들 필요는 없지만, 구현 책임을 명확히 하기 위한 개념으로 유용하다.

---

# 21. 우리만의 장점: Original Blueprint를 Semantic Anchor로 사용

CoderMind reverse encoding은 기존 code에서 의미를 bottom-up으로 복원한다.

우리 서비스는 1번 Blueprint 기능까지 연결되면 사용자의 원래 의도를 이미 가지고 있을 수 있다.

예:

```text
Blueprint

Feature: 팔로우
- 사용자는 다른 사용자를 팔로우할 수 있다.
- 비공개 계정은 승인이 필요하다.
- 팔로우 요청 시 알림이 간다.
```

이 경우 `toggleFollow()`의 의미를 해석할 때:

```text
Code
+ Local Context
+ Dependency Context
+ Original Blueprint
```

를 함께 참고할 수 있다.

즉:

```text
CoderMind

Code
  ↓
Meaning


우리

Original Intent
      ↓
Code ↔ Meaning
```

구조가 가능하다.

장기적으로 이는:

```text
초기 의도 ↔ 실제 구현
```

비교에도 활용할 수 있다.

---

# 22. Agent를 Semantic Reasoner로 사용하는 구조

우리 프로젝트의 중요한 전제:

> 도구 내부에 Claude/OpenAI 전용 API 호출을 하드코딩하는 것보다, 외부 Claude Code / Codex 같은 Agent가 MCP를 통해 Semantic Reasoning에 참여하도록 한다.

가능한 구조:

```text
Our Local Tool

Repository
   ↓
Parser
   ↓
CodeUnit IR
   ↓
Implementation Relations
   ↓
Context Builder
   ↓
Semantic Context Packet
   │
   │ MCP
   ▼
Claude Code / Codex
   │
   │ Semantic Candidate
   ▼
Validator
   ↓
Compression
   ↓
Semantic Project Graph
```

핵심:

```text
Tool
= 사실 추출 / graph data / validation / persistence

Agent
= semantic interpretation / reasoning / compression
```

---

# 23. 구현 책임 분리 초안

최종 implementation plan에서 참고할 수 있는 책임 분리:

| 단계 | Agent 사용 | 책임 |
|---|---|---|
| Repository file discovery | X | 분석 대상 파일 식별 |
| AST / syntax parsing | X | 코드 구조 추출 |
| CodeUnit IR 생성 | X | 언어별 구조를 공통 IR로 정규화 |
| imports/calls/reads/writes | X 우선 | Implementation Relations 생성 |
| Context Assembly | X | Agent가 읽을 재료 선택 |
| Semantic Feature 추론 | O | CodeUnit의 목적/책임 해석 |
| Semantic Candidate 생성 | O | 상위 의미 후보 생성 |
| Schema Validation | X | ontology 위반 차단 |
| Evidence Validation | X + 필요시 O | hallucination 감소 |
| Semantic Compression | O + 규칙 | 비전공자 수준으로 병합 |
| Grounding 저장 | X | Semantic Node ↔ CodeUnit 연결 |
| Incremental update | X + O | 변경된 영역만 재분석 |

---

# 24. Incremental Evolution

CoderMind/RPG-Encoder는 full encode 외에도 update mode를 제공한다.

개념:

```text
Repository v1
   ↓
RPG v1

Code Change / Commit

Repository v2
   ↓
Diff
   ↓
영향받는 graph 영역만 update
   ↓
RPG v2
```

우리에게는 특히 중요하다.

왜냐하면 최종 Viewer 기능 중:

```text
변경 전후
영향 범위
최근 변경
```

이 모두 graph version / incremental analysis와 연결되기 때문이다.

우리 쪽 장기 구조:

```text
Code Diff
   ↓
Changed CodeUnits
   ↓
Affected Implementation Relations
   ↓
Affected Semantic Nodes
   ↓
Selective Semantic Re-lifting
   ↓
Semantic Project Graph v2
   ↓
Semantic Diff
```

---

# 25. CoderMind에서 그대로 가져오지 않을 것

CoderMind의 최종 목표는 Coding Agent가 repository를 이해하고 수정하도록 하는 것이다.

따라서 다음과 같은 repository architecture 언어가 중요하다.

```text
Feature
Architecture
Module
File
Class
Function
```

우리의 최종 Viewer는 이 구조를 중심에 두지 않는다.

우리 최종 Semantic Ontology는 현재 가설상:

```text
Actor
Surface
Action
Information
External
Rule
```

및 제한된 Semantic Relations을 중심으로 한다.

CoderMind에서 차용할 것은:

```text
Semantic Lifting 방식
Context 관리
Validation
Grounding
Dependency Graph
Incremental Evolution
Agent Graph Query
```

이고,

그 최종 semantic abstraction은 우리 목적에 맞게 새로 설계한다.

---

# 26. 중요한 기술 원칙 정리

## 원칙 1

```text
AST는 의미를 판단하지 않는다.
AST는 정확한 코드 사실을 제공한다.
```

## 원칙 2

```text
LLM은 실제 코드 존재 여부를 결정하지 않는다.
LLM은 코드의 의미를 추론한다.
```

## 원칙 3

```text
CodeUnit 1개와 Semantic Node 1개는 1:1 관계가 아니다.
```

## 원칙 4

```text
Semantic Node를 만들 때 Implementation Grounding을 절대 잃지 않는다.
```

## 원칙 5

```text
Raw code 전체를 Agent에게 주지 않는다.
필요한 context를 Tool이 선택한다.
```

## 원칙 6

```text
LLM 결과를 그대로 Graph에 넣지 않는다.
Schema/Evidence Validation을 통과해야 한다.
```

## 원칙 7

```text
저수준 semantic meaning과 비전공자 product meaning은 동일하지 않다.
별도의 Product-level Compression 단계가 필요하다.
```

## 원칙 8

```text
Implementation Relation과 Semantic Relation을 분리한다.
```

## 원칙 9

```text
원래 Blueprint가 존재하면 Semantic Lifting의 top-down anchor로 사용할 수 있다.
```

## 원칙 10

```text
Graph는 일회성 산출물이 아니라 코드와 함께 진화하는 persistent model이다.
```

---

# 27. 앞으로 추가 조사할 항목

## A. TypeScript / JavaScript / React Parser

확인해야 할 것:

```text
TypeScript compiler API
ts-morph
tree-sitter
Babel parser
```

중 어떤 조합이 적합한가?

특히 추출 필요:

```text
function
class
component
hook
route
API endpoint
imports
calls
reads/writes
JSX render relation
framework hints
```

---

## B. Call Graph 정확도

정적 분석으로 어려운 경우:

```text
dynamic dispatch
callback
higher-order function
dependency injection
React hook
event handler
framework magic
```

을 어떻게 처리할 것인가?

완전한 call graph보다:

```text
certain
probable
unknown
```

confidence를 가진 relation이 현실적일 수 있다.

---

## C. React Surface 추론

예:

```text
FeedPage.tsx
PostCard.tsx
LikeButton.tsx
AuthProvider.tsx
```

모두 component이지만 사용자 화면 의미는 다르다.

Implementation hint + semantic reasoning 결합 필요.

---

## D. Database / API Grounding

ORM에 따라 추출 방식이 다름.

예:

```text
Prisma
Drizzle
Supabase
SQLAlchemy
Django ORM
Firebase
```

공통 IR에 어떻게 정규화할지 조사 필요.

---

## E. Semantic Compression 규칙

가장 중요한 미해결 문제.

예:

```text
allow user to like post
record post like
update like count
```

을:

```text
[좋아요 누르기]
[좋아요 정보]
```

로 어떻게 안정적으로 압축할 것인가?

고려 요소:

```text
semantic similarity
shared implementation refs
shared route / DB entity
same user goal
Blueprint match
graph neighborhood
```

---

## F. Incremental Re-analysis

변경된 파일만 분석하더라도 semantic 영향은 다른 Node까지 퍼질 수 있다.

필요한 개념:

```text
changed CodeUnit
↓
dependency traversal
↓
affected semantic nodes
↓
re-lift boundary
```

---

# 28. 구현 계획 작성 시 참고할 모듈 분리 후보

아직 확정안이 아닌 참고용 구조:

```text
core/
  repository_scanner
  parser_registry

analysis/
  codeunit
  implementation_graph
  context_builder

semantic/
  lifting_protocol
  candidate
  validator
  compressor

graph/
  semantic_node
  semantic_relation
  grounding
  project_graph
  graph_diff

integrations/
  mcp

viewer/
  graph_views
```

핵심 dependency:

```text
Parser
  ↓
CodeUnit IR
  ↓
Implementation Graph
  ↓
Context Builder
  ↓
Agent
  ↓
Semantic Candidate
  ↓
Validator
  ↓
Compressor
  ↓
Semantic Project Graph
```

---

# 29. 참고한 CoderMind / RPG-Encoder 소스

공식 repository:

- https://github.com/microsoft/RPG-ZeroRepo
- https://github.com/microsoft/RPG-ZeroRepo/tree/main/zerorepo/rpg_encoder
- https://github.com/microsoft/RPG-ZeroRepo/tree/main/CoderMind

주요 조사 대상:

- `zerorepo/rpg_encoder/rpg_parsing/semantic_parsing.py`
- `zerorepo/rpg_encoder/rpg_parsing/refactor_tree.py`
- `zerorepo/rpg_encoder/rpg_parsing/rpg_encoding.py`
- `zerorepo/rpg_encoder/rpg_parsing/rpg_evolution.py`
- `zerorepo/rpg_gen/base/unit/code_unit.py`
- `zerorepo/rpg_gen/base/unit/snippt_builder.py`
- Semantic parsing prompts
- `CoderMind/docs/commands.md`
- `CoderMind/docs/configuration.md`

공식 문서가 명시하는 RPG-Encoder의 핵심:

```text
repository → RPG
Semantic Lifting
→ Structural Reorganization
→ Artifact Grounding

+
Commit-level incremental evolution
+
Search / Fetch / Explore graph operations
```

---

# 30. 현재 결론

CoderMind에서 얻을 가장 중요한 힌트는 특정 알고리즘 하나가 아니다.

핵심은 다음 **파이프라인의 책임 분리**다.

```text
코드를 정확히 파싱한다
        ↓
LLM이 분석할 코드 단위를 만든다
        ↓
의미 판단에 필요한 context만 조립한다
        ↓
AI가 semantic meaning을 만든다
        ↓
프로그램이 결과를 검증한다
        ↓
낮은 의미를 더 높은 의미로 재구성한다
        ↓
실제 코드와 grounding을 유지한다
        ↓
코드 변경 시 graph도 증분 갱신한다
```

우리 도구에서는 여기에 두 가지를 추가하는 것이 핵심이다.

```text
1. Product-level Semantic Compression
   개발자 기능 구조 → 비전공자의 서비스 mental model

2. Original Intent Anchoring
   Blueprint ↔ 실제 코드 의미를 함께 사용
```

최종적으로 목표하는 구조:

```text
                   Original Blueprint
                         │
                         ▼
Repository → Implementation Analysis
                         │
                         ▼
                   CodeUnit IR
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
   Implementation Relations     Context Assembly
                                     │
                                     ▼
                               External AI Agent
                                     │
                                     ▼
                              Semantic Candidates
                                     │
                                Validation
                                     │
                                     ▼
                         Product-level Compression
                                     │
                                     ▼
                          Semantic Project Graph
                             ↕             ↕
                    Implementation      MCP / Viewer
                       Grounding
```

이 구조를 이후 최종 `implementation_plan.md`의 기술 설계 후보로 사용한다.
