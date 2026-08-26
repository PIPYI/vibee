# Ontology Structure V6 — 결과 보존을 전제로 한 토큰·시간 최적화

## 0. 문서 상태와 기준선

- 상태: 일부 구현 완료, 나머지는 측정·검증 우선 계획 단계
- 기준 브랜치/커밋: `ontology3` / `25b2d5d` (`Complete semantic turns after patch submission`)
- 대상: `prototypes/ontology/`의 분석 파이프라인(결정론적 인덱싱 → Semantic → Assembly)
- 문서 역할: V5의 **발견 범위와 결과 품질** 개선 계획을 대체하지 않고, 그 결과를 만드는 과정의
  **토큰 소비·대기 시간·반복 호출**을 줄이는 작업의 source of truth로 보완한다.

V5는 QA Maker에서 evidence가 최종 bundle에 충분히 반영되지 않는 문제를 다룬다. V6의 우선
불변식은 그 반대편의 제약이다.

> **어떤 최적화도 만들어지는 분석 결과(ArchitectureIR, WorkflowIR, UserMapIR, SequenceIR 및
> 근거 참조)의 의미·범위·검증 결과를 바꾸면 안 된다.**

따라서 "모델에 덜 보여 주기"는 그 자체로 V6의 해결책이 아니다. 정보 손실이나 순서 변화만으로도
생성형 모델의 결과가 달라질 수 있다. V6에서는 결과를 바꾸지 않는 관측/로컬 I/O 개선부터 하고,
LLM 입력을 바꾸는 개선은 shadow 비교와 fallback을 갖춘 뒤에만 검토한다.

### 용어와 증거 수준

- **관찰**: 로그·세션 기록·저장 파일·현재 코드에서 직접 확인했다.
- **추론**: 관찰된 호출 수/바이트/제어 흐름으로부터 가능한 원인을 설명한다. 아직 인과가 확정된
  것은 아니다.
- **결정**: 이번 문서에서 합의한 구현 순서 또는 금지 조건이다.

수치에 `cache 포함`이라고 쓰인 경우에는 provider가 보고한 cache read/write까지 합산한 처리량이다.
그 외 token 수는 adapter가 기록한 provider별 원시 지표일 수 있으므로, 서로 직접 비교하지 않는다.

---

## 1. 현재 파이프라인과 병목의 위치

분석은 대략 다음 순서로 실행된다.

```text
선택 프로젝트
  └─ Stage 1: re-index / System Fact 생성 (결정론적)
       └─ Stage 2: Semantic turn (LLM, Semantic Patch 제출)
            └─ Stage 3: Assembly turn (LLM, Analysis Bundle 제출)
                 └─ validator → generation commit → UI가 HEAD 결과 읽기
```

Semantic과 Assembly는 `runAnalyzePipeline()`에서 각각 새 provider session으로 시작한다. 즉 Assembly가
Semantic 대화 문맥을 그대로 이어받는 구조는 아니다. 반대로 각 stage 안에서는 MCP 조회 응답과 도구
스키마가 누적되어 모델 문맥과 왕복 시간이 커질 수 있다.

### 관찰: QA Maker의 실제 stage별 비용

동일 QA Maker 프로젝트의 실제 실행에서 아래 값이 기록됐다.

| Stage | MCP 호출 | 도구 응답 바이트 합계 | 경과 시간 | cache 포함 처리량 |
| --- | ---: | ---: | ---: | ---: |
| Semantic | 24 | 260,009 bytes | 약 3.7분 | 1,295,144 tokens |
| Assembly | 69 | 159,372 bytes | 약 13.9분 | 3,024,384 tokens |
| 합계 | 93 | 419,381 bytes | 약 17.6분 | 4,319,528 tokens |

Assembly의 69회 중 직접 분류가 확인된 호출은 Concept context 15회, System Fact 조회 23회,
Evidence 조회 20회, Scenario context 4회로 62회다. 나머지 7회에는 시작용 memory/impact 조회와
제출·재시도 계열 호출이 포함된다. 현 영속 rollout report에는 모든 tool 이름별 분포가 남지 않으므로,
이 7회를 더 세분화한 값은 **미확정**이다. Semantic도 총 24회는 확인됐지만, tool별 정확한 분포는
영속 기록만으로 복원되지 않는다. 이것이 §6의 telemetry 정규화가 먼저 필요한 이유다.

### 추론: 가장 큰 시간 비용은 LLM 왕복과 반복 조사다

Assembly는 69회의 순차 MCP 상호작용을 거쳤고 Semantic도 24회다. 서버의 JSON 읽기 비용도 있지만,
각 도구 호출 뒤 모델이 다음 결정을 내리는 순차 왕복 자체가 분 단위 대기의 주된 후보다. 특히
Concept·Fact·Evidence를 하나씩 다시 확인하는 N+1 흐름은 이미 계산되어 저장된 Core 근거를 모델이
재조립하도록 만든다. 이 결론은 호출 수와 시간이 뒷받침하지만, 각 호출의 네트워크/모델 지연을 아직
개별 계측하지 않았으므로 정확한 비율은 확정하지 않는다.

---

## 2. Provider 비교: 두 provider 모두 비용이 크며, 현재 수치는 동등 비교가 아니다

### 관찰: 고정 fixture 측정

고정 fixture와 고정 모델 설정에서 기록된 adapter 수치는 다음과 같다.

| Provider | 모델/effort | Semantic | Assembly | adapter 합계 | 경과 시간 |
| --- | --- | ---: | ---: | ---: | ---: |
| Claude | Sonnet 5 / medium | 34,263 | 23,874 | 58,137 | 약 9분 19초 |
| Codex | GPT-5.6-terra / medium | 372,578 | 327,568 | 700,146 | 약 5분 51초 |

Codex stage 기록에는 cache read가 Semantic 314,112, Assembly 262,400으로 별도 나타난다. Claude
adapter의 `totalTokens`는 provider 응답의 일반 input/output 합계로 기록되고 cache read/write는
별도 필드다. Claude가 작은 수를 보인다고 해서 실제로 작은 문맥을 처리했다는 뜻이 아니며, QA Maker
실행에서는 cache 포함 처리량이 432만 tokens 이상으로 확인됐다.

### 결정: "12배" 같은 단순 provider 비교는 중단한다

위 fixture의 700,146 ÷ 58,137은 서로 다른 cache 회계 방식을 나눈 값이다. 이를 모델 효율 차이로
해석하면 안 된다. 시간도 반대로 Codex가 더 짧았기 때문에, 원시 total 하나로 원인을 설명할 수 없다.
V6의 비교 단위는 provider가 아니라 **stage·도구 호출·payload 크기**이며, 모든 provider에 아래
같은 열을 남긴 뒤에만 비용 비교를 한다.

- non-cached input tokens
- cache read tokens
- cache write tokens
- output tokens
- provider가 보고한 total/billed tokens(정의도 함께 저장)
- wall-clock time, tool별 요청/응답 bytes와 duration

이 변경은 관측만 바꾸며 LLM 입력, validator, 결과 bundle을 바꾸지 않는다.

---

## 3. 확인된 반복·과다 입력 위험

### 3.1 Semantic turn 안의 중복 Assembly 제출

**관찰**: 고정 fixture에서 Semantic turn이 `submit_semantic_patch`로 끝나지 않고 같은 turn에서
`submit_analysis_bundle`을 두 번 호출한 사례가 있었다. Semantic 제출 이후 정식 Assembly stage가
다시 실행되므로, 이 경우 같은 조립 작업이 중복된다.

**추론**: prompt의 "멈춰라" 지시만으로는 모델 행동을 경계할 수 없고, 모든 stage 도구가 한 session에
노출되면 모델이 다음 도구를 선택할 여지가 남는다.

**결정 및 구현 상태**: §5의 패치로 Semantic Patch가 성공한 뒤 provider turn을 완료 처리한다.
이 케이스는 구조적으로 차단됐다. 다만 QA Maker의 관찰 실행에서 이 중복이 매번 발생한 것은 아니므로,
가장 큰 평균 절감 항목이라고 주장하지 않는다.

### 3.2 Assembly의 N+1 context 조회

**관찰**: QA Maker Assembly의 분류된 62/69 호출이 Concept(15), System Fact(23), Evidence(20),
Scenario(4) 개별/반복 조회였다.

**추론**: 이미 같은 generation에 저장된 graph/evidence가 있는데 모델이 작은 단위로 계속 탐색한다.
각 응답은 작더라도 순차 왕복과 누적 문맥을 만든다. Assembly 13.9분과 302만 cache 포함 tokens의
가장 유력한 구조적 설명이다.

**미결정**: 기존 69회 조회의 정보 합집합, 조회 순서, 모델의 선택 경로가 결과에 영향을 주는지 아직
검증하지 않았다. 따라서 즉시 개별 도구를 제거하거나 Assembly에 고정 packet만 주는 변경은 금지한다.

### 3.3 full memory/System Fact 응답의 크기 위험

**관찰**: `get_system_facts`의 기본 상한은 entities 500개와 links 500개이며, QA Maker generation의
기본 응답은 약 533KB까지 커질 수 있다. 한 번의 `get_evidence` 기본 page도 종류에 따라 약 30–46KB다.
작은 fixture에서도 Codex가 `detail: "full"` 형태로 약 100KB를 받은 기록이 있다.

**추론**: 한 번의 큰 full 응답이 수만~십만 토큰의 문맥을 만들 수 있고, 여러 도구 응답이 cache에
반복 포함되면 실제 처리량이 급증한다. 이는 provider 하나만의 문제가 아니다.

**미결정**: 필요한 정보를 줄이면 품질이 바뀔 수 있다. payload 상한을 낮추거나 digest만 강제하는
것은 결과 보존 조건을 충족하지 못하므로 지금은 보류한다.

### 3.4 Scenario context 계약 불일치

**관찰**: prompt는 Canonical Scenario ID를 `get_scenario_context`에 넣도록 안내하지만, 현재 구현은
이름과 달리 Concept 중심으로 찾는다. QA Maker Assembly에서 4회의 Scenario 조회가 빈 응답이었다.

**추론**: 모델이 존재하는 Scenario를 못 찾고 다른 context 도구를 추가 호출할 수 있다.

**결정**: 계약을 고치면 빈 응답이 실제 data로 바뀌므로 결과가 바뀔 가능성이 높다. 성능상 낭비가
명백해 보여도 결과 보존 우선 원칙 아래에서는 별도 동등성 계획 전까지 보류한다.

### 3.5 stage와 무관하게 노출되는 도구

**관찰**: MCP server는 Semantic과 Assembly 관련 도구를 한 catalog에 등록한다. prompt에는
`submit_analysis_bundle (assembly turn 전용)`이라고 쓰였지만 tool visibility 자체가 stage별로
분리되어 있지 않다.

**추론**: 3.1 같은 잘못된 다음 행동의 원인이 될 수 있고, 넓은 도구 스키마도 문맥 부담이 된다.

**결정**: 성공 후 종료 패치가 먼저 적용됐다. stage별 tool filtering은 fallback 탐색까지 막을 위험이
있어, 결과 parity 증거 없이 적용하지 않는다.

### 3.6 반복 `SemanticStore.load()`

**관찰**: bridge의 여러 MCP read endpoint는 매 호출마다 `loadState(projectPath)`를 실행한다.
이는 같은 generation의 `evidence.json`, `system-facts.json`, memory 등을 다시 파일에서 읽고 JSON으로
파싱할 수 있다. impact-context의 계산 결과 cache가 있어도 state를 load한 뒤 cache를 확인하는 경로가
있다.

**추론**: 이 비용은 모델 token을 줄이지 않지만 93회의 local I/O/parse 중복을 줄여 wall-clock을
낮출 수 있다.

**결정**: 같은 task와 generation 동안의 read-only snapshot cache는 결과 JSON을 byte-for-byte 그대로
돌려줄 수 있는 후보다. cache key, invalidation, 병렬 task 격리를 검증하기 전에는 구현하지 않는다.

---

## 4. `.project-intel` 저장 구조와 QA Maker 이력

분석 결과는 앱 저장소가 아니라 사용자가 선택한 프로젝트 디렉터리 내부에 저장된다.

```text
<selected-project>/.project-intel/
├── HEAD                         # 현재 generation: { "generation": 8 }
├── events.ndjson                # rollout report 등 event
└── gen/000001/ ... gen/000008/  # generation별 전체 snapshot
    ├── project.json
    ├── evidence.json
    ├── system-facts.json
    ├── semantic-memory.json
    ├── grounding.json
    ├── versions.json
    ├── analysis-bundle.json
    └── manifest.json             # 파일 sha256
```

`analysis-bundle.json`은 Architecture/Workflow/User Map/Sequence의 저장 결과다. `HEAD`만 현재 UI와
다음 분석이 기본으로 읽고, 이전 generation은 rollback/history를 위한 copy-forward snapshot이다.
현재 기본 보존 수는 20 (`DEFAULT_RETAIN = 20`)이며, QA Maker의 generation 1~8 파일 총합은 약
18MB(측정값 18,594,053 bytes, 약 17.73 MiB)다.

### 관찰: QA Maker generation 1~8의 정확한 commit 이력

| Generation | 시각 (UTC) | source | 내용 | 분석/의미 버전 |
| ---: | --- | --- | --- | --- |
| 1 | 2026-08-25 08:19:56 | `init` | 빈 초기화 | analysis 0 / semantic 0 |
| 2 | 08:19:59 | `index` | 첫 전체 discovery re-index | 1 / 0 |
| 3 | 08:20:13 | `index` | 다시 전체 discovery re-index | 2 / 0 |
| 4 | 08:23:45 | `patch` | Semantic Patch: Concept 15, Claim 17, Scenario 2 추가 | 2 / 1 |
| 5 | 08:37:44 | `bundle` | 첫 Analysis Bundle commit | 2 / 1 |
| 6 | 11:04:46 | `index` | 영향 범위 re-index: bundle 조각 30, discovery root 29 | 3 / 1 |
| 7 | 11:06:33 | `patch` | 빈 Semantic Patch commit(semantic reconciliation) | 3 / 2 |
| 8 | 11:13:23 | `bundle` | 두 번째 Analysis Bundle commit | 3 / 2 |

**관찰**: 사용자가 index를 선택해 generation 2를 만든 뒤 분석을 시작했을 때, 분석 시작 과정이 다시
전체 re-index를 수행해 generation 3을 만들었다. 두 generation 모두 전체 discovery 사유이며,
이것은 저장 용량과 초기 처리 시간의 중복 관찰이다. V6은 이것을 "불필요하다"고 아직 결론 내리지
않는다. 분석 시작 시 freshness/transaction 안전성을 위해 재색인이 요구됐을 수 있으므로, 먼저
index 결과 재사용 조건과 hash/dirty-file 불변식을 확인해야 한다.

---

## 5. 완료된 최소 패치 — Semantic 성공 후 turn 종료

### 목적과 설계

`25b2d5d`는 Semantic Patch가 **성공적으로 커밋된 경우에만** 현재 provider turn을 끝낸다.
HTTP 성공 응답을 먼저 전송하고 response의 `finish` 뒤 `adapter.stopTask(taskId, "completed")`를
호출한다. 그래서 모델은 성공 응답을 받은 뒤 같은 Semantic turn에서 Assembly bundle을 제출할 수 없다.

실패, validation diagnostic, 파일 변경 race, 사용자 Stop의 제어 흐름은 바꾸지 않는다. Assembly는
기존대로 별도의 새 session에서 시작해 저장된 Semantic Memory를 읽는다. 이 패치는 input evidence,
Semantic Patch 내용, Assembly prompt, validator와 committed bundle 형식을 바꾸지 않는다.

### 변경 파일

- `apps/bridge/src/stage-completion.ts`: response 완료 뒤 semantic task를 `completed`로 멈추는 작은
  helper.
- `apps/bridge/src/index.ts`: `submit_semantic_patch` 성공 경로에서 helper를 연결.
- `apps/bridge/src/agents/types.ts`: adapter stop reason에 `completed`를 표현.
- `apps/bridge/src/agents/claude/adapter.ts`: Claude session을 정상 완료로 중단.
- `apps/bridge/src/agents/codex/adapter.ts`: Codex turn을 정상 완료로 중단.
- `apps/bridge/test/stage-completion.test.mjs`: response finish 이후의 종료와 실패/미완료 경로 회귀.

### 검증 완료

- bridge `typecheck` 통과
- bridge build 통과
- `stage-completion.test.mjs` 통과
- 기존 Claude adapter 테스트 통과
- `git diff --check` 통과

실제 provider E2E 재실행은 큰 token 비용이 있어 이 커밋 시점에는 하지 않았다. 또한 기존
`m4-wiring.test.mjs`는 단독 실행 시 완료 출력 없이 대기하여 확정 pass/fail을 얻지 못했다.

### 남은 위험

분석 산출물 관점의 위험은 낮다. 성공 응답 시점에는 Semantic Memory가 이미 transaction으로 저장되고,
정식 Assembly가 별도로 계속 실행되기 때문이다. 다만 adapter를 programmatic stop하면 provider의 마지막
usage event가 오지 않아 stage usage telemetry가 실제보다 작게 기록될 가능성이 있다. 이는 **결과가
아닌 측정 정확성**의 위험이며, §6.1의 metric 통일 전에 E2E로 확인해야 한다.

---

## 6. 결과 보존 기준의 패치 분류와 순서

### A. 바로 진행 가능한 안전 패치

#### 6.1 Token metric 통일 — 관측 전용

각 stage와 provider에서 non-cached input, cache read/write, output, provider total/billed, tool bytes,
tool duration을 같은 schema로 기록한다. 기존 최종 결과와 MCP request/response에 영향을 주지 않는다.

**gate**: 같은 run 전후의 `analysis-bundle.json` SHA-256, committed generation의 manifest, validator
diagnostics가 모두 같아야 한다. 이 변경 자체는 output을 만들지 않으므로, instrumentation이 분석 실행을
방해하지 않는지만 확인한다.

#### 6.2 same task/generation `loadState` read cache — 로컬 I/O 전용

동일 task·동일 HEAD generation에서 읽는 state snapshot을 immutable cache로 재사용한다. generation이
바뀌거나 task가 끝나면 반드시 버린다. mutation route, 다른 project, 다른 task 사이에서는 공유하지
않는다.

**조건**: cache hit 응답이 cache miss 응답과 JSON 직렬화 기준으로 같아야 한다. transaction commit,
rollback, re-index, race recovery 시 invalidation을 테스트한다.

### B. 조건부 패치 — shadow 검증이 먼저

#### 6.3 Assembly packet(통합 context) — 활성화 전 shadow only

Core가 기존 69회 탐색에서 모델이 읽은 Concept·Claim·Canonical Scenario·관련 System Fact·Evidence를
중복 없이 묶은 **후보 packet**을 만들 수 있다. 하지만 packet이 결과 보존을 자동으로 보장하지는 않는다.
LLM은 정보의 순서·표현·탐색 과정에도 영향을 받는다.

따라서 첫 구현은 model prompt를 바꾸지 않는 shadow output이어야 한다.

1. 기존 Assembly run과 병행해 packet을 생성하고 저장/계측만 한다.
2. 기존 tool 응답의 합집합 대비 packet의 Concept, Scenario, System Entity/Link, Evidence ID coverage를
   계산한다.
3. 실제 제출 bundle이 참조한 모든 ID가 packet에 있는지 확인한다.
4. coverage parity와 validator parity가 누적 fixture에서 성립할 때까지 기존 개별 도구를 유지한다.
5. 활성화를 검토하더라도 기존 개별 조회를 fallback으로 남기고 fallback 사용량을 측정한다.

이 단계에서 payload를 작게 만들기 위해 evidence를 요약/절단하면 안 된다. 목표는 **동일 정보의 중복
전달 제거**이지 recall 저하다.

### C. 보류 — 결과 의미를 바꿀 수 있는 패치

- stage별 MCP tool visibility 강제 분리: fallback 조사와 모델의 수습 경로를 막을 수 있다.
- `get_system_facts`/evidence의 강제 축소 또는 full memory 제거: 입력 evidence가 달라진다.
- Scenario context 구현/프롬프트 계약 수정: 기존의 빈 응답 대신 실제 context가 들어간다.
- index generation 2 → 분석 re-index generation 3의 생략: freshness와 race 안전성 증명 전에는
  중복처럼 보여도 삭제하지 않는다.

이 항목들은 성능 개선 후보로 기록하되, "현재 결과와 영향이 없어야 한다"는 우선순위를 만족하지
않으므로 이번 V6 작업 순서에서 제외한다.

---

## 7. 검증 gate와 미결정 사항

### 공통 결과 보존 gate

모든 성능 변경은 최소한 다음을 통과해야 한다.

1. 변경 전/후 같은 fixture, 같은 generation 입력, 같은 provider/model/effort를 사용한다.
2. committed `analysis-bundle.json`의 구조·참조 ID·validator 결과를 비교한다. 모델의 비결정성 때문에
   byte 단위 동일성을 항상 요구할 수 없다면, 차이를 분류해 사용자 기능/근거/coverage가 같음을
   명시적으로 입증한다.
3. Architecture/Workflow/UserMap/Sequence의 validator diagnostics, topology coverage, grounding 참조가
   빠지지 않았는지 확인한다.
4. QA Maker 외 fixture에서도 같은 gate를 실행한다. V5의 coverage 개선을 되돌리는 최적화는 실패다.
5. token/time 개선 수치는 cache 회계가 통일된 schema로 기록된 뒤에만 주장한다.

### 아직 답하지 못한 질문

- Semantic 24회와 Assembly의 미분류 7회가 각각 어떤 tool/재시도 경로인지, 호출별 duration과 payload는
  얼마인가?
- programmatic `completed` stop 뒤 Claude/Codex가 final usage event를 모두 남기는가?
- Assembly packet이 기존 개별 조회의 합집합과 실제 최종 bundle 참조를 모두 덮는가?
- full System Fact 응답이 실제로 어떤 stage의 token 증가를 지배하는가, 아니면 tool schema/반복 대화가
  더 큰가?
- generation 2의 index 결과를 generation 3에서 안전하게 재사용할 수 있는 정확한 freshness 조건은
  무엇인가?

이 질문에 답하기 전에는 "token을 줄이기 위해 context를 줄인다"는 변경을 하지 않는다. V6의 성공은
적은 토큰이라는 숫자 하나가 아니라, **동일하거나 입증 가능한 동등한 분석 결과를 더 적은 왕복·I/O·
회계 오류 없이 만드는 것**이다.
