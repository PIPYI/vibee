# Spike Findings

검증 환경

| 항목 | 값 |
| --- | --- |
| 실행일 | Phase A 2026-08-19 / Phase B 2026-08-20 |
| 회귀 게이트 | `npm run acceptance` — codex·claude 각 9개 항목 전부 통과 |
| OS | Linux 6.6.87.2 (WSL2, Ubuntu) / Phase B는 6.18.33.2 (WSL2, Ubuntu) |
| Node.js | v24.14.1 (Phase A) / v18.19.1 (Phase B — bridge·MCP server는 동작, web dev server는 20+ 필요) |
| Codex CLI | `codex-cli 0.148.0` (0.147.0에서도 검증했으나 동작이 달라졌다 — Finding 4) |
| Claude Code | `2.1.237` + `@anthropic-ai/claude-agent-sdk` 0.3.237 |
| 인증 | ChatGPT 계정 / Claude 계정 로그인 상태 |
| Agent 모델 API 직접 호출 | 없음 |

---

## 1. 결론

**Phase A(Codex)와 Phase B(Claude) 가설 모두 참으로 확인되었다.** 아래 §1~§8은 Phase A(Codex)
검증 기록이고, Phase B(Claude) 결과는 §9에 있다.

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

## 9. Phase B — Claude adapter (2026-08-20)

**Phase B 가설도 참으로 확인되었다.** Browser/Bridge protocol을 한 줄도 바꾸지 않고 provider만
바꿔서 동일한 9개 acceptance 항목을 통과했다.

```text
$ npm run acceptance claude
  [PASS] task가 오류 없이 완료됨
  [PASS] 진행 이벤트가 스트리밍됨
  [PASS] get_app_context — agent 스트림 증거
  [PASS] get_app_context — bridge 도달 증거
  [PASS] show_result — agent 스트림 증거
  [PASS] show_result — bridge 도달 증거
  [PASS] 구조화된 결과가 UI로 전달됨
  [PASS] fileChange 이벤트에 README.md가 있음
  [PASS] 파일시스템에 실제로 반영됨
```

`AgentAdapter` 인터페이스(`apps/bridge/src/agents/types.ts`)는 실제로 provider 중립이었다.
`ClaudeAdapter`를 추가하고 `adapters` map에 등록한 것 외에 bridge의 HTTP/WebSocket 계층,
`packages/protocol`의 `AgentEvent`, MCP server는 **변경하지 않았다.** 브라우저 쪽 변경도
"agent 선택 select를 실제로 동작시킨 것"뿐이다.

### Codex와 다른 점

| | Codex | Claude |
| --- | --- | --- |
| Agent control | `codex app-server` child process + JSON-RPC | Agent SDK `query()` |
| MCP 등록 | 전역 `codex mcp add` 필요 (`npm run mcp:register`) | **불필요** — `options.mcpServers`로 query마다 직접 전달 |
| 다른 MCP 서버 격리 | elicitation에서 `serverName`을 보고 거부 | `strictMcpConfig: true`로 애초에 로드 안 됨 |
| 도구 승인 | `mcpServer/elicitation/request` 응답 | `canUseTool` 콜백 |
| 세션 재사용 | 프로젝트당 thread 하나 | 프로젝트당 `session_id` 하나 (`options.resume`) |
| 중단 | `turn/interrupt` | `AbortController` |

MCP 등록이 필요 없다는 점은 제품 관점에서 의미가 크다. Codex는 사용자의 전역 설정을 건드려야
하고 그래서 register/unregister 스크립트와 "Bridge 재시작 필요" 절차가 따라붙지만, Claude는
그 절차 전체가 사라진다.

### 세션 재사용은 UI에 드러나야 한다 (Run -> Send / New Session)

두 adapter 모두 **프로젝트 경로당 세션 하나를 만들어 bridge 프로세스가 사는 동안 재사용한다**
(Codex는 thread, Claude는 `session_id` + `resume`). 즉 버튼을 반복해서 누르면 새 대화가
시작되는 것이 아니라 **같은 대화가 이어진다.**

실측으로 확인했다.

```text
Send #1  "숫자 7을 기억해줘"        -> agent.session ba034187 resumed=false
Send #2  "그 숫자가 뭐였지?"        -> agent.session ba034187 resumed=true   답: "7"
New Session
Send #3  "그 숫자가 뭐였지?"        -> agent.session 125cb1f6 resumed=false  답: "모릅니다"
```

그런데 초기 UI는 이것을 전혀 드러내지 않았다. 버튼 하나("Run")만 있어서 화면만 봐서는 지금이
새 대화인지 이어지는 대화인지 알 수 없었고, 실제로 사용자가 "Run을 누르면 새 세션이 계속
시작되는 거냐"고 물었다. **동작이 아니라 UI가 문제였다.**

바꾼 것:

- `Run` -> `Send`. 프롬프트를 보내는 버튼이라는 뜻을 이름에 담았다.
- `New Session` 버튼 추가. `POST /api/sessions/reset`이 adapter의 프로젝트별 세션 참조를 버린다.
  **세션 파일을 지우지 않는다** — 이전 세션은 디스크에 남아 CLI에서 이어받을 수 있다.
- `agent.session` 이벤트 추가(`sessionId`, `resumed`). 브라우저가 "세션 xxx · turn N"을 표시하고,
  Activity에 `New session` / `Continuing session`을 남긴다.

주의: Codex thread id는 UUIDv7이라 **앞 8자가 타임스탬프**다. 연달아 만든 두 세션이 같은
prefix를 가져 처음엔 "reset이 동작하지 않는다"고 잘못 판단했다. UI는 13자를 보여준다.

### Finding 6 — Claude에는 Codex의 `writableRoots`에 해당하는 강제가 없다

#### What

Codex adapter는 `sandboxPolicy: { type: "workspaceWrite", writableRoots: [projectPath] }`로
**OS 레벨에서** 쓰기 범위를 프로젝트 디렉터리로 제한한다. Claude Agent SDK에는 이에 대응하는
옵션이 없다. SDK 문서가 명시적으로 "파일시스템·네트워크 제한은 `sandbox` 설정이 아니라
permission 규칙으로 한다"고 안내한다.

#### 현재 대응

`canUseTool` 콜백에서 직접 검사한다.

- `Write` / `Edit` / `NotebookEdit` → 대상 경로가 `projectPath` 하위가 아니면 거부
- `WebFetch` / `WebSearch` → 거부 (Codex의 `networkAccess: false`에 대응)
- `mcp__byoa-spike__*` → 허용

#### 남는 격차

**`Bash`로 프로젝트 밖 경로에 쓰는 것은 이 훅 수준에서 막을 수 없다.** 임의의 셸 명령을
파싱해 쓰기 대상을 알아내는 것은 신뢰할 수 없기 때문이다. Codex는 OS 샌드박스가 이것을 막고,
Claude는 막지 않는다.

`permissionMode: "bypassPermissions"`를 쓰면 더 편했겠지만 쓰지 않았다 — 그쪽이 격차를 더
벌린다. 제품에서 이 격차를 메우려면 SDK의 `sandbox: { enabled: true }`(bubblewrap 등 OS 격리)를
켜는 방향을 검토해야 하며, 이 spike 범위에서는 검증하지 않았다.

#### Is this a prototype bug or provider limitation?

Provider 간 설계 차이다. Codex는 샌드박스를 turn 파라미터로 받고, Claude는 permission 훅과
별도의 sandbox 설정으로 분리해 둔다. 프로토타입 버그가 아니다.

### Finding 8 — SDK가 만든 Claude 세션은 `--resume` picker에 뜨지 않는다

Claude도 Codex처럼 자기 세션을 디스크에 남긴다.

```text
~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl
예: ~/.claude/projects/-home-kimms-...-tmp-fixture/ba034187-....jsonl
```

그런데 **프로젝트 디렉터리에서 `claude --resume`을 실행해도 목록에 나오지 않는다.**

```text
Resume session
  fixture
  No conversations found in this project.
```

세션 파일은 그 자리에 있고(3개), `gitBranch`도 현재 브랜치(`main`)와 일치하며,
`isSidechain: false`, `userType: "external"`로 정상이다. 그런데도 picker는 비어 있다.

#### 무엇이 다른가

우리 세션과 사람이 직접 친 세션의 메시지 필드를 비교했다.

| | SDK가 만든 세션 | 대화형 세션 |
| --- | --- | --- |
| `entrypoint` | `sdk-cli` | `cli` |
| `promptSource` | `sdk` | `typed`, `suggestion_accepted` |
| `origin` | **필드 자체가 없음** | `{"kind":"human"}` |

picker는 사람이 친 대화만 보여주도록 거르는 것으로 보인다. 우리 세션에는 `origin`이 없다.

#### 그래도 이어받을 수는 있다

picker에 안 뜰 뿐, 세션은 **완전히 살아 있고 이어받을 수 있다.** 둘 다 실제로 확인했다.

| 방법 | SDK 세션 | 결과 |
| --- | --- | --- |
| `claude --resume` (picker) | 목록에 없음 | ❌ |
| `claude -c` (해당 디렉터리에서) | 최근 세션을 찾아 이어받음 | ✅ |
| `claude -p --resume <session-id>` | 이전 turn 내용을 기억한 채 이어짐 | ✅ |

#### Codex와의 차이, 그리고 제품에 대한 함의

Codex는 `originator: "byoa-mcp-spike-bridge"`가 찍혀 있어도 `codex resume` 목록에 그대로 나온다.
즉 §7에서 확인한 "앱에서 시작하고 터미널에서 이어받기"는 **Codex에서는 그냥 되지만 Claude에서는
세션 ID를 알아야만 된다.**

따라서 제품이 Claude를 지원하려면 **앱이 세션 ID를 사용자에게 노출해야 한다.** 이 spike에서는
`agent.session` 이벤트로 받은 ID를 화면에 표시하고 전체 ID를 복사할 수 있게 해 두었다.

두 CLI 모두 세션을 cwd 기준으로 분류하므로, 어느 쪽이든 그 프로젝트 디렉터리에서 실행해야
한다. Codex에는 그 필터를 끄는 `codex resume --all`이 있지만 Claude에는 대응 옵션이 없다.

또 하나: Codex는 rollout 파일 첫 줄 `session_meta.payload`에 `cwd`와 `originator`가 함께 들어가
**어떤 클라이언트가 만든 세션인지 파일만 보고 구분된다.** Claude 세션 파일에는 originator에
해당하는 값이 없고 `cwd`도 첫 줄이 아니라 뒤쪽 대화 줄에 나온다. `entrypoint: "sdk-cli"`가
그나마 가장 가까운 단서다.

### Finding 9 — 윈도우 지원: 코드는 고쳤으나 **실기 검증은 하지 못했다**

제품 요구사항상 윈도우 지원은 필수다. 코드를 검토해 윈도우에서 깨질 지점을 찾아 고쳤지만,
**실제 윈도우에서 돌려보지는 못했다.** 검증 환경(WSL2)의 윈도우 쪽에는 Node.js·npm·Codex·
Claude Code가 하나도 설치되어 있지 않아 E2E 테스트가 불가능했다.

#### 무엇이 문제였나

1. **`.cmd` 래퍼를 spawn할 수 없다.** 윈도우에서 `codex`, `claude`는 npm 전역 설치가 만든
   `.cmd` 배치 파일이다. Node는 보안상 `.cmd`/`.bat`을 shell 없이 실행하지 않으므로
   `spawn("codex", ["app-server"])`가 EINVAL/ENOENT로 실패한다. 해당 호출 4곳이 모두
   bare 명령 이름을 쓰고 있었고 `process.platform` 분기가 전혀 없었다.

2. **shell을 거치면 프로세스 정리가 깨진다.** shell로 띄우면 우리가 아는 pid는 `cmd.exe`이고
   실제 agent는 그 자식이다. `child.kill()`은 `cmd.exe`만 죽여서 **agent가 고아로 남는다** —
   §19의 "prototype 종료 후 child process가 남지 않는다"를 위반한다.

#### 고친 방법

`apps/bridge/src/platform.ts`에 플랫폼 차이를 모았다.

- `cliSpawnOptions` — 윈도우에서만 `shell: true`. 인자가 전부 상수 문자열(`app-server`,
  `--version`)이고 사용자 입력이 섞이지 않아 안전하다. 프로젝트 경로 같은 값은 argv가 아니라
  stdio JSON으로 넘어간다.
- `killTree()` — 윈도우에서는 `taskkill /pid <pid> /T /F`로 트리째 정리하고, POSIX에서는
  기존 시그널 방식을 유지한다.

적용 지점: `codex/appServerClient.ts`(spawn + dispose), `codex/adapter.ts`(`--version`),
`claude/adapter.ts`(`--version`), `scripts/_shared.mjs`, `scripts/acceptance.mjs`.

Claude adapter의 turn 실행 자체는 Agent SDK가 담당하며, SDK는 자체 플랫폼별 바이너리
(`@anthropic-ai/claude-agent-sdk-win32-x64`)를 들고 있으므로 우리가 손댈 필요가 없다.
MCP server는 `command: "node"`로 띄우는데 `node.exe`는 실제 실행 파일이라 문제되지 않는다.

#### 남은 것 / 알려진 제약

- **실기 검증 필요.** 윈도우에서 `npm run acceptance`가 통과해야 이 Finding을 "해결됨"으로
  바꿀 수 있다. 리눅스 회귀가 없다는 것만 확인했다(codex·claude 9/9 통과, 자식 프로세스 잔여 없음).
- **UNC 경로에서는 동작하지 않을 것이다.** `\\wsl.localhost\...`에서 `cmd.exe`를 실행하면
  "UNC 경로는 지원되지 않습니다"로 작업 디렉터리가 `C:\Windows`로 바뀐다. 실제로 이 환경에서
  재현했다. 윈도우에서는 반드시 `C:\` 아래에 체크아웃해야 한다.
- **`SIGTERM`은 윈도우에서 발생하지 않는다.** 창을 X로 닫거나 강제 종료하면 cleanup 핸들러가
  돌지 않는다. **Ctrl+C**로 종료해야 자식 프로세스가 정리된다.

#### 검증 절차

윈도우 쪽에 따로 설치해야 한다 (WSL에 깐 것은 쓸 수 없다). PowerShell에서:

```powershell
cd C:\dev                              # UNC 경로 금지
git clone <repo> && cd <repo>\prototypes\byoa-mcp-spike

winget install OpenJS.NodeJS.LTS       # Node 20+
npm i -g @openai/codex && codex login  # Codex를 검증할 경우
npm i -g @anthropic-ai/claude-code && claude   # Claude를 검증할 경우

npm install && npm run build && npm run fixture
npm run mcp:register                   # Codex를 쓸 때만

npm run bridge                         # 창 1
npm run acceptance                     # 창 2 — agent마다 9개 항목
```

확인할 것:

| 항목 | 실패하면 의심할 것 |
| --- | --- |
| `/api/health`에 두 agent 버전이 뜨는가 | `.cmd` 실행 실패 → `cliSpawnOptions` |
| acceptance 9/9 통과 | 항목별로 원인이 다르다. §2 참고 |
| Ctrl+C 후 `tasklist \| findstr /i "codex claude node"`가 비는가 | `killTree()`의 taskkill 경로 |
| 브라우저 Stop → `Task interrupted` | Finding 7 |
| 브라우저 New Session → 새 세션 ID | `resetSession()` |
- **`SIGTERM`은 윈도우에서 발생하지 않는다.** `index.ts`의 `process.on("SIGTERM")` 핸들러는
  윈도우에서 호출되지 않는다(Node 문서). `SIGINT`(Ctrl+C)는 동작하므로 터미널에서 정상 종료할
  수는 있지만, 프로세스를 강제 종료하면 cleanup이 돌지 않는다.
- 경로 처리는 전부 `node:path`(`join`/`resolve`/`sep`)를 쓰므로 윈도우에서도 동작할 것으로
  보이지만 이것도 실기 확인 대상이다.

### Finding 7 — abort는 result 메시지가 아니라 예외로 끝난다 (해결됨)

#### What failed

Stop 버튼이 `task.interrupted`가 아니라 `task.error`를 냈다.

```text
최종 이벤트: task.error  Claude Code process aborted by user
```

#### Expected

Codex의 `turn/interrupt`와 마찬가지로 `task.interrupted`.

#### Actual

Codex는 중단 결과를 `turn/completed`의 `status: "interrupted"`로 알려주므로 정상 흐름 안에서
구분된다(Finding 2). Claude Agent SDK는 다르다. `AbortController.abort()`를 호출하면 `query()`의
async iterator가 **result 메시지를 내지 않고 예외를 던진다.** 그 예외가 bridge의 `runTask`
catch로 흘러가 `task.error`가 되었다.

#### Resolution

`startTask`의 for-await를 try/catch로 감싸고, `abortController.signal.aborted`가 참이면
예외를 다시 던지지 않고 `"interrupted"`를 반환한다. 이미 result 메시지 경로에도 같은 검사가
있었지만, abort 시에는 그 경로에 도달하지 않는다는 것이 함정이었다.

acceptance 9개 항목에는 Stop 시나리오가 없어서 이 버그는 자동 검증으로 잡히지 않았다.
수동 확인(15초 후 Stop 요청)으로 발견했다.

#### Is this a prototype bug or provider limitation?

프로토타입 버그였다. SDK 동작은 문서화된 abort 시맨틱과 일치한다.

---

## 10. Phase C — 인터뷰 루프 (2026-08-20)

`docs/requirements_flow.md`가 설계한 요구사항 인터뷰의 **핵심 가설 하나**를 검증했다.

> agent가 구조화된 질문을 던지고 turn을 끝낸다 → 사용자가 답한다 →
> 다음 turn이 문맥을 이어받는다

**두 provider 모두 통과했다.**

```text
$ node interview-test.mjs claude     $ node interview-test.mjs codex
  [PASS] 질문이 2개 이상 왔다          [PASS] 질문이 2개 이상 왔다
  [PASS] 한 turn에 질문 하나씩만        [PASS] 한 turn에 질문 하나씩만
  [PASS] 질문이 반복되지 않았다         [PASS] 질문이 반복되지 않았다
  [PASS] 같은 세션이 유지되었다         [PASS] 같은 세션이 유지되었다
  [PASS] 초안(show_result)이 나왔다     [PASS] 초안(show_result)이 나왔다
```

### 무엇을 만들었나

기존 채널을 그대로 쓰고 tool 하나만 더했다.

| 추가 | 역할 |
| --- | --- |
| `ask_user` MCP tool | 질문을 등록하고 **즉시 반환**한다. 답을 기다리지 않는다 |
| `POST /api/questions/answer` | 답변을 기록하고 **다음 turn을 자동으로 시작**한다 |
| `AppContext.interview` | 지금까지의 문답. agent가 `get_app_context`로 읽는다 |
| `app.question` / `app.answer` 이벤트 | 브라우저가 질문을 렌더하고 답을 보낸다 |

agent가 매 turn 하는 일은 셋뿐이다 — `get_app_context`로 앞선 문답 확인 → 다음 질문 하나 결정 →
`ask_user` 호출 후 turn 종료. 정보가 충분해지면 `ask_user` 대신 `show_result`로 초안을 낸다.

### 확인된 것

**1. 블로킹하지 않는 설계가 맞았다.** MCP tool 타임아웃 문제를 피하면서 멀티턴 인터뷰가
성립한다. turn마다 깔끔히 끝나므로 사용자가 얼마나 오래 고민하든 상관없다.

**2. 초안이 설계한 형태로 나온다.** 프롬프트에 지시한 대로 화면 목록, "제가 정한 것"(AI가
채운 항목 표시), "넣지 않는 것"(DEC)이 모두 포함되었다. Claude는 AI가 정한 항목에 ⚠️ 표시까지
붙였다.

**3. 4개 질문으로 쓸 만한 초안이 나온다.** `requirements_flow.md` §4.9의 "최소 질문 4개 →
초안" 가정이 성립했다. Claude는 6개 화면과 그 안의 동작까지 제안했다.

**4. `why`와 `hints`가 실제로 유용하게 생성된다.** 예:

```text
❓ 새로운 친구를 데려오는 건 누가 할 수 있으면 좋을까요?
   why: "아무나 들어오는 건 싫다"고 하셨으니 문을 여는 사람이 누구인지 정해야 해요.
        방을 만든 사람만 초대할 수 있는지, 안에 있는 친구라면 누구나 데려올 수 있는지에
        따라 분위기가 꽤 달라지거든요. 마지막 질문이고, 다음엔 초안을 보여드릴게요.
   예) 방을 만든 나만 초대할 수 있으면 좋겠어요 / 안에 있는 친구면 누구나 데려와도 돼요 / ...
   진행: 4/4
```

기술 용어가 없고, 왜 묻는지와 언제 끝나는지가 모두 담겼다.

### 뜻밖에 검증된 것 — 엉뚱한 답변도 흡수한다

테스트 답변을 일부러 순서대로 넣다 보니 **질문과 답이 어긋난 turn이 생겼다.** agent는
"사진이 어떻게 묶이면 좋을까요"라고 물었는데 답변은 "사진 올리고, 댓글 달고, 좋아요"였다.

agent는 이것을 알아채고 초안에 이렇게 적었다.

```text
⚠️【제가 정한 것 1 — 앨범 없이 한 줄 피드】
   '사진이 어떻게 묶이면 좋을지' 여쭀을 때 답이 다른 쪽으로 와서, 일단 앨범 없이
   최신순 한 줄로 잡았습니다. 묶음이 필요하시면 말씀해 주세요.
```

`requirements_flow.md` §4.4가 가정한 **"사용자가 질문을 무시하고 하고 싶은 말을 해도
agent가 흡수하고 진행한다"**가 실제로 성립한다는 증거다. 의도한 테스트는 아니었지만
실제 사용자 행동에 더 가까운 상황이었다.

### 남은 것

- **철회 처리** — "아까 그건 취소"를 아직 다루지 않는다 (`requirements_flow.md` §4.4).
- **일곱 단위 추출** — 이번 검증은 질문 루프만 확인했다. 대화에서 ACTOR/REQ/SURFACE/ENTITY/
  FLOW/RULE/DEC이 구조화된 데이터로 실제 추출되는지는 확인하지 않았다. 초안 텍스트에는
  화면과 DEC이 자연어로 들어 있었으나 파싱 가능한 형태는 아니다.
- **harness 생성** — `app_design.md`, `AGENTS.md`, `CLAUDE.md`를 실제로 만드는 단계는
  구현하지 않았다.

> 이 프로토타입은 검증용이며 제품 코드가 아니다. 스택이 정해지면 새로 만들되
> **메커니즘만 가져간다.**

---

## 11. 남은 것 / 하지 않은 것

- **다중 동시 task** — 검토 완료, **현행 유지(필요 없음)**. Bridge는 의도적으로 한 번에 하나의
  task만 허용한다(409). 제품 설계(루트 `README.md`의 `AgentRuntime`, MVP 시나리오)가 프로젝트당
  순차적인 대화 하나를 전제하므로 동시 실행 요구사항 자체가 없다. 만약 나중에 필요해지면
  `show_result`에 taskId가 없다는 점(현재는 active task로 라우팅)부터 풀어야 한다.
- **윈도우 실기 검증** — Finding 9. 코드는 고쳤으나 실제 윈도우에서 돌려보지 못했다.
  Node.js + Codex CLI + Claude Code를 윈도우에 설치하고 `npm run acceptance`를 통과시켜야 한다.
- **Claude의 Bash 쓰기 범위 제한** — Finding 6. OS 샌드박스 검토는 하지 않았다.
- **acceptance에 Stop 시나리오가 없다** — Finding 7이 자동 검증을 빠져나간 이유다. 두 provider
  모두 Stop은 수동으로만 확인했다. 회귀 게이트에 넣는 편이 낫다.
- **Node.js 20+ 확인** — Phase B는 Node v18.19.1에서 검증했다. bridge·MCP server·acceptance는
  정상 동작하지만 `npm run web`(vite 8)은 20.19+를 요구하므로, 브라우저 UI를 띄우려면
  Node를 올려야 한다.
- **MCP tool 승인 UX** — 현재는 Bridge가 정책으로 자동 처리한다. 제품에서는 사용자에게
  노출해야 한다(Finding 1).
- **Agent가 무관한 파일을 읽는 경우** — 일부 run에서 Codex가 전역 skill 문서를 먼저 읽었다.
  동작에는 지장이 없었으나, 제품에서는 turn별 instruction 범위를 좁히는 편이 낫다.
