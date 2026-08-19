# Spike Findings

검증 환경

| 항목 | 값 |
| --- | --- |
| 실행일 | 2026-08-19 |
| 회귀 게이트 | `npm run acceptance` — 9개 항목 전부 통과 |
| OS | Linux 6.6.87.2 (WSL2, Ubuntu) |
| Node.js | v24.14.1 |
| Codex CLI | `codex-cli 0.148.0` (0.147.0에서도 검증했으나 동작이 달라졌다 — Finding 4) |
| 인증 | ChatGPT 계정 로그인 상태 |
| Agent 모델 API 직접 호출 | 없음 |

---

## 1. 결론

**Phase A(Codex) 가설은 참으로 확인되었다.**

브라우저에서 만든 프롬프트가 로컬 Codex agent의 turn으로 전달되고, agent가 지정한 디렉터리에서
실제로 파일을 수정했으며, 진행 상황이 WebSocket으로 브라우저에 흘렀고, agent가 MCP를 통해
앱 상태를 읽고(`get_app_context`) 구조화된 결과를 앱에 push(`show_result`)했다.

세 통신 경로가 각각 독립적으로 동작하는 것을 로그로 확인했다.

```text
Browser → Agent       = Agent Control   (POST /api/tasks → codex app-server turn/start)
Agent → Browser       = Event Streaming (codex notifications → normalized → WS /events)
Agent → App functions = MCP             (codex → stdio MCP server → loopback HTTP → Bridge)
```

우회나 위조는 없었다. 특히 다음은 사용하지 않았다: 키보드 자동화, clipboard 붙여넣기,
기존 Codex/Claude GUI 세션 조작, MCP 호출 mock, Bridge가 `show_result`를 임의 생성,
mock agent, 모델 API 직접 호출.

---

## 2. Acceptance Criteria 결과

아래 항목 중 자동 검증이 가능한 9개는 `npm run acceptance`로 언제든 다시 확인할 수 있다.
Codex를 업데이트한 뒤에는 이것부터 돌린다 (§8).

### Agent Control

- [x] Browser에서 prompt를 입력하고 Run을 누를 수 있다.
- [x] Bridge가 prompt를 Codex agent turn으로 전달한다. (`turn/start`)
- [x] Codex task의 cwd는 Browser에서 지정한 project directory다. (`thread/start` + `turn/start`의 `cwd`)
- [x] OpenAI 모델 API를 app code에서 직접 호출하지 않는다.
- [x] API key 입력 UI가 없다.

### Real Project Work

- [x] Codex가 fixture의 README.md를 실제로 수정한다.
- [x] 수정 내용이 filesystem에서 확인된다.

### Streaming

- [x] Codex task started/completed 상태가 Browser에 표시된다.
- [x] agent message 및 진행 event(command, fileChange)가 실시간 표시된다.
- [x] Bridge가 Codex raw protocol과 Browser protocol 사이 adapter 역할을 한다.
      브라우저는 `AgentEvent` union만 보고 Codex 타입을 전혀 보지 않는다.

### MCP

- [x] Codex가 실제로 `get_app_context` MCP tool을 호출한다.
- [x] `get_app_context`가 Browser/Bridge에 저장된 현재 context를 반환한다.
- [x] Codex가 실제로 `show_result` MCP tool을 호출한다.
- [x] `show_result` payload가 Bridge를 거쳐 Browser Result Panel에 표시된다.
- [x] MCP 호출 여부를 로그와 UI에서 명확하게 확인할 수 있다. (독립적인 2개 증거원, §4)

### Separation of Channels

- [x] Browser → Codex prompt 전달은 MCP로 구현하지 않았다. (HTTP → app-server JSON-RPC)
- [x] Codex → App structured tool action은 MCP로 구현했다.
- [x] Codex → Browser progress/result stream은 WebSocket으로 구현했다.

### Safety / Cleanup

- [x] Stop 버튼으로 active turn interrupt가 가능하다. (`turn/interrupt` → `task.interrupted`)
- [x] MCP 등록을 제거하는 cleanup command가 있다. (`npm run mcp:unregister`)
- [x] prototype 종료 후 child process가 남지 않는다. (SIGTERM 후 `pgrep` 확인)

---

## 3. 실제 실행 기록 (Definition of Done)

Bridge/Web 기동 → `npm run fixture` → Run. 아래는 Codex 0.148.0에서의 정규화된 이벤트 스트림이다
(command 이벤트는 지면상 생략).

```text
POST /api/tasks -> 200 {"taskId":"7dc325ab-bc30-4c81-a7db-38c5cada3bf0"}
10:46:52 task.started
10:47:06 mcp.tool.called        get_app_context [agent-stream]
10:47:06 agent.action.started   mcp:byoa-spike/get_app_context
10:47:06 agent.action.completed mcp.approval.accepted {"server":"byoa-spike"}
10:47:06 mcp.tool.called        get_app_context [bridge-endpoint]
10:47:06 agent.action.completed mcp:byoa-spike/get_app_context
10:47:13 agent.action.started   fileChange {"files":[".../tmp/fixture/README.md"]}
10:47:13 agent.action.completed fileChange {"files":[".../tmp/fixture/README.md"]}
10:47:22 mcp.tool.called        show_result [agent-stream]
10:47:22 agent.action.started   mcp:byoa-spike/show_result
10:47:22 agent.action.completed mcp.approval.accepted {"server":"byoa-spike"}
10:47:22 mcp.tool.called        show_result [bridge-endpoint]
10:47:22 app.result
   RESULT: {"title":"README 업데이트 완료","status":"success",
            "summary":"선택된 BYOA 프로젝트의 README.md 마지막에 요청한 문장을 추가했습니다.",
            "filesChanged":["README.md"],
            "details":["BYOA 컨텍스트의 프로젝트 경로에서 작업했습니다.",
                       "선택된 앱 항목은 Login Screen입니다.",
                       "파일 끝부분, git diff, 공백 오류 여부를 검증했습니다."]}
10:47:25 task.completed
```

Filesystem:

```text
# Spike Fixture

Original content.

Edited by BYOA agent.
```

같은 내용을 자동으로 검증하려면 `npm run acceptance`를 쓴다 (§8).

## 4. MCP 호출을 어떻게 증명했는가

"MCP를 정말 썼는가"는 이 spike의 핵심 질문이므로, 서로 독립적인 두 증거원을 모두 요구했다.

| source | 무엇인가 | 위조 가능성 |
| --- | --- | --- |
| `agent-stream` | Codex의 `item/started` 알림에 실린 `type:"mcpToolCall", server:"byoa-spike", tool:...` | Bridge가 만든 값이 아니라 agent가 보고한 값 |
| `bridge-endpoint` | Codex가 spawn한 **별도 프로세스**의 MCP server가 loopback HTTP로 Bridge를 호출한 사실 | Bridge 바깥 프로세스에서 들어온 실제 요청 |

마지막 run에서 두 tool 모두 양쪽 증거가 다 관측되었다.

```text
get_app_context : agent-stream, bridge-endpoint
show_result     : agent-stream, bridge-endpoint
```

한쪽만 관측되는 경우는 실패로 취급한다 — 실제로 아래 Finding 1이 정확히 그 상태였다.

---

## 5. Findings

### Finding 1 — MCP tool 승인은 `approvalPolicy: "never"`로 덮이지 않는다 (해결됨)

#### What failed
`get_app_context`와 `show_result`가 agent stream에서는 호출된 것으로 보이는데, MCP server가
Bridge를 전혀 호출하지 않았다. 결과적으로 README도 수정되지 않았고 Result Panel도 비어 있었다.
Agent는 "필수 선행 단계인 get_app_context 호출이 거부되어 ... README.md를 수정하지 않았습니다"라고
정확하게 보고했다.

#### Expected
`thread/start`와 `turn/start`에 `approvalPolicy: "never"`를 주었으므로 승인 없이 tool이 실행될 것.

#### Actual
Codex 0.147.0은 **MCP tool 호출 승인을 `mcpServer/elicitation/request` server→client 요청으로
라우팅**한다. 즉 command/patch 승인과 다른 채널이며 `approvalPolicy`가 적용되지 않는다.

```json
{
  "threadId": "...", "turnId": "...", "serverName": "byoa-spike", "mode": "form",
  "_meta": { "codex_approval_kind": "mcp_tool_call", "persist": ["session", "always"],
             "tool_title": "Get app context", "tool_params": {} },
  "message": "Allow the byoa-spike MCP server to run tool \"get_app_context\"?",
  "requestedSchema": { "type": "object", "properties": {} }
}
```

우리는 이 요청에 `{}`를 응답했고, app-server는 이를 파싱하지 못했다.

```text
ERROR codex_app_server::bespoke_event_handling:
  failed to deserialize McpServerElicitationRequestResponse: missing field `action`
```

응답이 유효하지 않으면 승인 거부로 처리되어 tool 호출이 실패한다.

#### Relevant protocol
`McpServerElicitationRequestResponse = { action: "accept" | "decline" | "cancel",
content: JsonValue | null, _meta: JsonValue | null }`

#### Resolution
Bridge가 elicitation을 정식으로 처리한다. 단 **무조건 수락하지 않는다.**

```text
serverName === "byoa-spike"  → { action: "accept",  content: {},   _meta: null }
그 외 모든 MCP server        → { action: "decline", content: null, _meta: null }
```

이 spike가 스스로 등록한 서버의 tool만 자동 승인하고, 사용자가 개인적으로 설정해 둔 다른
MCP 서버(예: 이 머신의 `figma`, `codex_apps`)의 호출은 거부한다. 승인/거부는 UI에도
`mcp.approval.accepted` / `mcp.approval.declined`로 노출된다.

수정 후 재실행에서 두 tool 모두 `agent-stream` + `bridge-endpoint` 양쪽 증거를 얻었다.

#### Is this a prototype bug or provider limitation?
**Prototype bug.** 다만 문서화되지 않은 지점이었다. 제품에서는 MCP tool 승인을
사용자에게 노출하는 UI(허용/거부, 세션 기억)로 다뤄야 한다 — `_meta.persist: ["session","always"]`가
그 UI를 염두에 둔 필드로 보인다.

---

### Finding 2 — `turn/interrupt`의 결과는 turn status로만 구분된다 (해결됨)

#### What failed
Stop을 눌러 turn이 실제로 중단되었는데도 UI에는 `task.completed`로 표시되었다.

#### Actual
`turn/interrupt`는 예외를 던지지 않고 `turn/completed` 알림을 그대로 보내며, 구분은
`turn.status`(`"completed" | "interrupted" | "failed" | "inProgress"`)에만 담긴다.
초기 adapter는 두 경우 모두 `resolve()`로 처리해 상위에서 구분할 수 없었다.

#### Resolution
`AgentAdapter.startTask`가 `Promise<"completed" | "interrupted">`를 반환하도록 계약을 바꾸고,
Bridge가 그 값으로 `task.completed` / `task.interrupted`를 구분해 emit한다. 실패는 예외로만 전달한다.

#### Is this a prototype bug or provider limitation?
**Prototype bug** (adapter 계약 설계 미비).

---

### Finding 3 — 이벤트 replay 버퍼가 이전 task와 섞였다 (해결됨)

브라우저가 재접속하면 Bridge가 버퍼를 replay하는데, 초기 구현은 이전 task의 종료 이벤트까지
같이 보내서 새 클라이언트가 잘못된 종료 상태를 표시했다. `task.started`에서 버퍼를 비워
항상 **가장 최근 task의 이벤트만** replay하도록 고쳤다.

---

### Finding 4 — Codex 0.148에서 `approvalPolicy: "never"`가 MCP tool 호출을 아예 거부한다 (해결됨)

세션 도중 Codex CLI가 0.147.0 → 0.148.0으로 자동 업데이트되었고, **같은 코드가 즉시 깨졌다.**

#### What failed
`get_app_context`가 agent 스트림에는 호출된 것으로 잡히는데 Bridge에는 도달하지 않았고,
elicitation 요청도 오지 않았다. README도 수정되지 않았다. 0.147에서 통과하던 것과 같은 코드다.

#### Actual
rollout 파일에 원인이 그대로 남아 있었다.

```json
{"type":"mcp_tool_call_end","invocation":{"server":"byoa-spike","tool":"show_result", ...},
 "result":{"Err":"MCP tool call requires approval, but approval policy is never"}}
```

0.147은 `approvalPolicy: "never"`여도 MCP tool 호출을 elicitation으로 클라이언트에 물었다
(Finding 1). **0.148은 묻지 않고 즉시 거부한다.**

#### Resolution
`AskForApproval`의 granular 형태를 쓴다. 스키마는 두 버전에서 동일하다.

```ts
const APPROVAL_POLICY = {
  granular: {
    sandbox_approval: false,
    rules: false,
    skill_approval: false,
    request_permissions: false,
    mcp_elicitations: true,   // ← MCP 승인만 우리에게 보내라
  },
} as const;
```

command/patch는 여전히 승인 없이 샌드박스 안에서 진행되고, MCP tool 호출만 elicitation으로
넘어와 `byoa-spike` 서버에 한해 수락한다. 의도가 설정에 명시되므로 `"never"`의 의미 변화에
영향을 받지 않는다.

#### Is this a prototype bug or provider limitation?
**Provider의 동작 변경.** 다만 근본 원인은 우리 쪽에 있었다 — `"never"`라는 포괄적 값이
"MCP도 묻지 마라"까지 뜻할 것이라고 **가정**했다. 스키마에 정확히 그 의도를 표현하는
granular 형태가 처음부터 있었다. 교훈은 §9에 정리했다.

#### 부수적으로 관측된 것
0.148은 tool 호출을 code mode로 실행한다. rollout에 `custom_tool_call`로
`await tools.mcp__byoa_spike__get_app_context({})` 같은 JS가 남는다. 우리의 `item/mcpToolCall`
감지는 그대로 동작했으므로 event 정규화 계층은 이 변화에 영향받지 않았다.

---

### Finding 5 — 이벤트 replay가 자동화 테스트를 오염시킨다 (해결됨)

Finding 3에서 재접속 대비로 넣은 replay 버퍼가, 이번에는 acceptance 스크립트를 망가뜨렸다.

#### What failed
`npm run acceptance`가 Bridge 재시작 직후 1회차만 통과하고 2회차부터 파일시스템 검사에서
실패했다. "agent가 fileChange를 보고했는데 파일에는 반영되지 않았다"처럼 보였다.

#### Actual
스크립트가 WebSocket에 접속하는 순간 Bridge가 **직전 task의 이벤트를 replay** 한다.
스크립트는 그 안의 `task.completed`를 자기 task의 완료로 오인하고, agent가 일을 시작하기도
전에 검사를 실행했다. 파일은 방금 fixture 초기화로 되돌려진 상태였으므로 당연히 실패한다.

#### Resolution
`POST /api/tasks`가 돌려준 taskId와 `event.taskId`가 일치하는 이벤트만 센다.
수정 후 Bridge 재시작 없이 3회 연속 전 항목 통과를 확인했다.

#### 잘못 짚었던 진단 (기록)
처음에는 thread 재사용이 원인이라고 판단해 "task마다 새 thread"로 바꿨다. 이 변경으로도
1회차는 통과했지만 2회차는 여전히 실패했고, 그 시점에 진단이 틀렸음이 드러났다.
근거가 잘못된 변경이므로 원복했고, thread 재사용(문서 §7)은 그대로 유지한다.

#### Is this a prototype bug or provider limitation?
**Prototype bug** (테스트 하네스). 다만 제품에도 시사점이 있다. replay는 편의 기능이지만
"이 이벤트가 지금 진행 중인 작업의 것인가"를 소비자가 구분할 수 없으면 위험하다.
제품에서는 replay 구간을 명시적으로 표시하거나, 구독 시 관심 taskId를 지정하게 해야 한다.

---

## 6. 확인된 사실 (제품 설계에 반영할 것)

1. **동일 세션 공유는 필요 없었다.** 이 머신에서는 VS Code ChatGPT 확장이 자체
   `codex app-server`를 이미 띄워 두고 있었지만(PID 1509), 우리 Bridge가 자신의
   app-server를 따로 spawn하는 데 아무 문제가 없었다. 같은 프로젝트 디렉터리를 cwd로
   공유하는 것만으로 충분하다는 spike 문서 §1.1의 전제가 확인되었다.

2. **Agent invocation과 MCP는 실제로 분리된다.** App→Agent는 app-server JSON-RPC,
   Agent→App은 MCP다. MCP sampling이나 resource notification에 제품 핵심 동작을 의존할
   필요가 없었다.

3. **MCP server는 상태를 갖지 않아도 된다.** Codex가 spawn한 별도 프로세스이므로 브라우저
   메모리에 접근할 수 없지만, loopback HTTP로 Bridge를 참조하는 것만으로 App과 Agent가
   같은 app state에 합의한다. 이는 설계 문서의 "App과 MCP는 같은 프로젝트 상태를 공유한다"
   원칙이 실제로 구현 가능함을 뜻한다.

4. **Provider-independent event model이 성립한다.** Codex의 풍부한 알림(약 70종)을
   9개짜리 `AgentEvent` union으로 정규화해도 UI 요구를 충족했다. Phase B(Claude)에서
   브라우저 protocol을 바꿀 필요가 없을 것으로 보인다.

5. **agent가 MCP를 자발적으로 부르지는 않는다.** spike instruction(§12)으로 명시적으로
   지시했을 때 안정적으로 호출했다. 제품에서는 tool description과 system prompt 설계가
   실제 사용률을 좌우할 것이다.

6. **Bridge가 만든 세션은 일회용이 아니라 정식 Codex thread다.** 아래 §7 참고.
   앱에서 시작한 작업을 사용자가 나중에 CLI에서 그대로 이어받을 수 있다는 뜻이며,
   제품 설계에서 활용할 여지가 크다.

---

## 7. Bridge가 만든 세션은 어디에 남는가

Run을 눌러 실행된 Codex 작업은 **사용자가 열어 둔 Codex CLI/Desktop 창에는 나타나지 않는다.**
Bridge가 자신의 `codex app-server`를 child process로 따로 띄우기 때문이다. 이는 결함이 아니라
spike 문서 §1.1이 요구한 동작이다(동일 세션 공유는 요구사항이 아니다).

대신 확인한 사실은, 그렇게 만들어진 thread가 **디스크에 정식 Codex 세션으로 영속화된다**는 것이다.

```text
~/.codex/sessions/2026/08/19/rollout-2026-08-19T19-11-22-01a01981-09e5-76a2-8ef1-b2ecb360a6c7.jsonl
```

rollout 파일의 메타데이터:

```json
{
  "id": "01a01981-09e5-76a2-8ef1-b2ecb360a6c7",
  "cwd": "<spike>/tmp/fixture",
  "originator": "byoa-mcp-spike-bridge",
  "cli_version": "0.147.0",
  "source": "vscode",
  "timestamp": "2026-08-19T10:11:22.213Z"
}
```

- `originator`는 `initialize`에서 우리가 보낸 `clientInfo.name`이 그대로 들어간 값이다.
  즉 **어떤 클라이언트가 만든 세션인지 파일만 보고 구분할 수 있다.** 제품에서 자신이 만든
  thread만 골라내는 데 그대로 쓸 수 있는 식별자다.
- `cwd`는 브라우저에서 지정한 프로젝트 경로다.
- `source`가 `"vscode"`인 것은 app-server의 기본값이다. `thread/start`의 `sessionStartSource` /
  `threadSource` 파라미터로 바꿀 수 있으므로, 제품에서는 자기 소스를 명시하는 편이 낫다.

### 관측 지점 4곳

| 어디 | 무엇이 보이는가 |
| --- | --- |
| 브라우저 Activity 패널 | 정규화된 `AgentEvent`. 가장 정제된 뷰 |
| Bridge 터미널 로그 | Codex stderr, elicitation 승인/거부 등 raw 레벨 |
| `~/.codex/sessions/**.jsonl` | thread 전문(프롬프트, tool 호출, 응답) |
| `codex resume` | 해당 thread를 CLI에서 이어받아 대화 계속 |

`codex resume`은 **기본적으로 현재 cwd 기준으로 세션을 필터링한다.** 따라서 브라우저에서 지정한
프로젝트 디렉터리에서 실행해야 목록에 보인다.

```bash
cd <spike>/tmp/fixture && codex resume   # cwd가 일치하므로 목록에 뜬다
codex resume --all                           # 아무 데서나. cwd 필터를 끄고 CWD 열을 함께 보여준다
```

이어받은 세션에서도 `byoa-spike` MCP server는 전역 등록이므로 그대로 붙는다. 단
**Bridge가 떠 있지 않으면 `get_app_context` / `show_result`는 실패한다** — 두 tool 모두
loopback HTTP로 Bridge를 참조하기 때문이다.

### 제약: thread는 동시에 writer 하나만 허용한다

Bridge가 떠 있는 상태에서 **그 Bridge가 사용 중인 thread를 resume 하면 실패한다.**

```text
Error: Failed to resume session from ~/.codex/sessions/.../rollout-...-01a0198d-....jsonl:
  thread/resume failed during TUI bootstrap: thread/resume failed:
  thread 01a0198d-3b8b-7571-b1ad-b58e24e40ab8 already has an active writer (code -32600)
```

원인은 현재 adapter의 thread 재사용 정책이다. `CodexAdapter`는 **프로젝트 경로당 thread 하나를
만들어 Bridge 프로세스가 살아있는 동안 계속 재사용한다**(문서 §7의 "thread가 없으면 새 thread를
생성한다"를 따른 것). 따라서 Bridge가 켜져 있는 동안 그 thread는 계속 열린 writer를 갖는다.

잠기는 것은 **프로젝트당 최신 thread 하나뿐**이다. 이전 Bridge 실행이 만든 thread들은 자유롭게
resume 된다.

```bash
cd <spike>/tmp/fixture && codex resume <이전 실행의 thread id>   # 가능
cd <spike>/tmp/fixture && codex resume <현재 Bridge가 쓰는 id>   # -32600
```

Bridge를 종료하면 잠금이 풀린다.

#### 제품 설계에 대한 함의

"앱에서 시작하고 터미널에서 이어받기"를 제품 기능으로 삼으려면 thread 생명주기 정책을
정해야 한다. 선택지는 대략 셋이다.

1. **turn마다 thread를 닫는다.** 앱이 켜져 있어도 사용자가 언제든 CLI로 이어받을 수 있다.
   대신 대화 연속성을 Bridge가 직접 관리해야 한다.
2. **명시적 handoff.** 앱에 "터미널에서 이어하기" 액션을 두고, 누르면 Bridge가 thread를
   놓아주고 `codex resume <id>` 명령을 보여준다. 소유권이 명확해서 이 spike 범위에서는
   가장 안전한 선택으로 보인다.
3. **현행 유지.** thread를 계속 붙잡고, CLI 이어받기는 앱 종료 후에만 가능하다고 문서화한다.

어느 쪽이든 `-32600`을 그대로 사용자에게 노출하지 말고 "이 세션은 앱이 사용 중입니다"로
번역해 주어야 한다.

### 세션이 계속 쌓인다

Bridge 프로세스마다 프로젝트당 thread 하나가 만들어지므로, Bridge를 재시작할 때마다 새 세션이
남는다. 이 spike를 개발하는 동안에만 9개가 쌓였다(코드를 고칠 때마다 Bridge를 재시작했기 때문).
사용자의 `codex resume` 목록이 우리 thread로 오염된다는 뜻이다.

`thread/start`의 `ephemeral: true`를 쓰면 디스크에 남기지 않을 수 있다. 다만 그러면 위에서
확인한 "CLI에서 이어받기"가 불가능해진다. **세션 이력 보존과 이력 오염 방지는 맞바꿈 관계**이며,
제품에서는 사용자가 고르게 하거나 앱이 만든 thread를 목록에서 구분해 보여주는 편이 낫다.
`originator` 필드가 그 구분에 그대로 쓸 수 있는 값이다.

정리하려면 `originator`로 걸러 지운다.

```bash
grep -l '"originator":"byoa-mcp-spike-bridge"' ~/.codex/sessions/**/*.jsonl
```

### 제품 설계에 대한 함의

App이 만든 세션과 사용자가 CLI에서 여는 세션이 **같은 저장소를 공유**한다. 즉 "앱에서 시작하고
터미널에서 이어서 한다" 또는 그 반대가 가능하다. 설계 문서가 말한 "또 하나의 코딩 에이전트를
만드는 것이 아니라 기존 agent에 기억과 구조를 붙인다"는 방향과 정확히 맞는 성질이며,
사용자를 우리 UI 안에 가두지 않아도 된다는 뜻이다.

---

## 8. Codex 버전 변경에 어떻게 대응할 것인가

이 spike는 2026-08-19 하루 동안 Codex 0.147.0 → 0.148.0 업데이트를 맞았고, **같은 코드가 즉시
깨졌다**(Finding 4). 이 문제는 앞으로도 반복될 것이므로 대응 방법을 명시해 둔다.

### 무엇이 통하지 않는가

| 방법 | 이번 두 번의 파손을 잡는가 |
| --- | --- |
| TypeScript 타입 검사 | **못 잡는다.** Finding 1도 4도 스키마는 그대로였다 |
| `codex app-server generate-ts`로 스키마 재생성 | **못 잡는다.** 필드 모양이 아니라 값의 *의미*가 바뀌었다 |
| 공식 문서 확인 | 부분적. 두 변경 모두 문서보다 CLI가 앞서 있었다 |

`AskForApproval`의 타입 정의는 0.147과 0.148이 **완전히 동일하다.** 바뀐 것은 `"never"`가
MCP tool 호출에 대해 무엇을 뜻하는가였다. 정적 검증으로 잡을 수 있는 종류의 변화가 아니다.

### 무엇이 통하는가

**1. 동작을 실제로 한 번 돌려보는 회귀 게이트 — `npm run acceptance`**

이것이 유일하게 신뢰할 수 있는 수단이다. §2의 acceptance criteria를 9개 자동 검사로 옮겼고,
하나라도 어긋나면 비정상 종료한다. Codex를 업데이트한 뒤 가장 먼저 돌린다.

특히 중요한 검사는 **MCP 호출의 두 증거원을 따로 확인**하는 것이다(§4). Finding 4에서 실제로
`agent-stream`은 잡히는데 `bridge-endpoint`만 사라졌고, 이 두 개를 분리해 두지 않았다면
"MCP는 호출됐다"고 잘못 판단했을 것이다.

마찬가지로 **파일시스템을 직접 확인**하는 검사가 필요하다. Finding 4에서 agent는 자기 실패를
정직하게 보고했지만, 만약 `show_result`가 success로 왔다면 UI만 보고는 알 수 없었다.
agent의 자기 보고를 신뢰의 근거로 삼지 않는다.

**2. 설정은 의도를 명시하는 형태로 쓴다**

두 번의 파손 모두 근본 원인은 같다. `approvalPolicy: "never"`라는 **포괄적 값이 우리가 원하는
세부 동작까지 포함할 것이라고 가정**했다. granular 형태는 "MCP 승인만 나에게 보내라"를 직접
표현하므로, 포괄적 값의 해석이 바뀌어도 영향을 받지 않는다.

일반화하면: **여러 동작을 한 단어로 묶은 설정값은 provider가 재해석할 여지가 크다.
세부 항목을 지정할 수 있으면 그쪽을 쓴다.**

**3. 실패는 조용히 지나가지 않게 한다**

Finding 4에서 Bridge는 task를 `completed`로 처리했다. agent가 아무것도 하지 않았는데도 그렇다.
제품에서는 "이 turn에서 기대한 MCP 호출이 일어났는가"를 Bridge가 검사하고, 어긋나면
사용자에게 드러내야 한다. 지금 UI의 `✔ get_app_context` / `✔ show_result` 체크 표시가
그 최소 형태다.

**4. 버전을 기록한다**

`SPIKE_FINDINGS.md` 머리말과 `CLAUDE.md`에 검증된 버전을 적어 둔다. 실패했을 때
`codex --version`을 먼저 비교하면 원인 탐색이 훨씬 빨라진다. 실제로 이번에도
Codex TUI 화면의 `v0.148.0` 표기와 문서의 `0.147.0`이 다른 것을 보고 원인을 좁혔다.

**5. rollout 파일을 먼저 본다**

`~/.codex/sessions/**.jsonl`에 tool 호출의 원본 요청과 결과가 그대로 남는다.
Finding 4의 결정적 단서(`{"Err":"MCP tool call requires approval, ..."}`)도 여기서 나왔다.
Bridge 로그나 UI에는 그 문자열이 없었다.

```bash
python3 -c "
import json,glob
f=sorted(glob.glob('$HOME/.codex/sessions/**/*.jsonl', recursive=True))[-1]
for l in open(f):
    d=json.loads(l).get('payload',{})
    if 'mcp_tool_call' in d.get('type',''): print(json.dumps(d, ensure_ascii=False)[:400])
"
```

### 권장 절차

```text
Codex 업데이트 감지
  ↓
npm run build && npm run acceptance
  ↓
통과 → codex --version을 SPIKE_FINDINGS.md / CLAUDE.md에 갱신
실패 → rollout 파일에서 원본 오류 확인
      → codex app-server generate-ts로 스키마 재생성 후 비교
      → 수정하고 SPIKE_FINDINGS.md에 Finding으로 기록
```

---

## 9. 남은 것 / 하지 않은 것

- **Phase B (Claude adapter)** — 미착수. Codex acceptance가 통과한 지금이 시작 시점이다.
  `AgentAdapter` 인터페이스는 이미 provider 중립이며, Bridge/Browser protocol은 그대로 둔 채
  `ClaudeAdapter`만 추가하면 된다.
- **다중 동시 task** — Bridge는 의도적으로 한 번에 하나의 task만 허용한다(409). `show_result`에
  taskId가 없어 active task로 라우팅하기 때문이다. 제품에서는 tool input에 taskId를 넣거나
  MCP session별 상태 분리가 필요하다.
- **MCP tool 승인 UX** — 현재는 Bridge가 정책으로 자동 처리한다. 제품에서는 사용자에게
  노출해야 한다(Finding 1).
- **Agent가 무관한 파일을 읽는 경우** — 일부 run에서 Codex가 전역 skill 문서를 먼저 읽었다.
  동작에는 지장이 없었으나, 제품에서는 turn별 instruction 범위를 좁히는 편이 낫다.
