# Findings

`docs/ontology/implementation_plan.md`는 **FROZEN**이다. 구현하다가 계획과 현실이 어긋나면
계획을 임의로 고치지 않고 여기에 적는다. 형식은 implementation_plan §8을 따른다.

```text
## Finding N — <한 줄 요약>

### 관찰
무엇을 하려다 무엇이 어긋났는가. 재현 가능한 형태로.

### 계획의 어느 부분과 충돌하는가
implementation_plan.md의 절 번호를 그대로 인용한다.

### 필요한 변경 후보
하나 이상. 각각의 대가와 무엇을 깨뜨리는지 함께.

### 지금 택한 우회
계획 안에서 진행할 수 있는 방법이 있으면 그것. 없으면 "막힘"이라고 적고 멈춘다.
```

---

## 검증 환경

| 항목 | 값 |
| --- | --- |
| 시작일 | 2026-08-22 |
| OS | macOS (darwin 25.5.0) |
| Node.js | v24.13.0 |
| npm | 11.6.2 |

---

## M0 — 저장 구조와 protocol (진행 중)

계획 §8이 M0에 요구한 것: `docs/ontology/implementation_plan.md` 저장, 모노레포 스캐폴딩,
`@onto/protocol` 타입 + schema, generation/pointer Store, **acceptance 19 통과**.

현재 상태:

- [x] 계획을 `docs/ontology/implementation_plan.md`로 저장 (FROZEN 표시 포함)
- [x] npm workspaces 모노레포 (`packages/protocol`, `packages/core`)
- [x] `@onto/protocol` 타입 — Evidence · EvidenceDiff · SemanticWorkSet · Semantic Memory ·
      Patch · View IR (Overview / Scenario / Trace)
- [x] `@onto/core` generation commit + atomic HEAD switch
- [x] **acceptance 19** — HEAD switch 직전 실제 SIGKILL 후 이전 generation이 온전히 읽히고
      고아 generation이 청소된다 (`packages/core/test/store.test.mjs`)
- [ ] JSON Schema (`packages/protocol/schemas/`) — ajv 검증은 M4에서 Validator와 함께 붙인다

---

## M1 — Evidence Engine P0~P1 + ID/freshness + EvidenceDiff (완료)

계획 §8이 M1에 요구한 것: acceptance 1·18c, 그리고 16·17의 engine 절반.

- [x] `@onto/evidence` — P0(file / symbol), P1(contains / call / reference)
- [x] 주소 기반 evidence id (R1) — 줄 번호가 들어가지 않는다
- [x] link evidence id를 `linkKind + fromEntityKey + toEntityKey + localNormalizedFingerprint`로 (U3)
- [x] `rawHash` + `normalizedFingerprint` + `normalizationProfile` (T1 · S1) — **engine·agent 모두**
- [x] `EvidenceDiff`를 두 축(`contentChange` × `relocated`)으로 (V3)
- [x] `buildWorkSet` — `ungroundedAppearedEvidenceIds` 포함 (U1)
- [x] acceptance 1 · 16(engine) · 17(engine) · 18b · 18c
- [ ] 증분 `updateFiles` — 계획 §8이 M5로 두었다. 지금은 전체 인덱싱 2회 + `diffEvidence`로
      같은 결과를 얻는다

### 18c가 제대로 걸려 있는지 확인한 방법

통과가 너무 쉬워서 mutation check를 돌렸다. `linkEvidenceBaseId`에서
`localNormalizedFingerprint`를 빼고 위치 기반으로 되돌리자 **18c만 실패**했고 나머지 8개는
통과했다. 지문이 호출부를 실제로 구별하고 있다는 뜻이고(세 call id에 ordinal suffix가 붙지
않는다), 시험이 의도한 것을 잡는다는 뜻이다.

### 알려진 한계 (계획이 받아들인 것)

바이트 수준으로 구별되지 않는 중복 호출부는 충돌 그룹 안에서 ordinal을 받으므로, 동일한
중복을 앞에 끼워 넣으면 그룹 안에서 밀린다. 다른 곳의 링크에는 영향이 없다.
`packages/evidence/test/normalize.test.mjs`에 그대로 시험으로 박아 두었다.

`code` 프로파일은 **주석만 바뀐 변경을 `cosmetic`으로 놓친다**(거짓 음성). 이것도 시험에
명시해 두었고, `prose` 프로파일이 그 대비책이다. 어떤 evidence에 어느 프로파일이 붙어야
하는지는 M2에서 config/문서 adapter를 붙일 때 실제로 시험된다.

아직 Finding 없음 — 계획과 충돌한 것이 없다.

---

## M2 — Evidence Engine P2~P3 + entity/link schema + projectTrace (완료)

계획 §8이 M2에 요구한 것: acceptance 12·13·13b·14.

- [x] P2 adapters — `next-app-router` · `next-pages-api` · `express` · `react-jsx-events` ·
      `prisma-schema` · `prisma-calls` · `project-config`. 각각 throw하지 않고 실패는
      `adapterReport`에 남는다 (C1)
- [x] P3 `git_change` + `changedFilesSince` / `dirtyFiles` — git이 modified라 해도
      contentHash가 같으면 dirty가 아니다 (C2)
- [x] entity/link schema (T2) — `EntityRef` 4종(file/symbol/route/model), evidence kind별
      entity/link 역할 확정. `graph`가 없는 evidence(config, git_change)는 grounding은 되지만
      Trace에 나오지 않는다
- [x] `projectTrace` — BFS(경계·hop) / SCC(cycle) / hop 비교(nonForward) 분리 (S4 · U2)
- [x] acceptance 12 · 13 · 13b · 14

### 13b가 제대로 걸려 있는지 확인한 방법

M1의 18c와 같은 방식으로 mutation check를 돌렸다. `cycle` 판정을 SCC에서
`hop(to) <= hop(from)`으로 되돌리자 **13과 13b만 실패**했고 나머지 8개는 통과했다.
두 방향 모두 잡힌다 — 13b는 DAG를 cycle로 오판하는 것을, 13은 진짜 cycle을 놓치는 것을.

### 구현 중 고친 것 (계획과 무관한 자체 결함)

- `commit()`이 돌려주는 `generation`이 한 세대 뒤처졌다 (M0). `LoadedState.generation`이
  스냅샷 클론에 섞여 들어가 반환값 spread에서 새 값을 덮어썼다. 디스크 상태는 정확했다.
- `normalize.ts`의 토큰 구분자가 소스에 **raw 제어문자**로 들어가 있었다. 동작은 했지만
  편집기·도구가 다루기 어려우므로 `"\u0001"` 이스케이프로 바꿨다.
- adapter가 `route`/`model` entity id를 만들 때 쓰는 sha1 헬퍼가 지저분하게 들어갔다가
  `node:crypto` top-level import로 정리했다.

### fixture가 실제로 P0~P2를 덮는지 확인한다

`packages/evidence/test/adapters.test.mjs`의 마지막 시험이 `file · symbol · contains ·
call · route · api_handler · ui_event · db_entity · db_read · db_write · config` 각각이
0보다 큰지 검사한다. 덮지 않으면 그 위의 시험들이 헛도는 것이므로 명시적으로 건다.

Finding 없음 — 계획과 충돌한 것이 없다.

---

## M3 — MCP server + bridge + agent adapter (부분 완료)

계획 §8이 M3에 요구한 것: **acceptance 2·3 — 두 증거원이 모두 관측된다.**

### ⚠️ 이 머신에서 검증하지 못한 것

**acceptance 2·3의 `agent-stream` 절반은 검증하지 못했다.** 이 머신에 `codex`·`claude` CLI가
설치되어 있지 않다 (`command -v` 둘 다 없음). 진짜 agent turn 없이는 "agent가 그 호출을
스스로 보고했다"를 확인할 방법이 없다.

두 증거원을 분리해 둔 이유가 정확히 이것이므로, 한쪽만 보고 "MCP는 돈다"고 적지 않는다.

| 증거원 | 뜻 | 상태 |
|---|---|---|
| `bridge-endpoint` | agent가 띄운 별도 프로세스가 실제로 bridge에 도달했다 | **검증됨** — `apps/bridge/test/mcp-channel.test.mjs`가 MCP server를 진짜 자식 프로세스로 띄우고 stdio MCP 프로토콜로 `get_evidence`를 호출해, 그것이 loopback HTTP로 bridge에 닿는 것을 확인한다 |
| `agent-stream` | Codex/Claude가 그 호출을 보고했다 | **미검증** — CLI 필요 |

검증 절차는 `TESTING.md`에 있다. 요약하면 `npm run mcp:register`(Codex만) →
`npm run bridge` → `npm run acceptance`이고, 두 증거원을 **따로** 보고하므로
한쪽만 PASS인 것이 곧 진단이 된다.

### 완료한 것

- [x] `apps/bridge/src/platform.ts` — **OS 차이를 아는 유일한 모듈.**
      `resolveAgentExecutable` · `cliSpawnOptions` · `killTree` · `probeAgentVersion` · `onShutdown`
- [x] `@onto/mcp-server` — stdio MCP, 상태 없음, 전부 loopback 위임. lazy/degraded mode(C5),
      instructions에 질문↔tool 매핑(C6)
- [x] `apps/bridge` — HTTP + WS + `/internal/*` 토큰 가드, 커밋 1(재인덱싱)과 커밋 2 분리(V1)
- [x] `CodexAdapter` — granular approval policy(B3), 우리 서버 이름만 elicitation 수락
- [x] `ClaudeAdapter` — SDK를 **선택적 런타임 의존성**으로. 없어도 빌드되고 `checkReady()`가
      정직하게 보고한다
- [x] platform 경계 강제 시험 — `process.platform`이 platform.ts 밖에 있거나 MCP server가
      OS를 알거나 CLI 이름을 직접 spawn하면 **시험이 실패한다**

### 시험이 잡아낸 것

`loadBridgeConfig`가 `ONTO_BRIDGE_TOKEN`을 읽지 않아 bridge와 MCP server가 서로 다른 토큰을
쓰고 loopback이 401로 끊겼다. **양쪽이 같은 함수를 거치게 한 이유가 바로 이것인데 env를
빠뜨렸다** — "같은 함수를 쓴다"는 사실만으로는 아무것도 보장되지 않는다는 것을 보여준다.
두 프로세스로 실제로 돌려보지 않았다면 발견하지 못했을 종류의 결함이다.

### 미검증으로 남는 것 (CLI가 있는 머신에서 확인해야 함)

- `CodexAdapter` / `ClaudeAdapter`의 turn 실행 경로 전체. `checkReady()`가 "설치되지 않음"을
  올바르게 보고하는 것만 확인했다.
- Codex의 granular approval policy가 현재 CLI 버전에서 의도대로 도는지. spike에서 두 번
  깨진 지점이므로 CLI 업데이트 후 가장 먼저 확인해야 한다.
- Stop → `task.interrupted` (acceptance 20).

Finding 없음 — 계획과 충돌한 것이 없다. 위는 환경 제약이지 설계 문제가 아니다.

### M3 마무리 — 사용자 검증을 위해 추가한 것

`agent-stream` 절반을 사용자가 확인할 수 있게 하려면 빠진 것이 있었다.

- `scripts/register-codex-mcp.mjs` · `unregister` · `mcp-status` — Codex 전역 등록.
  **`~/.codex/config.toml`을 직접 편집하지 않는다** — 형식이 버전마다 바뀔 수 있고 사용자의
  다른 설정을 망가뜨릴 수 있으므로 CLI가 자기 파일을 소유하게 두고, 실패하면 수동 등록용
  TOML을 그대로 출력한다.
- `scripts/create-fixture.mjs` — 팔로우/승인 도메인의 작은 앱. P0~P2를 전부 덮고 도메인
  용어가 분명해 사람이 눈으로 채점할 수 있다.
- `scripts/acceptance.mjs` — 두 증거원을 **따로** 검사한다. 한쪽만 PASS인 것이 가장 중요한
  진단이므로 합쳐서 보고하지 않는다.
- `POST /api/verify` — **채널 검증 전용 turn.** `submit_semantic_patch`가 M4라서, 분석
  프롬프트를 그대로 쓰면 agent가 의미를 만들어 놓고 낼 곳이 없어 혼란스러운 결과를 낸다.
  이 경로는 tool 두 개를 부르고 요약만 시킨다 — 증명하려는 것이 의미 품질이 아니라 배선이다.

### 시험이 잡아낸 것 (두 번째)

`loadBridgeConfig`가 env로 완전히 지정된 경우에도 디스크에 설정을 **썼다.** 그 결과
`mcp-channel.test.mjs`가 쓰는 시험용 포트(43871)가 `.onto/bridge.json`에 새어 들어가
개발자의 bridge 포트를 조용히 바꿔 놓았다. `npm run mcp:status`를 돌려 보고 발견했다.

env로 완전히 지정되면 쓰지 않도록 고쳤다. 시험이 공유 상태를 오염시키는 종류의 결함이라
그대로 두면 "왜 갑자기 등록이 안 맞지"로 나타났을 것이다.

---

## Finding 1 — granular 승인 정책이 `experimentalApi` capability를 요구하게 되었다

### 관찰

사용자 머신(macOS, codex 설치됨)에서 `npm run acceptance codex` 실행:

```text
[PASS] 프로젝트를 선택했다
[PASS] verify turn 을 시작했다
[FAIL] task 가 오류 없이 끝났다 — askForApproval.granular requires experimentalApi capability (code -32600)
[FAIL] get_project_semantic_memory — agent 스트림 증거
[FAIL] get_evidence — bridge 도달 증거
...
2/9 (codex)
```

MCP 등록 자체는 정상이었다 (`codex mcp list`에 `onto`가 `enabled`로 보였다).
`thread/start`가 거부되어 turn이 아예 시작되지 못했으므로 tool 호출이 하나도 없었다.

### 계획의 어느 부분과 충돌하는가

충돌하지 않는다. implementation_plan §6.9의 **B3**는 여전히 옳다 —
`approvalPolicy: {granular: {mcp_elicitations: true}}`를 쓰라는 지시는 유지된다.
빠진 것은 그 정책의 **전제 조건**이었다: `initialize`에서 `experimentalApi` capability를
선언해야 한다. byoa spike(codex 0.148) 당시에는 요구되지 않았다.

이것은 §8이 예고한 종류의 파손이다 — **스키마가 아니라 요구 조건이 바뀌었고, 타입 검사로는
잡히지 않는다.** spike에서 두 번(Finding 1·4) 같은 계열의 파손을 겪었다.

### 적용한 수정

1. `initialize`에 `capabilities: { experimentalApi: true }`를 실는다.
2. 그래도 거부되면 **조용히 물러서지 않고 명확히 실패한다.**

두 번째가 중요하다. 포괄적 값(`"never"`)으로 물러서는 것이 자연스러워 보이지만,
spike Finding 4가 확인했듯 0.148은 `"never"`를 "MCP 호출도 거부"로 해석했다. 물러서면
**tool이 한 번도 돌지 않는데 turn은 성공한 것처럼 끝난다** — 정확히 우리가 막으려는
조용한 실패다. 그래서 무엇이 왜 안 되는지 말하고 멈추며, `npm run codex:probe`를 가리킨다.

### 추가한 진단 도구

`scripts/codex-probe.mjs` (`npm run codex:probe`).

capability의 정확한 형태를 **추측하지 않기 위해** 만들었다. 이 스크립트는
(1) codex 버전을 기록하고 (2) `codex app-server generate-ts`로 프로토콜 스키마를 받아
`experimentalApi` · `ClientCapabilities` · `AskForApproval` · `granular` 심볼을 찾고
(3) capability 선언 형태 네 가지를 **실제로 시도해** 어느 것이 통하는지 보고한다.

CLI가 또 바뀌었을 때 가장 먼저 돌릴 것이다. §8의 "rollout 파일을 먼저 본다"와 같은 목적이다.

### 확인됨 (codex-cli 0.149.0, `npm run codex:probe`)

```ts
export type InitializeCapabilities = { experimentalApi: boolean, ... };
```

`capabilities.experimentalApi = true` 만 통한다. 최상위 `experimentalApi`,
`capabilities.experimental`, `clientCapabilities.experimentalApi` 는 모두 거부되었다.

---

## Finding 2 — 0.149 프로토콜 확인 결과와, 오류 메시지가 가리킨 엉뚱한 곳

### 관찰

capability 를 고친 뒤 다음 오류가 났다.

```text
[FAIL] task 가 오류 없이 끝났다 — Invalid request: invalid type: map, expected a sequence (code -32600)
```

`invalid type: map, expected a sequence` 는 `turn/start` 의 `input` 을 가리키는 것처럼 보였다.
실제로 `input` 도 틀려 있었지만 **그것이 원인의 전부가 아니었다.**

프로브에서 `input: [{type:"text", text}]` 로 고치자 오류가
`missing field \`threadId\`` 로 바뀌었다 — threadId 를 분명히 넘기고 있었는데도.
`thread/start` 의 raw 응답을 찍어 보니 이유가 드러났다.

```json
{"thread":{"id":"01a0276f-...","sessionId":"...","path":"...","cwd":"..."}, "model":"gpt-5.6-sol", ...}
```

**`{ threadId }` 가 아니라 `{ thread: { id } }` 였다.** `started.threadId` 가 `undefined` 가
되어 JSON 에서 통째로 빠졌고, serde 는 타입 오류(`input` 이 map)를 **먼저** 만나 그것만
보고했다. `missing field` 는 맵을 다 소비한 뒤에야 보고되므로, `input` 을 고치기 전까지
진짜 원인이 보이지 않았다.

### 교훈

**`undefined` 를 다음 호출로 흘려보내면 오류 메시지가 엉뚱한 곳을 가리킨다.**
`extractThreadId()` 를 두어 후보 위치를 훑되, 못 찾으면 받은 응답을 그대로 보여주며
즉시 실패하게 했다. 그랬다면 첫 실행에서 "thread id 를 찾지 못했습니다: {...}" 가 나왔을 것이다.

### 확인된 0.149.0 프로토콜 사실

| | 확인된 형태 |
|---|---|
| `initialize` | `{ clientInfo, capabilities: { experimentalApi: true } }` |
| `thread/start` 응답 | `{ thread: { id, sessionId, path, cwd, ... }, model, ... }` |
| `turn/start` input | `Array<UserInput>`, `UserInput = { type: "text", text }` — `type` 필수 |
| `AskForApproval` | `"untrusted" \| "on-request" \| { granular: {...} } \| "never"` |

### 함께 드러난 것 — `sandboxPolicy` 가 조용히 무시되고 있었다

`thread/start` raw 응답에 `sandbox.writableRoots` 가 **비어 있었다.**
`sandboxPolicy: { type: "workspaceWrite", writableRoots: [projectPath] }` 를 넘겼는데도.

스키마를 보면 이유가 분명하다 — `ThreadStartParams` 에는 `sandboxPolicy` 가 **없다**
(`sandbox?: SandboxMode` 뿐이다). 정책 객체는 `TurnStartParams.sandboxPolicy` 에 있다.
알 수 없는 필드는 조용히 버려지므로 **쓰기 범위를 제한하려던 의도가 그대로 사라졌다.**

`turn/start` 로 옮겼다. 이것은 acceptance 를 통과시키는 것과 무관한 수정이지만, 조용히
무시되는 보안 파라미터를 그대로 둘 수 없다 — 정확히 우리가 경계하는 "조용한 성공"이다.

### 결과 — acceptance 2·3 통과 (codex-cli 0.149.0)

```text
12/12 (codex)   3회 연속 재현
```

`agent-stream`과 `bridge-endpoint` 두 증거원이 `get_project_semantic_memory`와
`get_evidence` 양쪽에서 모두 관측되었다. **M3의 정의된 게이트가 통과했다.**

`sandboxPolicy`를 `turn/start`로 옮긴 뒤에도 통과하므로, 그 수정이 승인 경로를 깨뜨리지
않는다는 것도 함께 확인되었다.

---

## Finding 3 — 검사가 두 번 거짓 통과했다

acceptance 2·3을 통과시키는 과정에서 **내가 쓴 검사가 두 번 잘못 통과했다.** 통과 자체보다
이것이 더 중요한 기록이다.

### 3-1. 증거의 부재를 증거로 썼다

처음 acceptance는 두 증거원만 봤다. 그런데 `/api/verify`는 인덱싱을 하지 않으므로 agent가
받은 것은 evidence가 아니라 `memory_unavailable`이었다. **채널은 돌지만 agent는 아무것도
못 본 상태**인데 9/9로 통과했다.

"실제 데이터를 돌려줬다" 검사를 더했는데, 그것을 `outcome === "unavailable"`이 **없으면**
통과하도록 썼다. 옛 bridge 프로세스가 살아 있어 그 필드 자체가 없던 실행에서 **전부
`undefined`였고 그래서 통과했다.** 인덱싱이 FAIL인데 데이터 검사는 PASS인 모순된 출력이
나온 뒤에야 알아차렸다.

→ `outcome === "data"`를 **긍정으로 요구**하도록 고쳤다.

### 3-2. 검사 범위가 task에 묶여 있지 않았다

고친 검사가 1회차는 통과하고 **2회차에 `data=5/2`로 실패했다.** 전역 도달 목록을 보고
있어서 이전 실행과 내가 손으로 돌린 curl 호출까지 세고 있었다.

→ `McpCallRecord.outcome`으로 옮겨 **task 범위**로 만들었다. 3회 연속 12/12를 확인했다.

### 교훈

두 번 다 같은 모양이다 — **검사가 실제로 무엇을 확인하는지보다 통과 여부를 먼저 봤다.**
"두 증거원이 있다"는 채널이 돈다는 뜻이지 데이터가 흐른다는 뜻이 아니고, "나쁜 값이 없다"는
좋은 값이 있다는 뜻이 아니며, 전역 카운터는 이번 실행을 말해 주지 않는다.

새 검사를 넣을 때는 **실패하는 것을 먼저 확인한다.** 3-1은 인덱싱 안 된 프로젝트로
`outcome: "unavailable"`이 기록되는 것을, 3-2는 2회차 실행으로 확인했다.

---

## M4 — propose_evidence + AnalyzeTransaction(S2·T3) + Validator ⓪~⑤ + IdentityResolver (완료)

계획 §8이 M4에 요구한 것: acceptance 6·7·8·9·10, 그리고 16·17의 **agent 절반**.

### 완료한 것

- [x] `@onto/protocol` — `SEMANTIC_PATCH_SCHEMA` · `EVIDENCE_PROPOSAL_SCHEMA` (ajv, 한 벌만, A6)
- [x] `@onto/evidence` — agent evidence relocation (§6.5 S1). 정규화 토큰 지문으로 창을 밀어
      exact/degraded 매칭을 하고, 모호하면(2개 이상) missing으로 남긴다 (결정론 — 스캔 순서
      무관). `carryAgentEvidence`가 재인덱싱에 이어 붙는다
- [x] `@onto/core`
  - `IdentityResolver` — Concept(exact/정규화 이름 · grounding overlap) · Claim(§6.4 key,
    predicate는 소문자+공백압축만) · Scenario(이름 · anchor overlap) 후보
  - `propose_evidence` 검증 — 경로 안전성(A4, symlink 이스케이프 포함) · 파일 실재 · 범위
    유효 · 지문 계산 · symbolHint 대조(warning) · graph 힌트 해석(warning). id 발급은 전부
    끝난 뒤에만
  - `AnalyzeTransaction` / `AnalyzeSession` — S2(제안이 analysisVersion을 올리지 않음) ·
    T3(race 시 abort → 재인덱싱 → 같은 session에 새 transaction, 재시작 상한 3회)
  - `applyPatch` / `commitPatch` — Validator ⓪~⑤ 전부, ⑤는 참조 파일만 지금 디스크에서
    다시 읽어 대조(S3), lock 안에서 커밋과 함께
- [x] `apps/bridge` — `performReindex`(agent evidence relocation 순서: carryAgentEvidence →
      diffEvidence → carryMissingEvidence) · task별 `AnalyzeSession` 수명(`BridgeState`) ·
      `get_evidence`가 pendingEvidence를 봄 · `/internal/propose-evidence` ·
      `/internal/semantic-patch`(T3 재시작 포함) · stop/turn 종료 시 transaction 폐기 ·
      `get_concept_context`가 실제 IdentityResolver를 씀
- [x] `@onto/mcp-server` — `propose_evidence` · `submit_semantic_patch` tool 등록
- [x] acceptance 6 · 7 · 8 · 9 · 10, 16·17의 agent 절반 — **Core 단위 시험 + mutation
      check + bridge 통합 시험(m4-wiring.test.mjs) 세 층 모두 통과**
- [x] `npm run acceptance codex` 실제 codex-cli 0.149.0으로 12/12 — M3 회귀 없음

### 구현 중 고친 것 (계획과 무관한 자체 결함)

이번에도 M2처럼 검사를 먼저 통과시키지 않고 실패하는 상태를 먼저 만들어 확인했다
(Finding 3 원칙). 그 과정에서 세 가지를 잡았다.

**1. relocation의 창 검색이 지문 파이프라인과 다른 토크나이저를 썼다.** `relocate.ts`가
독자적인 토크나이저를 갖고 있어 세미콜론·후행 콤마를 다르게 다뤘다 — 창 길이가 지문의
토큰 수와 어긋나 포매팅만 바뀐 경우에도 relocate가 실패했다. `normalize.ts`에
`positionedTokens()`를 만들어 지문 계산과 relocation이 **같은 함수**를 쓰게 했다.

**2. degraded 매칭이 자리별 비교라 삽입/삭제에 취약했다.** 식별자 하나가 지워지면 그 뒤가
전부 밀려 점수가 무너졌다 — 실제 편집은 거의 항상 삽입/삭제를 포함하므로 acceptance 17
자체가 이 경로로 통과하지 못했다. 다중집합(bag) 겹침으로 바꿨다: 순서를 안 보므로 삽입/삭제에
강하지만, 무관한 재정렬을 같은 것으로 볼 수 있다는 오차 방향이 생긴다 — 그래서 임계값과
유일성 요구, `relocationConfidence: "degraded"` 표시로 우회한다.

**3. `diffEvidence`에 `missing`이 이미 채워진 인덱스를 넘기고 있었다.** 순서가
`carryMissingEvidence` → `diffEvidence`였는데, 그러면 지워진 심볼이 새 인덱스에도
"존재"하게 되어 `rawHash` 비교가 `unchanged`로 잘못 분류했다 — 근거가 사라졌는데 아무 일도
없었던 것처럼 보이는, T1이 막으려던 바로 그 조용한 부패였다. `diffEvidence(before, 지금
실제로 있는 것)` → `carryMissingEvidence(...)` 순서로 고쳤다 (`packages/core/test/_helpers.mjs`,
`apps/bridge/src/index.ts`의 `performReindex` 모두).

**4. (이전 세션에서 중단된 지점) 성공한 커밋이 transaction을 닫았다.** `commitPatch`가
`transaction.status = "committed"`를 찍어, 같은 turn 안에서 agent가 커밋 이후 더 제안하고
더 제출하는 것을 막고 있었다. `AnalyzeTransaction`은 "하나의 patch"가 아니라 "하나의
analysisVersion"에 묶인다(S2)는 것이 계획의 정의이므로, 성공한 커밋 뒤에도 transaction은
열린 채로 남아야 한다. `TransactionStatus`를 `"open" | "aborted"`로 좁히고(더 이상
`"committed"`는 없다), 성공은 `committedGenerations` 배열에만 기록한다. 옛 동작을 재현해
새로 추가한 시험("성공한 커밋 뒤에도 transaction은 열려 있다")이 그것만 잡고 나머지는
그대로 통과하는 것을 확인한 뒤 고쳤다.

### mutation check로 확인한 것

M1·M2와 같은 방식 — 메커니즘을 하나씩 되돌려 놓고 **의도한 시험만** 실패하는지 봤다.

- relocation: 지문 대신 원문 바이트 비교 · degraded 임계값을 1보다 크게 · 유일성 요구 제거
  — 각각 정확히 그것을 시험하는 케이스 하나만 깨졌다
- Core Validator: ⓪(analysisVersion·semanticVersion 절반을 각각) · ②(evidence 실재 검사,
  pendingEvidence 조회) · ⑤(커밋 직전 재확인) · S2(제안이 새 analysisVersion을 받게) ·
  T3(재시작 상한 제거, race 후 pendingEvidence를 조용히 옮겨줌) · R2(경로 escape·줄 범위 검사)
  — 아홉 가지 모두 대응하는 acceptance/시험만 깨졌다
- bridge wiring: `no_active_transaction` 가드 제거 · T3 race 감지 제거 · `get_evidence`의
  pendingEvidence 병합 제거 — 각각 대응하는 통합 시험만 깨졌다

### 미검증으로 남는 것

없음. `codex mcp list`에 이미 M3에서 등록된 `onto`가 있었고, 이 머신에 codex-cli 0.149.0이
설치되어 있어 **agent-stream 증거까지 포함한 acceptance 2·3을 실제로 재확인했다** (M3와
동일하게 12/12). M4가 새로 추가한 `propose_evidence`/`submit_semantic_patch`는 acceptance
2·3의 `REQUIRED_TOOLS`에 들어 있지 않으므로(그 둘은 M3 채널 검증 전용 turn이 부르는 tool이
아니다), agent가 이 두 tool을 자발적으로 부르는 실제 analyze turn 전체는 M5의 Semantic
Patch 루프가 붙은 뒤 `npm run eval`로 확인하는 것이 계획의 순서다(§8: M4는 M2·M3가
필요하고, M5가 Semantic Patch 루프를 붙인다).

Finding 없음 — 계획과 충돌한 것이 없다. 위 네 가지는 전부 자체 구현 결함이었다.

---

## M5 — Semantic Patch 루프 + 증분 갱신 + SemanticWorkSet(U1) (완료)

계획 §8이 M5에 요구한 것: acceptance 4 · 5 · 18 · 18b.

### 시작할 때 이미 있었던 것

M4가 `AnalyzeTransaction`/`AnalyzeSession`을 만들면서 §6.9의 두-커밋 lifecycle 전체를
**이미 필요로 했다** — 그래서 M5가 시작되기 전부터 `semanticReconciledAnalysisVersion`
(`packages/protocol/src/index.ts` · `packages/core/src/store.ts` · `validator.ts`),
`buildWorkSet`(`packages/evidence/src/diff.ts`), `buildIncrementalAnalyzePrompt`
(`apps/bridge/src/prompt.ts`)가 전부 구현되어 `apps/bridge`의 `reindex()`에 배선되어
있었다(`m4_invariants.md` §8 compatibility rule 3이 이미 이 사실을 기록해 두었다).
`buildWorkSet`도 acceptance 18b·18c는 이미 단위 시험이 있었다.

**M5가 실제로 한 일은 그 위에 새 메커니즘을 얹는 것이 아니라, 이미 있는 메커니즘이
정말로 끝까지 도는지 확인하고 마지막 구멍을 메우는 것이었다.**

### 완료한 것

- [x] `packages/evidence/test/indexer.test.mjs` — **acceptance 18** 단위 시험. 심볼을
      삭제하면 `diffEvidence`가 그 evidence만 `missing`으로 잡고, `buildWorkSet`이 그
      evidence에 grounding된 Concept를 `affectedConceptIds`에 넣는지 확인한다(17번 시험과
      쌍을 이룬다 — 17은 `modified`, 18은 `missing`이 dirty에 기여하는지를 각각 건다).
- [x] `fixtures/fixture-app/expectations.json` — §7.2. `scripts/create-fixture.mjs`가
      만드는 팔로우/승인 fixture에 대해 사람이 미리 정한 구조적 기대(§7.2의 예시를 이
      fixture에 맞게 그대로 채택했다 — 우연이 아니라 계획 저자가 같은 fixture를 염두에
      두고 그 예시를 썼다는 뜻이다).
- [x] `scripts/coverage.mjs` — S6의 세 층(structural hard · smoke warning · semantic
      리뷰 큐)을 그대로 구현. `mustGroundIn`의 "path#name" 주소를 실제 evidence id로
      해석하는 `resolveEvidenceIds`가 핵심이다.
- [x] `scripts/eval.mjs`(`npm run eval`) — acceptance 4·5·18·18b를 **실제 codex/claude
      turn으로** 확인하는 M5의 회귀 게이트. `/api/analyze`가 커밋 1(재인덱싱) 뒤에만
      응답한다는 사실(§6.9)을 이용해, 18·18b의 **Core가 계산한 부분**(`workSetSize`)은
      agent turn 완료를 기다리지 않고 확인한다 — LLM이 뭘 하든 상관없는 결정론적 증거다.
      agent의 판단이 필요한 부분(5의 structural coverage, 18b의 "새 Concept를 만든다")만
      turn이 끝난 뒤 커밋된 Semantic Memory를 파일시스템에서 직접 읽어 확인한다(B4).
- [x] `apps/bridge/src/prompt.ts`의 `buildFullAnalyzePrompt`에 Scenario 등록 지시를
      추가했다 — 아래 "구현 중 고친 것" 참고.
- [x] `scripts/_shared.mjs`에 `waitForTask`를 옮겨 `acceptance.mjs`(M3)와 `eval.mjs`(M5)가
      **같은 함수**를 쓰게 했다. M3가 이미 taskId 필터링이 중요하다는 것을 시험으로 증명해
      둔 로직을 다시 만들지 않기 위함이다.
- [x] `npm test` 121/121 — 새 시험 8개(acceptance 18 하나, coverage.mjs 시험 7개) 포함,
      M1~M4 시험 전부 회귀 없음.

### 구현 중 고친 것 (계획과 무관한 자체 결함 · 하나는 M4가 남긴 진짜 구멍)

**1. `buildFullAnalyzePrompt`가 Scenario를 만들라고 시키지 않았다.** M4가 이미
`CanonicalScenarioEntry` 영속과 `submit_semantic_patch`의 `addedScenarios` 필드를 전부
구현해 두었는데(§6.4), 정작 첫 분석 프롬프트의 "순서"에는 Concept·Claim만 있고 Scenario는
빠져 있었다 — 그래서 codex로 실제 turn을 돌려 보기 전까지는 `canonicalScenarios`가 항상
빈 채로 커밋되고 있었다는 것을 아무도 몰랐다. `npm run eval`로 처음 실제 agent turn을
끝까지 태워 보고서야 드러난, M4가 남긴 배선 구멍이다. 프롬프트에 4번 단계로 추가했다.

**2. `scripts/coverage.mjs`의 `mustGroundIn` 해석이 agent-proposed evidence를 놓쳤다.**
처음엔 "path#name" 주소를 엔진이 만든 raw `symbol`/`db_entity` evidence 하나에만
매칭했다. 그런데 실제 codex turn은 `requestFollow`의 정책 분기를 발견하고 원시 심볼
evidence 대신 `propose_evidence`로 **그 자리에 더 정밀한 `policy_note`/`conditional_policy`
evidence를 새로 등록해 거기에 grounding했다** — 정확히 M4의 R2가 의도한 동작이다
("엔진이 못 본 근거를 버리지 말고 제안하라"). 그런데 내 checker는 raw 심볼 id만 알아서
"grounding되어 있지 않다"고 오판했다. `resolveEvidenceIds`를 **하나의 id가 아니라 그
주소에 걸린 후보 id들의 집합**을 돌려주도록 고쳐, 원시 symbol evidence든 같은
파일·symbolHint에 걸린 agent evidence든 **어느 쪽에 grounding해도** 인정하게 했다.
agent가 M4의 설계대로 행동했는데 그것을 "실패"로 보고한 것이었다 — 메커니즘이 아니라
검사 쪽의 결함이었다.

**3. 같은 concept 쌍 사이에 claim이 여럿일 때 첫 번째 것만 봤다.** `requiredClaims`가
`(subjectKey, objectKey)`로 관계를 찾는데, 실제 Semantic Memory에는 같은 두 Concept
사이에 서로 다른 predicate의 claim이 여러 개 있을 수 있다(예: "승인을 요구한다"와
"대기 목록에서 확인할 수 있다"가 둘 다 계정→팔로우 요청이다). `claims.find(...)`로 **첫
번째** 것만 집어 그것의 grounding만 봤더니, grounding이 약한 쪽이 먼저 나오면 강한 쪽이
있어도 실패로 떨어졌다. `relationClaims.find(claim이 mustGroundIn 전부를 만족)`으로
고쳐, 후보 중 **하나라도** 요구를 만족하면 통과하게 했다. 회귀 시험을 추가했다
(`scripts/coverage.test.mjs` "같은 subject/object 사이에 claim이 여럿이면...").

### `npm run eval codex`로 확인한 것 (codex-cli 0.149.0, 실제 agent, 3회 실행)

```text
turn 1(첫 분석) → acceptance 4(submit_semantic_patch 커밋) · acceptance 5(structural coverage)
turn 2(requestFollow 삭제 후 증분) → acceptance 18
turn 3(block.js 기능 추가 후 증분) → acceptance 18b
```

- **acceptance 4·18·18b — 3회 모두 통과.** `submit_semantic_patch`가 두 증거원 모두에서
  관측되고 `semanticVersion`이 실제로 올랐다(Validator ⓪~⑤ 전부 통과, 4). 심볼을 지우면
  `workSetSize.affectedConcepts`가 agent turn을 기다리지 않고도(커밋 1만으로) 0보다
  컸다(18). 새 기능 파일을 추가하면 `ungroundedAppearedEvidenceIds`가 채워졌고, turn이
  끝난 뒤 그 evidence에 grounding된 새 Concept가 실제로 생겼다(18b).
- **acceptance 5 — 3회 중 2회 통과, 1회 실패.** 실패한 1회는 checker 결함이 아니라
  **모델 출력의 실제 편차**였다 — "비공개 계정" Concept는 만들었지만, 그것을
  "팔로우 요청"과 잇는 Claim을 만들지 않고 다른 관계("계정 → 자신에게 온 요청을 확인할 수
  있다")만 만들었다. 이것을 통과하도록 checker를 더 느슨하게 고치지 않았다 — 그러면
  구조적 검사가 실제로 아무것도 증명하지 않게 된다. §7.3이 이미 이 성격을 규정해
  두었다("단일 fixture이므로 이 fixture에서로만 말한다") — acceptance 5는 **이 fixture에서
  구조가 맞는지**를 매 실행마다 재는 것이지, 모델이 항상 같은 관계를 만든다는 보장이
  아니다. `npm run eval`은 그 편차를 감추지 않고 그대로 보고한다.
- `claude`는 이 머신에 설치되어 있지 않아 codex로만 확인했다(M3·M4와 같은 제약).

Finding 없음 — 계획과 충돌한 것이 없다. 위 세 가지는 전부 자체 구현 결함(그 중 하나는
M4가 남긴 것)이었고, acceptance 5의 실행 간 편차는 결함이 아니라 §7.3이 이미 예상한
live-agent 측정의 성질이다.

---

## M6 — View Planner (Overview·Scenario) + schema/validator + budget (완료)

계획 §8이 M6에 요구한 것: acceptance 11 · 15.

### 시작할 때 이미 있었던 것

`packages/protocol/src/index.ts`에 `OverviewIR`·`ScenarioIR`·`ViewRequest`·`ViewCacheKey`·
`CachedView<T>` 등 타입 전체가 이미 정의되어 있었고(§22·§28~§33), `McpToolName`에
`"submit_view_ir"`도 이미 예약되어 있었다 — 둘 다 M0~M1 시절 protocol 패키지를 통째로
설계할 때 함께 만들어진 것이지 M6가 만든 것이 아니다. Trace(§6.6)는 M2에서 이미 완성되어
`projectTrace`가 결정론적으로 도는 상태였다. 그 외 — schema, Validator, budget, bridge
배선, mcp-server tool 등록, 프롬프트 — **전부 M6가 새로 만들었다.**

### 완료한 것

- [x] `packages/protocol/src/schemas.ts` — `OVERVIEW_IR_SCHEMA`·`SCENARIO_IR_SCHEMA` (ajv,
      한 벌만, A6). `SEMANTIC_PATCH_SCHEMA`와 같은 관례대로 **`maxItems`를 넣지 않았다**
      (§6.7 — 개수 제한은 schema가 아니라 soft budget의 일이다).
- [x] `packages/core/src/view-validator.ts` — `submit_view_ir`의 Validator.
      `submit_semantic_patch`의 ⓪~⑤와 다르다 — View는 `SemanticStore`에 커밋되지 않으므로
      (§6.4, cache일 뿐이다) `AnalyzeTransaction`도 `store.commit`도 모르는 순수 함수다.
      - schema(ajv) → 참조 무결성(conceptRefs/claimRefs/scenarioRefs/evidenceRefs가 실재하고
        present, I9) → Scenario 구조(entry/outcome 실재, **acceptance 15**: step evidenceRef
        ≥ 1 + entry에서 전부 도달 가능, back edge는 `condition` 필수, §6.8) → soft budget
        (warning만, §6.7) 순서로 계층을 나눴다 — validatePatch의 ⓪~④ 계층 구조를 그대로
        따른 것이다.
      - loop-unrolled 감지(§6.8) — 같은 conceptRefs·비슷한 label의 step 쌍을 warning으로
        잡는다. **경고일 뿐이다** — 정말 다른 반복이라 다르게 표현해야 하는 경우를 강제로
        막지 않는다.
- [x] `packages/core/src/viewBudget.ts` — Overview/Scenario의 soft budget 초기값과 근거를
      주석에 적었다(§53에서 조정될 값이라는 것도 함께).
- [x] `apps/bridge/src/view.ts` — Overview/Scenario 캐시 키(`semanticVersion`으로 잡는다,
      `analysisVersion`이 아니다 — V2). Trace는 캐시가 없다(동기라 필요 없다).
- [x] `apps/bridge/src/state.ts` — `viewCache`(taskId가 아니라 cache key로) ·
      `pendingViewRequests`(taskId → 이 turn이 무엇을 만들려는 것이었는지) ·
      `viewResultsByTask`(완료된 turn의 결과를 taskId로 찾는 길). 전부 bridge 메모리에만
      있다 — `@onto/core`의 generation store를 거치지 않는다(§6.4, "cache일 뿐이고
      source of truth가 아니다").
- [x] `apps/bridge/src/prompt.ts` — `buildOverviewPrompt`·`buildScenarioPrompt`.
- [x] `apps/bridge/src/index.ts`
  - `POST /api/views` — `viewKind: "trace"`는 `projectTrace`를 그대로 불러 **동기로 즉시
    응답한다**(§6.6 R4, agent turn이 없다). `"overview"|"scenario"`는 캐시가 있으면 즉시,
    없으면 view turn을 연다(§6.4 V2·§6.9 [C]).
  - `GET /api/views/:id` — taskId로 완료된 view turn의 결과를 가져온다. **freshness는
    캐시에 써 둔 값을 믿지 않고 매번 다시 계산한다** — 코드가 그 사이에 더 바뀌었을 수
    있기 때문이다(V2, `withCurrentFreshness`).
  - `/internal/submit-view-ir` — Core의 `validateViewIR`를 부르고, 통과하면
    `viewCache`에 남긴다. transaction이 없으면 lazy/degraded로 답한다(C5).
- [x] `packages/mcp-server/src/index.ts` — `submit_view_ir` tool 등록. **`ir`의 zod 스키마를
      따로 만들지 않았다** — `concept`/`claim`처럼 zod로 다시 베끼면 A6("schema는 한 곳에만")를
      스스로 어기는 셈이고, ScenarioIR은 중첩이 훨씬 깊어 유지비가 크다. 대신 `ir: z.record(z.unknown())`로
      느슨하게 받고 실제 검증은 전부 Core의 ajv schema(단 하나)에 맡겼다 — `description`에
      정확한 shape을 사람이 읽는 말로 적어 agent를 안내한다.
- [x] `packages/core/test/view-validator.test.mjs` — acceptance 11(schema 통과/실패)·
      15(step evidenceRef·도달 가능성) 단위 시험 17개. loop condition 필수, loop-unrolled
      warning, I9(허구·missing evidence 거절), soft budget이 제출을 막지 않는다는 것까지 포함.
- [x] `apps/bridge/test/view-wiring.test.mjs` — m4-wiring.test.mjs와 같은 방식(agent CLI
      없이 agent가 만들 상태만 대신 준비하고 나머지는 실제 HTTP route를 통과한다) 8개.
      trace의 동기 응답, cache-hit이 agent 없이도 즉시 응답하는 것, `submit_view_ir`가
      틀린 viewKind·허구 conceptRefs를 실제로 거절하는 것까지 검증한다.
- [x] `apps/bridge/test/mcp-channel.test.mjs` — M3가 tool 목록을 정확히 단언하던 시험에
      `submit_view_ir`를 추가했다(추가하지 않으면 M6가 M3 시험을 깬다).
- [x] `npm test` 146/146. `npm run typecheck` 전 패키지 통과.

### `npm run eval codex`로 확인한 것 (codex-cli 0.149.0, 실제 agent)

M5의 3-turn 흐름(첫 분석 → 심볼 삭제 → 기능 추가) 사이, 첫 분석 직후에 View turn 둘을
끼워 넣었다 — Semantic Memory가 이미 있어야 View를 만들 수 있기 때문이다.

```text
turn 1(첫 분석) 이후
  → Overview turn  → GET /api/views/:id → acceptance 11(schema+구조 통과, conceptRefs/
                      scenarioRefs가 실재한다는 것을 스크립트가 **다시 계산해** 대조)
  → Scenario turn  → GET /api/views/:id → acceptance 11 · 15(모든 step이 evidenceRef ≥ 1
                      이고 present이며, entryStepId에서 전부 도달 가능하다는 것을 스크립트가
                      **다시 계산해** 대조 — "성공을 곧이곧대로 믿지 않는다")
```

**실제 결과 — Overview·Scenario 관련 8개 항목 전부 1회차에 통과.** M5 때와 달리 이번엔
`view-validator`나 bridge 배선에서 실행 중에 새로 드러난 버그가 없었다 — unit 시험
17개 + wiring 시험 8개가 이미 잡아낸 것 이상이 live run에서 나오지 않았다. Overview는
실제로 Concept 5개·Scenario 2개를 3개 Area로 묶고 `importantConnections`까지 만들어
냈고, Scenario는 3-step 흐름을 만들며 그 중 하나(정책 판단)를 `propose_evidence`로
등록한 agent evidence에 grounding했다 — M4의 R2("엔진이 못 본 근거를 버리지 말고
제안하라")가 View Planner turn에서도 그대로 작동한다는 뜻이다. Trace도 별도로
`POST /api/views`에 직접 호출해 동기 응답(agent 없이, taskId 없이)을 확인했다.

M5의 acceptance 5(structural coverage) 실패가 이번에도 재현되었다 — M5 FINDINGS에 이미
기록한 것과 같은 종류의 live-model 편차이고, M6와는 무관하다.

`claude`는 이 머신에 설치되어 있지 않아 codex로만 확인했다(M3~M5와 같은 제약).

### 이 문서가 다루지 않는 것

renderer safety ceiling(§6.7 — 뷰어가 안 멎게 IR을 "…외 N개"로 접는 것)은 M6에 없다.
그것은 **렌더러의 책임**이라고 계획이 명시한다("IR을 거절하지 않는다") — M7(React viewer)
범위다. View turn을 몇 번이고 다시 열 수 있게 하는 것(재생성 버튼, 캐시 무효화 UI)도
M7/apps/web의 몫이다. 이 문서는 그 UI를 만들지 않았다 — bridge API(`POST /api/views`)는
이미 몇 번이고 다시 부를 수 있게 되어 있으므로 막혀 있는 것은 없다.

Finding 없음 — 계획과 충돌한 것이 없다.
