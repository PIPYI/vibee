# Vibe Coding Project Intelligence

> 사용자가 이미 쓰고 있는 AI 코딩 에이전트(Codex, Claude Code 등)에 **프로젝트의 장기 기억과 구조 이해 능력**을 연결하고, 그 결과를 사람이 탐색할 수 있게 시각화하는 Project Intelligence 앱.

바이브코딩은 구현 속도는 빠르지만, 시간이 지나면 "무엇을 만들고 싶었는지", "왜 이 구조를 골랐는지", "지금 코드가 처음 의도와 얼마나 달라졌는지"가 빠르게 사라진다.
이 프로젝트는 그 문제를 **Intent ↔ Code 지속 동기화**로 정의하고 해결한다.

또 하나의 코딩 에이전트를 만드는 것이 아니라, 다음 세 요소를 연결하는 것이 핵심이다.

| 구성요소 | 역할 |
| --- | --- |
| **App** | 사람이 대화하고 문서·코드맵·기술부채·의사결정을 보는 UI |
| **Agent** | 요구사항 정리, 설명, 판단, 문서화 등 언어적 추론 |
| **MCP / Core** | 코드·요구사항·설계 의도·Git 이력 등 프로젝트 컨텍스트와 도구 제공 |

---

## 상태

**설계 + 기술 검증 단계.** 제품 구현은 아직 시작하지 않았고, 핵심 아키텍처 가설 하나를
실제 local coding agent로 검증한 프로토타입이 있다.

- 전체 설계: [`docs/vibe_coding_assistant_design.md`](./docs/vibe_coding_assistant_design.md)
- 기능 3.1(요구사항·의사결정) 동작 설계: [`docs/requirements_flow.md`](./docs/requirements_flow.md)
- BYOA + MCP 통합 검증 사양: [`docs/BYOA_MCP_INTEGRATION_SPIKE.md`](./docs/BYOA_MCP_INTEGRATION_SPIKE.md)
- 그 검증 프로토타입: [`prototypes/byoa-mcp-spike/`](./prototypes/byoa-mcp-spike)
  ([검증 결과](./prototypes/byoa-mcp-spike/SPIKE_FINDINGS.md))

프로토타입은 제품 코드가 아니라 기술 검증용 spike다. 검증이 끝나 `main`에 있지만,
**스택이 정해지면 새로 만들되 메커니즘만 가져간다.**

### 지금까지 검증된 것

| | 확인한 것 |
| --- | --- |
| **Phase A** (Codex) | 브라우저 프롬프트가 로컬 agent의 turn으로 전달되고, agent가 지정된 디렉터리에서 실제로 파일을 수정하며, 진행 상황이 실시간으로 흐르고, MCP로 앱 상태를 읽고(`get_app_context`) 결과를 앱에 push(`show_result`)한다 |
| **Phase B** (Claude) | 같은 검증 항목을 provider만 바꿔 통과. Browser/Bridge protocol은 **한 줄도 provider별로 분기하지 않았다** |
| **Phase C** (인터뷰 루프) | agent가 구조화된 질문을 던지고 turn을 끝낸다 → 사용자가 답한다 → **다음 turn이 문맥을 이어받는다**. 두 provider 모두 성립 |
| **Phase D** (인터뷰 이후 전체 플로우) | 가장 불확실했던 **일곱 단위가 대화에서 구조화되어 추출된다.** FLOW의 순서와 ENTITY 관계가 사용자의 시나리오 문장에서 도출되고, 거기서 사람용 설명 · `app_design.md` · harness가 **LLM 없이** 렌더된다 |

즉 `App → Agent`(실행)와 `Agent → MCP`(컨텍스트/도구)를 분리한다는 설계 전제가 실제로
성립하고, Agent Adapter 계층으로 provider 종속을 피한다는 설계(§9)도 실측으로 확인되었다.

### 다음

기능 3.1의 남은 검증 항목은 [`docs/requirements_flow.md`](./docs/requirements_flow.md) §8에 있다.
가장 가까운 것은 **인터뷰 상태의 지속성**이다. 인계 후 설계를 다듬으러 돌아오는 경로가
세션 이어가기인데, 지금은 bridge를 재시작하면 설계가 메모리에서 사라진다.

시각화 관련 작업은 [`prototype/ontology` 브랜치](../../tree/prototype/ontology)에서 별도로 진행 중이다.

---

## 해결하려는 문제

바이브코딩 과정에서 다음 정보가 쉽게 유실된다.

- 처음에 무엇을 만들고 싶었는지 (요구사항)
- 왜 특정 구조/기술을 선택했는지 (의사결정)
- 대화 중 임시로 제외하거나 미룬 것이 무엇인지
- 특정 유스케이스가 실제 코드에서 어떤 흐름으로 구현되어 있는지
- 코드가 처음 설계 의도와 얼마나 달라졌는지 (drift)
- 기술부채가 언제, 왜 생겼는지
- 비전공자가 현재 코드베이스를 다시 이해할 수 있는 설명

---

## 핵심 기능

### 1. 요구사항 / 설계 문서 공동 작성

단발성 "PRD 생성"이 아니라, AI와 멀티턴 대화로 요구사항을 점진적으로 구체화하고 구조화해 저장한다.

```text
REQ-013 회원가입
- 이메일 기반
- 소셜 로그인 제외
- MVP에서는 이메일 인증 제외

DEC-008
- MVP 단계에서는 Redis를 사용하지 않는다.
- 이유: 운영 복잡도 최소화
```

프로젝트 시작 시점에 동작하며, 인터뷰 결과로 **설계도(`app_design.md`)와 에이전트 harness
(`AGENTS.md` / `CLAUDE.md`)를 만들어 사용자의 도구로 넘긴다.**
동작 설계는 [`docs/requirements_flow.md`](./docs/requirements_flow.md)에 있다.

### 2. Use Case 중심 코드베이스 시각화

파일 트리나 클래스 다이어그램이 아니라 **사용자 행동 단위**로 코드를 보여준다.

```text
[사용자가 로그인한다]
        ↓
LoginPage → POST /api/login → AuthController → AuthService → UserRepository / JwtService
```

설명 깊이는 4단계로 나눈다.

- **Level 1** — 비전공자용 자연어 설명
- **Level 2** — 컴포넌트/모듈 흐름
- **Level 3** — 함수·메서드 및 호출 관계
- **Level 4** — 코드 수준 + 결합도/응집도 + 구조적 위험

### 3. 설계 의도 ↔ 실제 코드 관리 (Drift 감지)

설계 결정을 코드와 연결해 두고, 코드가 바뀌면 기존 의도와 비교한다.

```text
⚠ Architecture Drift

기존 결정 : 외부 결제 API는 PaymentGateway를 통해서만 접근
현재 코드 : OrderService에서 외부 결제 SDK를 직접 호출
```

### 4. 아키텍처 · 기술부채 지속 관리

정적 분석 수치만이 아니라 **과거 의사결정과 비교**한다.

Architecture / Requirement / Decision Drift, 의존성 증가, 높은 결합도, 낮은 응집도, 순환 의존성, 레이어 위반, 임시 구현·TODO의 장기 잔존.

### 5. Bookmark / Wiki / Project Memory

대화 중 중요한 판단을 이유·출처·관련 코드와 함께 저장하고, 이후 코드 변경과 자동으로 연결한다.

---

## 아키텍처

```text
┌─────────────────────────────────────────┐
│                  App                    │
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

가장 중요한 설계 분리는 **실행 채널과 컨텍스트 채널을 구분**하는 것이다.

```text
App   → Agent Adapter → Agent      # invocation (control plane)
Agent → MCP → Core / Store         # context / tools (data plane)
```

### Agent Runtime Adapter

특정 provider에 제품 전체가 종속되지 않도록 어댑터 계층을 둔다 (**Bring Your Own Agent**).

```ts
interface AgentRuntime {
  createSession(projectId: string): Promise<Session>;
  sendMessage(sessionId: string, message: string): AsyncIterable<AgentEvent>;
  cancel(sessionId: string): Promise<void>;
}
```

### MCP Server

Agent가 프로젝트 지식과 기능을 사용하는 인터페이스.

**Tools**

```text
get_project_context   get_usecases        get_usecase_trace
get_code_graph        get_symbol          get_dependencies
get_decisions         save_decision       save_requirement
link_intent_to_code   get_git_changes     detect_drift
report_drift          create_bookmark
```

**Resources**

```text
project://state     project://requirements   project://decisions
project://usecases  project://code-graph     project://events
```

> MCP Resource 변경 알림과 "Agent가 새 추론을 시작한다"는 것은 별개다. MVP에서는 resource notification에 핵심 동작을 의존하지 않으며, MCP Sampling도 invocation 메커니즘으로 사용하지 않는다.

### Core Engine

LLM 없이도 동작하는 결정론적 처리 담당: repository indexing, AST/symbol 분석, dependency graph, Git diff/history 분석, 구조적 metric 계산, use-case ↔ code 및 intent ↔ code 관계 저장, drift 후보 탐지.

### Shared Project Store

App / Core / MCP가 공유하는 Source of Truth. App은 자기 상태를 MCP를 거쳐 저장할 필요 없이 직접 store에 쓰고, MCP는 같은 store를 읽어 Agent에게 제공한다.

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

**저장소 선택**: MVP는 JSON/NDJSON으로 충분하다(빠른 구현, 사람이 읽기 쉬움, Git 친화적). 프로세스와 이벤트가 늘어나면 runtime state는 SQLite로, human-readable 산출물은 JSON/Markdown으로 분리한다.

---

## MVP 범위

모든 기능을 만들지 않고 **하나의 end-to-end cycle**을 완성한다.

1. 사용자가 repository를 연다.
2. App에서 Agent와 대화하며 기능 요구사항 하나를 구체화한다.
3. Agent가 Requirement / Decision을 구조화하여 저장한다.
4. Core가 관련 코드를 Use Case로 연결한다.
5. App이 Use Case Map을 보여준다.
6. 코드가 변경된다.
7. Agent가 기존 Decision과 변경 코드를 비교한다.
8. Drift를 발견하면 App에 표시한다.

데모 시나리오:

```text
사용자: "MVP 회원가입에는 이메일 인증을 넣지 않을 거야."   → DEC-003 저장
이후 Agent가 EmailVerificationService를 생성            → 기존 Decision과 충돌 감지

⚠ 기존 설계 의도와 충돌
DEC-003: "MVP 회원가입에서는 이메일 인증을 사용하지 않는다."
[기존 결정 유지] [현재 구현 승인] [새 결정으로 교체]
```

---

## 계획 중인 패키지 구조

```text
repo/
├── apps/
│   └── desktop/          # chat, requirements, usecase-map, architecture, wiki
│
├── packages/
│   ├── core/             # code-analysis, graph, usecase, intent, drift
│   ├── store/
│   ├── mcp-server/
│   └── agent-runtime/    # interface, codex, claude, local
│
├── .project-intel/       # requirements.json, decisions.json, events.ndjson, docs/
├── README.md
└── LICENSE
```

---

## 설계 원칙

1. **Agent는 Brain, 이 제품은 Memory + Structure** — Agent가 잘하는 추론을 다시 구현하지 않는다.
2. **MCP는 Agent API가 아니다** — MCP는 Agent가 project context/tool에 접근하는 계층이다.
3. **App → Agent와 Agent → MCP를 분리한다.**
4. **App과 MCP는 같은 프로젝트 상태를 공유한다.**
5. **대화는 사라지는 로그가 아니라 구조화된 Project Knowledge가 된다** — Conversation → Requirement/Decision/Bookmark → Use Case/Code → History/Drift.
6. **특정 Closed Model에 종속되지 않는다** — Agent는 교체 가능한 reasoning provider이며, 코드 분석·지식 저장·시각화는 LLM 없이도 동작한다.

> 최종 가치: "AI가 코드를 잘 작성하게 만드는 도구"가 아니라, **AI가 빠르게 만들어낸 프로젝트를 사람이 계속 이해하고 통제할 수 있게 만드는 도구.**

---

## License

[GNU General Public License v3.0](./LICENSE) — Copyright (c) 2026 김민석
