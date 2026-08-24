# 분석 런타임 V3 — 검증, 세션, 토큰, 증분 Assembly

> V3.1 구현 메모(2026-08-24): §3의 `validation.retrying`, §4의 분석 Stage 세션 분리,
> §5의 Stage별 사용량 누적, `workflow.mainPath` prompt preflight를 1차 구현했다. §6 batch
> retrieval과 §7 증분 Bundle patch는 아직 설계 상태다. 세부 파일과 검증 결과는
> [README V3.1 기준선](./README.md#v31-구현-기준선--2026-08-24)을 따른다. 다음 구현은
> [V3.2 계획](./v3.2_plan.md)에서 runtime handshake, schema contract, bounded patch correction,
> 진행 UX와 Python Evidence까지 구체화한다.

## 1. 문제 정의

V2.x 파이프라인은 Core 검증으로 결과의 무결성을 높였지만, 하나의 `분석` 요청 안에서
Semantic Memory turn과 AnalysisBundle Assembly turn을 순차 실행하고 프로젝트별 agent
세션을 계속 resume한다. 이 구조는 다음 문제를 만든다.

- 복구 가능한 Validator 거절이 UI에서 치명적 분석 오류처럼 보인다.
- 같은 도구 호출의 `agent-stream`과 `bridge-endpoint` 관측이 두 번 실행된 것처럼 보인다.
- Stage 2와 Stage 3, 이후 재분석까지 대화 이력이 누적될 수 있다.
- agent가 기존 Bundle 전체를 Bash로 반복해서 읽으며 큰 문맥을 만든다.
- task 토큰 사용량이 Stage별로 합산되지 않고 최신 turn 값으로 덮어써진다.
- Claude의 cache read/create 사용량이 현재 계측에서 빠진다.
- 일부 검증 오류를 고치기 위해 큰 AnalysisBundle 전체를 다시 출력한다.

## 2. generation 36 진단 사례

`chungnam-mission-app-master` 재분석에서 첫 `submit_analysis_bundle`은 다음 진단으로
거절됐다.

```text
code: bundle/disconnected-main-path
path: /workflow/mainPath/4
from: wf:completion-reward
to: wf:travel-journal
reason: 두 노드를 잇는 workflow edge가 없음
```

agent는 같은 task와 같은 Claude 세션에서 `edge:reward-to-journal`을 추가하고 두 번째로
제출했다. 두 번째 제출은 generation 36으로 커밋됐다. 따라서 이 사건의 분류는 다음과 같다.

```text
recoverable validation correction
≠ agent turn error
≠ analysis pipeline failure
≠ concurrent duplicate session
```

당시 관측값:

| 항목 | 값 | 해석 |
|---|---:|---|
| Bridge listener | 1 | 같은 포트의 서버 중복 없음 |
| 분석 task | 1 | Stage 2와 Stage 3가 같은 taskId 사용 |
| 실행 중 task | 0 | 조사 시점에는 완료 상태 |
| 연결된 Claude 세션 | 1 | 다음 turn이 resume할 포인터이며 동시 실행을 뜻하지 않음 |
| 과거 비활성 세션 파일 | 2 | 디스크 기록일 뿐 명령을 보내지 않음 |
| 실제 MCP endpoint 호출 | 46 | `bridge-endpoint` 기준 |
| agent-stream 관측 | 46 | endpoint 호출과 1:1 대응 |
| Bash 호출 | 34 | 저장소·기존 Bundle을 직접 조사 |
| Read 호출 | 11 | 코드 파일 직접 조사 |
| 표시된 tokenUsage | 93,798 | 전체 task 비용이 아니라 마지막 계측값에 가까움 |

### 원인

Validator는 `workflow.mainPath`의 인접 노드가 실제 edge로 연결되는지 강제하지만 Assembly
프롬프트는 이 제약을 명시적으로 설명하지 않았다. 프롬프트는 실패 시 diagnostics를 읽고
재제출하라고만 지시했기 때문에 안전하게 복구했지만 첫 제출을 예방하지는 못했다.

## 3. 이벤트 의미 재설계

### 3.1 MCP 호출은 한 줄로 합친다

`agent-stream`과 `bridge-endpoint`는 같은 호출의 서로 다른 관측 증거다. 원시 이벤트는 둘 다
보존하되 UI에서는 `taskId + toolCallId`로 합쳐 하나의 상태로 보여준다.

```text
호출 보고됨 → endpoint 도달 → 데이터 반환
```

권장 표시:

- 진행 중: `Evidence 조회 중`
- 성공: `Evidence 조회 완료 · 28회`
- 배선 이상: `호출은 보고됐지만 Bridge에 도달하지 않음`
- 데이터 이상: `Bridge에 도달했지만 memory_unavailable 반환`

도구 이름과 두 증거원은 `진단 상세`에서만 펼친다.

### 3.2 Validator 재시도 상태를 추가한다

권장 이벤트:

```ts
type ValidationRetryEvent = {
  type: "validation.retrying";
  taskId: string;
  tool: string;
  attempt: number;
  maxAttempts: number;
  diagnostics: Diagnostic[];
};
```

상태 전이:

```text
assembly.submitting
  → validation.retrying
  → assembly.submitting
  → bundle.ready
```

최종 제출이 성공하면 경고 상태를 해제하고 `1회 자동 보정 후 완료`를 남긴다. 재시도 한도를
넘기거나 turn이 종료됐는데 Bundle이 없을 때만 `task.error`로 전환한다.

### 3.3 진단을 숨기지 않는다

현재 콘솔은 `검증 실패 — submit_analysis_bundle`만 보여준다. V3에서는 최소한 다음을
노출한다.

- 진단 코드
- 사람이 읽는 원인
- 영향받은 IR 경로
- 자동 수정 여부와 시도 횟수
- 최종 성공/실패

## 4. 세션 수명 정책

### 4.1 세션 종류를 분리한다

| 세션 | 수명 | resume | source of truth |
|---|---|---|---|
| 사용자 대화 | 사용자가 초기화할 때까지 | 허용 | 대화 문맥 |
| Semantic reconciliation | 분석 task의 Stage 2 동안 | 기본 금지 | WorkSet + Evidence + Semantic Memory |
| Bundle assembly | 분석 task의 Stage 3 동안 | 기본 금지 | 최신 Semantic Memory + Topology + 기존 Bundle digest |
| 온디맨드 View | 요청 하나 | 기본 금지 | View request + Core context |

분석 Stage는 대화 기록이 아니라 Core 상태로 이어진다. Stage 2가 끝나면 Semantic Memory가
커밋되므로 Stage 3는 새 세션이어도 필요한 정보를 잃지 않는다.

### 4.2 동시 실행 불변식

- Bridge 인스턴스 하나에서 active analysis task는 최대 1개다.
- task는 여러 Stage를 가질 수 있지만 동시에 두 Stage를 실행하지 않는다.
- `active session`은 resume 대상 포인터와 실행 중 turn을 구분해 표현한다.
- MCP stdio child process는 agent query의 도구 통신 수단이지 별도 AI 세션으로 세지 않는다.
- Stop, error, completion 경로에서 active turn과 transaction을 모두 정리한다.

### 4.3 명시적 재사용 예외

세션 resume는 기본값이 아니라 최적화로 취급한다. 다음 조건을 모두 만족할 때만 허용한다.

- 동일 분석 task 내부
- 직전 Stage의 출력이 Core에 아직 커밋되지 않아 대화 문맥이 필수
- 예상 절감량이 문맥 누적 비용보다 큼
- resume된 세션 ID와 누적 사용량을 UI에 표시

현재 파이프라인은 Stage 사이에 Core 커밋이 있으므로 이 예외가 필요하지 않다.

## 5. 토큰 계측

### 5.1 덮어쓰기 대신 Stage별 누적

task에 단일 `tokenUsage: number`를 두지 않고 다음처럼 기록한다.

```ts
type StageUsage = {
  stage: "semantic" | "assembly" | "view";
  turnId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCost?: number;
};
```

task 전체 사용량은 StageUsage 합계로 계산한다. provider가 특정 필드를 보고하지 않으면 0으로
속이지 않고 `unknown`으로 표시한다.

### 5.2 UI 표시

기본 화면에는 다음만 보인다.

```text
분석 비용 · Semantic 18k · 지도 조립 42k · 총 60k
```

진단 상세에서는 입력, 출력, cache read/write, 모델, effort, turn 수를 보여준다. 사용량이
예산 임계치를 넘으면 다음 Stage 시작 전에 경고하거나 축약 경로로 전환할 수 있어야 한다.

## 6. 조회와 문맥 크기 줄이기

### 6.1 Batch retrieval

- Evidence ID 배열을 한 번에 조회한다.
- Concept context도 anchor 배열 또는 Scenario 단위 묶음 조회를 지원한다.
- 같은 분석 task에서 동일 요청은 Core/Bridge가 캐시한다.
- 도구 결과에는 전체 source 대신 필요한 line range와 digest를 기본 반환한다.

### 6.2 기존 Bundle 접근

agent가 `.project-intel`의 기존 Bundle 전체를 Bash와 `jq`로 반복해서 덤프하지 않도록 Core가
다음을 제공한다.

```ts
type PreviousBundleDigest = {
  generation: number;
  componentSummaries: ...;
  connectionSummaries: ...;
  journeySummaries: ...;
  sequenceSummaries: ...;
  affectedIds: string[];
};
```

전체 객체가 필요한 경우에도 영향받은 ID만 선택 조회한다. Bash 자체를 전면 금지하지는
않는다. 코드 검색에는 유용하기 때문이다. 대신 `.project-intel` 내부 대형 산출물을 직접
덤프하는 경로를 피하도록 도구와 프롬프트를 설계한다.

## 7. 증분 AnalysisBundle

### 7.1 기본 흐름

```text
Repository re-index
→ EvidenceDiff / SemanticWorkSet
→ Semantic patch
→ BundleImpactSet 계산
→ 영향받은 IR 조각만 agent가 제안
→ Core가 기존 Bundle과 merge
→ 전체 불변식 검증
→ 새 generation 커밋
```

`BundleImpactSet` 후보:

```ts
type BundleImpactSet = {
  componentIds: string[];
  connectionIds: string[];
  journeyIds: string[];
  sequenceIds: string[];
  requiresFullAssembly: boolean;
  reasons: string[];
};
```

### 7.2 전체 Assembly 조건

- 첫 AnalysisBundle 생성
- IR/schema/planner version 변경
- 런타임 추가·삭제 또는 boundary 소유권 변경
- Canonical Scenario identity의 대규모 변경
- 이전 Bundle이 Validator를 통과하지 못함
- 영향 범위를 안전하게 계산할 수 없음

그 외에는 패치를 기본으로 한다.

### 7.3 제출 계약

장기적으로 `submit_analysis_bundle` 외에 부분 제출 계약을 둔다.

```ts
type AnalysisBundlePatch = {
  baseGeneration: number;
  upsertComponents?: ArchitectureComponent[];
  removeComponentIds?: string[];
  upsertConnections?: ArchitectureConnection[];
  removeConnectionIds?: string[];
  upsertJourneys?: ScenarioIR[];
  removeJourneyIds?: string[];
  upsertSequences?: SequenceIR[];
  removeSequenceIds?: string[];
  workflowPatch?: ...;
};
```

Core만 merge와 최종 전체 검증을 수행한다. agent는 `baseGeneration`이 현재 HEAD와 다르면
재조회해야 하며 임의로 충돌을 덮어쓰지 않는다.

## 8. Preflight와 자동 복구

비용이 큰 MCP 제출 전에 Bridge 또는 SDK가 같은 Validator를 로컬 preflight로 실행한다.

- dangling ref
- disconnected `workflow.mainPath`
- 누락 runtime/data store
- Sequence 양방향 참조 불일치
- Canonical Scenario와 UserMap journey 불일치
- Evidence가 없는 설명

안전하게 결정 가능한 presentation 값은 Core가 계산한다. 예를 들어 실제 edge 그래프에서
연결된 `mainPath`를 선택하는 것은 Core가 할 수 있다. 반면 빠진 의미 edge를 자동 생성하는
것은 근거를 발명할 수 있으므로 agent에게 진단으로 돌려보낸다.

## 9. 수용 기준

1. 한 MCP 호출이 기본 콘솔에서 한 줄만 차지한다.
2. 두 증거원 중 하나가 빠지면 배선 오류로 정확히 표시한다.
3. 첫 제출 실패 후 성공하면 task는 성공이고 자동 보정 횟수가 남는다.
4. `bundle/disconnected-main-path`를 큰 Bundle 전체 재출력 없이 수정할 수 있다.
5. 연속 분석 10회 후에도 분석 세션의 대화 문맥이 누적되지 않는다.
6. Semantic/Assembly Stage의 사용량이 각각 보이고 task 합계와 일치한다.
7. Claude cache read/create 토큰이 별도 표시되거나 `unknown`으로 정직하게 표시된다.
8. 코드 한 파일 변경 시 영향받지 않은 journey와 sequence의 ID·내용이 유지된다.
9. 런타임 추가 같은 큰 변경은 자동으로 전체 Assembly로 승격된다.
10. 최종 Bundle은 기존 V2.x Core 불변식을 모두 통과한다.
