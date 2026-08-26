# ontology_schema2.md — Viewer 층

> **상태: FROZEN.** 이 문서의 architecture와 범위는 확정되었다.
> 구현하다가 계획과 현실이 어긋나면 **이 문서를 임의로 고치지 않는다.**
> `docs/ontology/structure/m0_m8/FINDINGS.md`의 §8 형식대로 관찰과 변경 후보를 기록한다.
>
> 선행 문서는 [m0_m8/ontology_schema.md](./m0_m8/ontology_schema.md)와
> [m0_m8/implementation_plan.md](./m0_m8/implementation_plan.md)다.
> 이 문서의 §는 자기 자신을, `schema §N`은 전자를, `plan §N` / `I n` / `A n`은 후자를 가리킨다.

---

## 0. 문서 목적과 m0_m8과의 관계

M0~M8이 **Core**를 확정했다 — Evidence Engine, Semantic Memory, Validator, generation store,
Overview·Scenario·Trace 세 View, 그리고 §7.3 평가 arm. 이 문서는 그 위에 얹히는 **Viewer 층**만
다룬다.

**I1~I13을 그대로 상속하고 아무것도 폐기하지 않는다.** m0_m8의 어떤 결정도 이 문서로 조용히
개정되지 않는다. 뒤집어야 할 것이 생기면 그것은 Finding이다.

이 문서가 생긴 이유는 하나의 관찰이다: 참고 프로젝트 archify가 만든 HTML이 우리 viewer보다
읽기 좋았다. 이 문서는 **그 차이가 정확히 무엇인지 규명하고, 무엇을 빌리고 무엇을 빌리지
않을지**를 정한다.

목적은 예쁜 diagram이 아니다. **시스템 상태를 설명하고 debugging/analysis에 쓸 수 있는
visualization 층**이다.

---

## 1. archify 재평가

`plan §3.1`의 A1~A8은 archify를 **schema·validator·bounded view** 관점에서 조사했다.
이번에는 **layout과 viewer** 관점에서 다시 본다. 먼저 사실부터 바로잡는다.

### 1.1 archify에는 코드 분석 엔진이 없다

`reference/archify-main/archify/SKILL.md`는 Claude Skill 정의다. 동작은 이렇다.

```text
agent가 typed JSON spec을 직접 작성
        ↓
node bin/archify.mjs validate|deliver
        ↓
검증된 spec → 결정론적 geometry → 자체 완결 HTML
```

검증된 사실:

- `archify/package.json`에는 **`dependencies` 항목이 아예 없다** — 런타임 의존성이 0이다.
  `devDependencies`는 `ajv`와 `simple-icons` 둘뿐이다. AST 파서도 indexer도 없다.
- `renderers/shared/repository-evidence.mjs`(235줄)는 `git`을 실행해 origin과 revision을 얻고,
  **author가 적어 낸 `path@sha#L10-20`이 실재하는지 확인**한다. 코드를 읽어 구조를 뽑지 않는다.
- SKILL.md의 표현도 정확히 그렇다 — "**inspect repository evidence** when the diagram must
  reflect real code". 저장소를 읽는 주체는 agent다.

따라서 첨부 예시 HTML의 노드·엣지·경계는 **archify가 분석해 낸 것이 아니라 agent가 손으로
적은 것**이고, `repository-evidence`는 그 인용이 거짓이 아님을 확인해 줄 뿐이다.

**"archify의 분석 엔진"은 존재하지 않는다.** 이 오해 위에서 방향을 정하면 우리가 이미 가진
것(Evidence Engine)을 버리고 우리에게 없는 것(analysis)을 빌리려 하게 된다. 실제 대차대조표는
정반대다.

| 층 | archify | onto (M0~M8) |
|---|---|---|
| 코드 분석 | **없음** | TS AST indexer + adapter 7종 + call/reference 그래프 + route/model entity + git |
| Evidence | author 인용의 실재 확인 | 주소 기반 id · contentHash freshness · EvidenceDiff · relocation · many-to-many grounding |
| 영속 | 없음 (HTML 한 장) | generation + atomic HEAD + 증분 Semantic Patch |
| Validator | ajv + 구성/기하 검사 + Diagnostic | ajv + evidence/grounding/stability/race 5단계 + 같은 Diagnostic (A3로 이미 차용) |
| **layout 엔진** | `renderers/shared/geometry.mjs` **1334줄** | `scenarioLayout.ts` 115줄 + `traceLayout.ts` 27줄 = **142줄** |
| **viewer runtime** | `assets/template.html` **13,728줄** | `apps/web` 전체 약 1,400줄, pan/zoom·검색·딥링크 **없음** |

> **onto가 분석과 근거에서 앞서고, archify가 layout과 viewer에서 앞선다.**
> 빌릴 것은 뒤의 둘이고, 그것이 화면에서 느낀 차이의 정체다.

### 1.2 A9~A13 — 신규 판정

`plan §3.1`의 표를 이어서 확장한다. 형식은 동일하다.

| # | Reference behavior | 우리 문제와의 관련성 | 차용 | 수정해서 적용할 방식 |
|---|---|---|---|---|
| **A9** | **Viewer 상호작용 어휘** — Reading Depth(MAP/READ/FULL), Node Finder, Semantic Passport, Semantic Radar, Route Probe, Intent Trace, Direct Relationship Pin, 딥링크 | 우리 viewer에는 pan/zoom·검색·딥링크가 **하나도 없다**. §41 Progressive Disclosure는 화면 전환으로만 구현되어 있다 | **차용** | layout·ontology와 독립된 **Viewer Shell**(§2)로 세 View 위에 공통으로 얹는다. IR·Validator·Core는 건드리지 않는다 |
| **A10** | **결정론적 geometry 엔진** — 자동 라우팅, port spread, 라벨 충돌 회피, 최소 세그먼트/회전 보장 | 우리 layout은 142줄이고 라벨 충돌 회피가 없다. Scenario/Trace가 커지면 바로 깨진다 | **차용 — 단 renderer 안에서만** | **A7은 *agent가 좌표를 쓰는 것*을 기각했지 결정론적 layout 엔진을 기각하지 않았다.** 알고리즘을 `apps/web/src/layout/`으로 이식한다. 입력은 IR, 출력은 좌표. 같은 IR → 같은 좌표 |
| **A11** | **sequence의 표현 문법** — lifeline, activation 바, phase segment, return 화살표 | `ScenarioIR`에 "누가 지금 활성인가", "어느 국면인가", "응답인가"를 적을 자리가 없다 | **차용 — 문법만** | `ScenarioIR`에 선택 필드 세 개를 더한다(§5). **spec 자체는 빌리지 않는다** |
| **A12** | `sequence.schema.json`의 **author 좌표** — `messages[].y`, `activations[].from/to`, `segments[].from/to` | agent가 세로 좌표를 직접 쓴다 | **차용하지 않음** | A7·I10 재확인. 그리고 archify의 `messages`에는 **`evidenceRefs`가 없다** — 그대로 쓰면 I9가 요구하는 grounding을 통째로 잃는다 |
| **A13** | **component type enum** (`frontend`/`backend`/`database`/`cloud`/`security`/`messagebus`/`external`)과 거기 걸린 색·sigil·legend·Semantic Lens | archify 시각 언어 **전체**가 이 enum 위에 서 있다 | **차용하지 않음** | `schema §9`가 이 어휘를 Core에 넣지 않을 뿐 아니라 **"'공식 presentation vocabulary'로도 미리 예약하지 않는다"**고 못박았고 I3와 정면 충돌한다. §7 I16 참조 |

### 1.3 A13이 실무적으로 가장 아프다

archify가 한눈에 읽히는 큰 이유는 **색이 의미를 나른다**는 것이다. 그런데 우리는 그 축을 쓸 수
없다 — `SemanticConcept`에는 `type`이 없고 `hints`만 있으며, `hints`는 "틀리거나 없어도 의미와
Grounding은 유효해야" 한다(I3). 틀릴 수 있는 값에 색을 걸면 화면이 조용히 거짓말한다.

**대체 축은 프로젝트 의미가 아니라 우리가 실제로 아는 것에서 온다.**

| 축 | 근거 | 이미 있는가 |
|---|---|---|
| anchor로부터의 hop 거리 | `TraceEntity.hop` | 있다 |
| 순환 그룹 | `TraceEntity.sccId` | 있다 (M7이 sccId 해시 색으로 구현) |
| grounding 상태 | `Evidence.status` · `origin` · `relocationConfidence` | 있다 (Grounding.tsx 배지) |
| freshness | `ViewFreshness` · `EvidenceDiff.contentChange` | 있다 |
| story 진행 | `entryStepId` → `outcomeStepIds` 순서 | 있다 |

`schema §9`를 그대로 적용한다: **고정되는 것 = View의 문법. 고정되지 않는 것 = 화면에 보이는
프로젝트 의미.** 색은 문법 쪽이되, 그 색이 나르는 것은 프로젝트 의미가 아니라 **근거의 상태**여야
한다.

---

## 2. Viewer Shell

IR·Validator·Core를 바꾸지 않고 기존 세 View 위에 공통으로 얹는 상호작용 층. **새 층을 하나
만드는 것이지 View를 하나 더 만드는 것이 아니다.**

### 2.1 최소 어휘

| 기능 | 무엇을 하는가 | 새로 필요한 데이터 |
|---|---|---|
| Focus + 이웃 강조 | 노드 하나를 고르면 직접 연결만 남기고 나머지를 흐린다 | 없음 — IR의 엣지로 충분 |
| Pan / Zoom | 캔버스 이동·확대 | 없음 |
| Reading Depth | 배율에 따라 MAP(구조만) / READ(관계 라벨) / FULL(태그·주석) | 없음 — 렌더 시 접기 |
| Node Finder | label · stable id · responsibility 검색 | 없음 |
| Semantic Radar | 전체 축소도 + 현재 뷰포트 사각형 | 없음 |
| 딥링크 | `#view=` `#focus=` `#route=` `#impact=` | 없음 |
| Freshness 표시 | `needs_review`를 화면에 말하되 **비우지 않는다** | 없음 — `ViewFreshness` 구현되어 있음 |
| Truncation 고지 | "hop N에서 접었다" | 없음 — `truncatedAtHop` 구현되어 있음 |
| 키보드 내비 | 노드 간 이동, Escape로 focus 해제 | 없음 |

**전부 새 데이터가 필요 없다.** 이것이 M9를 첫 마일스톤으로 두는 이유다 — schema 변경 0,
validator 변경 0으로 체감 격차의 대부분을 메운다.

### 2.2 이미 있는 것 위에 얹는다

버리지 않는다. `StepDetail.tsx`는 이미 오른쪽 inspector이고, `Grounding.tsx`는 이미 evidence를
**렌더 시점에** resolve하며 `agent`/`missing`/`위치 추정`/`이동됨`/`수정됨` 배지를 단다
(`plan §6.10`). Shell은 그 위의 캔버스 조작·탐색·주소지정만 담당한다.

### 2.3 Semantic Passport = 이미 있는 inspector

archify의 Semantic Passport는 focus 시 열리는 패널로 upstream/downstream 사실과 복사 가능한
딥링크를 제공한다. 우리 `StepDetail`이 같은 자리다. 더할 것은 **딥링크와 명시적 닫기**뿐이다.

---

## 3. 두 surface

### 3.1 분리

```text
Project Reader    대상 = 사용자의 저장소
                  Overview · Scenario · Trace (+ Impact)
                  질문: "이 프로젝트는 어떻게 동작하는가"

Runtime Console   대상 = onto 자신
                  task · AgentEvent · MCP 두 증거원 · Validator diagnostics · generation 이력
                  질문: "내 분석기가 방금 무엇을 했는가"
```

같은 bridge를 쓰지만 **화면을 공유하지 않는다**(I17).

### 3.2 왜 분리하는가

한 캔버스에 섞으면 메인 화면이 "내 프로젝트는 어떻게 동작하는가"가 아니라 "내 분석기는 잘
돌고 있는가"에 답하게 된다. 기능2의 대상은 사용자의 저장소다.

더 구체적으로, Runtime Console의 재료 대부분은 **연구 계측**이다.

- `TaskState.exploredFiles` · `tokenUsage` · `mcpCalls`는 `plan §7.3`의 비교 arm을 위해 존재한다.
  `AnalyzeRequest.mode: "index-only"`도 마찬가지다.
- `scripts/stability.mjs`는 generation 간 **semantic identity** 안정성을 잰다 — 분석 *대상*의
  속성이 아니라 온톨로지 엔진의 속성이다.

이것들을 제품 캔버스의 노드로 올리면 층이 섞인다. 둘 다 정당한 화면이지만 같은 화면은 아니다.

### 3.3 Runtime Console은 새 데이터가 거의 필요 없다

| 필요한 것 | 이미 있는 경로 |
|---|---|
| turn 이벤트 스트림 | WebSocket `AgentEventEnvelope` (seq + at) |
| MCP 두 증거원 | `GET /api/tasks/:taskId/mcp-evidence`, `GET /api/mcp-arrivals` |
| Validator diagnostics | `validation.failed` 이벤트의 `diagnostics[]` |
| evidence 상태 분포 | `GET /api/evidence` (`contentChange` · `relocated` 포함) |
| generation 이력 | `.project-intel/gen/` + `versions.json` |

특히 **generation이 곧 history**이므로(`plan §5 T4`) 시간 이동은 사실상 공짜다 —
HEAD가 가리키지 않는 generation도 불변 스냅샷으로 그대로 읽힌다.

### 3.4 M1~M8이 어디에 있는가

| 구현물 | surface | 비고 |
|---|---|---|
| M1 Evidence Engine, `EvidenceDiff` | Project Reader — **모든 View의 grounding 층** | 배지는 이미 `Grounding.tsx`에 있다 |
| M2 entity/link schema, `projectTrace` | Project Reader — Trace의 엔진이자 **§6 Impact의 엔진** | 새 그래프 엔진을 만들지 않는 근거 |
| M3 MCP · bridge · adapter | **Runtime Console** — 두 증거원 | 캔버스 노드가 아니라 세션 타임라인 |
| M4 AnalyzeTransaction, Validator ⓪~⑤, IdentityResolver | **Runtime Console** — diagnostics 스트림 | Diagnostic이 이미 위치와 수리법을 들고 있어 그대로 렌더된다 |
| M5 Semantic Patch, `SemanticWorkSet` | 양쪽 — Reader에 `needs_review`, Console에 work set 크기 | |
| M6 View Planner, view-validator, budget | Project Reader — **§5가 확장하는 지점** | soft budget 정책(A5) 유지 |
| M7 React viewer 3 View | Project Reader — **§2 Shell이 감싸는 대상** | 버리지 않는다. 셸을 씌운다 |
| M8 index-only arm, stability, eval | **Runtime Console (평가 모드)** | 제품 캔버스가 아니다 |

---

## 4. Entry map — Scenario-first를 실제로 지킨다

### 4.1 문제

`schema §0`은 이미 이렇게 적었다.

```text
User experience = View-specific, Scenario-first
```

README의 기능2 대표 예시도 시퀀스다 (`[사용자가 로그인한다] → LoginPage → POST /api/login → …`).
그런데 실제 첫 화면은 `OverviewIR`의 area/item 트리이고, 그것은 파일 트리와 잘 구별되지 않는다.
"파일 트리나 클래스 다이어그램이 아니라 사용자 행동 단위"라는 약속이 첫 화면에서 지켜지지 않는다.

### 4.2 결정 — 스키마가 아니라 용도를 바꾼다

`OverviewIR`을 **Canonical Scenario 색인**으로 쓴다.

이미 그것을 위한 구조가 있다:

- `OverviewIR.items[].scenarioRefs` — item이 Canonical Scenario를 가리킬 수 있다 (`schema §22`)
- `CanonicalScenarioEntry` — 이름·anchor·목표를 얇게 영속한다 (`schema §26`)
- `plan §6.4` — 이것이 영속하는 이유가 정확히 "`OverviewIR.items[].scenarioRefs`가 이것을
  가리키고, §50이 `Area → Canonical Scenario`를 기본 네비게이션으로 삼기 때문"

즉 **schema 변경이 필요 없다.** View Planner 프롬프트와 `OverviewView` 렌더가 area/item을
"코드 영역 목록"이 아니라 "이 프로젝트에서 일어나는 일들"로 채우면 된다.

### 4.3 첫 화면을 단일 시퀀스로 대체하지 않는다

시퀀스 하나로 바로 진입시키면 **어떤 시나리오가 있는지 모르는 사용자가 길을 잃는다.** 그리고
I13("시작점을 강요하지 않는다")과 `schema §40`("프로젝트 최초 진입 → Overview")을 어긴다.

지키는 형태는 이것이다:

```text
Overview (무엇이 일어나는가 — Canonical Scenario 색인)
    ↓
Scenario (그 일이 어떻게 흐르는가 — §5의 확장된 시퀀스)
    ↓
StepDetail (이 단계의 의미와 근거)
    ↓
Trace (실제 코드 구조)
```

`schema §41` Progressive Disclosure 그대로다.

---

## 5. ScenarioIR v2 — archify sequence에서 빌리는 문법

### 5.1 현재와의 차이

`ScenarioIR`은 이미 participants · steps · transitions · branches · stateChanges ·
entryStepId · outcomeStepIds를 갖고, `ScenarioView`가 swimlane으로 그린다.
archify sequence에만 있는 것은 셋이다.

| 추가 필드 | archify 대응 | 왜 필요한가 |
|---|---|---|
| `activations?` | `activations` | swimlane에서 "이 참여자가 어느 구간 동안 일하는 중인가"가 표현되지 않는다 |
| `phases?` | `segments` | 긴 흐름을 접을 자연스러운 단위가 없다 (§2 Reading Depth와 짝) |
| `ScenarioTransition.kind?` | `variant: "return"` | 호출과 응답이 구분되지 않아 왕복이 두 개의 전진으로 보인다 |

### 5.2 초안

```ts
/** 참여자가 활성인 step 구간. 좌표가 아니라 step id 참조다 (A7·A12). */
type ScenarioActivation = {
  participantId: string;
  fromStepId: string;
  toStepId: string;
  evidenceRefs: string[];
};

/** 흐름의 국면. step 구간에 이름을 붙인다. */
type ScenarioPhase = {
  id: string;
  label: string;
  fromStepId: string;
  toStepId: string;
  evidenceRefs: string[];
};

type ScenarioTransition = {
  // ... 기존 필드 그대로 ...
  /** 없으면 "call"과 동일하게 다룬다. 하위호환. */
  kind?: "call" | "return";
};
```

### 5.3 규칙

- **세 필드 모두 선택이다.** 없는 기존 IR이 그대로 통과해야 한다(하위호환).
- **좌표를 넣지 않는다.** 구간은 언제나 step id 쌍으로 표현한다 (A7 · A12 · I10).
- **각각 `evidenceRefs`를 갖는다.** archify의 message에는 없는 것이고, I9가 요구하는 것이다.
  "이 참여자가 이 구간 동안 활성이다"도 근거가 있어야 하는 주장이다.
- `view-validator.ts`에 참조 무결성 검사를 더한다 — `participantId` · `fromStepId` · `toStepId`가
  실재하고, `evidenceRefs`가 실재하며 `present`인가. 실패는 error.
- `viewBudget.ts`에 soft budget을 더한다 — **A5 정책 유지: 경고이지 실패가 아니다.**
- `kind: "return"`은 렌더에서만 다르다. `loop`와 **다른 것이다** — `loop`는 되돌아가는 흐름이고
  `return`은 응답이다. 둘을 합치지 않는다.

---

## 6. Impact — 결정론적 투영으로, 그리고 이름을 조심한다

### 6.1 결정

`schema §36` ImpactIR을 **AI View가 아니라 Trace처럼 Core의 결정론적 투영(R4)으로 만든다.**

근거:

- 순회 재료가 이미 있다 — `packages/core/src/trace.ts`의 `buildEvidenceGraph` · BFS · Tarjan SCC.
- 환각 표면이 0이다. `submit_view_ir`을 확장할 필요가 없고 view-validator도 늘지 않는다.
- 분석 전에도 동작한다 — Evidence만 있으면 되므로 프로젝트를 열자마자 쓸 수 있다
  (`plan §6.9`가 Trace에 대해 든 것과 같은 이유).
- `get_impact_context`의 `not_enabled` 스텁이 여기서 풀린다.

### 6.2 이름에 대한 경고

archify는 같은 계산을 제공하면서 이름을 명시적으로 제한한다.

> Call it **authored reachability**—not impact, blast radius, breakage, or runtime causality.
> — `archify/references/viewer-runtime.md`

이 제한은 옳다. authored edge를 따라간 BFS가 보장하는 것은 **"우리가 인덱싱한 관계를 따라
여기서 저기에 닿는다"**뿐이다. 그것은 "여기를 고치면 저기가 깨진다"가 아니다. 인덱서가 못 본
관계(동적 디스패치, 설정, 문자열 키)는 결과에 없고, 있는 관계도 실행 시 인과라는 보장이 없다
(I4가 "완전한 runtime call graph 복원을 성공 조건으로 두지 않는다"고 이미 인정한 것).

그런데 `schema §36`의 초안은 `directImpacts` / `likelyImpacts` / `unknownImpacts`로 되어 있다.
**`likely`는 순회가 보장하지 않는 확률 주장이고, `impact`는 인과 주장이다.**

**결정: 계산이 보장하는 것만 이름에 담는다.**

```ts
type ReachabilityIR = {
  anchor: string;                        // entityKey 또는 conceptId
  direction: "upstream" | "downstream";
  /** anchor로부터의 최단 hop. Trace와 같은 의미다 (U2) */
  nodes: Array<{
    id: string;                          // entityKey
    label: string;
    hop: number;
    conceptRefs?: string[];              // 역 grounding으로 닿은 의미
  }>;
  links: Array<{
    fromId: string;
    toId: string;
    kind: string;
    evidenceRefs: string[];
  }>;
  truncatedAtHop?: number;
};
```

화면 문구도 함께 정한다. **"영향을 받는다"가 아니라 "인덱싱된 관계로 여기에 닿는다"**로 쓴다.
`schema §36`의 `directImpacts`/`likelyImpacts`/`unknownImpacts` 3분류는 채택하지 않는다 —
`hop`이 이미 거리를 나르고, `likely`/`unknown`을 결정론적으로 채울 방법이 없다.

> 이것은 `schema §36`의 **초안을 좁히는 결정**이다. 초안 자체를 고치지 않고 여기에 기록한다.
> Drift View(`schema §38`)는 여전히 범위 밖이다.

### 6.3 이 결정은 `plan §4`를 다시 여는 것이다 — 명시적으로 기록한다

`plan §4`는 확정된 범위를 이렇게 적었다.

```text
D1 View                  Overview + Scenario + Trace
명시적으로 하지 않는 것    LifecycleIR / ImpactIR / DriftIR schema,
                        get_impact_context(호출 시 not_enabled), …
```

**M12는 이 두 줄을 모두 다시 연다.** 조용히 넘어가지 않는다.

다시 열 수 있다고 판단한 근거는 D1이 스스로 든 이유다 — D1의 근거는 "**§41의 Progressive
Disclosure 척추가 끝까지 동작한다**"였다. View를 셋으로 묶은 것은 그 척추를 먼저 세우기
위해서였고, **M7이 끝나면서 그 목적은 이미 달성되었다** (`FINDINGS.md` M7: "브라우저에서
Overview → Scenario → Step → Trace가 끝까지 이어진다").

또한 M12가 늘리는 비용은 다른 View kind보다 작다. `plan §6.9 [C]`가 나눈 두 경로 중
**AI 경로가 아니라 결정론적 투영 경로**이기 때문이다.

| 새 View kind의 통상 비용 | M12에 해당하는가 |
|---|---|
| JSON Schema + ajv | **아니오** — `submit_view_ir`이 받지 않는다 |
| view-validator 층 | **아니오** — AI output이 아니다 |
| View Planner 프롬프트 | **아니오** |
| soft budget | **아니오** — Trace처럼 hop 상한으로 자른다 |
| cache key | 예 — Trace와 같은 `(analysisVersion, requestHash)` |
| layout + renderer | 예 |

남는 것은 cache key와 renderer뿐이고, 둘 다 Trace의 것을 재사용한다.

**Lifecycle View와 Drift View는 다시 열지 않는다.** 둘은 AI 경로이고, `schema §38` Drift는
`IntentRecord`를 요구하는데 그것은 기능1의 산출물이라 이번 범위에 없다.

---

## 7. 추가 불변식

I1~I13에 이어진다. 어느 것도 기존 불변식을 뒤집지 않는다.

### I14. Viewer Shell은 IR을 바꾸지 않는다
focus · zoom · 검색 · 상세 단계 · 선택 상태는 **URL과 브라우저 메모리에만** 산다.
IR에도 store에도 쓰지 않는다. I11("View는 Source of Truth가 아니다")의 viewer 층 표현이다.

### I15. 그래프 질의는 Core에서만 계산한다
reachability · 최단 경로 · SCC · kind 집계를 브라우저에서 계산하지 않는다.
브라우저가 두 번째 그래프 엔진이 되면 `plan §6.6 S4/U2`가 정한 의미
(BFS는 경계, SCC는 cycle 판정, hop 비교는 레이아웃)와 조용히 갈라진다.
archify가 브라우저에서 계산할 수 있는 것은 노드가 12개이고 파일 하나에 구워져 있기 때문이다.
저장소 전체는 다르다.

> archify 자신도 같은 경계를 그었다 — "Semantic Radar mirrors the visible viewport and
> authored graph **without becoming a second source of truth**."

### I16. 노드 색은 전역 semantic kind에서 오지 않는다
I3와 `schema §9`의 viewer 층 표현. 색이 나르는 것은 프로젝트 의미가 아니라 **근거의 상태**다
(§1.3의 축 목록). `hints`에 색을 걸지 않는다 — 틀릴 수 있는 값이기 때문이다.

### I17. Project Reader와 Runtime Console은 화면을 공유하지 않는다
분석 대상의 구조와 분석기의 상태는 층이 다르다. 한쪽의 노드가 다른 쪽의 캔버스에 나타나지 않는다.

---

## 8. 명시적으로 하지 않는 것

```text
- 전체 Semantic Memory를 하나의 Node-Link Graph로 렌더링       (I2 · schema §51 재확인)
- agent가 좌표를 쓰는 것                                      (A7 · A12 재확인)
- HTML export / 자체 완결 아티팩트                            (plan §4 재확인)
- archify visual preset · brand mark · share card · 애니메이션  (A8 재확인)
- 전역 component type enum과 그것에 걸린 색                     (A13 · I16)
- 브라우저측 그래프 계산                                       (I15)
- Drift View                                                (plan §4 재확인)
- Lifecycle View                                            (plan §4 재확인)
- classifier-first 재현                                      (plan §3.2 재확인)
```

---

## 9. 마일스톤

M8에서 이어진다.

| | 내용 | 끝났다고 말할 수 있는 근거 |
|---|---|---|
| **M9** | **Viewer Shell** — 기존 3 View 위. focus·pan/zoom·Reading Depth·Node Finder·Radar·딥링크·freshness 표시·키보드 내비. **schema 변경 0, validator 변경 0** | 세 View 모두에서 딥링크로 진입해 focus 상태가 복원된다. `needs_review`와 `truncatedAtHop`이 화면에 나온다. **`npm test`가 수정 없이 그대로 통과한다** |
| **M10** | **geometry** — `geometry.mjs`의 자동 라우팅·port spread·라벨 충돌 회피를 renderer 측 결정론 layout으로 이식 | 같은 IR을 두 번 layout하면 **byte-identical 좌표**. fixture Scenario/Trace에서 **겹치는 라벨 0**. layout 단위 시험 + mutation check |
| **M11** | **ScenarioIR v2** (`activations`/`phases`/`transition.kind`) + view-validator 참조 무결성 + soft budget + **Entry map을 Canonical Scenario 색인으로** | 세 필드가 **없는** 기존 IR이 그대로 통과한다(하위호환). 존재하지 않는 step id를 참조하면 `Diagnostic`으로 되돌아온다. Overview의 item이 `scenarioRefs`를 갖는 비율을 fixture에서 측정 |
| **M12** | **ReachabilityIR** 결정론적 투영 + View + `get_impact_context` | 같은 anchor로 반복 호출 시 **byte-identical**. anchor에서 authored edge로 도달 가능한 것만 나온다. `direction` 뒤집으면 결과가 뒤집힌다. mutation check로 **의도한 시험만** 실패 |
| **M13** | **Runtime Console** — 별도 surface | task 하나의 두 MCP 증거원·diagnostics·generation 이력을 화면에서 읽을 수 있다. **acceptance 20(`task.interrupted`)을 실제 agent turn 중단으로 여기서 확인한다** |

### 9.1 순서의 근거

**M9가 먼저다.** 스키마 비용 0으로 체감 격차의 대부분을 메운다. M10~M13은 그다음이고, 각각
필요가 실증된 뒤에 간다.

M9와 M10은 독립이 아니다 — M9의 pan/zoom이 없으면 M10의 라우팅 개선을 확인할 화면이 없다.
M11은 M10에 의존한다(activation 바와 phase 밴드는 layout이 정확해야 의미가 있다).
M12는 M2에만 의존하므로 M9~M11과 병행 가능하다.

### 9.2 M13이 갚는 빚

`FINDINGS.md`가 다음 세션에 넘긴 것: **acceptance 20이 실제 agent로 검증된 적이 없다.**
`implementation_plan §8`의 M7 행이 완료 근거로 그것을 들었지만 기록이 없다.
M13은 이벤트 스트림을 화면에 드러내므로 여기서 함께 확인한다. **확인하지 못하면 확인하지
못했다고 적는다.**

---

## 10. Evaluation

### 10.1 미뤄진 것을 더는 미루지 않는다

`schema §53`의 **View Utility**가 M6·M7·M8에서 세 번 미뤄졌다. M9는 그것을 미룰 수 없는
지점이다 — Viewer Shell의 목적이 정확히 "사람이 이걸로 무언가를 알아낼 수 있는가"이기 때문이다.

### 10.2 방법

fixture 프로젝트로 비전공자 n명에게 과제를 준다.

```text
Q1  이 기능은 어디서 시작하는가
Q2  이 함수를 고치면 인덱싱된 관계로 무엇이 닿는가
Q3  이 화면에 보이는 주장의 근거 코드를 열어라
```

측정: 성공률, 소요 시간, 막힌 지점.
비교: Shell 이전(M7 상태) vs Shell 이후(M9 상태). **같은 fixture, 같은 과제.**

### 10.3 규율

`plan §7.2`를 그대로 적용한다.

- **통과시키려고 기준을 느슨하게 고치지 않는다.** M5에서 acceptance 5가 3회 중 1회 실패했을 때
  checker를 고치지 않았던 것과 같다.
- **n이 작으면 작다고 적는다.** §7.3이 "단일 fixture이므로 '이 fixture에서'로만 말한다.
  벤치마크가 아니다"라고 못박은 것과 같은 태도다.
- **답할 수 있는 만큼만 적고 나머지는 열린 질문으로 남긴다.**

### 10.4 M10의 측정은 사람이 아니라 기계다

layout 품질은 사람 평가가 필요 없다. **겹치는 라벨 수 · 엣지 교차 수 · 최소 세그먼트 위반 수**를
fixture에서 센다. 개선을 주장하려면 이 수가 줄어야 한다.

---

## 11. 열린 질문

이 문서로 답하지 않는 것을 적어 둔다.

1. **Q11** — Viewer Shell이 실제로 이해도를 올리는가? §10이 측정하지만 n이 작을 것이다.
2. **Q12** — `activations`/`phases`를 AI가 안정적으로 채울 수 있는가? 자유도가 늘면 §54 Q4가
   경고한 불안정이 여기서도 나올 수 있다.
3. **Q13** — Reachability의 hop 거리가 사람에게 "얼마나 관련 있는가"로 읽히는가?
   읽힌다면 그것은 §6.2가 피하려던 인과 주장으로 미끄러지는 경로다.
4. **Q14** — Runtime Console과 Project Reader를 오가는 사용자가 실제로 있는가?
   없다면 Console은 제품이 아니라 개발 도구로 남겨야 한다.
5. **Q7 (계속)** — View-specific IR을 여러 벌 유지하는 비용. M11·M12가 kind를 하나만 늘리지만
   그래도 늘어난다.
