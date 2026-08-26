# 테스트 방법

> 이 문서는 **MCP 채널(agent ↔ bridge) 자체가 도는지**만 진단하는 좁은 문서다. 전체
> 흐름(프로젝트 열기 → Analyze → Overview/Scenario/Trace 보기)을 써 보려면
> [how2use.md](./how2use.md)를 본다. 두 문서는 겹치지 않는다 — 여기는 "agent가 tool을
> 실제로 부르는가"만 본다.

## 준비

Node 20+ 가 필요하다. agent 는 **둘 중 하나만** 있어도 된다.

```bash
# Codex 를 쓸 경우
npm i -g @openai/codex && codex login

# Claude 를 쓸 경우
npm i -g @anthropic-ai/claude-code && claude    # 첫 실행에서 로그인
```

```bash
cd prototypes/ontology
npm install
npm run build
```

## 1. agent 없이 되는 것 — 지금 바로 확인 가능

```bash
npm test
```

전부 통과해야 한다(지금은 170개 — `npm test` 출력 마지막 줄이 정확한 숫자다).
여기에는 **MCP server 를 진짜 자식 프로세스로 띄워** stdio 로
`get_evidence` 를 부르고 그것이 loopback HTTP 로 bridge 에 닿는지 보는 시험이 포함된다
(`apps/bridge/test/mcp-channel.test.mjs`). 즉 **`bridge-endpoint` 증거원은 여기서 이미 증명된다.**

증명되지 않는 것은 `agent-stream` 절반 — "Codex/Claude 가 그 호출을 스스로 보고했는가" 다.
그것은 아래가 필요하다.

## 2. acceptance 2·3 — 두 증거원 모두

### 2-1. Codex 를 쓸 경우에만: MCP 등록

Claude 는 등록이 필요 없다 (query 마다 직접 전달한다).

```bash
npm run mcp:register
npm run mcp:status        # 등록 확인
```

`mcp:register` 가 실패하면 CLI 버전에 따라 플래그가 다를 수 있다. 스크립트가 수동 등록용
TOML 을 그대로 출력하므로 `~/.codex/config.toml` 에 붙여 넣으면 된다.

> **주의:** 등록에는 bridge 의 URL·토큰이 들어간다. bridge 설정(`.onto/bridge.json`)을 지웠거나
> 포트를 바꿨다면 **다시 등록해야 한다.**

### 2-2. bridge 를 띄운다 (창 1)

```bash
npm run bridge
```

`listening on http://127.0.0.1:43220` 이 나와야 한다.

### 2-3. acceptance 를 돌린다 (창 2)

```bash
npm run acceptance            # 설치된 agent 전부
npm run acceptance codex      # 하나만
npm run acceptance claude
```

기대 출력:

```text
=== codex ===
  [PASS] 프로젝트를 선택했다
  [PASS] verify turn 을 시작했다
  [PASS] task 가 오류 없이 끝났다
  [PASS] get_project_semantic_memory — agent 스트림 증거
  [PASS] get_project_semantic_memory — bridge 도달 증거
  [PASS] get_project_semantic_memory — 두 증거원이 모두 있다
  [PASS] get_evidence — agent 스트림 증거
  [PASS] get_evidence — bridge 도달 증거
  [PASS] get_evidence — 두 증거원이 모두 있다
  9/9 (codex)
```

**한쪽 증거원만 PASS 인 것이 가장 중요한 진단이다.**

| 증상 | 뜻 |
|---|---|
| agent 스트림만 PASS | agent 는 부르려 했는데 tool 이 실제로 돌지 않았다. 승인 정책이나 등록을 의심한다 (spike Finding 1·4 가 정확히 이 모양이었다) |
| bridge 도달만 PASS | 우리 이벤트 정규화가 agent 의 보고를 놓치고 있다 |
| 둘 다 FAIL | agent 가 tool 자체를 부르지 않았다. 등록(`npm run mcp:status`)부터 확인한다 |

## 3. 손으로 확인하기

```bash
# 창 1
npm run bridge

# 창 2
npm run fixture                      # tmp/fixture 를 새로 만든다
curl -s -X POST localhost:43220/api/project \
  -H 'content-type: application/json' \
  -d "{\"projectPath\":\"$PWD/tmp/fixture\"}"

# 인덱싱 + 분석 (agent 가 실제로 돈다)
curl -s -X POST localhost:43220/api/analyze \
  -H 'content-type: application/json' \
  -d "{\"agent\":\"codex\",\"projectPath\":\"$PWD/tmp/fixture\"}"

# 두 증거원 확인
curl -s localhost:43220/api/tasks/<taskId>/mcp-evidence | python3 -m json.tool
```

이벤트를 실시간으로 보려면:

```bash
npx wscat -c ws://127.0.0.1:43220/events
```

## 4. 이 문서가 보는 것과 안 보는 것

`npm run acceptance` 는 **채널 검증 전용 turn**(`POST /api/verify`)을 쓴다. agent 에게
"tool 두 개를 부르고 본 것을 요약하라"고만 시킨다 — Concept/Claim을 만들라고 시키지
않는다. 이것으로 확인되는 것은 좁고 정확하다:

- Evidence Index 가 fixture 에서 제대로 만들어지는가 (`get_evidence` 응답)
- agent 가 MCP tool 을 실제로 부르는가 (두 증거원 — 이 문서의 유일한 목적)
- 아직 분석하지 않은 프로젝트에서 tool 이 죽지 않고 안내를 주는가
- bridge 가 꺼져 있을 때 tool 이 읽을 수 있는 오류를 주는가

**`submit_semantic_patch`로 실제 Concept/Claim을 만들고, Overview/Scenario/Trace를
브라우저에서 보고, 코드 변경 후 증분 재분석하는 것은 전부 여기 범위 밖이다** —
[how2use.md](./how2use.md)를 본다. `npm run eval`이 그 흐름 전체(실제 patch 커밋 ·
View Planner · §46 안정성 관측)를 실제 agent turn으로 검증하는 스크립트다.

## 5. 정리

```bash
npm run mcp:unregister        # Codex 전역 설정에서 제거
rm -rf tmp/fixture .onto
```

## 결과를 알려줄 때

이것들이 있으면 진단이 빠르다.

```bash
codex --version   # 또는 claude --version
npm run mcp:status
```

그리고 `npm run acceptance` 의 출력 전체와, 실패했다면 bridge 창의 로그.
Codex 라면 `~/.codex/sessions/**/*.jsonl` 의 마지막 파일에 tool 호출의 원본 요청과 결과가
그대로 남는다 — spike 에서 결정적 단서가 거기서 나왔다.
