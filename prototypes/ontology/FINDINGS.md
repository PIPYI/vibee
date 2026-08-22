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

검증 절차 (CLI가 있는 머신에서):

```bash
npm i -g @openai/codex && codex login          # 또는
npm i -g @anthropic-ai/claude-code && claude
npm run build && npm run bridge                # 창 1
# 창 2에서 POST /api/analyze → GET /api/tasks/<id>/mcp-evidence
# toolsWithBothSources 가 비어 있지 않아야 acceptance 2·3 통과
```

`GET /api/tasks/:taskId/mcp-evidence`가 두 증거원을 따로 보여주도록 만들어 두었으므로,
CLI가 있는 머신에서는 즉시 확인할 수 있다.

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
