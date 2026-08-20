# CLAUDE.md

## 코딩 규칙

### 주석은 한글로 작성한다

이 저장소의 모든 코드 주석은 한글로 작성한다. 언어와 파일 형식을 가리지 않는다
(TypeScript, JavaScript, 설정 파일, 셸 스크립트 등).

```ts
// 좋음: Codex 0.147은 MCP tool 승인을 elicitation 채널로 보낸다.
//       approvalPolicy가 적용되지 않으므로 여기서 직접 응답해야 한다.

// 나쁨: Codex 0.147 routes MCP tool approval through the elicitation channel.
```

적용 범위와 예외:

- **주석 본문은 한글.** 서술은 한글로 쓴다.
- **식별자·타입명·프로토콜 용어는 원문 그대로.** `turn/start`, `AgentEvent`,
  `workspaceWrite` 같은 것을 억지로 번역하지 않는다. 한글 문장 안에 그대로 섞어 쓴다.
- **문서(`README.md`, `SPIKE_FINDINGS.md`)도 한글**로 쓴다. 코드 블록과 로그 발췌는 원문 유지.
- **커밋 메시지는 영문**을 유지한다.

### 커밋 · 브랜치 규칙

- 브랜치는 `prototype/<spike-name>` 형태로 만든다 (예: `prototype/byoa-mcp-spike`).
  아직 제품 코드가 시작되지 않았으므로 `main`은 항상 배포 가능한 상태(문서 + 검증된 spike)로 유지한다.
- 커밋은 **acceptance가 통과하는 단위**로 나눈다. 하나의 커밋 안에 spike 코드와
  검증 실패 상태를 같이 두지 않는다. Phase A/Phase B처럼 문서에 정의된 단계가
  끝났을 때 그 경계에서 커밋하는 것을 기본으로 한다.
- 동작(acceptance 결과)을 바꾸는 커밋은 같은 커밋 안에서 `SPIKE_FINDINGS.md`도 갱신한다.

## 프로젝트 구조

```text
docs/                      설계 문서 (제품 설계, 기술 검증 사양)
ontology/                  협업자 작업 — 완성된 코드베이스 시각화 (건드리지 않는다)
prototypes/byoa-mcp-spike/ BYOA + MCP 통합 검증 프로토타입 (Phase A·B·C 검증 완료)
```

아직 제품 구현은 시작하지 않았다. 루트 `README.md`의 "계획 중인 패키지 구조"는 목표이지
현재 상태가 아니다.

### 브랜치

| 브랜치 | 담는 것 |
| --- | --- |
| `main` | 설계 문서(`docs/`)와 협업자의 `ontology/`. **`prototypes/`는 없다** |
| `prototype/byoa-mcp-spike` | 위 전부 + `prototypes/` |
| `prototype/ontology` | 협업자 작업 |

**설계 문서는 `main`에, 프로토타입 코드는 브랜치에** 커밋한다. 한 커밋에 섞지 않는다.

### 새 세션이 읽어야 할 것

1. 이 파일 (자동 로드)
2. 루트 `README.md`의 "상태" — 지금 어디인지
3. `docs/requirements_flow.md` — 기능 3.1의 설계와 다음 할 일(§8)
4. `prototypes/byoa-mcp-spike/SPIKE_FINDINGS.md` — 무엇이 검증됐고 무엇이 함정인지

### 패키지 경계

`docs/BYOA_MCP_INTEGRATION_SPIKE.md` §4에 정의된 경계를 그대로 따른다. 코드를 어디에
추가할지 애매하면 이 경계를 기준으로 판단한다.

- **Web UI** (`apps/web`) — Codex/Claude의 raw 프로토콜 타입을 직접 참조하지 않는다.
  `packages/protocol`의 `AgentEvent`만 본다.
- **Local Bridge** (`apps/bridge`) — HTTP API, WebSocket, app state, agent adapter를 갖는다.
  provider별 raw 프로토콜을 다루는 유일한 층.
- **Agent adapter** (`apps/bridge/src/agents/<provider>`) — provider마다 디렉터리를 분리한다
  (`codex/`가 선례). Claude adapter를 추가할 때도 같은 패턴을 따른다.
- **MCP server** (`packages/mcp-server`) — stdio 전용. stdout은 MCP 프로토콜 전용이며
  일반 로그는 stderr로 보낸다.
- **Shared protocol** (`packages/protocol`) — 위 네 층이 공유하는 TypeScript 타입만 둔다.

## prototypes/byoa-mcp-spike

기술 검증용 spike이며 제품 코드가 아니다. 작업 전 다음을 지킨다.

- 사양은 `docs/BYOA_MCP_INTEGRATION_SPIKE.md`, 검증 결과와 발견 사항은
  `prototypes/byoa-mcp-spike/SPIKE_FINDINGS.md`에 있다. **결과를 바꾸는 변경을 했다면
  FINDINGS도 같이 갱신한다.**
- **모델 API를 직접 호출하지 않는다.** 추론은 사용자가 이미 설치·로그인해 둔 로컬
  coding agent(Codex CLI 등)가 담당한다. API key를 다루는 코드를 넣지 않는다.
- **세 통신 채널을 섞지 않는다.** Agent Control(HTTP → app-server JSON-RPC),
  Event Stream(WebSocket), MCP Tool(stdio MCP → loopback HTTP)은 각각의 역할이 있다.
- **브라우저에 provider 타입을 노출하지 않는다.** Codex 프로토콜 객체는 bridge에서
  `packages/protocol`의 `AgentEvent`로 정규화한 뒤에만 위로 올린다.
- **검증 결과를 위조하지 않는다.** MCP 호출을 mock하거나 bridge가 `show_result`를
  임의로 만들어내지 않는다. 막히면 `SPIKE_FINDINGS.md`에 기록한다.
- Codex 프로토콜이 문서와 어긋나면 설치된 CLI의 스키마를 기준으로 삼는다:
  `codex app-server generate-ts --out ./schemas`

### 절대 하지 않는 것

`docs/BYOA_MCP_INTEGRATION_SPIKE.md` §1.1, §22에 정의된 금지 목록. spike 범위를
"편의상" 넘어가고 싶어질 때 이 목록을 먼저 확인한다.

- OS-level keyboard automation, clipboard 붙여넣기 자동화
- 이미 열려 있는 Codex/Claude GUI 창을 찾아서 조작 (input 클릭, AppleScript/AutoHotkey 등)
- 임의의 기존 agent GUI 세션 hijack
- 로그인/회원가입, SaaS 백엔드, DB, billing, cloud deployment, multi-user, collaboration
- 정식 에디터, git worktree orchestration, prompt library, provider marketplace
- 데스크톱 패키징 (Tauri/Electron wrapping)
- 이 목록에 없는 "실제 제품 기능" 일반 — spike의 목표는 integration feasibility 검증 하나다.

### 현재 단계

| Phase | 내용 | 상태 |
| --- | --- | --- |
| A | Codex adapter | 2026-08-19 검증 완료 (acceptance 9/9) |
| B | Claude adapter | 2026-08-20 검증 완료 (acceptance 9/9) |
| C | 인터뷰 루프 (`ask_user`) | 2026-08-20 검증 완료 (`SPIKE_FINDINGS.md` §10) |

Phase C는 `docs/requirements_flow.md`가 설계한 요구사항 인터뷰의 핵심 가설을 확인한 것이다 —
"agent가 질문을 던지고 turn을 끝낸다 → 사용자가 답한다 → 다음 turn이 문맥을 이어받는다".
Codex·Claude 양쪽에서 성립했다.

**다음에 검증할 것**은 `docs/requirements_flow.md` §8에 있다. 가장 불확실한 것은
`save_design` 스키마(§4.11) — 일곱 단위가 대화에서 실제로 추출되지 않으면 설계 전제가 흔들린다.

두 adapter를 손댈 때 지켜야 할 것:

- Browser/Bridge protocol(`AgentEvent`, HTTP API, WebSocket)은 provider별로 분기하지 않는다.
  Web UI에 `if (agent === "claude")` 같은 분기가 생긴다면 Bridge/adapter 층으로 내려야 할 로직이다.
- **모델 API를 직접 호출하지 않는다** — Codex는 `codex app-server`, Claude는
  `@anthropic-ai/claude-agent-sdk`의 `query()`를 쓴다.
- provider 세부사항이 문서와 달라지면 최신 공식 문서/설치된 CLI를 기준으로 고치고
  `SPIKE_FINDINGS.md`에 차이를 기록한다.

Claude adapter가 Codex와 다른 지점 (`SPIKE_FINDINGS.md` §9에 표로 정리):

- **MCP 등록이 필요 없다.** `options.mcpServers`로 query마다 직접 넘기고
  `strictMcpConfig: true`로 사용자의 다른 MCP 설정을 격리한다. `npm run mcp:register`는
  Codex 전용이다.
- 도구 승인은 elicitation이 아니라 `canUseTool` 콜백으로 한다.
- **Codex의 `sandboxPolicy.writableRoots`에 해당하는 강제가 없다.** `canUseTool`에서
  Write/Edit 경로를 직접 검사하지만 **Bash로 프로젝트 밖에 쓰는 것은 막지 못한다**(Finding 6).
  이 격차를 `permissionMode: "bypassPermissions"`로 우회하지 말 것 — 더 벌어진다.

### Safety / Cleanup 불변조건

Phase A acceptance를 통과한 뒤에도 계속 유지해야 하는 조건이다. 이후 변경이 이 조건을
깨지 않는지 확인한다.

- Bridge와 MCP 서버는 `127.0.0.1`에만 bind (외부 네트워크에 공개하지 않음)
- Stop 버튼으로 active turn을 interrupt할 수 있어야 한다
- `npm run mcp:unregister`로 등록을 완전히 제거할 수 있어야 한다
- prototype 종료 후 child process가 남지 않는다
- project path는 canonicalize하고, 선택된 프로젝트 root 밖을 임의로 writable root로 추가하지 않는다
- API key를 브라우저 localStorage에 저장하지 않는다
- 사용자의 Codex/Claude 인증 credential을 직접 읽거나 복사하지 않는다
- 사용자의 전역 Codex/Claude 설정을 자동으로 덮어쓰거나 초기화하지 않는다 (등록은 helper script로만)

## 대회 운영규정

`docs/vibe_coding_assistant_design.md` §14에서 열어뒀던 "연동 테스트 범위가 상시 Agent 사용까지
포함하는지"는 운영사무국 서면 확인으로 해소되었다 (2026-08-20 회신).

확인된 내용:

- 제9조 2항 1호 다목의 제한 대상은 "GPT/Claude 등 상용 API 모델 호출 자체"가 아니라,
  **출품작의 핵심 기능이 로컬/독립 서버에서 구동되지 못하고 Closed API에 전적으로
  의존하는 구조인지 여부**다.
- **MCP, AI 에이전트 프레임워크, 라이브러리, 커넥터, 플러그인 등 연동/개발 보조 생태계
  자체를 구축하는 소프트웨어가 출품작의 주된 목적**이면 제9조 2항 1호 단서 및 별표2에
  따라 예외로 인정된다.
- 이 예외는 테스트/개발 과정의 연동 검증뿐 아니라, **소프트웨어의 기능 구현 및 정상적인
  사용 과정에서 발생하는 외부 Closed API 모델 호출까지 포함**한다.
- 단, **출품작 자체가 특정 Closed API 모델의 챗봇/서비스 제공을 주된 목적으로 하면 안 되고**,
  연동 인프라 구축이라는 목적에 부합해야 한다.
- 이 AI 모델 활용 기준(제9조, 별표2)은 2026년 신설 규정이며 작년 기준과 직접 비교할 수 없다.

따라서 다음 원칙은 계속 유지한다 (`docs/vibe_coding_assistant_design.md` §14, §15와 동일):

1. 특정 Closed Model 하나에 제품이 종속되지 않는다 (Agent Adapter로 provider 교체 가능).
2. MCP/Core/App 자체는 독립된 오픈소스 결과물로 동작한다.
3. 코드 분석·지식 저장·시각화 등은 가능한 한 LLM 없이도 동작한다.
4. 제품 포지셔닝은 "특정 모델로 OO를 만들어주는 앱"이 아니라 "선택한 AI coding agent를
   프로젝트 지식 계층과 연결하는 연동 인프라"로 유지한다.

## 자주 쓰는 명령

```bash
cd prototypes/byoa-mcp-spike
npm run build          # protocol → mcp-server → bridge → web
npm run build:server   # 서버 쪽만
npm run typecheck
npm run fixture          # tmp/fixture 재생성 (독립 git 저장소, gitignore 됨)
npm run acceptance       # 회귀 게이트(codex+claude). CLI 업데이트 후 필수
npm run acceptance codex # 하나만 (codex|claude)
npm run bridge           # 127.0.0.1:43120
npm run web              # 127.0.0.1:5173 (Node 20+ 필요)
npm run mcp:register     # codex mcp add byoa-spike — Codex 전용, Claude는 등록 불필요
npm run mcp:unregister
npm run sessions:cleanup # fixture에서 만들어진 테스트 세션만 삭제 (bridge 종료 후)
```

MCP 서버를 재등록했거나 포트를 바꿨다면 bridge를 재시작해야 Codex가 새 설정을 집어 온다.

## 검증 환경

Codex CLI 0.148.0 / Claude Code 2.1.237 (+ agent-sdk 0.3.237) / WSL2(Ubuntu)

Node.js는 Phase A가 v24.14.1, Phase B가 v18.19.1에서 검증되었다. bridge·MCP server·acceptance는
18에서도 동작하지만 `npm run web`(vite 8)은 20.19+를 요구한다.

이 spike는 provider의 스키마가 아니라 **동작**에 의존한다. 실제로 Codex 0.147 → 0.148
업데이트에서 `approvalPolicy: "never"`의 의미가 바뀌어 한 번 깨졌다. **CLI를 업데이트했다면
`npm run acceptance`부터 돌린다.** 대응 절차는 `SPIKE_FINDINGS.md` §8.
