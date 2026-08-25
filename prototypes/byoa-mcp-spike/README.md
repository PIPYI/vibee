# BYOA + MCP Integration Spike

기술 검증용 프로토타입입니다. 제품 기능이 아니라 **아키텍처 가설 하나**를 실제 local coding agent로 증명하는 것이 목적입니다.

> 브라우저 UI에서 만든 프롬프트를 로컬에 설치·로그인된 coding agent에 전달하고,
> agent가 지정한 프로젝트 디렉터리에서 실제 작업을 수행하며,
> 진행 상황을 브라우저에 실시간 표시하고,
> agent가 MCP를 통해 앱 상태를 읽고 구조화된 결과를 앱에 push할 수 있는가?

**결과: Phase A(Codex) · Phase B(Claude) 모두 검증 성공.** 두 provider가 동일한 acceptance
9개 항목을 통과했고, Browser/Bridge protocol은 provider별로 분기하지 않습니다. 통과 기록과
도중에 발견한 프로토콜 이슈는 [`SPIKE_FINDINGS.md`](./SPIKE_FINDINGS.md)에 있습니다.

이 프로토타입은 **OpenAI/Anthropic 모델 API를 직접 호출하지 않습니다.** 추론은 전적으로
사용자가 이미 설치·로그인해 둔 Codex CLI / Claude Code가 담당합니다. API key 입력 UI도 없습니다.

---

## 세 개의 채널

이 spike의 핵심은 세 통신 경로를 섞지 않는 것입니다.

```text
A. Agent Control    Browser --HTTP--> Bridge --stdio JSON-RPC / Agent SDK--> agent
B. Event Stream     agent notifications --normalize--> Bridge --WebSocket--> Browser
C. MCP Tool         agent --stdio MCP--> MCP Server --loopback HTTP--> Bridge --WS--> Browser
```

A는 MCP가 아니고, C는 agent 실행 수단이 아닙니다. Bridge는 provider raw protocol과
브라우저 protocol 사이의 adapter이며, 브라우저는 Codex/Claude 타입을 전혀 보지 않습니다
(`packages/protocol`의 `AgentEvent` union만 봅니다).

```text
┌──────────────────────────┐
│ React Browser UI (:5173) │  Agent / Model / Effort / Project Path / Prompt
└────────────┬─────────────┘  Activity Log / Structured Result
             │ HTTP + WebSocket
             ▼
┌──────────────────────────┐
│ Local Bridge (:43120)    │  Task API, Agent Adapter,
│ 127.0.0.1 only           │  App State, WebSocket Event Hub
└───────┬──────────▲───────┘
        │          │ loopback HTTP (/internal/*, token 인증)
        ▼          │
┌──────────────┐   │   ┌────────────────────────┐
│ codex        │───┼──▶│ Prototype MCP Server   │
│ app-server   │ stdio │ get_app_context        │
│ cwd=project  │  MCP  │ show_result            │
└──────────────┘       └────────────────────────┘
```

---

## Prerequisites

- **Node.js 20+** — 브라우저 UI(Vite 8)에 필수입니다. bridge·MCP server·acceptance는 18에서도
  돌지만, npm 9로 설치하면 optional dependency 버그로 Vite 네이티브 바이너리가 빠집니다.
  Node 20+에서 `npm install`을 다시 하면 해결됩니다.
- **git** — 인계할 때 프로젝트를 로컬 저장소로 만들고, harness가 agent에게 자주 커밋하도록
  지시합니다. 사용자는 되돌리는 법을 모르므로 되돌릴 지점이 반드시 있어야 합니다.
  **원격 저장소는 쓰지 않습니다.**
- 쓰려는 agent 중 **하나 이상**이 설치·로그인되어 있을 것

> agent 앱이나 터미널을 **켜 둘 필요는 없습니다.** Bridge가 자기 자신의 agent 프로세스를
> 직접 띄우므로, 디스크에 저장된 로그인 자격증명만 있으면 됩니다. 옆에 Codex Desktop이나
> Claude Code를 열어 두어도 서로 간섭하지 않습니다 (문서 §1.1).

**플랫폼**: Linux / macOS / WSL2에서 검증되었습니다. 윈도우 네이티브는 코드상 대응만 되어 있고
**실기 검증이 남아 있습니다** — 절차와 알려진 제약은 `SPIKE_FINDINGS.md` Finding 9에 있습니다.

```bash
codex --version && codex login     # Codex를 쓸 경우 (검증 환경: codex-cli 0.148.0)
claude --version                   # Claude를 쓸 경우 (검증 환경: 2.1.238)
git --version                      # 되돌릴 지점을 남기는 데 필요합니다
```

Bridge는 시작 시 두 agent의 설치·인증 상태를 확인하고, 준비되지 않았다면 브라우저에
명확한 에러를 표시합니다. Bridge는 사용자의 credential을 직접 읽거나 복사하지 않습니다
(Codex는 app-server의 `account/read` 응답으로 인증 여부만 확인하며, 이메일 등은 브라우저로
보내지 않습니다).

Codex Desktop이나 Codex CLI, Claude Code를 옆에서 따로 띄워 두어도 무방합니다. 이 프로토타입은
기존 GUI 세션을 조작하지 않고 **자기 자신의 agent 세션**을 만들며, 같은 프로젝트 디렉터리를
cwd로 공유할 뿐입니다.

---

## Install / Build

```bash
cd prototypes/byoa-mcp-spike
npm install
npm run build          # protocol → mcp-server → bridge → web
```

서버 쪽만 다시 빌드하려면 `npm run build:server`.

---

## Register MCP

**Codex를 쓸 때만 필요합니다.** Claude adapter는 query마다 MCP server를 직접 넘기므로
등록이 필요 없습니다 (`SPIKE_FINDINGS.md` §9).

MCP server를 Codex에 등록합니다. **전역 Codex 설정을 몰래 수정하지 않습니다.**

```bash
npm run mcp:register
```

이 명령이 실제로 하는 일은 다음 한 줄이 전부입니다.

```bash
codex mcp add byoa-spike \
  --env BRIDGE_URL=http://127.0.0.1:43120 \
  --env BRIDGE_TOKEN=<로컬 토큰> \
  -- node <spike>/packages/mcp-server/dist/index.js
```

- `byoa-spike`라는 이름의 항목 **하나만** 추가합니다.
- 사용자의 기존 MCP 설정은 읽지도, 덮어쓰지도, 삭제하지도 않습니다.
- `BRIDGE_TOKEN`은 `.byoa-spike/bridge.json`(gitignore 됨, mode 0600)에 저장된 로컬
  전용 공유 비밀입니다. Bridge의 `/internal/*` 엔드포인트가 이 토큰을 요구하므로,
  loopback의 다른 프로세스가 앱 상태를 마음대로 읽거나 쓸 수 없습니다.

확인 / 제거:

```bash
npm run mcp:status       # codex mcp get byoa-spike
npm run mcp:unregister   # codex mcp remove byoa-spike (이 항목만)
```

---

## Run

터미널 두 개를 씁니다.

```bash
# 1) Bridge
npm run bridge
# [bridge] listening on http://127.0.0.1:43120

# 2) Web UI
npm run web
# http://127.0.0.1:5173
```

Fixture project를 만듭니다. **첫 테스트를 실제 저장소에 하지 마세요.**

```bash
npm run fixture          # 기본값 <spike>/tmp/fixture (gitignore 됨)
```

fixture는 **자체 git 저장소로 초기화**됩니다. 상위 저장소와 분리해야 agent가 실행하는
`git status` / `git diff`가 fixture만 보기 때문입니다. 다시 실행하면 파일 내용이 초기 상태로
되돌아갑니다(디렉터리는 지우지 않습니다 — Bridge thread의 cwd가 유지되어야 합니다).
경로를 인자로 주면 다른 위치에 만들 수도 있습니다: `npm run fixture ~/my-fixture`

브라우저에서:

| 필드 | 값 |
| --- | --- |
| Agent | Codex |
| Model | 기본값 |
| Effort | 기본값 |
| Project Path | `<spike>/tmp/fixture` |
| Mock App Selection | Login Screen |
| Prompt | `README.md의 마지막에 "Edited by BYOA agent." 를 추가해줘.` |

**Send**를 누릅니다.

Model·Effort 목록은 선택한 agent에게 직접 물어서 채웁니다(Codex는 `model/list`, Claude는
`supportedModels()`). 하드코딩이 아니므로 CLI를 업데이트하면 목록도 따라 바뀝니다.
둘 다 **기본값**으로 두면 아무것도 넘기지 않고 provider 기본 설정으로 돕니다.
effort를 지원하지 않는 모델(예: Claude `haiku`)을 고르면 Effort 선택이 잠깁니다.
자세한 내용은 `SPIKE_FINDINGS.md` §11.

### Expected result

Activity 패널:

```text
✓ Task started — <spike>/tmp/fixture
✓ MCP get_app_context called   [agent-stream]
✓ MCP get_app_context called   [bridge-endpoint]
▶ command   /bin/bash -lc 'tail -n 20 README.md ...'
✔ fileChange  <spike>/tmp/fixture/README.md
✓ MCP show_result called       [agent-stream]
✓ MCP show_result called       [bridge-endpoint]
✓ Task completed
```

Structured Result 패널(= `show_result`로 들어온 값, transcript와 분리):

```text
README 업데이트 완료
SUCCESS
선택된 프로젝트의 README.md 마지막에 요청한 문구를 새 줄로 추가했습니다.
Files changed: README.md
```

파일시스템:

```bash
cat <spike>/tmp/fixture/README.md
```
```text
# Spike Fixture

Original content.

Edited by BYOA agent.
```

**Stop** 버튼은 진행 중인 turn을 중단하고 `task.interrupted`를 표시합니다
(Codex는 `turn/interrupt`, Claude는 `AbortController`).

### 세션은 이어집니다

**Send를 반복해서 눌러도 새 대화가 시작되지 않습니다.** 두 adapter 모두 프로젝트 경로당 세션
하나를 만들어 Bridge가 사는 동안 재사용하므로, 두 번째 Send는 첫 번째 대화를 이어받습니다.
화면 하단에 `세션 xxx · turn N`으로 현재 상태가 표시됩니다.

새 대화로 시작하려면 **New Session**을 누릅니다. 세션 파일을 지우는 것이 아니라 Bridge가 들고
있던 참조만 버리므로, 이전 세션은 그대로 남아 CLI에서 이어받을 수 있습니다.

```bash
cd <프로젝트 디렉터리>   # 브라우저에서 지정한 Project Path

codex resume            # 목록에 그대로 나옴 (필터를 끄려면 codex resume --all)

claude -c                          # 이 디렉터리의 최근 세션 이어받기
claude --resume <session-id>       # ID를 지정해서 이어받기
```

두 CLI 모두 세션을 cwd 기준으로 분류하므로 그 프로젝트 디렉터리에서 실행해야 합니다.

> **Claude 주의**: SDK로 만든 세션은 `claude --resume`의 **목록에 나오지 않습니다**
> (`entrypoint: "sdk-cli"`로 기록되어 picker가 걸러냅니다). `-c`나 세션 ID를 직접 주면
> 정상적으로 이어받아집니다. 그래서 UI가 세션 ID를 표시하고 복사 버튼을 제공합니다.
> 자세한 내용은 `SPIKE_FINDINGS.md` Finding 8.

### 자동 검증

같은 시나리오를 사람 손 없이 확인하려면 (Bridge가 떠 있는 상태에서):

```bash
npm run acceptance          # codex, claude 둘 다
npm run acceptance codex    # 하나만
npm run acceptance claude
```

agent마다 acceptance criteria 9개를 검사하고 하나라도 어긋나면 비정상 종료합니다.
**CLI를 업데이트한 뒤에는 이것부터 돌리세요** — 이 spike는 스키마가 아니라 *동작*에
의존하며, 실제로 Codex 0.147 → 0.148 업데이트에서 한 번 깨졌습니다
(`SPIKE_FINDINGS.md` Finding 4, §8).

### 테스트 세션 정리

테스트를 반복하면 fixture 디렉터리에서 실행된 세션이 계속 쌓여 `codex resume` /
`claude --resume` 목록을 채웁니다. 그것만 골라 지우려면 (Bridge를 끈 상태에서):

```bash
npm run sessions:cleanup
```

`~/.codex/sessions`와 `~/.claude/projects`를 훑어 **세션의 `cwd`가 이 spike의 fixture 경로와
정확히 일치하는 것만** 지웁니다. 사용자가 자기 실제 프로젝트에서 만든 세션은 건드리지
않습니다. Bridge가 떠 있으면 사용 중인 세션을 건드릴 수 있으므로 실행을 거부합니다.

### MCP 호출을 어떻게 신뢰하는가

MCP 호출 여부는 **서로 독립적인 두 증거**로 확인합니다. UI의 `[agent-stream]` /
`[bridge-endpoint]` 태그가 각각 이것을 가리킵니다.

1. `agent-stream` — Codex 자신의 `item/started` 이벤트에 `type: "mcpToolCall"`,
   `server: "byoa-spike"`가 실린 것. Bridge가 만든 값이 아니라 agent가 보고한 값입니다.
2. `bridge-endpoint` — 별도 프로세스로 뜬 MCP server가 실제로 loopback HTTP로
   Bridge를 호출한 것.

둘 중 하나만 뜬다면 실패로 봐야 합니다. Bridge는 `show_result` 결과를 스스로 만들어내지
않으며, MCP 호출을 mock하지 않습니다.

---

## 실행 중인 작업은 어디서 보이나

Run으로 시작한 Codex 작업은 **사용자가 열어 둔 Codex CLI/Desktop 창에는 나타나지 않는다.**
Bridge가 자신의 `codex app-server`를 따로 띄우기 때문이며, 이는 의도된 동작이다(스펙 §1.1).

| 어디 | 무엇이 보이는가 |
| --- | --- |
| 브라우저 Activity 패널 | 정규화된 이벤트. 가장 정제된 뷰 |
| `npm run bridge` 터미널 | Codex stderr, MCP 승인 결정 등 raw 레벨 |
| `~/.codex/sessions/**.jsonl` | thread 전문. `originator: "byoa-mcp-spike-bridge"`로 구분 가능 |
| `codex resume` | 해당 thread를 CLI에서 이어받아 대화 계속 |

`codex resume`은 기본적으로 현재 cwd로 세션을 필터링하므로, 브라우저에서 지정한 프로젝트
디렉터리에서 실행해야 목록에 보인다.

```bash
cd <spike>/tmp/fixture && codex resume   # cwd 일치
codex resume --all                           # 아무 데서나. cwd 필터를 끄고 CWD 열을 표시
```

이어받은 세션에서도 `byoa-spike` MCP server는 그대로 붙지만, **Bridge가 떠 있지 않으면
`get_app_context` / `show_result`는 실패한다.**

반대로 **Bridge가 떠 있는 동안에는 그 Bridge가 쓰고 있는 thread를 resume 할 수 없다.**
Codex thread는 동시에 writer 하나만 허용하기 때문이다.

```text
thread ... already has an active writer (code -32600)
```

잠기는 것은 프로젝트당 최신 thread 하나뿐이므로, 이전 실행이 만든 thread는 그대로 열린다.
최신 thread를 열려면 Bridge를 먼저 종료한다. 자세한 내용은 `SPIKE_FINDINGS.md` §7.

## Stop / Cleanup

```bash
# 각 터미널에서 Ctrl+C
npm run mcp:unregister
```

Bridge는 SIGINT/SIGTERM에서 `codex app-server` child process를 정리합니다
(SIGTERM → 2초 후 SIGKILL). 종료 후 남는 프로세스가 없는 것을 확인했습니다.

---

## 요구사항 인터뷰 (docs/requirements_flow.md)

빈 프로젝트에서 설계도와 harness를 만들어 내는 플로우입니다. 검증 결과는
`SPIKE_FINDINGS.md` §12에 있습니다.

```text
[1] 인터뷰 시작   에이전트가 질문 하나를 던지고 turn을 끝냅니다 (ask_user)
        ↕         답하면 다음 turn이 자동으로 시작됩니다
[1] 초안          질문 4개쯤 뒤에 save_design으로 일곱 단위를 채웁니다
[2] 정리          "설계 초안" 패널에 이야기로 풀어쓴 설명이 나옵니다
        ↕         틀린 것이 있으면 입력창에 그냥 말하세요 — 초안이 고쳐집니다
[3][4] 인계       "이대로 시작하기"를 누르면 프로젝트에 파일이 생깁니다
```

인계하면 이렇게 남습니다. **선택한 agent의 harness만** 만듭니다.

```text
<프로젝트>/
├── app_design.md          설계도 (에이전트가 읽습니다)
├── AGENTS.md              Codex를 골랐을 때
│   또는 CLAUDE.md         Claude Code를 골랐을 때
└── .project-intel/
    └── design.json        일곱 단위 원본
```

이미 있는 파일에 `<!-- byoa:generated -->` 표식이 없으면 **덮어쓰지 않고 건너뜁니다.**
직접 쓴 `CLAUDE.md`가 날아가지 않습니다.

### 기존 대화 이어가기

**기존 대화 이어가기** 버튼을 누르면 이 프로젝트에서 나눈 대화 목록이 나옵니다. bridge를
껐다 켜도 세션은 디스크에 남아 있으므로 어제 하던 인터뷰를 오늘 이어받을 수 있습니다.
CLI(`codex` / `claude`)에서 시작한 대화도 같은 목록에 보입니다.

> 화면의 문답 기록은 bridge 메모리에만 있어서 이어받아도 되살아나지 않습니다. 에이전트
> 자신은 기억하고 있으므로 대화는 이어집니다 (`SPIKE_FINDINGS.md` §12 "남은 것").

### 검증

```bash
npm run interview          # codex, claude 순서로 인터뷰 → save_design 검증
npm run interview codex    # 하나만
```

`npm run acceptance`가 "MCP 채널이 살아 있는가"를 보는 것과 달리, 이쪽은 **산출물의 형태**를
봅니다 — FLOW에 순서가 있는지, ENTITY 관계가 도출됐는지, AI가 채운 항목이 표시됐는지.

## 드리프트 리뷰

인터뷰가 저장해 둔 DEC/RULE을 **코드 변경을 판정하는 기준으로** 씁니다
(`docs/vibe_coding_assistant_design.md` §3.3). PR 리뷰와 같은 모양이되, 보는 것이 범용
베스트프랙티스가 아니라 **이 프로젝트가 정한 것** 하나입니다.

diff는 bridge가 만들어 넘기므로 agent가 git을 돌리지 않습니다. 리뷰 turn은 읽기 전용이고
내장 도구도 프로젝트 문서도 없습니다 — **코드를 고치지 않습니다.** 어긋난 것을 고치는 일은
사용자가 쓰는 agent가 합니다.

**검출은 절반입니다.** finding이 나오면 그것을 고칠 프롬프트("해소 프롬프트")를 렌더해
화면에서 복사할 수 있게 합니다. 어느 쪽이 맞는지는 이 앱이 정하지 않습니다 — 프롬프트가
두 선택지를 함께 주고, 판단과 실행은 그 프롬프트를 받은 옆 agent가 합니다: 코드가 틀렸으면
코드를 고치고, 결정이 낡았으면 `.project-intel/design.json`의 그 항목만 고칩니다.

**리뷰의 단위는 커밋 하나**입니다. 커밋은 변하지 않으므로 한 번 본 것을 다시 볼 이유가 없고,
범위(`base..HEAD`)로 보면 커밋이 늘 때마다 앞의 것까지 다시 읽어 비용이 곱해집니다.
어디까지 봤는지는 `.project-intel/reviews.json`에 남습니다.

| 순서 | 어디부터 보는가 |
| --- | --- |
| 1 | 마지막으로 리뷰한 커밋 다음부터 |
| 2 | `design.json`이 들어온 커밋 다음부터 — **설계보다 앞선 커밋은 판정 대상이 아닙니다** |
| 3 | 최근 50개 (설계가 아직 커밋되지 않은 경우의 안전판) |

```bash
npm run drift              # codex, claude 순서로 모두
npm run drift codex        # 하나만
npm run drift codex 3      # 3회 반복
```

검증은 위반 커밋과 무해 커밋을 **한 리뷰에 같이 넣습니다.** 따로 돌리면 "무언가를 찾아냈다"만
재게 되고, 같이 넣어야 **둘을 구분했다**를 잴 수 있습니다. 무해 커밋에는 중복 로직·매직 넘버
같은 **일반 리뷰거리를 일부러 심어 뒀습니다** — 범용 코드 리뷰를 하고 있다면 거기서 걸립니다.

결과와 함정은 `SPIKE_FINDINGS.md` §15에 있습니다.

## 위키

바이브코딩 대화에서 비전공자가 모를 만한 말을 골라 **이 프로젝트 기준으로** 설명합니다
(`docs/vibe_coding_assistant_design.md` §3.5). **순수 학습용입니다** — "이건 위험합니다",
"X가 낫습니다" 같은 평가는 하지 않습니다. 그건 드리프트 리뷰의 몫입니다.

**후보 키워드는 agent가 고릅니다.** 처음에는 빈도로 뽑으려 했는데 실패했습니다 — 실제
대화에서 가장 자주 나온 말은 `wait`, `getting`, `turn` 같은 것들이었습니다. 빈도는 낯섦과
반대 방향입니다. "모를 만한 말"은 판단이라 코드에 맡길 수 없습니다.

```bash
npm run wiki              # codex, claude 순서로 모두
npm run wiki codex        # 하나만
```

검증은 실제 바이브코딩 turn을 한 번 돌려 대화를 만든 뒤, 그 대화에서 키워드를 뽑고 페이지를
씁니다 — 무엇이 궁금할지는 인터뷰나 리뷰처럼 미리 준비해 줄 수 없고, 실제로 코딩을 해봐야
나옵니다. 판정은 결정적으로 잡습니다 — 근거(`where`)가 이 프로젝트에 실재하는 파일이나
REQ/DEC id를 가리키는지, 읽는 사람의 언어로 썼는지, 권고·평가 표현이 없는지.

페이지는 `.project-intel/wiki/`에 JSON(원본)과 마크다운(파생물)을 함께 냅니다. Notion·
Obsidian 같은 도구를 직접 연동하지 않는 이유이기도 합니다 — `.md`가 있으면 그런 도구가
이미 그대로 동작합니다.

결과와 함정은 `SPIKE_FINDINGS.md` §16에 있습니다.

## 아키텍처·기술부채

이미 완성된 코드베이스에서 여러 커밋에 걸쳐 조금씩 쌓인 구조 문제를 점검합니다. 범용
아키텍처 리뷰가 아니라 사용자가 실제로 겪은 다음 세 가지에만 집중합니다.

| 검출 대상 | 코드가 먼저 준비하는 것 | agent가 판단하는 것 |
| --- | --- | --- |
| 한 파일에 쌓인 책임 | 파일 크기 + 설계 REQ/ENTITY 매핑 | 설계 경계를 실제로 넘었는가 |
| 의미가 같은 로직 중복 | 함수/메서드 시그니처와 위치 | 표현은 달라도 같은 일을 하는가 |
| 방치된 임시 조치 | TODO/임시 마커 + git blame 나이 | 후속 코드가 쌓여 제거가 어려워졌는가 |

**크다, TODO가 있다**만으로 finding을 만들지 않습니다. agent는 준비된 목록을 받은 뒤 관련
파일만 열어 의미를 확인합니다. 결합도·응집도·순환 의존·레이어 위반과 스타일 평가는 현재
범위 밖입니다.

각 finding에는 사용자 영향·구체적 근거·관련 설계 id·다음 행동이 나오며, **해소 프롬프트
복사**로 같은 프로젝트를 공유하는 Codex/Claude Code에 리팩터링을 맡길 수 있습니다. 분석
turn은 `mode: "architecture"`의 새 세션에서 읽기 전용으로 실행됩니다. 앱은 소스 코드를
고치지 않고 현재 snapshot을 `.project-intel/architecture.json`과 `architecture.md`에
저장합니다. 다음 실행이 두 파일을 덮어쓰며 추세는 git 이력이 대신합니다. Wiki·Drift 등
다른 기능의 상태는 초기화하지 않습니다.

```bash
npm run architecture              # codex, claude 순서로 모두
npm run architecture codex        # 하나만
```

실제 두 provider로 전체 경로를 통과한 결과(13/13)와 아직 검증하지 않은 범위는
`SPIKE_FINDINGS.md` §17에 있습니다.

## Layout

```text
prototypes/byoa-mcp-spike/
├─ apps/
│  ├─ bridge/                HTTP API + WebSocket hub + agent adapters
│  │  ├─ src/agents/codex/   app-server JSON-RPC client + event normalizer
│  │  └─ src/agents/claude/  Agent SDK query() + event normalizer
│  └─ web/                   React + Vite UI
├─ packages/
│  ├─ protocol/              브라우저·bridge·MCP가 공유하는 타입
│  └─ mcp-server/            stdio MCP server (context/result/architecture tools)
├─ scripts/                  register/unregister/status/fixture/acceptance/cleanup
├─ SPIKE_FINDINGS.md         검증 결과와 Findings
└─ README.md
```

---

## Security notes

- Bridge와 MCP server 모두 `127.0.0.1`에만 bind하며 외부에 노출되지 않습니다.
- `/internal/*`는 `x-byoa-token` 헤더로 보호됩니다.
- Project path는 `realpath`로 canonicalize하고, 존재하지 않거나 디렉터리가 아니면 거부합니다.
- Codex turn은 `sandboxPolicy.workspaceWrite`로 실행되며 `writableRoots`는 **선택한
  프로젝트 디렉터리 하나**입니다.
- 승인 정책은 granular 형태로 **MCP elicitation만 켜고** 나머지는 끕니다. MCP tool 승인은
  이 spike가 등록한 `byoa-spike` 서버에 대해서만 자동 수락하고, 사용자가 따로 설정해 둔 다른
  MCP 서버의 승인 요청은 거부합니다 (`SPIKE_FINDINGS.md` Finding 1, 4).
- API key를 브라우저 localStorage에 저장하지 않습니다. 애초에 API key를 다루지 않습니다.

---

## Troubleshooting

| 증상 | 원인 / 해결 |
| --- | --- |
| `Codex is not ready. Please log in` | `codex login` 실행 후 Bridge 재시작 |
| `Bridge is not reachable` | `npm run bridge`가 떠 있는지, 43120 포트가 비어 있는지 확인 |
| MCP 호출이 `[agent-stream]`만 뜨고 `[bridge-endpoint]`가 없음 | MCP server가 Bridge에 못 붙는 상태. `npm run mcp:status`로 `BRIDGE_URL`/`BRIDGE_TOKEN`이 `.byoa-spike/bridge.json`과 맞는지 확인하고, 토큰을 재생성했다면 `npm run mcp:register`를 다시 실행 |
| MCP 호출이 아예 없음 (Codex) | `npm run mcp:status`로 등록 확인. 등록 후 Bridge를 재시작해야 Codex가 새 서버를 집어 옵니다. bridge 로그에 `unknown MCP server 'byoa-spike'`가 보이면 이 경우입니다 |
| `A task is already running` | 이 spike는 동시에 한 개의 task만 허용합니다. Stop을 누르거나 끝날 때까지 대기 |
| 포트를 바꾸고 싶음 | `BRIDGE_PORT=... npm run bridge` 후 `npm run mcp:register` 재실행 |

Codex 버전이 달라 protocol이 어긋나면 현재 설치된 CLI의 schema를 기준으로 맞춥니다.

```bash
codex app-server generate-ts --out ./schemas
```

다만 스키마 재생성으로 잡히는 것은 *필드 모양* 변화뿐입니다. 값의 *의미*가 바뀌는 변화는
`npm run acceptance`로만 잡힙니다. 자세한 대응 절차는 `SPIKE_FINDINGS.md` §8.
