# Vibe Coding Project Intelligence — 앱 구현 및 설계 초안

> 목적: 바이브코딩 과정에서 흩어지는 요구사항, 설계 의도, 코드 구조, 의사결정과 기술부채를 지속적으로 연결하고, 사용자가 이미 사용하는 AI 코딩 에이전트(Codex, Claude Code 등)의 추론 능력을 활용해 프로젝트를 이해·관리할 수 있는 개발 도구를 만든다.

## 1. 제품 한 줄 정의

**기존 바이브코딩 에이전트에 프로젝트의 장기 기억과 구조 이해 능력을 연결하고, 그 결과를 사람이 탐색할 수 있게 시각화하는 Project Intelligence 앱.**

핵심은 또 하나의 코딩 에이전트를 만드는 것이 아니라 다음 세 요소를 결합하는 것이다.

1. **App** — 사람이 대화하고, 문서·코드맵·기술부채·의사결정을 보는 UI
2. **Agent** — 요구사항 정리, 설명, 판단, 문서화 등 언어적 추론 담당
3. **MCP/Core** — 코드·요구사항·설계 의도·Git 이력 등 프로젝트 컨텍스트와 도구를 Agent에 제공

---

## 2. 해결하려는 문제

바이브코딩은 구현 속도는 빠르지만 시간이 지날수록 다음 정보가 쉽게 유실된다.

- 사용자가 처음에 무엇을 만들고 싶었는지
- 왜 특정 구조나 기술을 선택했는지
- 대화 중 임시로 제외하거나 미룬 요구사항이 무엇인지
- 특정 유스케이스가 실제 코드에서 어떤 흐름으로 구현되어 있는지
- 코드가 처음 설계 의도와 얼마나 달라졌는지
- 기술부채가 언제, 왜 생겼는지
- 비전공자가 현재 코드베이스를 다시 이해할 수 있는 설명

따라서 제품의 핵심 문제를 **Intent ↔ Code 지속 동기화**로 정의한다.

---

## 3. 핵심 기능

### 3.1 요구사항 / 설계 문서 공동 작성

단발성 "PRD 생성"이 아니라 AI와 점진적으로 대화하면서 요구사항을 구체화한다.

예시:

```text
AI: 어떤 서비스를 만들고 싶나요?
사용자: 바이브코딩한 프로젝트를 나중에도 이해하고 싶어.
AI: 코드 이해와 설계 의도 보존 중 무엇을 우선하고 싶나요?
사용자: 설계 의도 보존.
AI: 그러면 변경 시 기존 의도와 충돌하는지 알려주는 기능이 필요할까요?
사용자: 응.
```

대화 결과는 단순 채팅 로그로만 남기지 않고 구조화한다.

```text
REQ-013 회원가입
- 이메일 기반
- 소셜 로그인 제외
- MVP에서는 이메일 인증 제외

DEC-008
- MVP 단계에서는 Redis를 사용하지 않는다.
- 이유: 운영 복잡도 최소화
```

문서는 버전 관리하며, 이후 코드 변경과 연결한다.

### 3.2 Use Case 중심 코드베이스 시각화

파일 트리나 클래스 다이어그램 자체보다 사용자의 행동 단위로 코드를 보여준다.

```text
[사용자가 로그인한다]
        ↓
LoginPage
        ↓
POST /api/login
        ↓
AuthController
        ↓
AuthService
        ↓
UserRepository / JwtService
```

설명 깊이를 단계화한다.

- Level 1: 비전공자용 자연어 설명
- Level 2: 컴포넌트/모듈 흐름
- Level 3: 함수·메서드 및 호출 관계
- Level 4: 코드 수준 + 결합도/응집도 + 구조적 위험

### 3.3 설계 의도 ↔ 실제 코드 관리

설계 결정과 코드를 연결한다.

```text
DEC-014
"외부 결제 API는 PaymentGateway를 통해서만 접근한다."

관련 코드
- src/payment/PaymentGateway.ts
- src/payment/PaymentService.ts
```

코드가 변경되면 기존 의도와 비교한다.

```text
⚠ Architecture Drift

기존 결정
외부 결제 API는 PaymentGateway를 통해서만 접근

현재 코드
OrderService에서 외부 결제 SDK를 직접 호출
```

### 이것은 PR 리뷰와 같은 모양이다

다만 **보는 것이 다르다.** 버그·스타일 리뷰는 이미 agent가 잘 하고, 그것은 우리 몫이
아니다. 우리 리뷰어의 기준은 범용 베스트프랙티스가 아니라 **이 프로젝트가 정한 것** —
인터뷰가 `.project-intel/`에 저장해 둔 DEC과 RULE — 하나뿐이다.

그래서 설계 단위 ↔ 코드 매핑이 없어도 된다. "DEC-014가 어느 파일에 구현돼 있나"를 알
필요가 없다. diff가 파일을 알려주고, DEC은 통째로 실어도 될 만큼 적다. 매핑은 역방향
("이 결정이 어디에 살아 있나" = §3.2 시각화)에 필요한 것이다.

세 층으로 나뉜다.

| | 무엇을 하는가 | LLM |
| --- | --- | --- |
| git diff | 무엇이 바뀌었는지, 어느 기준을 다시 볼지 좁힌다 | 없음 |
| 리뷰 turn | 기준 하나하나에 대해 diff가 그것을 깨는지 판단한다 | 있음 |
| 해소 프롬프트 | 어긋난 것을 고칠 문장을 렌더한다 | 없음 |

**검출은 절반이다.** 검출만 있으면 잔소리하는 린터가 되고, 사람은 그것을 끈다. 어긋난 것을
발견했을 때 무엇을 고칠지 정하는 경로가 붙어야 "지속 동기화"가 된다.

§13의 `[기존 결정 유지] / [현재 구현 승인] / [새 결정으로 교체]`는 세 선택지를 화면에서
고르는 그림이었지만, 그러면 이 앱이 셋 중 뭐가 맞는지 판단하는 셈이 되어 "이 프로젝트가
정한 것 하나만 본다"는 이 절의 원칙과 "우리는 코드를 쓰는 곳이 아니라 보는 곳"이라는
§1.2의 원칙 둘 다와 부딪힌다. 그래서 셋을 둘로 접었다 — **판단도 실행도 사용자가 옆에
띄운 agent에게 넘긴다.** 코드가 틀렸으면 코드를, 결정이 낡았으면 `.project-intel/design.json`
의 그 항목만 고치라고 지시하는 프롬프트 한 장을 렌더해서 건넬 뿐이다 (표의 "해소 프롬프트"
행, LLM 없음). 어느 쪽이 맞는지는 이 앱이 정하지 않는다.

결정을 갱신하는 쪽을 고르면 `.project-intel/`의 DEC이 직접 고쳐진다 — §3.1 인터뷰를 다시
거치지 않는다. 그 agent는 이미 코드를 볼 수 있으므로, 판단과 실행이 같은 자리에서 끝난다.

> 검증: `SPIKE_FINDINGS.md` §15. 두 provider에서 검출 4/4 · 오탐 없음 4/4, 해소 프롬프트
> 3/3 — 두 provider 모두 코드를 고치는 쪽을 골랐다("결정 갱신" 분기는 아직 실측 전).
> 리뷰 turn은 읽기 전용이며 코드를 고치지 않는다 (`docs/BYOA_MCP_INTEGRATION_SPIKE.md` §1.2).

### 3.4 아키텍처·기술부채 지속 관리

단순 정적 분석 수치뿐 아니라 프로젝트의 과거 의사결정과 비교한다.

관리 대상 예시:

- Architecture Drift
- Requirement Drift
- Decision Drift
- 의존성 증가
- 높은 결합도
- 낮은 응집도
- 순환 의존성
- 레이어 위반
- 임시 구현/TODO의 장기 잔존

### 3.5 Wiki — 바이브코딩 중 흘려들은 말을 이해한다

DEC/RULE을 북마크로 남기는 것은 3.1의 저장과 3.3의 드리프트가 이미 하는 일이다("정한 것이
지켜지고 있는가"). 3.5가 다루는 것은 다른 문제다 — 비전공자가 에이전트와 대화하다 스쳐
지나간 말, **"아까 걔가 말한 그게 뭔데"**.

**순수 학습용이다.** 가치판단을 하지 않는다 — "이건 위험합니다", "X가 낫습니다", "재검토가
필요합니다"는 이 기능이 하는 일이 아니다. 그건 3.3(드리프트)의 몫이고, 섞이면 둘 다 못
쓰게 된다. 설명이 일반론이어도 만들 이유가 없다 — 검색으로 얻을 수 있는 것은 우리가 만들
필요가 없다. 가치는 **"이 프로젝트에서 그 말이 무슨 뜻인가"**에 있다.

```text
🔍 인-메모리 저장소

한 줄
데이터를 컴퓨터의 메모리에 임시로 저장하는 방식으로,
앱을 끄면 모든 정보가 사라진다.

이 프로젝트에서
이 앱은 주민, 물건, 대여 정보를 모두 JavaScript의 Map에
보관합니다. src/user.js, src/item.js, src/rental.js에서
이렇게 쓰입니다.

이 프로젝트에서
src/user.js · src/item.js · src/rental.js

함께 보기
세션 관리 · 데이터 저장
```

**추출은 판단이므로 agent가 한다.** 처음에는 빈도로 후보 키워드를 뽑으려 했는데 실패했다 —
가장 자주 나오는 말이 가장 익숙한 말이라, 실제 대화에 돌리면 `wait`·`getting`·`turn` 같은
것이 상위를 차지한다. "비전공자가 모를 만한 말"은 세는 일이 아니라 판단이다. 세는 일(코드
블록 걷어내기, 몇 번 나왔는지)만 코드가 맡는다.

흐름은 채팅이 아니라 **버튼**이다 — 위키를 켜면 대화에서 후보가 뽑혀 나오고, 사용자는
그중 하나를 눌러 페이지를 만든다. 사용자가 없는 새 개념을 처음부터 타이핑할 필요가 없다.

만든 페이지는 `.project-intel/wiki/`에 원본(JSON)과 마크다운을 함께 낸다. 마크다운을
같이 두는 이유는 Notion/Obsidian 같은 도구를 우리가 직접 연동하지 않기 위해서다 — `.md`가
있으면 이미 있는 도구가 그대로 동작하고, 다른 곳에 옮기고 싶으면 사용자가 자기 agent에게
시키면 된다.

> 검증: `SPIKE_FINDINGS.md` §16. 두 provider에서 13/13. 빈도 기반 실패와 판단 기반 성공을
> 실측으로 비교했다.

---

## 4. 전체 시스템 아키텍처

권장 구조는 **App / Agent Runtime / MCP / Core / Shared Store**를 분리하는 것이다.

```text
┌─────────────────────────────────────────┐
│                  App                    │
│                                         │
│ Chat / Requirements / Design Docs       │
│ Use Case Map / Architecture / Drift     │
│ Bookmark / Wiki / Timeline              │
└──────────────────┬──────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
 Agent Runtime Adapter    Shared Project Store
 API / SDK / CLI          JSON/SQLite/Git data
        │                     ▲
        ▼                     │
 Codex / Claude /          Core Engine
 Other Agent                 │
        │                     │
        └──────── MCP ────────┘
```

핵심 책임은 다음과 같다.

### App

- 사용자의 실제 제품 UI
- AI와의 멀티턴 대화
- 요구사항/설계 문서 편집
- 코드맵 시각화
- 의사결정·기술부채·북마크 탐색
- Agent 실행 요청 생성

### Agent

- 사용자와 점진적 대화
- 모호한 요구사항에 대한 추가 질문
- 요구사항 정리 및 문서화
- 코드 설명
- 설계 판단
- 변경 영향 해석
- 필요 시 Agent 자체의 sub-agent 기능 사용

### MCP Server

Agent가 프로젝트 지식과 기능을 사용할 수 있게 하는 인터페이스.

예시 Tools:

```text
get_project_context
get_usecases
get_usecase_trace
get_code_graph
get_symbol
get_dependencies
get_decisions
save_decision
save_requirement
link_intent_to_code
get_git_changes
detect_drift
report_drift
create_bookmark
```

예시 Resources:

```text
project://state
project://requirements
project://decisions
project://usecases
project://code-graph
project://events
```

### Core Engine

LLM 없이도 가능한 결정론적 처리를 담당한다.

- Repository indexing
- AST / symbol 분석
- dependency graph
- Git diff/history 분석
- 구조적 metric 계산
- use-case ↔ code relation 저장
- intent ↔ code relation 저장
- drift 후보 탐지

### Shared Project Store

App, Core, MCP가 공유하는 Source of Truth.

---

## 5. App ↔ Agent 호출 방식

중요한 점은 **MCP와 Agent Invocation을 같은 문제로 보지 않는 것**이다.

### 5.1 Control Plane — App이 Agent를 실행

사용자가 앱에서 프롬프트를 입력하거나 버튼을 누르면 App이 Agent Runtime Adapter를 통해 Agent를 실행한다.

```text
App
 │
 │ prompt / continue conversation
 ▼
Agent Adapter
 │
 ├─ Codex Adapter
 ├─ Claude Adapter
 └─ Other Agent Adapter
 │
 ▼
Agent
```

구현 방식은 Agent별로 API / SDK / CLI 등이 될 수 있다.

공통 abstraction 예시:

```ts
interface AgentRuntime {
  createSession(projectId: string): Promise<Session>;
  sendMessage(sessionId: string, message: string): AsyncIterable<AgentEvent>;
  cancel(sessionId: string): Promise<void>;
}
```

여기서 중요한 것은 특정 provider에 제품 전체가 종속되지 않도록 Adapter 계층을 두는 것이다.

### 5.2 Data / Context Plane — Agent가 MCP를 사용

Agent가 추론 중 프로젝트 정보가 필요하면 MCP를 호출한다.

```text
Agent
  │
  ├─ get_usecase("login")
  ├─ get_related_decisions("login")
  ├─ get_code_graph("login")
  └─ save_requirement(...)
  │
  ▼
MCP Server
  │
  ▼
Core / Project Store
```

따라서 제품 구조를 한 문장으로 정리하면 다음과 같다.

> **App → Agent는 실행/대화 채널, Agent ↔ MCP는 프로젝트 컨텍스트 및 도구 채널이다.**

---

## 6. JSON 기반 App 상태 공유 아이디어

### 결론

**가능하며, 오히려 권장할 만한 구조다.**

App이 한 행동을 JSON 또는 로컬 DB에 저장하고, MCP Server가 동일한 저장소를 읽어 Agent에게 제공할 수 있다.

즉 App이 MCP를 거쳐 자신의 상태를 저장해야 할 필요는 없다.

```text
┌─────────┐
│   App   │
└────┬────┘
     │ write
     ▼
┌─────────────────────┐
│ Shared Project Store │
│                     │
│ actions/events      │
│ requirements        │
│ decisions           │
│ current selection   │
└─────────▲───────────┘
          │ read/write
          │
      ┌───┴────┐
      │  MCP   │
      └───▲────┘
          │
          │ get_project_events()
          ▼
        Agent
```

### 예시 디렉터리

```text
.project-intel/
├── project.json
├── requirements.json
├── decisions.json
├── usecases.json
├── bookmarks.json
├── graph.json
├── drift.json
└── events.ndjson
```

`events.ndjson` 예시:

```json
{"id":"evt_101","type":"UI_REQUIREMENT_SELECTED","at":"2026-08-18T18:10:00+09:00","payload":{"requirementId":"REQ-013"}}
{"id":"evt_102","type":"USER_REQUESTED_REVIEW","at":"2026-08-18T18:11:12+09:00","payload":{"scope":"login"}}
```

MCP에서는 다음처럼 노출할 수 있다.

```text
get_project_state()
get_recent_events(after_event_id)
get_current_ui_context()
get_pending_tasks()
ack_event(event_id)
```

또는 읽기 전용 정보는 MCP Resource로 제공할 수 있다.

### 중요한 구분: 상태 공유 ≠ Agent 실행

JSON에 이벤트를 썼다고 Agent가 자동으로 실행되는 것은 아니다.

```text
App → JSON 저장
```

은 **"현재 무슨 일이 있었는지 Agent가 읽을 수 있게 한다"**는 의미다.

반면

```text
App → Agent에게 지금 이 작업을 수행하라고 요청
```

은 별도의 invocation mechanism이 필요하다.

따라서 다음 두 기능을 분리한다.

```text
1. State synchronization
   App → Shared Store ← MCP ← Agent

2. Agent invocation
   App → Agent Runtime Adapter → Agent
```

이 분리를 해두면 제품 구조가 훨씬 단순해진다.

---

## 7. 권장 데이터 흐름

### 7.1 요구사항 문서 만들기

```text
사용자
  ↓
App Chat
  ↓
Agent Runtime
  ↓
Agent
  │
  ├─ MCP: 기존 요구사항 조회
  ├─ MCP: 기존 결정 조회
  │
  ▼
사용자에게 추가 질문
  ↓
멀티턴 대화
  ↓
Agent가 구조화 결과 생성
  │
  ├─ MCP: save_requirement
  └─ MCP: save_decision
  ↓
Shared Store 변경
  ↓
App UI 자동 갱신
```

### 7.2 코드 변경 후 Drift 분석

```text
코드 변경
  ↓
Core: Git diff / graph update
  ↓
Agent 또는 사용자: Review 요청
  ↓
Agent
  ├─ MCP: get_git_changes
  ├─ MCP: get_related_decisions
  └─ MCP: get_architecture_context
  ↓
Agent 판단
  ↓
MCP: report_drift
  ↓
App Drift Dashboard
```

### 7.3 App에서 특정 Use Case를 보고 있는 상태를 Agent가 이해

App이 UI 상태를 저장한다.

```json
{
  "activeView": "usecase",
  "selectedUsecase": "checkout",
  "selectedNode": "PaymentService",
  "depth": 3
}
```

Agent가 필요할 때:

```text
get_current_ui_context()
```

를 호출하면 사용자가 무엇을 보고 있었는지 알 수 있다.

이 방식은 "이 부분 좀 더 설명해줘" 같은 지시를 자연스럽게 처리하는 데 유용하다.

---

## 8. JSON vs SQLite

### MVP

JSON/NDJSON으로 충분하다.

장점:

- 구현이 빠름
- 사람이 직접 열어볼 수 있음
- Git에 넣기 쉬움
- 디버깅 용이
- MCP Resource로 노출하기 쉬움

### 이후

동시에 여러 프로세스가 읽고 쓰고 이벤트가 많아지면 SQLite를 권장한다.

```text
App ─┐
     ├── SQLite
MCP ─┤
Core ┘
```

그리고 사용자가 Git으로 관리해야 하는 중요한 산출물만 JSON/Markdown으로 export할 수 있다.

권장 방향:

```text
Runtime State     → SQLite
Human-readable    → JSON / Markdown
Event Log         → NDJSON 또는 DB
Generated Docs    → Markdown
```

---

## 9. Agent Integration 전략

제품을 **Bring Your Own Agent(BYOA)** 형태로 정의한다.

```text
                  Agent Layer
        ┌────────────┼────────────┐
        ▼            ▼            ▼
      Codex       Claude       Other/Local
        │            │            │
        └────────────┼────────────┘
                     ▼
                Agent Adapter
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
   Conversation                 MCP
   Orchestration                  │
         │                        │
         └───────────┬────────────┘
                     ▼
             Project Intelligence
```

특정 모델을 제품 정체성으로 삼지 않는다.

예:

```text
Bad positioning
"GPT로 PRD를 만들어주는 앱"

Preferred positioning
"사용자가 선택한 AI coding agent를 프로젝트 지식 계층과 연결하여
요구사항·설계·코드를 지속적으로 동기화하는 개발 플랫폼"
```

---

## 10. MCP에서 JSON을 읽는 방식

### Tool 방식

Agent가 명시적으로 요청해야 하는 데이터에 적합하다.

```text
get_current_ui_context()
get_recent_events()
get_pending_tasks()
```

### Resource 방식

프로젝트 상태를 context resource로 제공할 때 적합하다.

```text
project://state
project://events
project://requirements
```

MCP Resource는 서버가 파일, DB 스키마, 애플리케이션 데이터 같은 컨텍스트를 Client에 제공할 수 있는 구조이므로 Shared Store를 MCP Resource로 감싸는 방식이 자연스럽다.

### 변경 알림

MCP Resource는 Client가 지원하는 경우 resource 변경 구독/알림 패턴을 사용할 수 있다. 다만 **"resource가 바뀌었다"는 알림과 "Agent가 새로운 추론 작업을 시작한다"는 것은 별개**다. 실제 자동 실행 여부는 Agent host/runtime의 정책에 달려 있다.

따라서 MVP에서는 resource notification에 제품 핵심 동작을 의존하지 않는다.

---

## 11. MCP Sampling에 대한 판단

과거/일부 MCP 구현에는 Server가 Client를 통해 LLM sampling을 요청하는 기능이 존재하지만, 제품의 App → Agent invocation 핵심 메커니즘으로 삼지 않는 것을 권장한다.

이유:

- Server 단독으로 임의의 Agent 작업을 깨우는 일반적인 호출 모델과는 다름
- Client/Host 지원 여부에 의존
- 최신 MCP 방향에서는 Sampling이 deprecated 경로에 들어가 있어 신규 핵심 아키텍처로 삼기 부적절

따라서 다음 구조를 유지한다.

```text
App → Agent Adapter           # invocation
Agent ↔ MCP → Project Store   # context/tools
```

---

## 12. 구현 패키지 구조 예시

```text
repo/
├── apps/
│   └── desktop/
│       ├── chat/
│       ├── requirements/
│       ├── usecase-map/
│       ├── architecture/
│       └── wiki/
│
├── packages/
│   ├── core/
│   │   ├── code-analysis/
│   │   ├── graph/
│   │   ├── usecase/
│   │   ├── intent/
│   │   └── drift/
│   │
│   ├── store/
│   ├── mcp-server/
│   └── agent-runtime/
│       ├── interface/
│       ├── codex/
│       ├── claude/
│       └── local/
│
├── .project-intel/
│   ├── requirements.json
│   ├── decisions.json
│   ├── events.ndjson
│   └── docs/
│
├── README.md
└── LICENSE
```

---

## 13. MVP 범위

처음부터 모든 기능을 완성하지 않고 하나의 end-to-end cycle을 완성한다.

### MVP Scenario

1. 사용자가 Repository를 연다.
2. App에서 Agent와 대화하며 하나의 기능 요구사항을 구체화한다.
3. Agent가 Requirement / Decision을 구조화하여 저장한다.
4. Core가 관련 코드를 Use Case로 연결한다.
5. App이 Use Case Map을 보여준다.
6. 이후 코드가 변경된다.
7. Agent가 기존 Decision과 변경 코드를 비교한다.
8. Drift를 발견하면 App에 표시하고, 고칠 프롬프트를 함께 준다.
9. 사용자가 그 프롬프트를 옆에 띄운 agent에게 건넨다 — 판단과 실행은 거기서 끝난다.

데모 예시 (§3.3):

```text
사용자:
"MVP 회원가입에는 이메일 인증을 넣지 않을 거야."

→ DEC-003 저장

나중에 Agent가 EmailVerificationService를 생성

→ 기존 Decision과 충돌 감지

⚠ 기존 설계 의도와 충돌
DEC-003: "MVP 회원가입에서는 이메일 인증을 사용하지 않는다."

[해소 프롬프트 복사] → 옆 Codex/Claude Code 창에 붙여넣기
```

---

## 14. 대회 운영규정과의 관계

현재 설계는 특정 Closed API 모델을 단순히 감싼 서비스가 아니라, **AI coding agent와 개발 프로젝트 사이의 연동/개발 보조 생태계**를 제품의 핵심으로 정의한다.

운영규정에서 확인한 핵심 사항:

- 출품작에 AI 모델을 탑재·적용하는 일반적인 경우 최소 오픈웨이트 수준을 요구한다.
- 외부 API 호출로만 작동하는 Closed API 모델을 서비스 형태로 단순 연결하는 출품작을 제한한다.
- MCP, AI 에이전트 프레임워크, 라이브러리, 커넥터, 플러그인 등 AI 모델과의 연동/개발 보조 생태계 자체를 위한 소프트웨어는 예외로 명시한다.
- 다만 예외 문구의 "연동 테스트를 위한 외부 API 호출"의 범위가 제품의 상시 Agent 사용까지 포함하는지는 문서상 명시적으로 확정되어 있지 않다.

따라서 제품 설명과 구현 모두 다음 원칙을 유지한다.

1. 특정 Closed Model 하나에 종속되지 않는다.
2. Agent Adapter를 명시적인 제품 구성요소로 둔다.
3. MCP/Core/App 자체는 독립된 오픈소스 결과물로 동작한다.
4. 코드 분석·지식 저장·시각화 등 가능한 기능은 LLM 없이도 동작한다.
5. Agent는 교체 가능한 reasoning provider로 취급한다.
6. 출품 전 운영사무국에 "연동 테스트" 범위에 대한 서면 확인을 받는 것이 안전하다.

---

## 15. 설계 원칙 요약

### 1. Agent는 Brain, 우리 제품은 Memory + Structure

Agent가 추론을 잘하는 영역을 다시 구현하지 않는다.

### 2. MCP는 Agent API가 아니다

MCP는 Agent가 프로젝트의 context/tool에 접근하는 계층으로 사용한다.

### 3. App → Agent와 Agent → MCP를 분리한다

```text
App → Agent Adapter → Agent
Agent → MCP → Core/Store
```

### 4. App과 MCP는 같은 프로젝트 상태를 공유한다

```text
App → Shared Store ← MCP ← Agent
```

### 5. 대화는 사라지는 로그가 아니라 구조화된 Project Knowledge가 된다

```text
Conversation
     ↓
Requirement / Decision / Bookmark
     ↓
Use Case / Code
     ↓
History / Drift
```

### 6. 제품의 최종 가치

**"AI가 코드를 잘 작성하게 만드는 도구"가 아니라, AI가 빠르게 만들어낸 프로젝트를 사람이 계속 이해하고 통제할 수 있게 만드는 도구.**

