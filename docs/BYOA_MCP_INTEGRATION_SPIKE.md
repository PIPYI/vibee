# BYOA + MCP Integration Spike

## 0. 목적

이 작업은 제품 기능 개발이 아니라 **기술 검증용 프로토타입(spike)** 이다.

검증하려는 핵심 가설은 다음과 같다.

> 브라우저 UI에서 생성한 프롬프트를 사용자의 로컬 Codex/Claude 계열 coding agent에 전달하고,  
> agent가 지정된 로컬 프로젝트 디렉터리에서 실제 작업을 수행하며,  
> 작업 과정과 결과를 브라우저에 실시간 표시하고,  
> agent가 필요할 때 MCP를 통해 브라우저/앱의 상태를 읽거나 구조화된 결과를 앱에 전달할 수 있는가?

이 spike에서 **AI 모델 API를 직접 호출하지 않는다.**
OpenAI Responses API, Anthropic Messages API 등의 직접 호출을 구현하지 않는다.

사용자는 이미 로컬에 설치·로그인된 coding agent를 사용한다.

---

# 1. 가장 중요한 구현 원칙

## 1.1 동일 세션 공유는 요구사항이 아니다

Codex Desktop / Codex CLI / Claude Code가 옆에서 별도로 실행되어 있어도 된다.

이 프로토타입은 이미 열려 있는 GUI의 채팅창에 키보드 이벤트를 주입하거나,
기존 터미널 UI를 자동 조작하지 않는다.

금지:

- OS-level keyboard automation
- clipboard 붙여넣기 자동화
- Codex/Claude 창 탐색 후 input 클릭
- AppleScript / AutoHotkey 등으로 채팅창 조작
- 이미 열린 임의의 agent UI 세션 hijack

필요한 것은 **동일한 프로젝트 디렉터리를 agent 작업 디렉터리(cwd)로 사용하는 것**이다.

## 1.2 우리는 코드를 쓰는 곳이 아니라 보는 곳이다

이 앱이 turn을 돌리는 것 자체는 금지가 아니다 — 인터뷰도 드리프트 리뷰도 여기서 돈다.
경계는 **반복 루프가 어디에 사는가**다. 프롬프트 → 코드 → 확인 → 다음 프롬프트가 이 앱
안에서 돌기 시작하면 우리는 바이브코딩 툴이 되고, 그러면 경쟁 상대가 Codex 자신이 된다.
그 싸움에서 이길 이유가 없다 — 저쪽은 에디터·diff 뷰·승인 UI에 훨씬 많이 부어 놓았다.

GitHub이 `git`을 대체하지 않는 것과 같다. `git log`로 다 볼 수 있지만 아무도 그렇게 보지
않는다. GitHub이 하는 일은 같은 데이터에 **화면**을 주는 것이고, 그 화면의 중심은 저장소가
아니라 PR — 변경을 놓고 판단하는 자리다. 우리 리뷰어가 사람 대신 DEC 목록일 뿐이다.

금지:

- **코드를 쓰는 turn을 이 앱이 돌리는 것.** 어긋난 것을 고치는 일은 사용자의 agent가 한다.
  우리는 그 프롬프트를 건넨다 (`design.ts`의 `suggestFirstPrompt`와 같은 자리다).
- 코드 편집기 · diff 편집 UI · 승인 워크플로 — 이미 있는 도구의 자리다.

우리가 직접 쓰는 파일은 `.project-intel/`과 인계 산출물뿐이다. GitHub이 직접 쓰는 것이 git
메타데이터뿐인 것처럼. 소스 코드는 옆 창이 쓴다.

이 선은 실용적인 이득이기도 하다. 실행을 우리가 독점하면 **우리가 adapter를 만든 도구에서만**
쓸 수 있다. 프롬프트를 건네는 경로는 adapter가 없는 도구에도 붙는다 — 그것이 "연동 인프라"라는
포지셔닝이 말뿐이 아니게 되는 유일한 방식이다.

예:

```text
Codex Desktop
└── /Users/me/test-project

Prototype Agent Session
└── /Users/me/test-project
```

두 세션은 달라도 된다.

---

## 1.2 통신 역할을 반드시 분리한다

이 프로토타입에는 세 가지 통신 경로가 있다.

### A. Agent Control Channel

브라우저에서 agent에게 새로운 작업을 시작시키는 경로.

```text
Browser
  ↓ prompt
Local Bridge
  ↓ agent control protocol
Codex / Claude
```

Codex에서는 우선 `codex app-server`를 사용한다.

이 경로는 MCP가 아니다.

---

### B. Agent Event Stream

agent의 진행 상황과 응답을 브라우저에 전달하는 경로.

```text
Codex / Claude
  ↓ streamed events
Local Bridge
  ↓ WebSocket
Browser
```

예:

- task started
- agent message delta
- command/tool started
- command/tool completed
- turn completed
- error

이 경로 역시 MCP가 아니다.

---

### C. MCP Tool Channel

agent가 우리 앱의 상태를 조회하거나 우리 앱에 구조화된 action/result를 전달하는 경로.

```text
Agent
  ↓ MCP
Prototype MCP Server
  ↓
Local Bridge / App State
  ↓
Browser
```

이번 spike에서는 이 MCP 경로를 반드시 실제로 사용해야 한다.

---

# 2. Required End-to-End Flow

최종적으로 다음 플로우가 실제로 동작해야 한다.

```text
┌──────────────────────────┐
│ React Browser UI         │
│                          │
│ Project Path             │
│ Prompt                   │
│ [Run]                    │
└────────────┬─────────────┘
             │
             │ HTTP
             ▼
┌──────────────────────────┐
│ Local Bridge             │
│                          │
│ Task API                 │
│ Agent Adapter            │
│ App State                │
│ WebSocket Event Hub      │
└───────┬──────────▲───────┘
        │          │
        │          │ MCP proxy/data
        │          │
        ▼          │
┌──────────────────────────┐
│ Codex                    │
│ via codex app-server     │
│                          │
│ cwd = selected project   │
└────────┬─────────────────┘
         │
         │ MCP tool call
         ▼
┌──────────────────────────┐
│ Prototype MCP Server     │
│                          │
│ get_app_context          │
│ show_result              │
└────────┬─────────────────┘
         │
         ▼
      Bridge
         │
         │ WebSocket
         ▼
      Browser
```

---

# 3. 기술 스택

Spike이므로 단순성을 우선한다.

권장:

- Node.js 20+
- TypeScript
- React
- Vite
- Express 또는 Fastify
- `ws` 또는 동급 WebSocket 라이브러리
- 공식 MCP TypeScript SDK
- Codex CLI / `codex app-server`
- npm workspaces 또는 pnpm workspace

새로운 대형 프레임워크를 추가하지 않는다.

Docker는 사용하지 않는다.
프로토타입은 사용자 로컬 머신에서 직접 실행한다.

---

# 4. 프로젝트 구조

다음과 비슷한 구조를 사용한다.

```text
byoa-mcp-spike/
├─ apps/
│  ├─ web/
│  │  └─ React frontend
│  │
│  └─ bridge/
│     ├─ HTTP API
│     ├─ WebSocket server
│     ├─ app state
│     └─ agent adapters
│
├─ packages/
│  ├─ protocol/
│  │  └─ shared TypeScript types
│  │
│  └─ mcp-server/
│     └─ stdio MCP server
│
├─ scripts/
│  ├─ register-codex-mcp.*
│  └─ unregister-codex-mcp.*
│
├─ README.md
└─ package.json
```

구조는 필요하면 조금 변경해도 되지만 다음 경계는 유지한다.

- Web UI
- Local Bridge
- Agent adapter
- MCP server
- Shared protocol

---

# 5. Phase A — Codex 구현 (필수)

먼저 Codex만 end-to-end로 완성한다.

Claude 구현 전에 Codex acceptance test를 통과시켜라.

## 5.1 사전 조건 검사

Bridge 시작 시 다음을 검사한다.

```bash
codex --version
```

가능하다면 인증 상태도 확인한다.

API key 입력 UI는 만들지 않는다.

사용자가 Codex에 로그인되어 있지 않다면 명확한 에러를 브라우저에 표시한다.

예:

```text
Codex is not ready.
Please install/login to Codex first.
```

---

# 6. Codex App Server 연결

Codex agent control에는 우선 공식 `codex app-server`를 사용한다.

기본 구현은 stdio transport를 선호한다.

Bridge에서 child process로 실행:

```text
codex app-server
```

stdin/stdout JSONL을 통해 App Server와 통신한다.

stdout에 디버그 문자열을 섞지 않는다.

Bridge 내부에 최소 JSON-RPC client abstraction을 만든다.

예:

```ts
interface CodexAppServerClient {
  initialize(): Promise<void>;
  startThread(options: StartThreadOptions): Promise<string>;
  startTurn(input: StartTurnInput): Promise<string>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  onNotification(handler: (event: unknown) => void): void;
  dispose(): Promise<void>;
}
```

Codex protocol object를 React까지 그대로 노출하지 않는다.

---

# 7. Codex thread / turn

사용자가 Browser에서 Run을 누르면:

1. 지정된 project path를 검증한다.
2. thread가 없으면 새 thread를 생성한다.
3. selected project path를 `cwd`로 사용한다.
4. user prompt를 `turn/start` input으로 전달한다.
5. 이후 notification을 계속 읽는다.

개념적 흐름:

```text
initialize
  ↓
thread/start(cwd)
  ↓
turn/start(threadId, prompt, cwd)
  ↓
notifications...
  ↓
turn/completed
```

프로토타입에서 project directory 안의 파일 수정을 허용해야 한다.

그러나 과도한 권한을 기본값으로 주지 말고
가능하면 workspace write 범위는 선택된 프로젝트 폴더로 제한한다.

---

# 8. MCP 서버 (필수)

별도 stdio MCP server를 구현한다.

MCP server는 Codex가 child process로 실행할 수 있어야 한다.

예:

```text
node /absolute/path/to/packages/mcp-server/dist/index.js
```

MCP server stdout은 MCP protocol 전용이다.

일반 로그는 stderr를 사용한다.

---

# 9. MCP Tool 1 — `get_app_context`

반드시 구현한다.

목적:

> agent가 브라우저/앱에서 현재 설정된 context를 가져올 수 있는지 검증.

Schema 예:

```ts
type AppContext = {
  projectPath: string;
  prompt: string;
  selectedItem: {
    id: string;
    label: string;
  } | null;
  metadata: {
    source: "byoa-mcp-spike";
    timestamp: string;
  };
};
```

MCP 서버 자체는 브라우저 메모리에 직접 접근할 수 없으므로
Local Bridge에 context를 요청한다.

예:

```text
Codex
  ↓ MCP
get_app_context()
  ↓
MCP Server
  ↓ localhost HTTP
Bridge
  ↓
current app state
```

Bridge internal endpoint 예:

```text
GET http://127.0.0.1:43120/internal/app-context
```

정확한 endpoint 이름은 변경 가능하다.

반드시 loopback에만 bind한다.

---

# 10. MCP Tool 2 — `show_result`

반드시 구현한다.

목적:

> agent가 단순 자유 텍스트 응답이 아니라 앱에서 렌더링 가능한 구조화된 결과를 MCP를 통해 push할 수 있는지 검증.

Input schema 예:

```ts
type ShowResultInput = {
  title: string;
  summary: string;
  status: "success" | "warning" | "error";
  filesChanged?: string[];
  details?: string[];
};
```

흐름:

```text
Codex
  ↓ MCP
show_result(...)
  ↓
MCP Server
  ↓ localhost HTTP
Bridge
  ↓ WebSocket
Browser
```

Bridge internal endpoint 예:

```text
POST http://127.0.0.1:43120/internal/results
```

Browser에서는 `show_result`로 전달된 결과를
일반 agent transcript와 분리된 Result Panel에 표시한다.

---

# 11. MCP 등록

Codex의 global config를 코드가 몰래 수정하지 않는다.

등록 helper script 또는 명령을 제공한다.

개념:

```bash
codex mcp add byoa-spike -- node /ABSOLUTE/PATH/packages/mcp-server/dist/index.js
```

필요한 경우 stdio process에 Bridge URL을 env로 전달한다.

예:

```text
BRIDGE_URL=http://127.0.0.1:43120
```

다음 명령도 제공한다.

```bash
npm run mcp:register
npm run mcp:unregister
npm run mcp:status
```

각 명령이 실제로 무엇을 변경하는지 README에 명확히 설명한다.

사용자의 기존 MCP 설정을 삭제하거나 덮어쓰지 않는다.

---

# 12. Agent에게 MCP 사용을 강제하는 Spike Instruction

이 검증에서는 agent가 우연히 MCP를 사용하지 않는 상황을 피해야 한다.

Bridge는 실제 user prompt 앞/뒤에 spike 전용 instruction을 추가해도 된다.

의도는 다음과 같다.

```text
You are running inside the BYOA MCP integration spike.

Before doing the requested work:
1. Call the MCP tool `get_app_context`.
2. Use the returned project/app context as additional context.

Perform the user's requested task in the selected project directory.

Before finishing:
3. Call the MCP tool `show_result` exactly once with a structured summary.
4. Then provide your normal final response.
```

문구는 필요에 따라 조정 가능하다.

중요한 것은 acceptance test에서 실제 MCP 호출 기록을 확인할 수 있어야 한다는 것이다.

---

# 13. Browser UI

디자인은 최소화한다.

필수 UI:

```text
┌───────────────────────────────────────────┐
│ BYOA + MCP Spike                          │
│                                           │
│ Agent                                     │
│ [ Codex ]                                 │
│                                           │
│ Project Path                              │
│ [/Users/me/test-project               ]  │
│                                           │
│ Mock App Selection                        │
│ [ login-screen ▼ ]                        │
│                                           │
│ Prompt                                    │
│ ┌───────────────────────────────────────┐ │
│ │ README를 수정해줘                    │ │
│ └───────────────────────────────────────┘ │
│                                           │
│ [ Run ] [ Stop ]                          │
├───────────────────────────────────────────┤
│ Agent Activity                            │
│                                           │
│ • Turn started                            │
│ • Agent message...                        │
│ • command execution...                    │
│ • MCP get_app_context called              │
│ • MCP show_result called                  │
├───────────────────────────────────────────┤
│ Structured Result                         │
│                                           │
│ title                                     │
│ summary                                   │
│ files changed                             │
└───────────────────────────────────────────┘
```

UI library는 필요 없다.

---

# 14. Browser ↔ Bridge API

최소 API를 정의한다.

예:

## Start task

```http
POST /api/tasks
```

```json
{
  "agent": "codex",
  "projectPath": "/Users/me/test-project",
  "prompt": "README.md 마지막에 Edited by agent를 추가해",
  "appContext": {
    "selectedItem": {
      "id": "login-screen",
      "label": "Login Screen"
    }
  }
}
```

Response:

```json
{
  "taskId": "..."
}
```

---

## Stop task

```http
POST /api/tasks/:taskId/stop
```

Codex의 active turn을 interrupt한다.

---

## Events

WebSocket:

```text
ws://127.0.0.1:43120/events
```

정확한 endpoint는 변경 가능하다.

---

# 15. Provider-independent Event Model

Codex raw notifications를 Web UI에 직접 전달하지 않는다.

공통 event model로 normalize한다.

예:

```ts
type AgentEvent =
  | {
      type: "task.started";
      taskId: string;
    }
  | {
      type: "agent.message.delta";
      taskId: string;
      text: string;
    }
  | {
      type: "agent.action.started";
      taskId: string;
      name: string;
      detail?: unknown;
    }
  | {
      type: "agent.action.completed";
      taskId: string;
      name: string;
      detail?: unknown;
    }
  | {
      type: "mcp.tool.called";
      taskId: string;
      tool: "get_app_context" | "show_result";
    }
  | {
      type: "app.result";
      taskId: string;
      result: ShowResultInput;
    }
  | {
      type: "task.completed";
      taskId: string;
    }
  | {
      type: "task.interrupted";
      taskId: string;
    }
  | {
      type: "task.error";
      taskId: string;
      message: string;
    };
```

필요한 필드는 추가해도 된다.

---

# 16. Local Bridge State

Spike에서는 DB가 필요 없다.

메모리 상태로 충분하다.

예:

```ts
type TaskState = {
  taskId: string;
  projectPath: string;
  prompt: string;
  selectedItem: {
    id: string;
    label: string;
  } | null;
  threadId?: string;
  turnId?: string;
  status:
    | "starting"
    | "running"
    | "completed"
    | "interrupted"
    | "error";
};
```

단, MCP process와 Bridge process 사이에 상태를 공유하기 위해
localhost HTTP internal API를 사용한다.

---

# 17. 보안 최소 요구사항

이것은 로컬 prototype이지만 다음은 지킨다.

- Bridge는 기본적으로 `127.0.0.1`에만 bind
- MCP server도 외부 네트워크에 공개하지 않음
- project path를 canonicalize
- 존재하지 않는 directory 거부
- task가 선택한 project root 밖을 임의로 writable root로 추가하지 않음
- API key를 브라우저 localStorage에 저장하지 않음
- 사용자의 Codex auth credential을 직접 읽거나 복사하지 않음
- global Codex config를 자동 파괴/초기화하지 않음

---

# 18. 테스트용 프로젝트

실제 제품 repository를 첫 테스트 대상으로 쓰지 않는다.

별도 fixture를 만든다.

예:

```text
/tmp/byoa-spike-fixture/
├─ README.md
└─ hello.js
```

초기 README:

```md
# Spike Fixture

Original content.
```

Browser prompt:

```text
README.md의 마지막에 아래 문장을 추가해.

Edited by BYOA agent.

작업 전 get_app_context MCP tool을 호출하고,
작업 완료 후 show_result MCP tool로 결과를 전달해.
```

---

# 19. Acceptance Criteria — 필수

아래 항목을 모두 통과해야 Phase A 성공이다.

## Agent Control

- [ ] Browser에서 prompt를 입력하고 Run을 누를 수 있다.
- [ ] Bridge가 prompt를 Codex agent turn으로 전달한다.
- [ ] Codex task의 cwd는 Browser에서 지정한 project directory다.
- [ ] OpenAI 모델 API를 app code에서 직접 호출하지 않는다.
- [ ] API key 입력 UI가 없다.

## Real Project Work

- [ ] Codex가 fixture의 README.md를 실제로 수정한다.
- [ ] 수정 내용이 filesystem에서 확인된다.

## Streaming

- [ ] Codex task started/completed 상태가 Browser에 표시된다.
- [ ] agent message 또는 최소 하나 이상의 진행 event가 Browser에 실시간 표시된다.
- [ ] Bridge가 Codex raw protocol과 Browser protocol 사이 adapter 역할을 한다.

## MCP

- [ ] Codex가 실제로 `get_app_context` MCP tool을 호출한다.
- [ ] `get_app_context`가 Browser/Bridge에 저장된 현재 context를 반환한다.
- [ ] Codex가 실제로 `show_result` MCP tool을 호출한다.
- [ ] `show_result` payload가 Bridge를 거쳐 Browser Result Panel에 표시된다.
- [ ] MCP 호출 여부를 로그나 UI에서 명확하게 확인할 수 있다.

## Separation of Channels

- [ ] Browser → Codex prompt 전달은 MCP로 구현하지 않는다.
- [ ] Codex → App structured tool action은 MCP로 구현한다.
- [ ] Codex → Browser progress/result stream은 WebSocket/event channel로 구현한다.

## Safety / Cleanup

- [ ] Stop 버튼으로 active turn interrupt가 가능하다.
- [ ] MCP 등록을 제거하는 cleanup command가 있다.
- [ ] prototype 종료 후 child process가 남지 않는다.

---

# 20. 실패 시 반드시 기록할 것

기능을 억지로 우회해서 성공처럼 보이게 만들지 않는다.

아래 중 하나가 막히면 `SPIKE_FINDINGS.md`에 기록한다.

```md
## Blocker

### What failed
...

### Expected
...

### Actual
...

### Relevant protocol/event/log
...

### Workaround attempted
...

### Is this a prototype bug or provider limitation?
...
```

특히 다음 workaround는 acceptance success로 인정하지 않는다.

- 브라우저 prompt를 clipboard로 복사한 뒤 사용자가 직접 붙여넣기
- Codex UI에 keyboard automation으로 입력
- MCP 호출을 fake/mock해서 UI에 표시
- `show_result`를 agent가 호출한 것처럼 Bridge가 임의 생성
- 실제 Codex 대신 mock agent만 사용
- 직접 OpenAI API를 호출해서 결과 생성

---

# 21. Phase B — Claude Adapter (Codex 성공 후)

Codex end-to-end + MCP가 완전히 동작한 후에만 시작한다.

목표는 Browser/Bridge protocol은 그대로 유지하면서 provider만 바꾸는 것이다.

```text
AgentAdapter
├─ CodexAdapter
└─ ClaudeAdapter
```

공통 interface 예:

```ts
interface AgentAdapter {
  checkReady(): Promise<{
    installed: boolean;
    authenticated: boolean | "unknown";
    version?: string;
  }>;

  startTask(input: {
    projectPath: string;
    prompt: string;
  }): AsyncIterable<AgentEvent>;

  stopTask(taskId: string): Promise<void>;

  dispose(): Promise<void>;
}
```

Claude에서는 현재 공식적으로 지원되는 Claude Code / Claude Agent SDK의
로컬 interactive 또는 streaming 방식 중 이 요구사항에 가장 적합한 방법을 선택한다.

중요:

- 직접 Anthropic Messages API를 호출하지 않는다.
- 동일한 project directory를 cwd/workspace로 사용한다.
- 가능하면 동일 MCP server의 `get_app_context`, `show_result`를 사용한다.
- Browser protocol을 provider별로 분기시키지 않는다.

Provider-specific 세부 구현이 현재 문서와 다르면,
반드시 최신 공식 문서를 확인하고 `SPIKE_FINDINGS.md`에 차이를 기록한다.

---

# 22. 하지 말아야 할 것

이 spike에서 구현하지 않는다.

- 실제 제품 기능
- 로그인/회원가입
- SaaS backend
- database
- billing
- cloud deployment
- multi-user
- collaboration
- polished design
- editor
- git worktree orchestration
- project history UI
- prompt library
- production auth
- provider marketplace
- desktop packaging
- Tauri/Electron wrapping
- existing Codex/Claude GUI window control
- same-session synchronization

목표는 integration feasibility 하나다.

---

# 23. 완료 산출물

반드시 다음을 제공한다.

```text
1. 실행 가능한 prototype source
2. README.md
3. SPIKE_FINDINGS.md
4. npm/pnpm scripts
5. MCP register/unregister scripts
6. fixture project 또는 fixture 생성 script
```

README에는 최소 다음이 있어야 한다.

```text
Prerequisites
Install
Codex login prerequisite
Build
Register MCP
Start bridge
Start web
Run fixture test
Expected result
Stop
Unregister MCP
Troubleshooting
```

---

# 24. 구현 순서

다음 순서로 작업한다.

```text
Step 1
Monorepo + shared protocol

Step 2
React minimal UI + Bridge HTTP/WebSocket

Step 3
Codex app-server child process + initialize

Step 4
thread/start + turn/start + cwd 지정

Step 5
Codex notifications → normalized WebSocket events

Step 6
stdio MCP server

Step 7
get_app_context

Step 8
show_result

Step 9
Codex MCP 등록 helper

Step 10
fixture end-to-end test

Step 11
Stop/interrupt + cleanup

Step 12
SPIKE_FINDINGS.md 작성

Step 13 (optional after all above pass)
Claude adapter
```

각 단계가 동작하지 않은 상태에서 다음 단계로 대규모 구현을 진행하지 않는다.

---

# 25. Definition of Done

이 spike는 다음 장면이 한 번의 실제 실행에서 확인되면 성공이다.

```text
Browser:

Project:
/tmp/byoa-spike-fixture

Prompt:
README 마지막에 "Edited by BYOA agent." 추가해.

[Run]

↓


Activity:

✓ Task started
✓ MCP get_app_context called
✓ README.md modified
✓ MCP show_result called
✓ Task completed


Structured Result:

Title: README update complete
Status: success
Files changed:
- README.md

Summary:
Added requested marker to README.


Filesystem:

# Spike Fixture

Original content.

Edited by BYOA agent.
```

그리고 이 과정에서:

```text
Browser → Agent       = Agent Control
Agent → Browser       = Event Streaming
Agent → App functions = MCP
```

세 통신 경로가 각각 실제로 동작했음을 로그로 확인할 수 있어야 한다.

---

# 26. 구현 시 참고할 현재 공식 인터페이스

Codex 쪽 구현은 현재 설치된 Codex 버전의 schema를 source of truth로 사용한다.

공식 문서 기준 핵심:

- `codex app-server`는 rich client integration용 로컬 interface다.
- 기본 transport는 stdio JSONL이다.
- 연결 후 `initialize` → `initialized` handshake가 필요하다.
- 새 conversation은 `thread/start`.
- user 작업 시작은 `turn/start`.
- `turn/start`에서 `threadId`, text input, `cwd` 등을 전달할 수 있다.
- 작업 중 notification을 stream으로 받는다.
- 취소는 `turn/interrupt`.
- Codex MCP server 등록은 `codex mcp add`.
- Codex CLI는 stdio 또는 streamable HTTP MCP server를 등록할 수 있다.

현재 설치된 Codex와 protocol mismatch가 있으면 다음 명령으로 schema를 생성해서 맞춘다.

```bash
codex app-server generate-ts --out ./schemas
```

또는:

```bash
codex app-server generate-json-schema --out ./schemas
```

App Server와 관련된 experimental surface는 버전에 따라 바뀔 수 있으므로
하드코딩된 오래된 예시보다 현재 설치된 CLI schema를 우선한다.

공식 참고:

```text
https://developers.openai.com/codex/app-server
https://developers.openai.com/codex/cli/reference
https://developers.openai.com/codex/mcp
```

---

# 27. Agent에게 주는 마지막 지시

이 작업의 목적은 예쁜 데모가 아니다.

**아키텍처 가설을 실제 local coding agent로 증명하거나 반증하는 것**이다.

따라서:

1. mock으로 성공을 위조하지 말 것.
2. 직접 모델 API 호출로 우회하지 말 것.
3. 기존 Codex/Claude GUI를 키보드 자동화하지 말 것.
4. 같은 프로젝트 directory를 실제 agent cwd로 사용할 것.
5. MCP tool call은 실제 MCP protocol로 수행할 것.
6. progress/result는 실제 agent event에서 가져올 것.
7. 실패한 부분은 숨기지 말고 `SPIKE_FINDINGS.md`에 정확히 기록할 것.
8. 구현 중 공식 protocol이 문서와 달라졌다면 현재 설치 버전을 기준으로 수정하고 이유를 기록할 것.
9. Codex phase가 완전히 성공하기 전에는 제품 기능이나 Claude 확장으로 범위를 넓히지 말 것.
10. 최종적으로 실행 명령과 end-to-end 재현 절차를 사람이 그대로 따라 할 수 있게 만들 것.
