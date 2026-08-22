# M4 Invariants — propose_evidence · AnalyzeTransaction · Validator ⓪~⑤ · IdentityResolver

이 문서는 `docs/ontology/implementation_plan.md`(FROZEN)의 §6.3·§6.5·§6.9를 **바꾸지 않는다.**
M4가 실제로 구현한 코드(`packages/core`, `packages/evidence`, `apps/bridge`,
`packages/mcp-server`)를 읽어 거기서 성립하는 invariant를 그대로 추출해 적어 둔 것이다.
설계를 제안하지 않는다 — 이미 있는 것을 freeze한다.

**대상 커밋:** M4 (`prototypes/ontology/FINDINGS.md`의 "M4" 절, 113/113 시험 통과,
mutation check 통과, `npm run acceptance codex` 12/12 — 코드는 그 상태 그대로다).

**독자:** M5(Semantic Patch 루프 + 증분 갱신 + SemanticWorkSet) 작업자. 이 문서를 읽고
"이 변경이 M4 invariant를 깨는가"를 판단할 수 있어야 한다.

---

## 0. M4의 목적

§8이 M4에 요구한 것은 정확히 이것이었다:

> `propose_evidence`(지문·프로파일·graph 힌트) + AnalyzeTransaction(S2·T3) +
> Validator ⓪~⑤ + IdentityResolver

즉 M4는 **"agent가 발견한 근거를 Core가 검증해 등록하고, 그 근거와 함께 만든 의미를
Validator가 통과시켜 하나의 generation으로 커밋하는 경로"** 하나를 완성하는 milestone이다.
M4가 끝난 지금, 다음 다섯 가지가 실제로 동작한다.

1. agent가 엔진이 못 본 근거를 `propose_evidence`로 등록하면 Core가 검증하고 id를 발급한다.
2. 그 등록은 `analysisVersion`을 올리지 않는다(S2) — 같은 turn의 `submit_semantic_patch`가
   자기 자신의 tool 호출 때문에 stale-base로 거절되는 self-deadlock이 없다.
3. `submit_semantic_patch`는 Validator ⓪~⑤를 전부 통과해야 하나의 generation으로 커밋된다.
4. 커밋 직전에 참조 파일이 바뀌면(race) 아무것도 쓰지 않고, 재인덱싱한 뒤 **같은 agent
   session 안에서** 새 transaction을 연다(T3) — agent는 대화 문맥을 잃지 않는다.
5. 새 Concept/Claim/Scenario를 만들기 전에 IdentityResolver가 재사용 후보를 알려준다 —
   강제하지 않는다. 판단은 AI, 측정은 Core(I1).

---

## 1. Lifecycle diagram

```text
                         ┌─────────────────────────────────────────────┐
                         │                 Agent (Codex/Claude)          │
                         └───────────────┬───────────────────────────────┘
                                         │ MCP tool call (stdio)
                                         ▼
                         ┌─────────────────────────────────────────────┐
                         │        @onto/mcp-server (상태 없음, B1)        │
                         └───────────────┬───────────────────────────────┘
                                         │ loopback HTTP + token
                                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ apps/bridge (BridgeState 가 유일한 소유자)                                   │
│                                                                             │
│  POST /api/analyze                                                        │
│    └─ reindex(projectPath, taskId, gitBase)                               │
│         └─ performReindex(store, projectPath, gitBase)   ── 커밋 1 ──┐     │
│              indexProject → carryAgentEvidence → diffEvidence         │     │
│              → carryMissingEvidence → buildWorkSet → store.commit     │     │
│         └─ state.setAnalyzeSession(taskId, new AnalyzeSession(...))   │     │
│         └─ state.setDirtyEvidenceCount(taskId, work.dirtyEvidence.length)  │
│    └─ state.createTask({ taskId, status: "starting", ... })               │
│    └─ void runTask(adapter, taskId, ...)               ← agent turn 시작   │
│                                                                             │
│  POST /internal/propose-evidence   (session.transaction.propose)          │
│  POST /internal/semantic-patch     (commitPatch → ⓪~⑤ → 커밋 2)           │
│         └─ race 시: performReindex 재실행 → session.restartAfterRace(...)  │
│                                                                             │
│  runTask() 의 finally / POST /api/tasks/:id/stop                          │
│    └─ state.disposeAnalyzeSession(taskId, reason)      ← session 종료      │
└───────────────────────────────────────────────────────────────────────────┘
```

**두 개의 별도 store commit이 있다** (§6.9):

- **커밋 1** (`performReindex`) — 결정론적 재인덱싱. `analysisVersion++`,
  `semanticVersion` 유지. `AnalyzeSession`이 이 커밋이 만든 `analysisVersion` 위에서 열린다.
- **커밋 2** (`commitPatch`) — agent가 만든 의미. `analysisVersion` 유지,
  `semanticVersion++`. `pendingEvidence`도 여기서 함께 커밋된다.

이 둘은 시점이 다르고 **몇 번이고 번갈아 일어날 수 있다** — 하나의 analyze turn 안에서
`propose_evidence`(커밋 없음, transaction 안에만 머묾) → `submit_semantic_patch`(커밋 2) →
또 `propose_evidence` → 또 `submit_semantic_patch` 가 반복될 수 있다. race가 나면 그 사이에
커밋 1이 한 번 더 끼어든다(§4).

---

## 2. Task lifecycle (A)

### session 생성 위치

`AnalyzeSession`은 **오직 한 곳**, `apps/bridge/src/index.ts`의 `reindex()` 함수 안에서
생성된다 (`reindex()` → `performReindex()`로 커밋 1을 만들고, 그 결과로
`new AnalyzeSession(taskId, projectPath, { baseAnalysisVersion: nextVersion, index: after.evidence })`
를 만들어 `state.setAnalyzeSession(taskId, session)`으로 등록한다).

`reindex()`를 부르는 곳은 **`POST /api/analyze`뿐**이다. 즉 session은 agent turn을 태우는
경로에서만 열린다.

**`POST /api/index`(index-only)는 session을 열지 않는다.** 이 경로는 `performReindex()`를
**직접** 부르고 `reindex()`를 거치지 않는다 — agent turn이 없으므로
`AnalyzeTransaction`이 필요 없고, 실제 코드 주석이 이유를 명시한다:

> **세션을 열지 않는다** — agent turn이 없으므로 AnalyzeTransaction이 필요 없다.
> `reindex()`를 쓰면 존재하지 않는 task에 세션이 묶여 정리되지 않고 남는다.

`POST /api/verify`(M3의 채널 검증 turn)도 session을 열지 않는다 — `buildVerifyPrompt()`를
바로 `runTask()`에 넘기고 `reindex()`를 부르지 않는다. `submit_semantic_patch`는 M4에서
붙었으므로, verify turn에서 `propose_evidence`/`submit_semantic_patch`를 부르면
`no_active_transaction`을 받는다(정상 동작 — lazy/degraded, C5).

**session의 소유자는 `BridgeState`뿐이다.** `analyzeSessions: Map<taskId, AnalyzeSession>`
하나에 저장되고, `/internal/propose-evidence` · `/internal/semantic-patch`는
`state.getActiveTaskId()`로 현재 task를 찾은 뒤 `state.getAnalyzeSession(taskId)`로만
접근한다. MCP server는 상태가 없으므로(B1) session이 bridge 밖에 존재할 방법이 없다.

### session 종료 조건

`BridgeState.disposeAnalyzeSession(taskId, reason)`이 유일한 종료 경로다. 이것을 부르는
곳은 정확히 두 곳이다.

1. **`runTask()`의 `finally` 블록** — turn이 `completed`·`interrupted`·`error` 중 **어느
   것으로 끝나든** 무조건 실행된다. try/catch 바깥의 finally이므로 예외가 나도 실행된다.
2. **`POST /api/tasks/:taskId/stop`** — adapter의 `stopTask()`를 기다리지 않고 먼저 부른다.

`disposeAnalyzeSession`은 **idempotent**다 — session이 없으면 조용히 아무것도 하지 않는다
(`if (!session) return;`). 그래서 `stop`이 먼저 지운 뒤 `runTask`의 `finally`가 나중에
같은 taskId로 다시 불러도 안전하다. 이 순서 의존성 없음이 코드가 실제로 보장하는 것이다 —
두 호출 중 어느 쪽이 먼저 와도 결과가 같다.

`disposeAnalyzeSession`은 내부에서 `session.dispose(reason)`을 부르고,
`AnalyzeSession.dispose()`는 `if (this.current.status === "open") this.current.abort(reason)`을
한다 — **이미 aborted된 transaction에는 아무것도 하지 않는다**(중복 abort 방지).

### transaction 생성 범위

`AnalyzeSession` 하나는 생성 시점에 `AnalyzeTransaction` 하나를 만들어 들고 있는다
(`private current: AnalyzeTransaction`). 이 `current`는 **session의 수명 동안 여러 번
교체될 수 있다** — `restartAfterRace()`가 새 `AnalyzeTransaction`으로 `this.current`를
바꾼다(§4). 하지만 **session 객체 자체는 재시작 때 교체되지 않는다** — `taskId`가 그대로
유지되므로 agent의 대화 문맥(Codex thread / Claude session_id)도 유지된다.

### pending state 폐기 조건

`AnalyzeTransaction.pendingEvidence`(agent가 제안해 검증까지 통과했지만 아직
`evidence.json`에 없는 근거)가 비워지는 경로는 **`abort()`뿐**이다:

```ts
abort(reason: string): DiscardedProposal[] {
  const discarded = this.unusedProposals(new Set());
  this.status = "aborted";
  this.abortReason = reason;
  this.pendingEvidence.length = 0;   // 전부 버린다
  return discarded;
}
```

`abort()`가 불리는 경로는 정확히 두 곳이다 — `restartAfterRace()`(race 시, §4)와
`AnalyzeSession.dispose()`(session 종료 시, 위 참고). **`commitPatch()`가 성공해도
`abort()`는 불리지 않는다** — 커밋된 evidence는 `pendingEvidence` 배열에 그대로 남는다
(그것이 왜 안전한지는 §3에서 다룬다).

---

## 3. Evidence lifecycle (B)

세 종류의 evidence가 있고, 재인덱싱을 지나며 서로 다른 것을 겪는다.

### 기존 evidence (engine origin, `origin: "engine"`)

id가 **주소**에서 나온다(R1·U3) — `ev:file:<sha1(relPath)>`,
`ev:symbol:<sha1(relPath#qualifiedName)>`, link evidence는 `linkKind + fromKey + toKey +
localNormalizedFingerprint`의 sha1. 재인덱싱은 `indexProject()`를 다시 돌려 **같은
주소면 같은 id**를 만들어 낸다. 위치(`location`)가 바뀌어도 주소가 같으면 id가 같으므로
Grounding이 자동으로 살아남는다 — relocation 로직이 필요 없다.

### agent proposed evidence (agent origin, `origin: "agent"`)

id가 **지문**에서 나온다 — `ev:agent:<sha1(relPath + ":" + kind + ":" + anchorFingerprint)>`.
엔진이 이 evidence를 만들지 않으므로 재인덱싱이 저절로 같은 id를 다시 만들어 주지
**않는다.** 그래서 `carryAgentEvidence()`가 **명시적으로** 이어 붙여야 한다(§4에서
순서를 다룬다):

```text
파일이 그대로다        → 그대로 옮긴다 (fileContentHash 동일)
파일이 바뀌었다        → relocateExtent() 로 지문 검색
  같은 지문의 창이 정확히 1개  → relocate (exact). id 는 그대로.
  0개                          → 식별자 부분수열 겹침(bag overlap) 점수로 degraded 매칭 시도
  2개 이상                     → missing (모호. 재제안 필요)
파일을 읽을 수 없다     → missing
```

**exact/degraded 판정에 쓰는 토크나이저는 지문 계산과 같은 함수를 쓴다**
(`packages/evidence/src/normalize.ts`의 `positionedTokens()`). 이것이 M4 구현 중 실제로
한 번 틀렸던 지점이다 — relocation이 독자적인 토크나이저를 갖고 있어 세미콜론·후행 콤마를
다르게 다뤘고, 그 결과 창 길이가 지문의 토큰 수와 어긋나 포매팅만 바뀐 경우에도 relocation이
실패했다. 지금은 `fingerprintOf()`와 `relocationTokens()`가 **같은 파이프라인**을 거친다.

degraded 매칭은 **다중집합(bag) 겹침**으로 계산한다(자리별 비교가 아니다) — 식별자 하나가
지워지면 그 뒤가 전부 밀려 점수가 무너지는 문제가 있었기 때문이다. bag 겹침은 삽입/삭제에
강하지만 무관한 재정렬을 같은 것으로 볼 수 있다는 오차 방향이 생기므로, 임계값
(`DEGRADED_SIMILARITY_THRESHOLD = 0.6`)과 **유일한 후보만 인정**(겹치는 덩어리가 둘
이상이면 모호 → missing)으로 우회한다. 결과에는 `relocationConfidence: "degraded"`가
붙어 뷰어가 "위치를 추정했습니다"라고 보여줄 수 있다.

**relocate되어도 id는 바뀌지 않는다.** 지문이 달라졌더라도(본문 의미 변경) id는 유지되고,
달라진 지문은 `EvidenceDiff.contentChange = "modified"`로 나타나 재검토 대상이 된다 —
id가 바뀌면 그 evidence를 가리키던 Grounding이 전부 끊기므로, "내용이 바뀌었다"와 "다른
것이 됐다"를 구분해야 한다.

**`carryAgentEvidence`는 그 evidence가 사는 파일의 해시를 `fileHashes`에 넣는다.** 엔진이
수집하지 않는 파일(문서·주석 정책 등, `propose_evidence`의 주 대상)이 `fileHashes`에
없으면 `present ⟺ fileContentHash === fileHashes[filePath]`가 영원히 거짓이 되어 방금
등록한 근거가 즉시 죽는다 — 이것도 실제 구현이 처리하는 지점이다.

### missing evidence

`carryMissingEvidence()`가 이전 인덱스에는 있었지만 새 인덱스에서 주소가 해석되지 않은
evidence를 `status: "missing", missingSinceVersion: <새 analysisVersion>`으로 **보존**한다
(지우지 않는다). Grounding이 가리키는 id가 남아 있어야 Validator ③이 `grounding/lost`
warning을 만들 수 있고, 뷰어가 "근거를 잃었다"는 것을 표시할 수 있다.

### 재인덱싱 순서가 왜 invariant인가

`apps/bridge/src/index.ts`의 `performReindex()`가 실제로 도는 순서:

```ts
const fresh = indexProject(projectPath, { analysisVersion: nextVersion, ...gitBase });
const { index: withAgent, report } = carryAgentEvidence(before.evidence, fresh, readProjectFile);
const diffs = diffEvidence(before.evidence, withAgent);          // ← withAgent, withMissing 아님
const withMissing = carryMissingEvidence(before.evidence, withAgent);
const work = buildWorkSet(diffs, before.memory, before.grounding);
// ... snapshot.evidence = withMissing;
```

`diffEvidence(before, next)`의 계약은 "`next`에는 **지금 실제로 있는 것**만 들어와야
한다"는 것이다. `diffEvidence`는 `next.evidence`에 있는 모든 항목을 `before`와 대조해
`unchanged`/`cosmetic`/`modified`로 분류하고, `before`에 있었는데 `next`에 없는 것만
`missing`으로 판정한다(코드 그대로: `for (const item of next.evidence) { ... }` 다음
`for (const id of [...before.keys()]) { push missing }`). 만약 `withMissing`(이미 사라진
것을 `missing` 항목으로 다시 채운 인덱스)을 `diffEvidence`에 넘기면, 사라진 항목이
`next.evidence`에 **존재하게 되어** `rawHash` 비교 대상이 되고, `carryMissingEvidence`가
붙인 `rawHash`는 원래 항목의 것 그대로이므로 `old.rawHash === item.rawHash`가 참이 되어
**`unchanged`로 분류된다.** 근거가 사라졌는데 아무 일도 없었던 것처럼 보이는 것이다 —
T1이 막으려던 바로 그 조용한 부패("status는 present인데 내용이 바뀐 근거를 증분 루프가
영원히 들여다보지 않는다"는 것과 동형인 실패다).

이 순서는 **M4 구현 중 실제로 한 번 틀렸다가 시험이 잡은 결함**이다
(`packages/core/test/_helpers.mjs`의 `reindex()` 헬퍼와 `apps/bridge/src/index.ts`의
`performReindex()` 둘 다 지금은 올바른 순서다). `packages/core/test/agent-evidence.test.mjs`의
"근거가 통째로 사라지면 missing이고, 지어내서 옮기지 않는다" 시험이 이 순서가 깨지면 즉시
실패한다.

**이 문서는 이 순서를 바꾸라고도, missing carry를 앞당기라고도 제안하지 않는다** — 순서
자체가 invariant이고, 위 설명은 "왜 이 순서여야만 하는가"를 기록해 M5가 실수로 바꾸지
않게 하는 것이 목적이다.

---

## 4. Transaction lifecycle (C)

### 하나의 analysisVersion 안에서 여러 번 왕복할 수 있다

`AnalyzeTransaction`의 상태는 `"open" | "aborted"` 둘뿐이다. **`"committed"`는 없다.**
`commitPatch()`가 성공해도 `transaction.status`는 바뀌지 않고 `"open"`으로 남는다 —
성공은 `transaction.committedGenerations.push(committed.generation)`으로만 기록된다
(코드 주석 그대로: "transaction은 열린 채로 남는다. 같은 turn 안에서 agent가 더 제안하고
더 제출할 수 있어야 한다").

실제로 보장되는 순서(반복 가능):

```text
propose_evidence  →  (검증 통과) →  pendingEvidence 에 추가, transaction 은 open 유지
submit_semantic_patch  →  Validator ⓪~⑤  →  성공 →  committedGenerations 에 기록, transaction 은 여전히 open
propose_evidence  →  (또 검증 통과) →  pendingEvidence 에 추가
submit_semantic_patch  →  ... 반복 가능
```

이것이 성립하려면 두 가지가 같이 필요하다:

1. `propose()`가 `if (this.status !== "open") return {ok:false, "transaction/not-open"}`로
   막는 것은 **`"aborted"` 상태일 때뿐**이다 — 성공한 커밋 뒤에도 `status`가 `"open"`이므로
   막히지 않는다.
2. **커밋된 evidence가 `pendingEvidence`에서 지워지지 않는다.** `commitPatch()`는
   `referencedEvidenceIds(patch)`로 이번 patch가 참조한 것만 골라 store에 쓰지만,
   `transaction.pendingEvidence` 배열 자체는 건드리지 않는다. 그래서 다음
   `submit_semantic_patch`가 **같은 evidence id를 다시 참조**해도(예: 이미 만든 Concept에
   Claim을 하나 더 추가하며 같은 evidenceRef를 쓰는 경우) `transaction.findEvidence(id)`가
   여전히 그것을 찾는다.

**주의 — transaction은 patch 하나와 동일하지 않다.** transaction의 생명주기는 "하나의
`baseAnalysisVersion`"에 묶여 있지, "하나의 `submit_semantic_patch` 호출"에 묶여 있지
않다. Validator ⓪이 검사하는 것도 `patch.baseAnalysisVersion === transaction.baseAnalysisVersion`
이지, "이 transaction에서 이미 커밋한 적이 있는가"가 아니다. 이 구분을 무너뜨리는 변경
(예: 첫 커밋 후 transaction을 자동으로 닫는 것)은 M4가 실제로 고친 결함을 되돌리는
것이다 — `packages/core/test/transaction.test.mjs`의 "성공한 커밋 뒤에도 transaction은
열려 있다 — 같은 turn에서 더 제안하고 더 제출할 수 있다" 시험이 정확히 이것을 건다
(이 시험은 옛 `"committed"` 종결 상태를 재현해 실패하는 것을 먼저 확인한 뒤 작성됐다).

### transaction이 실제로 닫히는 유일한 방법

`abort()`뿐이다. 호출 경로는 정확히 둘:

- `AnalyzeSession.restartAfterRace()` — 항상 새 `AnalyzeTransaction`으로 교체하기 **직전에**
  현재 것을 abort한다.
- `AnalyzeSession.dispose()` — session 종료 시, 그 시점에 `status`가 여전히 `"open"`이면.

---

## 5. Race recovery lifecycle (D)

Validator ⑤(`commitPatch()` 내부, `store.commit()`의 mutate 콜백 안, **lock 안**)가
참조된 파일만 지금 디스크에서 다시 읽어 대조한다. 하나라도 다르면
`PrecommitError(["evidence/file-changed-during-turn"])`를 던지고, `store.commit()`의
mutate 콜백은 예외를 던졌으므로 **generation을 만들지 않는다** — 커밋 1(재인덱싱)이든
커밋 2(패치)든 이 경로에서는 **아무 generation도 쓰이지 않는다.**

`apps/bridge`의 `/internal/semantic-patch` 핸들러가 실제로 잇는 흐름:

```text
1. commitPatch() 가 evidence/file-changed-during-turn 으로 실패한다
   (diagnostics 에 changedFiles 목록이 실려 있다)
2. bridge 가 session.transaction 을 직접 abort 하지 않는다 —
   대신 performReindex() 를 다시 실행한다 (이것이 "커밋 1과 같은 종류의 transition"이다:
   analysisVersion 만 오르고 semanticVersion 은 그대로다)
3. session.restartAfterRace(changedFiles, () => ({ baseAnalysisVersion, index }))
     → 내부에서 현재 transaction 을 abort (pendingEvidence 전부 버림)
     → 재시작 횟수가 상한(MAX_TRANSACTION_RESTARTS = 3) 미만이면
       새 AnalyzeTransaction 을 session.current 로 교체
     → raceDiagnostic(changedFiles, opened) 를 diagnostics 에 실어 돌려준다
4. bridge 가 응답에 새 baseAnalysisVersion 과 discardedProposals(session.lastDiscarded)
   를 함께 실어 agent 에게 돌려준다
5. session(= taskId, agent 대화 문맥) 은 그대로다. **agent 는 처음부터 탐색하지 않는다.**
   버려진 제안 중 여전히 유효하다고 판단하는 것은 다시 propose 해야 한다 —
   pendingEvidence 를 자동으로 옮겨 주지 않는다.
```

**`AnalyzeSession.restartAfterRace`의 `reopen` 인자는 동기 함수다.** bridge 쪽의
`performReindex()`는 비동기(디스크 I/O + `store.commit()`)이므로, bridge는
**`restartAfterRace`를 부르기 전에 `performReindex()`를 먼저 `await`하고**, 이미 계산된
결과를 동기 클로저(`() => ({ baseAnalysisVersion, index })`)로만 넘긴다. Core의
`AnalyzeSession` API 자체는 동기로 남아 있다 — 이것은 M4가 의도적으로 지킨 경계다
(Core는 파일시스템 재인덱싱을 스스로 하지 않는다. 그것은 `@onto/evidence` +
`SemanticStore`의 몫이고, bridge가 오케스트레이션한다).

**상한을 넘으면 새로 열지 않는다.** `restarts >= MAX_TRANSACTION_RESTARTS`(3회)이면
`restartAfterRace`는 `{ok:false, diagnostics:["transaction/restart-limit"]}`을 돌려주고
**새 transaction을 만들지 않는다** — 무한 재시작보다 "파일이 계속 바뀌고 있습니다"라고
말해 주는 편이 낫다는 것이 계획의 판단이고, 코드가 그대로 구현한다.

---

## 6. MCP/Bridge boundary (E)

```text
Agent
 │  MCP tool call (stdio)
 ▼
@onto/mcp-server           — 상태 없음. 모든 tool 이 loopback HTTP 로 위임한다 (B1).
 │                            propose_evidence/submit_semantic_patch 는 zod 로 shape 만
 │                            검사하고, 실제 검증은 하지 않는다.
 │  loopback HTTP + x-onto-token
 ▼
apps/bridge (/internal/*)  — requireToken 가드. state.getActiveTaskId() 로 현재 task 를
 │                            찾고, 그 task 의 AnalyzeSession 이 없으면
 │                            { error: "no_active_transaction", next_step } 을 돌려준다
 │                            (실패가 아니라 lazy/degraded, C5 — throw 하지 않는다).
 ▼
AnalyzeSession              — taskId·projectPath 에 묶인, 재시작 가능한 transaction 보관소.
 │                            현재 transaction 을 노출하고, race 시 교체한다.
 ▼
AnalyzeTransaction          — 하나의 baseAnalysisVersion 에 대한 pendingEvidence 보관소.
 │                            propose() 가 validateProposal() 을 부른다.
 ▼
Validator (validatePatch / commitPatch)
 │                            ⓪~⑤ 전부. ⑤와 실제 쓰기는 SemanticStore 의 lock 안에서
 │                            한 번에 일어난다.
 ▼
evidence/index state (SemanticStore, generation + HEAD pointer)
```

각 경계가 넘지 않는 책임:

- **MCP server는 프로젝트 상태를 모른다.** 검증도, 재사용 후보 계산도 하지 않는다 —
  모든 것을 bridge에 위임하고 응답을 그대로 감싸 돌려준다(`reply()`). MCP server가 아는
  것은 zod가 표현하는 **입력 shape**뿐이고, 그것이 걸러도 실패는 error가 아니라 MCP
  프로토콜 수준의 문제이지 Validator ①(ajv)과는 다른 층이다.
- **bridge는 무엇이 유효한 evidence/semantic patch인지 모른다.** bridge가 하는 것은
  "지금 이 taskId에 맞는 session/transaction을 찾아 넘겨준다"와 "race가 나면 재인덱싱을
  오케스트레이션한다"뿐이다. 실제 검증 로직(경로 안전성, 지문 계산, ⓪~⑤)은 전부
  `@onto/core`에 있다.
- **AnalyzeSession/AnalyzeTransaction은 파일시스템을 모른다.** `propose()`가 부르는
  `validateProposal()`은 실제로 디스크를 읽지만(§6.5의 "Core가 직접 읽는다"), 그것은
  `@onto/core`의 `propose.ts`가 하는 것이고, **재인덱싱**(파일 전체를 다시 스캔해
  `EvidenceIndex`를 새로 만드는 것)은 transaction/session 밖, bridge의
  `performReindex()`가 오케스트레이션한다. `restartAfterRace`의 `reopen` 인자가 동기인
  이유가 이 경계 때문이다(§5).
- **Validator는 store를 모른다.** `validatePatch()`는 `LoadedState`(순수 데이터)만 받아
  순수 함수로 diagnostics를 만든다. 실제 쓰기(`store.commit()`)는 `commitPatch()`가
  담당하고, ⑤(파일 재확인)와 쓰기는 **같은 `store.commit()` mutate 콜백 안, 같은 lock
  아래**에서 일어난다 — 검사와 쓰기 사이에 틈이 있으면 ⑤가 막으려던 race를 다시 여는
  것이기 때문이다.
- **SemanticStore는 의미를 모른다.** generation 커밋과 HEAD 원자적 전환만 한다(§5 T4,
  M0에서 이미 freeze됨). M4는 이 계층을 바꾸지 않았다.

---

## 7. Forbidden changes

아래는 **M4의 정의 자체**이므로, 바꾸면 M4 acceptance(6·7·8·9·10, 16·17 agent 절반)와
그것을 확인하는 mutation check가 깨진다. M5가 이 동작에 의존해도 된다는 뜻이고, 반대로
이것들을 "정리"하거나 "단순화"하는 리팩터는 전부 breaking change다.

| # | Invariant | 어긴 결과 | 지키는 시험 |
|---|---|---|---|
| F1 | `AnalyzeTransaction`은 성공한 `commitPatch()` 뒤에도 `status === "open"`으로 남는다 | S2 self-deadlock 재발 — 같은 turn에서 두 번째 `submit_semantic_patch`가 불가능해진다 | `transaction.test.mjs` "성공한 커밋 뒤에도 transaction은 열려 있다" |
| F2 | `propose_evidence`는 `observedAtVersion`으로 **`transaction.baseAnalysisVersion`**을 쓰고 새 analysisVersion을 만들지 않는다 | acceptance 8 붕괴 — 제안이 자기 자신의 patch를 stale-base로 만든다 | `transaction.test.mjs` acceptance 8, mutation check "S2 — 제안이 새 analysisVersion을 받게 한다" |
| F3 | Validator ⑤(커밋 직전 재확인)와 실제 쓰기는 **같은 `store.commit()` lock 안**에서 일어난다 | S3가 막던 race가 재발 — 존재하지 않는 줄 범위에 grounding이 커밋될 수 있다 | `validator.test.mjs` acceptance 10, mutation check "⑤ 커밋 직전 재확인을 끈다" |
| F4 | 재인덱싱 순서는 `carryAgentEvidence → diffEvidence → carryMissingEvidence`다(§3 참고. 순서 변경/개선 제안 자체가 이 문서의 금지 대상) | 사라진 근거가 `unchanged`로 오분류되는 조용한 부패 재발 | `agent-evidence.test.mjs` "근거가 통째로 사라지면 missing이고, 지어내서 옮기지 않는다" |
| F5 | agent evidence의 identity·relocation은 **정규화 지문**(`anchorFingerprint`)만 쓴다. 원문 바이트 비교로 되돌리지 않는다 | prettier 한 번에 agent evidence가 전부 끊긴다 | `relocate.test.mjs`, mutation check "지문 대신 원문 바이트로 일치 판정" |
| F6 | relocation 매칭이 모호하면(exact 후보 2개 이상, 또는 degraded 후보가 겹치지 않는 두 덩어리) **옮기지 않고 missing으로 남긴다** | 틀린 위치에 relocate되어 끊긴 것보다 나쁜, 조용히 잘못된 grounding | `relocate.test.mjs` "똑같은 블록이 둘이면 옮기지 않는다", mutation check "유일성 요구 제거" |
| F7 | T3 재시작은 `pendingEvidence`를 새 transaction으로 **자동으로 옮기지 않는다** | 코드가 실제로 바뀐 뒤에도 agent가 재검토하지 않은 주장이 밀수된다 | `transaction.test.mjs` T3 시험, mutation check "race 후 pendingEvidence를 조용히 옮겨줌" |
| F8 | T3 재시작 상한(`MAX_TRANSACTION_RESTARTS = 3`)을 넘으면 새 transaction을 열지 않는다 | format-on-save 루프에서 무한 재시작 | `transaction.test.mjs` "재시작은 3회까지다", mutation check "재시작 상한 제거" |
| F9 | `get_evidence`(`/internal/evidence`)는 활성 task의 `pendingEvidence`를 병합해 보여준다 | `propose_evidence`로 발급받은 id를 같은 task 안에서 즉시 확인할 수 없다(self-deadlock의 다른 얼굴) | `m4-wiring.test.mjs` "propose_evidence — bridge가 Core의 검증을 실제로 통과시킨다", mutation check "get_evidence가 pendingEvidence를 보지 못하게 함" |
| F10 | `disposeAnalyzeSession`은 idempotent다 — 없는 session에 다시 불러도 안전하다 | stop과 turn 종료가 경쟁하면 둘 중 나중 것이 예외를 던지거나 다른 task의 session을 잘못 건드릴 위험 | `state.ts` 구현 자체(`if (!session) return;`), `m4-wiring.test.mjs` stop 시험 |
| F11 | Validator ④(identity 재사용 제안)는 **warning**이지 error가 아니다 | agent가 진짜 split을 만들어야 할 때 강제로 막힌다 (I1 위반 — 판단은 AI, 측정은 Core) | `validator.test.mjs` "같은 이름의 Concept를 새로 만들면 재사용 후보를 warning으로 알려준다" |
| F12 | Claim identity key는 `(subjectConceptId, normalize(predicate), objectKey)`이고 `normalize`는 소문자화+공백압축뿐이다 — 동의어 사전을 넣지 않는다 | I3(전역 관계 vocabulary 금지) 위반 | `identity.ts`의 `normalizePredicate()` 정의 자체, §6.4 |
| F13 | `AnalyzeSession.restartAfterRace`의 `reopen` 인자는 동기 함수다 — Core가 파일시스템 재인덱싱을 스스로 하지 않는다 | Core/bridge 경계가 무너져 `@onto/core`가 `@onto/evidence`의 인덱싱 로직에 직접 의존하게 된다 | §6의 경계 설명, `apps/bridge/src/index.ts`의 `performReindex` 선실행 패턴 |

---

## 8. M5 이후 유지해야 하는 compatibility rules

M5(Semantic Patch 루프 + 증분 갱신 + SemanticWorkSet)가 이 위에 쌓을 때 지켜야 하는 것.

1. **`AnalyzeTransaction`/`AnalyzeSession`의 공개 표면을 그대로 쓴다.** `propose()` ·
   `visibleEvidence()` · `findEvidence()` · `unusedProposals()` · `abort()` ·
   `restartAfterRace()` · `dispose()`. M5가 증분 갱신 루프를 자동화하더라도, 그 루프는
   이 API 위에서 구현되어야지 이것을 우회하는 새 경로를 만들면 안 된다(예: store를 직접
   건드려 pendingEvidence 없이 evidence를 주입하는 것 — F5·F9를 우회하게 된다).
2. **`analysisVersion`의 뜻은 하나로 고정되어 있다** — "결정론적 저장소 인덱스의 상태."
   M5가 증분 갱신을 붙이더라도 이 뜻을 바꾸면(예: SemanticWorkSet 계산이
   `analysisVersion`을 올리게 하면) Trace cache staleness 키(§6.4 V2)와 Validator ⓪이
   같이 깨진다.
3. **`SemanticWorkSet`의 두 목록(`affected*`와 `ungroundedAppearedEvidenceIds`)은 M4가
   그대로 소비한다** — `apps/bridge`의 `reindex()`가 `buildWorkSet()`의 결과를 그대로
   `buildIncrementalAnalyzePrompt()`에 넘긴다. M5가 이 구조를 바꾸면(U1) M4가 만든
   프롬프트 빌더도 함께 바뀌어야 한다 — 이 문서는 그 변경을 막지 않지만, M4가 그 인터페이스에
   의존하고 있다는 사실은 기록해 둔다.
4. **`dirtyEvidenceCount`는 재인덱싱마다 `BridgeState`에 갱신된다** (`setDirtyEvidenceCount`).
   T3 재시작 후에도 새 `work.dirtyEvidence.length`로 다시 설정된다 — Validator ④의 churn
   판정(§6.3)이 이 값에 의존하므로, M5가 이 값을 다른 시점에 계산하게 바꾸면 churn 경고의
   기준(§`churnWarning`의 `budget = Math.max(5, dirty * 3)`)이 근거를 잃는다.
5. **`propose_evidence`가 만드는 id 형식(`ev:agent:<sha1(...)>`)과 `submit_semantic_patch`가
   요구하는 `base*Version` 필드는 MCP tool의 외부 계약이다.** M5가 새 tool을 추가하는 것은
   자유이지만, 이 두 tool의 입출력 shape을 바꾸면 이미 등록된 Codex/Claude MCP 설정과
   프롬프트(`apps/bridge/src/prompt.ts`의 `EVIDENCE_RULES`)가 함께 깨진다.
6. **race 진단 코드 `"evidence/file-changed-during-turn"`은 문자열 계약이다.**
   `apps/bridge`가 `outcome.diagnostics.find((item) => item.code === "evidence/file-changed-during-turn")`
   로 T3 분기를 탄다 — 이 코드 문자열을 바꾸면 bridge의 race 복구 분기 전체가 조용히
   죽는다(디버깅하기 매우 어려운 방식으로).

---

## 9. 이 문서가 다루지 않는 것

- View Planner(Overview·Scenario), Trace 투영, `submit_view_ir` — M6 범위.
- SemanticWorkSet의 **생성** 로직 자체(U1, `buildWorkSet()`)의 세부 — M1에서 이미
  구현·시험되었고 M4는 그 결과를 소비만 한다. M5가 그것을 바꾸는 것은 이 문서의 범위 밖이다.
- `@onto/evidence`의 P0~P3 인덱서 내부 — M1·M2 범위. M4는 그 출력(`EvidenceIndex`)의
  소비자일 뿐이다.
