# 기능2 (코드 시각화) 프로토타입 구현 계획

> **상태: FROZEN.** 이 문서의 architecture와 범위는 확정되었다.
> 구현하다가 계획과 현실이 어긋나면 **이 문서를 임의로 고치지 않는다.**
> `prototypes/ontology/FINDINGS.md`에 §8의 형식대로 관찰과 변경 후보를 기록한다.
>
> 아키텍처 source of truth는 [ontology_schema.md](./ontology_schema.md)이고,
> 이 문서는 그것을 실행 가능한 형태로 옮긴 것이다.

## Context

이 제품의 목표는 두 가지다.

- **기능1** — 비전공자가 "~해줘"로 코드를 짜게 하는 대신, 정립된 이론으로 먼저 설계하고
  잘 짜인 설계 도면을 AI 에이전트에 넘긴다. `prototypes/byoa-mcp-spike`가 이미 이것을
  프로토타입으로 검증했다 (인터뷰 → `save_design` → `app_design.md` + harness 인계,
  Codex/Claude 양쪽 adapter + MCP 연동 포함).
- **기능2** — 본인이 만들었거나 이미 만들어진 코드 모음을 시각화해서 쉽게 이해하게 한다.
  이번 작업이 여기에 해당한다.

기능2의 아키텍처 source of truth는 [ontology_schema.md](./ontology_schema.md)다.
이 계획은 그 문서의 architecture에서 출발하며, `prototypes/ontology`에 기능2 + MCP/Codex 연동을
**독립적으로** 구현한다. 나중에 두 기능을 합칠 것이므로 기존 spike 코드는 **참고만** 하고
메커니즘만 가져온다 (spike 자신이 SPIKE_FINDINGS.md §10에서 "제품 코드가 아니다,
메커니즘만 가져간다"고 못박아 두었다).

---

## 1. ontology_schema.md에서 읽어낸 핵심 Invariant

구현 중 어느 것도 위반해서는 안 되는 불변식이다. 괄호 안은 근거 절.

### I1. 역할 분리 — AI는 의미, Core는 근거와 정체성 (§2, §44)
AI가 결정하는 것: 어떤 Concept가 중요한가, 어떤 Claim이 핵심인가, 어떤 Step으로 묶을까,
무엇을 숨길까, 비전공자 언어로 어떻게 표현할까.
Core가 검증하는 것: ID가 실재하는가, file/symbol이 실재하는가, transition/state change에
근거가 있는가, 허구 Grounding이 있는가, version conflict가 있는가.

### I2. Universal Graph를 만들지 않는다 (§1, §51)
전체 Semantic Memory를 하나의 Node-Link Graph로 렌더링하지 않는다.
질문 → View Planner → View별 Typed IR → Renderer 경로만 존재한다.

### I3. Global Node Type / Relation Vocabulary 없음 (§6, §8, §9)
Concept에 전역 Type을 붙이지 않는다. Claim의 `predicate`는 AI가 프로젝트 의미에 맞게 쓰는
자유 문자열이다. `hints` / `semanticHint`는 **보조**일 뿐이고, 틀리거나 없어도 Concept의
의미와 Grounding은 유효해야 한다.

### I4. AST는 Semantic Classifier가 아니라 Evidence Indexer다 (§11)
Evidence Engine은 "이 Symbol은 어디에 있는가 / 무엇을 reference하는가 / 어떤 Route인가"만
답한다. 의미 분류를 하지 않는다. 완전한 runtime call graph 복원을 성공 조건으로 두지 않는다.

### I5. Evidence는 versioned이고, Grounding은 many-to-many다 (§10, §12)
Evidence는 언제 관측된 것인지를 들고 있어야 하고, Concept-Grounding과 Claim-Grounding을
분리한다. "Concept가 존재하는 근거"와 "Claim이라는 관계가 성립하는 근거"는 다른 것이다.

### I6. Intent와 Current Implementation은 같은 truth가 아니다 (§3.2, §13, §38)
IntentRecord는 별도 저장소에 두고, 현재 구현과의 차이가 Drift의 근거가 된다.

### I7. Semantic Identity 안정성 — 새로 만들기보다 재사용 (§15, §46)
같은 의미가 분석마다 새 Concept가 되면 실패다. Name-only churn / 불필요한 split·merge를
평가 항목으로 둔다.

### I8. 전체 재생성 금지 — Semantic Patch만 (§16, §45)
코드 변경 시 Evidence Diff → Dirty Evidence → 관련 Memory 조회 → AI Patch → Validation →
vNext. 전체 재분석은 fallback이지 기본 경로가 아니다.

### I9. AI output은 Evidence validation 없이 저장되지 않는다 (§17, §51)
Schema / Evidence 실재성 / Grounding / Stability 4단계 Validator를 통과해야 저장한다.

### I10. AI는 HTML/SVG를 직접 만들지 않는다 (§42)
항상 `AI/View Planner → Typed View IR → Validator → Renderer`. 이것이 모델 교체·Renderer
교체·Schema test·View diff·Hallucination validation을 가능하게 하는 유일한 구조다.

### I11. View는 Source of Truth가 아니며 Bounded해야 한다 (§3.4, §43, §49)
View IR은 cache일 수 있다. Semantic Memory의 완전성과 화면의 완전성을 동일시하지 않는다.

### I12. 사용자에게 보이는 단어는 코드가 아니라 코드에 Grounding된 프로젝트 언어다 (§9, §50.1)
label 우선순위: ① Intent/Requirement에서 이미 쓴 용어 → ② Repository의 도메인 용어
(UI text / domain model / route / test) → ③ AI가 복원한 제품 의미 → ④ 기술 세부는
Trace View에서만.
**고정되는 것 = View의 문법/Schema. 고정되지 않는 것 = 화면에 보이는 프로젝트 의미.**

### I13. 시작점을 강요하지 않는다 (§19, §40)
ViewRequest의 `anchor`는 Concept / Intent / Decision / Code Change / File / Symbol /
Scenario / Search Result 무엇이든 될 수 있다. View 선택은 대부분 UI context로 결정되고,
자연어 질문일 때만 Agent가 판단한다.

---

## 2. 데이터 흐름 (schema §2 + §45 + §20을 실행 가능한 형태로)

```text
[A] 인덱싱 (deterministic, 모델 호출 없음)  ── 여기서만 analysisVersion이 오른다
Repository ──► Evidence Engine ──► evidence.json (analysisVersion = N)
                                    file / symbol / definition / reference /
                                    route / ui_event / db_* / config / git_change

[B] 의미 생성 (AI-first, 검증됨)
evidence.json + 이전 Semantic Memory + Intent
        │
        ├──► MCP로 Agent에 노출 (읽기 tool + propose_evidence)
        │
        ▼
   AI Agent — Evidence Index를 seed로 삼아 Repository를 직접 탐색한다.
              엔진이 인덱싱하지 못한 근거를 발견하면 propose_evidence로 등록을 요청하고,
              Core가 검증해 id를 발급한 뒤에야 그것에 grounding할 수 있다.
              발급된 evidence는 **이번 turn의 transaction에만** 있고,
              analysisVersion을 올리지 않는다.                          (§6.5 S2)
        │
        ▼  submit_semantic_patch { baseAnalysisVersion, baseSemanticVersion, ... }
   Validator  ⓪Version ①Schema ②Evidence ③Grounding ④Stability ⑤커밋 직전 working-tree 재확인
        │            (실패 시 구조화된 diagnostics를 돌려주고 agent가 같은 turn에 수리)
        ▼
   generation commit + atomic HEAD switch:
     pendingEvidence + memory patch + semanticVersion N+1 을 새 generation에 쓰고
     HEAD를 rename(2)으로 넘긴다                                    (§5 T4)

[C] View 생성 — 두 경로로 나뉜다
   ┌─ Overview / Scenario : AI View Planner ──► submit_view_ir ──► Validator ──► Renderer
   └─ Trace               : Core가 Grounding/Evidence에서 **결정론적으로 투영** ──► Renderer
                            (모델 호출 없음. 분석 전에도 동작한다.
                             양방향 순회 · 방향 보존 · cycle 허용 §6.6)

[D] 증분 갱신
Git Diff ──► contentHash 대조 ──► Dirty File ──► 해당 파일 Evidence만 재인덱싱
        ──► EvidenceDiff 분류 (§6.2 T1)
              unchanged · cosmetic · relocated   → dirty 아님
              modified  · appeared · missing     → Semantic Dirty
        ──► SemanticWorkSet (§6.2 U1)
              affected*                      = dirty에 grounding된 기존 의미 (재검토)
              ungroundedAppearedEvidence     = 아직 아무 의미도 없는 새 근거 (새 기능 발견)
        ──► AI Semantic Patch ──► Validation ──► 새 generation, semanticVersion N+1
        ──► stale해진 View IR cache 표시 (View 종류마다 기준이 다르다 §6.4 V2)
```

핵심: **[A]는 결정론, [B]는 AI가 만들고 Core가 검증, [C]는 질문에 따라 갈리고, [D]는 국소 갱신.**

---

## 3. 참고 구현 조사

두 참고 프로젝트는 설계를 그대로 복사하지 않는다. 형식은
`Reference behavior → 우리 문제와의 관련성 → 차용 여부 → 수정해서 적용할 방식`.

### 3.1 Archify (`reference/archify-main/archify`)
조사 범위: agent-first analysis, typed IR, schema validation, view-specific renderer,
bounded view generation.

| # | Reference behavior | 우리 문제와의 관련성 | 차용 | 수정해서 적용할 방식 |
|---|---|---|---|---|
| A1 | **View 종류마다 독립 JSON Schema** + 공유 `common.schema.json`. generic graph schema가 없다 | §21 View-specific IR과 같은 구조 | **차용** | `schemas/{overview,scenario,trace}.json` + `common.json`. 단 Archify의 `componentType` 같은 **전역 semantic enum은 만들지 않는다** (I3) |
| A2 | **AI가 HTML을 만들지 않는다.** SKILL은 agent에게 JSON만 쓰게 하고 CLI가 SVG/HTML을 만든다 | §42와 동일한 원칙 | **차용** | 그대로. Renderer는 React 컴포넌트 |
| A3 | **구조화된 diagnostics로 수리 루프.** `{code, severity, message, subject, evidence, supportedFixes}` + `annotatedPath()`가 `/nodes/3 (id/label: "router")`처럼 **고칠 수 있는 위치**로 바꿔 준다 | §17이 "AI 자유도를 높이는 대신 Validator를 강화한다"고 했다. 그러려면 실패가 agent에게 되돌아가 **고쳐질 수 있어야** 한다 | **차용 (가장 가치 높음)** | 같은 형태를 `@onto/core` Validator 전체에. `submit_semantic_patch` / `submit_view_ir` / `propose_evidence`가 실패 시 `diagnostics[]`를 반환해 같은 turn에 재시도 |
| A4 | **Repository Evidence 검증** (`repository-evidence.mjs`): 파일 실재 확인, 줄 수를 세어 line range 검사, 경로 escape(`..`, 절대경로, `.git`) 차단 (`verifiedSourcePath`) | §17 Evidence Validation의 구현 예시. "AI가 허구의 Grounding을 만들지 않았는가"(§2)를 실제로 막는 코드 | **차용하되 기준을 바꾼다** | Archify는 **pinned commit**에 고정하지만 우리는 작업 트리를 계속 다룬다. 대신 **파일 contentHash**를 기준으로 삼는다(§6.2). 경로 escape와 line-range 검사는 그대로 가져오고, **`propose_evidence`의 검증 루틴이 바로 이것**이다 |
| A5 | **Bounded view가 규범으로 명시됨.** "at most 12 primary nodes", `maxItems: 5` | §43 | **방향만 차용, 강제 방식은 바꾼다** | Archify는 schema `maxItems`로 **거절**한다. 우리는 그러지 않는다 — 검증되지 않은 제품 존재론 주장이고, 하드 실패면 agent가 통과하려고 의미 있는 내용을 버린다. **soft warning + renderer safety ceiling** (§6.7) |
| A6 | **Schema → 코드 컴파일** (`generate-validators.mjs`) | 세 곳에서 같은 schema를 쓴다 | **부분 차용** | 프로토타입은 `ajv` 런타임. schema는 `@onto/protocol`에 **한 벌만** |
| A7 | **좌표를 agent가 쓴다** (`messages[].y`, `row`/`col`, `viewBox`). renderer는 455~1087줄 SVG geometry 엔진 | 우리 IR(§28~§37)에는 좌표 필드가 **하나도 없다**. §42의 목적은 AI가 시각 표현에서 손을 떼는 것 | **차용하지 않음** | IR은 순수 semantic. **layout은 Renderer가 결정론적으로 계산** (§6.8). View diff가 의미 단위로 나온다 |
| A8 | 시각 preset / brand mark / 애니메이션 / share card | 지금 문제의 본체가 아니다 | **차용하지 않음** | 범위 밖 |

### 3.2 CoderMind (`reference/RPG-ZeroRepo-main/CoderMind`)
조사 범위: repository analysis, grounding, context retrieval, incremental update,
agent/MCP interaction.

> **전제 확인:** CoderMind의 **RPG ontology**(전역 `NodeType` / `EdgeType`)와
> **classifier-first semantic pipeline**(`semantic_parsing.py`가 LLM으로 파일을 feature로
> 분류하고 `refactor_tree.py`가 트리로 정규화하는 흐름)은 **우리 ontology의 전제가 아니다** —
> I2·I3와 정면 충돌한다. 도입하지 않는다.
>
> 이 프로토타입은 classifier-first를 **재현하지도, 벤치마크하지도 않는다.** §7.3의 비교 arm은
> classifier-first가 아니라 "저장소 탐색 없이 evidence 요약만 준 AI 분석"이다 (§7.3 S5).
> 따라서 §54 Q1(classifier-first와의 비교)은 **이 프로토타입으로 답하지 않는다.**

| # | Reference behavior | 우리 문제와의 관련성 | 차용 | 수정해서 적용할 방식 |
|---|---|---|---|---|
| C1 | **언어별 파서를 config로 분리** + tree-sitter backend의 **지연 로딩 + 실패 시 fallback** | Evidence Engine이 문법 패키지가 없어도 죽으면 안 된다 | **차용** | 같은 형태의 `LanguageConfig`. TS/JS는 TypeScript compiler API로. 파싱 실패는 **조용히 건너뛰지 않고** `adapterReport`에 남긴다 |
| C2 | **content hash 기반 증분 파싱** (`_hash_content()` + `update_files()`가 byte-identical 파일을 건너뛴다) | §45 증분 갱신의 첫 단계 | **차용, 그리고 확장** | contentHash를 스킵 최적화가 아니라 **Evidence freshness의 정의 자체**로 쓴다 (§6.2). "재관측되었는가"가 아니라 "근거가 사는 파일이 관측 이후 바뀌었는가"가 기준 |
| C3 | **파일 단위 add/remove/update로 그래프를 국소 수정** (`_file_descendants()`, `_wipe_semantic_edges()` + `_rerun_semantic_passes()`) | 전체 재구축 없이 국소 갱신 | **차용** | `byFile` 인덱스로 파일 단위 replace. 파일 경계를 넘는 reference evidence는 dirty 파일을 가리키는 것만 다시 계산 |
| C4 | **RPG를 버전 스냅샷으로 관리** (`history/rpg.v<N>.json` + rollback/diff, 파일별 atomic write) | §14 versions, §47 Semantic Diff | **방향만 차용, 구조는 바꾼다** | 파일별 rename은 **여러 파일에 걸친 커밋을 원자적으로 만들지 못한다.** generation + HEAD pointer로 바꾸고 **generation이 곧 history**가 되게 한다 (§5 T4) |
| C5 | **MCP tool 4개** + **lazy engine 로딩** — 인덱스가 없어도 서버가 뜨고 tool이 `{error, next_step}`을 돌려준다 (throw하면 클라이언트에는 `MCP error -32000`만 남는다) | §48과 대응 | **차용** | tool 이름은 §48을 따른다. lazy 로딩 + actionable `next_step`, **handler에서 절대 throw 하지 않는다** |
| C6 | **MCP instructions에 질문↔tool 매핑을 담는다** | spike가 확인한 것(§6.5): **agent는 MCP를 자발적으로 부르지 않는다** | **차용** | instructions에 §18의 질문↔View 표를 그대로 |
| C7 | **모든 tool 호출을 duration과 함께 로깅** | §53 평가에 필요 | **차용** | `.project-intel/events.ndjson`에 append |
| C8 | **Impact를 dep_graph의 in/out edge로 계산** (`rpg_edit/impact.py`) | §36의 방향과 같다 | **방향만, 이번 범위 밖** | Impact View는 만들지 않는다. 다만 같은 순회 코드가 **Trace의 결정론적 투영**(§6.6)에 그대로 쓰인다 |
| C9 | **Evidence-first agent 프롬프트**: "경로·심볼·줄번호를 지어내지 마라 / 모든 출력은 그래프에 실재하는 노드여야 한다" | §44·§17을 프롬프트 층에서도 거는 방식 | **차용, 단 한 줄 완화** | CoderMind의 "실재하는 노드만"을 그대로 쓰면 **엔진이 못 본 근거를 agent가 버리게 된다.** "지어내지 마라 — 대신 `propose_evidence`로 등록을 요청하라"로 바꾼다. `<think>/<action>` 자체 루프는 쓰지 않는다 |
| C10 | RPG ontology, classifier-first 정규화 | I2·I3와 충돌 | **차용하지 않음 (명시적)** | 계층은 Core가 아니라 **OverviewIR의 presentation hierarchy**로만 (§22) |
| C11 | 워크스페이스 밖(`~/.cmind/`)에 런타임 데이터 저장 | §49는 `.project-intel/`을 프로젝트 안에 두라고 한다 | **차용하지 않음** | §49를 따른다. 커밋해 팀이 공유하고 git으로 되돌릴 수 있어야 한다 |

### 3.3 byoa-mcp-spike (기존 프로토타입 — 검증된 배선을 포팅)

| # | 검증된 메커니즘 | 가져오는 방식 |
|---|---|---|
| B1 | 3채널 분리: Browser→Agent = HTTP/JSON-RPC, Agent→Browser = WebSocket, Agent→App = MCP | 그대로 |
| B2 | provider 중립 `AgentAdapter` | 그대로 포팅. "Claude adapter 추가에 bridge/protocol/MCP 변경 0줄"로 이미 검증됨 |
| B3 | Codex MCP 승인은 `approvalPolicy: {granular: {mcp_elicitations: true}}`로 받고 **우리 서버 이름만 accept** | 그대로. `"never"`는 0.147→0.148에서 의미가 바뀌어 두 번 깨진 값이다 |
| B4 | MCP 호출을 **독립적인 두 증거원**(agent-stream + bridge endpoint)으로 검사 | 그대로. acceptance의 핵심 |
| B5 | `TaskMode`로 turn별 격리 수준을 다르게 (`settingSources: []`) | 그대로. ontology는 `analyze` / `view` / `chat` |
| B6 | 큰 산출물은 **digest만**, 필요할 때만 전체 | 그대로 |
| B7 | `platform.ts`의 `cliSpawnOptions` / `killTree()` (Windows) | 그대로 |
| B8 | 이벤트 replay 버퍼는 **taskId로 필터링** (Finding 3, 5) | 그대로 |

---

## 4. 확정된 범위

| | 결정 | 근거 |
|---|---|---|
| **D1 View** | **Overview + Scenario + Trace** | §41의 Progressive Disclosure 척추가 끝까지 동작한다 |
| **D2 Evidence** | **TS/JS, P0~P3** | 기능1 harness가 만들 앱과 같은 스택. P2가 있어야 ScenarioStep·StateChange에 근거가 붙는다 |
| **D3 Renderer** | **앱 안의 React viewer**, layout은 결정론적 계산 | anchor를 바꿔가며 탐색하는 것이 기능2의 본체(§13·§27·§41) |
| **D4 Fixture** | **기능1이 만들어낸 앱** + `expectations.json` | Intent 정답(`design.json`)을 알고 있어 §53을 채점할 수 있다 |

**명시적으로 하지 않는 것:** LifecycleIR / ImpactIR / DriftIR schema,
`get_impact_context`(호출 시 `not_enabled`), P4~P5 static analysis, HTML export,
classifier-first 재현.

---

## 5. 디렉터리 구조와 영속 레이아웃

```text
prototypes/ontology/
├── package.json                      npm workspaces
├── tsconfig.base.json
├── fixtures/fixture-app/             기능1으로 만들어 체크인한 검증 대상 앱
│   └── expectations.json             §7.2의 semantic coverage 기대값 + reviewedPredicates
├── packages/
│   ├── protocol/                     @onto/protocol   타입 + JSON Schema 한 벌
│   ├── evidence/                     @onto/evidence   Evidence Engine (모델 호출 없음)
│   ├── core/                         @onto/core       Store · Identity · Validator · Patch · Diff · Trace 투영
│   └── mcp-server/                   @onto/mcp-server stdio MCP → loopback HTTP
├── apps/
│   ├── bridge/                       @onto/bridge     HTTP + WS + AgentAdapter(codex/claude)
│   └── web/                          @onto/web        React viewer
└── scripts/
    ├── _shared.mjs  create-fixture.mjs
    ├── register-codex-mcp.mjs  unregister-codex-mcp.mjs  mcp-status.mjs
    ├── acceptance.mjs                회귀 게이트
    └── eval.mjs                      §46 / §53 측정 + arm 비교
```

### T4 — generation + pointer로 crash-consistent commit을 정의한다

> **고친 문제:** 초안은 "atomic write(temp → rename)"라고 썼는데, 그것은 **파일 하나**에
> 대해서만 원자적이다. 커밋 하나가 `evidence.json` + `semantic-memory.json` +
> `grounding.json` + `versions.json` + 스냅샷을 함께 바꾸므로, rename 사이에서 크래시하면
> **찢어진 상태**가 남는다 — 없는 evidence를 참조하는 memory, 착지하지 않은 스냅샷을 가리키는
> 버전 레코드. 그리고 프로세스 mutex는 동시 *쓰기*를 막을 뿐 전원 손실·SIGKILL·중간 크래시에는
> 아무 역할도 하지 않는다. **그것을 atomic commit이라고 부른 것이 틀렸다.**

```text
<project>/.project-intel/
  HEAD                          ← 유일한 canonical pointer.  {"generation": 42}
  gen/
    000042/
      project.json              analysisVersion · semanticVersion
                                · semanticReconciledAnalysisVersion  (§6.9)
      evidence.json             Evidence[] + byFile/byKind/byEntity 인덱스 + fileHashes + adapterReport
      semantic-memory.json      concepts[] + claims[] + canonicalScenarios[]
      grounding.json            conceptGroundings[] + claimGroundings[]
      versions.json             SemanticVersion[] (message · timestamp · source · SemanticDiff 요약)
      manifest.json             이 generation의 파일 목록 + 각 sha256
    000041/ …
  gen.lock                      pid를 담은 advisory lock (프로세스 간)
  intent.json                   generation 밖 — 기능1이 쓰는 **입력**이지 우리 산출물이 아니다
  events.ndjson                 generation 밖 — append-only 로그 (C7)
  views/                        generation 밖 — cache (§49, I11)
```

**커밋 절차 — generation commit + atomic HEAD switch**

```text
1. g := HEAD.generation + 1
2. gen/<g>/ 에 모든 상태 파일을 쓴다            ← 아직 아무도 이 디렉터리를 보지 않는다
3. 각 파일의 sha256을 manifest.json에 쓰고 파일들을 fsync
4. gen/<g>/ 디렉터리를 fsync
5. HEAD를 temp에 쓰고 fsync 한 뒤 rename(2)으로 교체     ← 원자적인 지점은 여기 하나뿐이다
6. 보존 정책에 따라 오래된 generation 정리 (기본: 최근 20개)
```

**막아지는 실패 모드를 정확히 적으면:**

| 크래시 시점 | 결과 |
|---|---|
| 5 이전 | HEAD는 여전히 옛 generation. `gen/<g>/`는 고아가 되고 다음 실행이 청소한다. **읽는 쪽에 아무 영향 없다** |
| 5 도중/이후 | `rename(2)`은 원자적이므로 HEAD는 옛 값 **또는** 새 값. 중간 상태가 없다 |

읽기는 HEAD를 읽고 그 generation 디렉터리만 본다. 그 디렉터리는 불변이므로 **reader가 writer를
막지 않고 그 반대도 아니다.** 시작 시 manifest의 sha256을 검증하고, 어긋나면 generation−1로
물러서면서 **크게 알린다.** HEAD보다 큰 고아 generation은 지운다.

프로세스 내 mutex는 남지만 **이제 정확히 이름 붙는다** — 한 프로세스 안에서 두 task가 동시에
generation을 만들지 않게 하는 직렬화일 뿐이고, crash-consistency는 pointer가 준다.
프로세스 간에는 `gen.lock`(pid 기록 + 죽은 pid 감지)이 담당한다 — bridge가 떠 있는 동안
사용자가 CLI를 돌릴 수 있기 때문이다.

**generation이 곧 history다.** 별도의 `history/semantic.v<N>.json`을 두지 않는다 (C4의
요구는 이것으로 충족되고, 메커니즘이 하나 줄어든다). `views/`가 generation 밖에 있는 이유는
cache이기 때문이고, staleness 키(`analysisVersion` / `semanticVersion` — **View 종류마다 다르다,
§6.4 V2**)는 커밋된 상태 안에 있다.

CoderMind처럼 홈 디렉터리로 빼지 않고 **프로젝트 안에 둔다** (C11).

---

## 6. 구현

### 6.1 `@onto/protocol` — 타입과 Schema를 한 곳에

지켜야 할 것:
- Concept에 전역 `type` 필드를 **넣지 않는다.** `hints?: string[]`만 (I3).
- `SemanticClaim.predicate`는 enum이 아니라 `string` (I3).
- 모든 IR에 **좌표 필드를 넣지 않는다** (A7).
- 모든 IR schema에 **개수 제한(`maxItems`)을 넣지 않는다** (§6.7).

Archify의 진단 형태 (A3):

```ts
export type Diagnostic = {
  code: string;                        // "evidence/not-present"
  severity: "error" | "warning";
  message: string;                     // 위치가 주석된, 사람이 읽는 문장
  subject: Record<string, unknown>;    // { path: "/addedClaims/2/evidenceRefs/0", claimId }
  evidence: Record<string, unknown>;   // 무엇을 보고 그렇게 판단했는지
  supportedFixes: string[];            // agent가 고를 수 있는 수리 방법
};
```

`AgentEvent`는 byoa의 것(`packages/protocol/src/index.ts:224`)을 포팅하고
`analysis.progress` / `memory.patched`(SemanticDiff 포함) / `view.ready` /
`validation.failed`를 더한다.

### 6.2 `@onto/evidence` — Evidence ID와 freshness

> **고친 문제 (R1):** 초안은 Validator가 `evidence.analysisVersion === 현재 analysisVersion`을
> 요구했다. 증분 갱신에서는 바뀌지 않은 파일을 다시 인덱싱하지 않으므로 그 파일의 evidence는
> 영원히 낡은 버전을 달고, **커밋 한 번에 거의 모든 Grounding이 무효가 된다.** 증분 갱신(I8)과
> 정면 모순이었다.

#### Evidence ID는 주소에서 나온다 (관측 시점에서 나오지 않는다)

id는 **그 근거가 무엇을 가리키는가**로만 정해진다. 줄 번호는 들어가지 않는다 — 줄은 움직인다.

**Entity evidence** — 주소가 위치에 의존하지 않는다.

```text
file       ev:file:<sha1(relPath)>
symbol     ev:symbol:<sha1(relPath + "#" + qualifiedName)>
route      ev:route:<sha1(method + " " + pathPattern)>
db_entity  ev:model:<sha1(modelKey)>
agent      ev:agent:<sha1(relPath + ":" + kind + ":" + anchorFingerprint)>   ← §6.5 S1
```

#### U3 — Link evidence의 id는 위치가 아니라 지문으로 정한다

> **고친 문제:** 초안은 `reference`를 `…"@" + ordinal`로 식별했다. `A → B` 호출이 3개 있는데
> **앞쪽에 새 호출을 하나 끼워 넣으면** ordinal이 밀려서 기존 세 개의 id가 전부 바뀐다.
> 거기 걸린 Grounding이 통째로 끊긴다 — **R1이 막으려던 바로 그 churn을 뒷문으로 다시 들인
> 것이다.** `db_read`/`db_write`/`ui_event`/`call`도 같은 결함을 갖고 있었다.

이미 계산하고 있는 정규화 지문을 discriminator로 쓴다. 위치는 id에 들어가지 않는다.

```text
link evidence id
  = ev:<linkKind>:<sha1( linkKind
                       + "|" + fromEntityKey
                       + "|" + toEntityKey
                       + "|" + localNormalizedFingerprint )>

localNormalizedFingerprint = 그 호출부 extent(호출식 + 그것을 감싸는 문장)의
                             정규화 토큰 지문 (§6.2 T1과 같은 파이프라인)
```

**지켜지는 invariant:** *주변에 새로운 호출 하나가 추가되었다는 이유로 기존 call evidence
id들이 바뀌지 않는다.* 무관한 곳의 편집은 그 호출부의 토큰을 건드리지 않기 때문이다.

**충돌 처리:** 같은 쌍 사이에 **바이트 수준으로 동일한** 호출부가 둘 이상이면 지문이 겹친다.
그때만 line 순서로 정한 **그 충돌 그룹 안에서의** ordinal을 덧붙인다. 범위가 중복 그룹으로
한정되므로 다른 곳에 호출을 추가해도 영향이 없다. 동일한 중복을 앞에 하나 더 끼워 넣으면
그룹 안에서는 밀리지만, 그 문장들은 서로 구별할 수 없으므로 실질적 손해가 없다.

같은 파일을 다시 인덱싱해도 id가 같다. 포매팅만 바뀐 커밋이 Grounding을 통째로 끊지 않는다.
심볼 이름이 바뀌면 새 id가 나오고 옛 id가 사라지는데, 그것은 오류가 아니라 **진짜 신호**다.

#### freshness는 파일 단위 contentHash로 정의한다

```ts
type Evidence = {
  id: string;
  kind: string;
  origin: "engine" | "agent";
  filePath?: string;
  symbolId?: string;

  /** 이 근거가 차지하는 범위. 아래 두 해시는 **이 extent에 대해** 계산된다. */
  location?: { startLine: number; endLine?: number };

  /** exact 바이트. "원문이 바뀌었다"를 감지한다 */
  rawHash: string;
  /** 정규화 토큰 지문. identity · relocation · **의미 변화 판정**의 기준 (§6.5 S1) */
  normalizedFingerprint: string;
  /** 정규화 방식. 아래 T1 참고 */
  normalizationProfile: "code" | "prose";

  excerpt?: string;                    // 사람이 확인할 원문. **identity 기준이 아니다**
  relocationConfidence?: "exact" | "degraded";

  /** Trace가 순회할 수 있는 근거인지. 없으면 grounding은 되지만 Trace에 나오지 않는다 (§6.6 T2) */
  graph?: EvidenceGraphRole;

  summary?: string;
  confidence?: number;

  fileContentHash: string;             // 관측 당시 그 파일의 sha256
  observedAtVersion: number;
  status: "present" | "missing";
  missingSinceVersion?: number;
};
```

`rawHash` / `normalizedFingerprint`는 **engine·agent evidence 모두**가 갖는다. 초안은 지문을
agent evidence에만 두었는데, 그러면 아래 T1의 의미 변화 판정이 engine evidence에 대해 불가능하다.
extent가 없는 종류(`file`)는 파일 전체를 extent로 삼는다.

파일 단위 존재 판정은 하나다.

```text
present  ⟺  evidence.fileContentHash === index.fileHashes[evidence.filePath]
```

"최신 실행에서 재관측되었는가"가 아니라 **"이 근거가 사는 파일이 관측 이후 바뀌었는가"**가
기준이다. 바뀌지 않은 파일의 evidence는 재인덱싱 없이도 유효하다 — 증분 갱신과 모순되지 않는
유일한 정의다.

`analysisVersion`은 **Evidence Engine이 저장소를 (재)인덱싱할 때만** 오른다. 다른 어떤 것도
올리지 않는다 (§6.5 S2). 쓰이는 곳은 **Trace cache staleness**(§6.4 V2)와 stale-write 차단이다.

#### T1 — EvidenceDiff: 살아남았지만 내용이 바뀐 근거도 Semantic Dirty다

> **고친 문제:** 초안의 dirty set은 `missing`뿐이었다. 그런데 `present`는 전혀 다른 두 가지를
> 덮는다. `requestFollow`가 **재정렬만 된 것**과, `requestFollow`가 이제 FollowRequest를 만들지
> 않고 관계를 바로 만드는 것 — 후자는 id가 살아남고 status도 `present`라서
> **증분 루프가 영원히 들여다보지 않는다.** 그 Claim은 틀렸는데 grounding은 멀쩡해 보이므로
> memory가 낡은 의미를 계속 참으로 주장한다. churn보다 나쁜, 조용한 부패다.

분류는 `(rawHash, normalizedFingerprint, location)` 세 값의 전이로 결정되는데,
**두 축은 서로 독립이다.** 내용은 그대로인데 위쪽에 줄만 늘어나면 `unchanged`이면서 동시에
위치가 바뀐 것이고, 이동하면서 prettier까지 돌면 `cosmetic`이면서 이동한 것이다.
하나의 enum으로는 표현되지 않는다.

```ts
type EvidenceDiff = {
  evidenceId: string;
  contentChange: "unchanged" | "cosmetic" | "modified" | "appeared" | "missing";
  relocated: boolean;        // 위치 변화 metadata. dirty 판정에 쓰이지 않는다
};
```

| `contentChange` | 조건 | Semantic Dirty |
|---|---|---|
| `unchanged` | `rawHash` 동일 | **아니오** |
| `cosmetic` | `rawHash` 다름, `normalizedFingerprint` 동일 | **아니오** — 포매팅·따옴표·주석·후행 콤마 |
| `modified` | `normalizedFingerprint` 다름 | **예** |
| `appeared` | 이전 generation에 이 id가 없음 | **예** (새 근거) |
| `missing` | 주소가 더 이상 해석되지 않음 | **예** |

`relocated = location이 바뀌었다`. 두 축의 조합 예:

```text
포매팅만 변경        → cosmetic  + relocated: false
위치만 이동          → unchanged + relocated: true
이동 + prettier      → cosmetic  + relocated: true
내용 변경 + 이동      → modified  + relocated: true
```

#### U1 — SemanticWorkSet: 아직 아무 의미와도 연결되지 않은 새 근거를 빠뜨리지 않는다

> **고친 문제:** 초안은 "dirty evidence에 **grounding된** Concept/Claim/Scenario를 할 일로
> 만든다"였다. 그런데 `appeared` evidence는 **정의상 아직 grounding이 없다** — 방금 추가된
> 코드이기 때문이다. 그래서 저장소에 기능이 통째로 하나 추가되면 evidence는 잔뜩 생기는데
> 그것에 걸린 의미가 하나도 없으므로 **할 일 목록이 비어 있고 agent는 새 기능의 존재조차
> 모른다.** 새 기능 발견은 이 제품의 주 사용 경로인데 거기가 막혀 있었다.

```ts
type SemanticWorkSet = {
  dirtyEvidence: EvidenceDiff[];             // class ∈ {modified, appeared, missing}
  affectedConceptIds: string[];
  affectedClaimIds: string[];
  affectedScenarioIds: string[];
  ungroundedAppearedEvidenceIds: string[];   // appeared 이면서 어떤 grounding에도 없는 것
};
```

```text
dirtyEvidence                  = { d | d.contentChange ∈ {modified, appeared, missing} }
affectedConcept/Claim/Scenario = dirtyEvidence에 grounding된 것들의 합집합
                                 (missing도 여기 기여한다 — 근거를 잃은 의미)
ungroundedAppearedEvidence     = { d | d.contentChange = appeared
                                     ∧ d.evidenceId 가 어떤 grounding에도 없음 }
```

**`relocated`는 dirty 판정에 들어가지 않는다.** 위치 변화 metadata일 뿐이고, 뷰어가
"코드가 옮겨졌습니다"를 보여주는 데 쓴다.

**agent에게 두 목록을 함께, 그러나 구별해서 준다.** 뜻이 다르고 지시도 다르다.

| | 뜻 | agent에게 시키는 것 |
|---|---|---|
| `affected*` | **기존 의미 중 재검토할 것** | 근거가 바뀌었거나 사라졌다. 그 Concept/Claim이 여전히 참인지 확인하고 갱신·철회하라 |
| `ungroundedAppearedEvidence` | **새로 나타났지만 아직 의미가 없는 근거** | 여기 새 기능이 있을 수 있다. 살펴보고 필요하면 Concept/Claim을 새로 만들라 |

`appeared`인데 이미 grounding이 있는 드문 경우(지웠던 심볼이 되살아나 옛 id가 돌아온 경우)는
`affected*`에 들어가고 ungrounded에는 들어가지 않는다.

**분량 제어:** 큰 기능이 한 번에 들어오면 ungrounded evidence가 수백 개일 수 있다.
프롬프트에는 **파일·entity 단위로 묶은 요약**만 싣고 나머지는 `get_evidence`로 가져가게 한다
(B6의 digest 원칙). 전체 개수는 항상 함께 알려 준다 — "40개 중 12개를 보여드립니다"가
조용한 절단보다 낫다.

`cosmetic`이 dirty set에 **들어가지 않는 것이 핵심**이다 (그리고 `relocated`는 애초에 판정에
참여하지 않는다). 들어가면 prettier 한 번에 프로젝트 전체를 재검토하게 되고, 그것이 §46이
실패로 규정한 churn이다.

**정규화의 오차 방향을 정직하게 적어 둔다.**

- 지역 변수 이름만 바꿔도 토큰이 달라져 `contentChange = modified`가 된다 → **거짓 양성.** 안전한 방향이다
  (불필요한 재검토일 뿐).
- 불변식을 설명하는 **주석만** 바뀌면 `code` 프로파일은 그것을 버리므로
  `contentChange = cosmetic`이 된다 → **거짓 음성.** 위험한 방향이다.

그래서 `normalizationProfile`을 둔다. `code`는 주석을 버리고, **`prose`는 주석·문서·설정 텍스트를
보존**하며 공백만 압축한다. 주석·문서·config 범위에 걸린 근거(특히 `propose_evidence`가 만드는
것 — 엔진이 모델링 못 하는 정책이 거기 있는 경우가 많다)는 `prose`를 쓴다. Core가
extent의 성격을 보고 기본값을 정하고, 제안자가 덮어쓸 수 있다.

**전이(transitive) 전파는 하지 않는다.** `requestFollow`의 본문이 바뀌었다고 그 호출자에 대한
Claim까지 자동으로 dirty로 만들지 않는다 — 그것은 경계가 없고, 우리가 이번 범위에서 미룬 Impact
문제 그 자체다. Core는 **직접 dirty한 것만** 할 일로 주고, 거기서 더 따라갈지는 agent가
`get_concept_context`로 판단한다. Core가 경계 짓고 AI가 판단한다 (I1).

#### 인덱싱 단계

- **P0 file / symbol** — 파일을 걸으며 sha256을 `fileHashes`에 기록하고, `ts.createProgram`으로
  top-level/exported 심볼 → `symbolId = "<relPath>#<qualifiedName>"`.
- **P1 definition / reference** — `ts.LanguageService.findReferences`.
- **P2 framework adapter** — 각 어댑터는 `{ id, detect(program, sourceFile): Evidence[] }`이고
  **절대 throw 하지 않는다** (C1). 실패는 `adapterReport`에 남는다.

  | adapter | 만드는 Evidence |
  |---|---|
  | `next-app-router` / `next-pages-api` / `express` | `route`, `api_handler` |
  | `react-jsx-events` (`onClick`/`onSubmit`/`onChange` → 핸들러 심볼) | `ui_event` |
  | `prisma` (`schema.prisma` 모델 + `prisma.<model>.<op>` 호출부를 read/write로 분류) | `db_entity`, `db_read`, `db_write` |
  | `project-config` (`package.json`, `next.config`, `.env.example`) | `config` |

- **P3 git_change** — `git diff --name-status <base>..HEAD` ∩ contentHash 불일치 (C2).
- **증분** `updateFiles(paths)` (C3) — 해당 파일 evidence를 재계산해 T1의 class를 판정하고,
  **dirty 파일을 가리키던 cross-file reference evidence만** 다시 푼다.

### 6.3 `@onto/core` — Store · Identity · Validator · Patch

**`SemanticStore`** — §5 T4의 generation + HEAD pointer로 읽고 쓴다. generation이 곧 history다.
쓰기는 프로세스 내 mutex와 `gen.lock` 아래에서 직렬화한다 (crash-consistency는 mutex가 아니라
pointer가 준다 — §5 T4).

**`IdentityResolver`** (§15) — 후보를 찾아 주되 **강제하지 않는다.** 판단은 AI, 측정은 Core (I1).

```text
Concept 후보:  exact name/alias · 정규화 이름 · grounding overlap(Jaccard) · 이전 버전 id
Claim  후보:   (subjectConceptId, normalize(predicate), objectKey)          ← §6.4
Scenario 후보: name · anchorConceptIds overlap                              ← §6.4
```

**`Validator`** — 실패는 전부 `Diagnostic[]` (A3).

| 단계 | 검사 | 실패 |
|---|---|---|
| **⓪ Version** | `baseAnalysisVersion` / `baseSemanticVersion`이 head와 일치 | error `version/stale-base` (§6.4) |
| **① Schema** | ajv. 오류 경로를 `/addedClaims/2 (id: "clm-7") /evidenceRefs/0`처럼 주석 | error |
| **② Evidence** | 모든 `evidenceRefs[]`가 실재하고 `status === "present"`. 새 ref가 `missing`을 가리키면 거절. transaction의 pendingEvidence도 여기 포함 | error `evidence/unknown-id`, `evidence/not-present` |
| **③ Grounding** | Concept는 `uncertain`이 아닌 한 evidenceRef ≥ 1, Claim은 ≥ 1, subject/object conceptId 실재 | error |
| **④ Stability** (§17·§46) | identity 점수가 임계값을 넘는 새 Concept/Claim → 재사용 제안. Evidence diff가 작은데 변경 비율이 높으면 churn 경고 | **warning** — 진짜 split이 필요할 수 있고 판단은 AI의 몫 (I1) |
| **⑤ 커밋 직전 재확인** | **아래 S3** | error `evidence/file-changed-during-turn` |

기존 ref가 `missing`이 된 항목은 실패가 아니라 **이번 turn의 할 일**로 `grounding/lost`
warning에 실려 나간다 (영향받는 concept/claim 목록 포함). §45가 구현되는 지점이다.

#### S3 — 커밋 직전 working-tree 재확인 (index ↔ 작업 트리 race)

> **고친 문제:** Evidence Engine이 T0에 인덱싱하고, agent는 수 분간 탐색하며 patch를 만든다.
> 그 사이에 사용자·에디터의 format-on-save·`git checkout`·다른 도구가 파일을 바꿀 수 있다.
> `evidence.json`의 `fileHashes`는 **T0의 사진**이므로 ②의 `present` 검사는 현실이 아니라
> 낡은 인덱스와 비교하는 것이 된다. 존재하지 않는 줄 범위에 grounding을 커밋하게 된다.

```text
commitPatch(patch):
  1. files := patch가 참조하는 모든 Evidence(기존 + pendingEvidence)의 filePath 집합
  2. 각 파일을 **지금 디스크에서 읽어** sha256을 계산한다      ← 참조된 파일만. 전체 재스캔 아님
  3. evidence.fileContentHash와 대조
       전부 일치 → 4로
       불일치    → 쓰지 않는다. 아래 T3의 abort/재시작 절차로 간다
  4. §5 T4의 generation 커밋 (pendingEvidence + memory patch + semanticVersion++)
```

2~4는 store mutex와 `gen.lock` 아래에서 실행된다.

**⓪과 ⑤는 다른 것을 막는다.** ⓪은 *우리 자신의* 동시 쓰기를, ⑤는 *바깥*에서 일어난 파일
변경을 막는다. 둘 다 필요하다.

#### T3 — race가 나면 Transaction을 버리고 같은 session에서 새로 연다

> **고친 문제:** 초안은 "bridge가 재인덱싱하고 갱신된 그림을 같은 turn의 agent에게 넘긴다"고만
> 썼고 **transaction을 어떻게 할지 말하지 않았다.** 그대로 두면 `observedAtVersion = N`으로
> 검증된 pendingEvidence가 N+1 인덱스로 넘어간다 — 방금 바뀐 파일에 대해 옛 검증 결과를 들고
> 가는 것이고, S3가 막으려던 바로 그 상태다.

```text
evidence/file-changed-during-turn 발생 시:

1. 현재 AnalyzeTransaction을 **abort** 한다. pendingEvidence를 전부 버린다.
2. 바뀐 파일을 증분 재인덱싱한다 → analysisVersion N+1, EvidenceDiff(§T1) 계산
3. **같은 agent session 안에서** 새 AnalyzeTransaction을 연다 (baseAnalysisVersion = N+1)
4. agent에게 넘긴다:
     - diagnostic evidence/file-changed-during-turn (바뀐 파일 목록)
     - 새 baseAnalysisVersion
     - 재인덱싱이 만든 Semantic Dirty Set
     - 버려진 제안의 목록 (요약만)
5. agent는 대화 문맥을 그대로 갖고 있으므로 **처음부터 탐색하지 않는다.**
   버려진 제안 중 여전히 유효하다고 판단하는 것은 **다시 propose 해야 한다.**
```

**pendingEvidence를 자동으로 옮겨 주지 않는 이유:** "여전히 유효한가"를 알려면 새 파일 내용에
대해 검증을 다시 돌려야 하는데, 그럴 거면 agent가 다시 주장하게 하는 편이 옳다 — 코드가 실제로
바뀐 뒤에는 agent가 **그 범위가 여전히 그 주장의 근거라는 데 동의하지 않을 수도** 있다. 조용히
옮기면 재검토되지 않은 주장을 코드 변경 너머로 밀수하는 셈이다. 규칙도 단순해진다:
**하나의 transaction은 언제나 정확히 하나의 analysisVersion에 묶인다.**

session은 유지되므로(Codex thread / Claude `session_id`, B2) 비용은 turn 하나뿐이다.

**abort 상한:** 한 task에서 3회까지만 재시작한다. 넘으면 멈추고 사용자에게
"파일이 계속 바뀌고 있습니다 — 저장을 멈추고 다시 시도해 주세요"라고 알린다.
format-on-save가 켜진 dev server가 돌고 있으면 실제로 일어나는 상황이고, 무한 재시작보다
말해 주는 편이 낫다.

### 6.4 정하고 넘어가는 것들

#### R3 — stale write 차단
`SemanticPatch`와 `submit_view_ir`에 `baseAnalysisVersion` / `baseSemanticVersion`을 넣는다.
거절 응답에는 **base → head 사이의 SemanticDiff를 함께 실어** 보낸다 — agent가 전부 다시 읽지
않고 rebase할 수 있어야 한다.

#### V2 — View cache freshness는 View 종류마다 다르다

> **고친 문제:** 초안은 모든 View cache를 `(analysisVersion, semanticVersion)` 쌍으로 판정했다.
> 그런데 포매팅만 바꾼 커밋도 `analysisVersion`을 올린다(§6.9 커밋 1). EvidenceDiff는
> 전부 `cosmetic`이고 Semantic Dirty는 비어 있는데도, exact match를 요구하면
> **의미가 전혀 바뀌지 않았는데 Overview/Scenario를 AI로 다시 생성하게 된다.**

| View | freshness 키 |
|---|---|
| **Overview · Scenario** | `semanticVersion` + view schema/planner version + request(anchor · scope · question), **그리고 reconcile 상태가 current인지** (§6.9) |
| **Trace** | `analysisVersion` + anchor + traversal options(hops · direction · scope) |

Trace가 `analysisVersion`을 쓰는 것은 맞다 — 그것은 Evidence 그래프의 결정론적 투영이므로
인덱스가 바뀌면 결과가 바뀔 수 있다. 재계산이 싸기도 하다(모델 호출이 없다).

**reconcile이 current가 아닐 때 Overview/Scenario를 어떻게 다루는가**

```text
semanticReconciledAnalysisVersion < analysisVersion
    → 캐시된 View를 **지우지 않는다.** needs review 로 표시한다.
```

지우지 않는 이유: 그 View는 여전히 사람이 읽을 수 있고, 코드가 바뀌었다는 이유만으로 화면을
비우면 사용자는 아무것도 얻지 못한다. 대신 "코드가 변경되어 아직 반영되지 않았습니다"를
화면에 붙이고, 분석을 다시 돌릴 수 있는 길을 준다 — §41의 progressive disclosure는 유지하되
신뢰 수준을 정직하게 표시하는 쪽이다.

**cosmetic/relocated만 있는 변경에서는 reconcile이 커밋 1에서 자동 advance되므로
needs review가 붙지도, View가 재생성되지도 않는다.**

**Semantic View freshness ≠ Evidence location freshness.**
Overview/ScenarioIR 안의 `evidenceRefs`는 id일 뿐이다. 그 근거의 현재 `file:line`·excerpt는
**View 생성 시점에 고정하지 않고, 렌더·상세 조회 시점에 Evidence Store에서 resolve한다.**
그래서 코드가 옮겨지거나 재정렬돼도 View를 다시 만들 필요 없이 화면에는 항상 최신 위치가 나온다
(그리고 §6.2의 `relocated` metadata가 "옮겨졌습니다"를 함께 보여준다).

#### Claim identity: **유지한다**
근거: (a) `SemanticPatch`가 이미 `updatedClaims` / `removedClaimIds`로 말하는데 안정된 id 없이는
뜻이 없다, (b) §47의 "Claim contradicted"는 기존 Claim의 **갱신**이다, (c) ScenarioStep/Branch가
`claimRefs`를 들고 있어 id가 흔들리면 캐시된 View가 매번 깨진다.

메커니즘은 Concept보다 **일부러 약하게**. key는 `(subjectConceptId, normalize(predicate), objectKey)`
이고 `normalize`는 소문자화 + 공백 압축뿐이다 — vocabulary 매핑을 하는 순간 I3를 어긴다.

정직하게 적어 둘 것: predicate가 자유 문자열이므로 **Claim identity는 Concept identity보다
불안정할 것이다.** 그것 자체가 §54 Q4이므로 eval은 둘을 **따로** 측정한다.

#### Canonical Scenario identity: **유지한다, 단 얇은 index로만**
- `ScenarioIR` — View다. cache일 뿐이고 source of truth가 아니다 (§49, I11). **영속하지 않는다.**
- `CanonicalScenarioEntry` — 영속하는 얇은 포인터.

```ts
type CanonicalScenarioEntry = {
  id: string; name: string; type: "user" | "system";
  goal?: string; anchorConceptIds: string[];
  status: "active" | "uncertain" | "deprecated";
  createdAtVersion: number; updatedAtVersion: number;
};
```

영속 이유: §22의 `OverviewIR.items[].scenarioRefs`가 이것을 가리키고, §26이 index를 유지한다고
했으며, §50이 `Area → Canonical Scenario`를 기본 네비게이션으로 삼는다. id가 매번 바뀌면
Overview가 매 분석마다 링크를 다시 맺는다.

**얇게 유지한다** — 이름·anchor·목표까지만. 두 번째 ontology가 되지 않게 하는 선이다.
따라서 `SemanticPatch`에 `addedScenarios` / `updatedScenarios` / `removedScenarioIds`가 붙는다.

### 6.5 `@onto/mcp-server` — §48의 tool + `propose_evidence`

byoa `packages/mcp-server/src/index.ts`의 구조를 그대로: 상태 없이 loopback HTTP + 토큰 헤더로
bridge에 위임 (B1). stdout은 프로토콜 전용. CoderMind의 **lazy/degraded mode**(C5)와
**instructions의 질문↔tool 매핑**(C6)을 가져온다.

| tool | 하는 일 |
|---|---|
| `get_project_semantic_memory({detail})` | 기본 **digest** (B6) |
| `get_concept_context({conceptId\|name})` | Concept + Claim(in/out) + grounding 요약 + **identity 후보** |
| `search_claims({query, conceptId?, limit})` | Claim 검색 |
| `get_evidence({ids?\|filePath?\|kind?\|symbolId?, includeSource?})` | Evidence + 선택적 소스 발췌. **transaction의 pendingEvidence도 보인다** |
| `get_scenario_context({anchor, question?})` | anchor에서 N hop 이내를 bounded하게 |
| **`propose_evidence(proposal)`** | **아래** |
| `submit_semantic_patch(patch)` | base version 포함. Validator ⓪~⑤ → 실패 시 `{ok:false, diagnostics}` |
| `submit_view_ir({requestId, viewKind, ir, base…})` | Overview/Scenario만. Trace는 받지 않는다 |
| `get_impact_context` | **stub** — `{ error: "not_enabled" }` |

#### R2 — Agent가 발견한 근거를 Core가 검증해 등록한다

> **고친 문제:** 초안은 agent가 미리 인덱싱된 evidence만 참조하게 했다. 그런데 §2는 AI가
> Repository를 직접 탐색한다고 했고 §11은 Evidence Engine을 "우선순위"로 두었지 완전한
> 인덱스로 두지 않았다. 엔진이 모델링하지 못한 근거(switch로 짜인 상태 기계, 설정이 결정하는
> 정책, 템플릿 리터럴 route, 주석의 불변식)를 발견하면 **의미를 버리거나 refs를 지어내는 것
> 말고 할 수 있는 일이 없었다.**

```ts
type EvidenceProposal = {
  kind: string;
  filePath: string;                              // repo-relative POSIX
  location: { startLine: number; endLine?: number };
  symbolHint?: string;
  summary: string;                               // 왜 이것이 근거인가
  confidence?: number;
};
```

Core의 검증 (전부 결정론, id 발급 **전에**):

```text
1. 경로 안전성   repo-relative POSIX, ".." / 절대경로 / ".git" 차단
                 → Archify `verifiedSourcePath()`를 그대로 (A4)
2. 파일 실재     프로젝트 루트 안에 realpath로 존재하는가
3. 범위 유효     endLine ≥ startLine, endLine ≤ 실제 줄 수
4. 지문 계산     Core가 그 범위를 직접 읽어 anchorFingerprint를 만든다  ← S1
5. 심볼 대조     symbolHint가 있으면 P0 인덱스와 대조. 불일치는 **warning**
                 (엔진이 모델링 못 한 것을 가리키는 것이 이 tool의 목적이므로 error가 아니다)
6. id 발급       ev:agent:<sha1(relPath + ":" + kind + ":" + anchorFingerprint)>
```

**agent는 evidence id를 직접 쓰지 않는다.** 발급받은 id에만 grounding할 수 있다.

#### S1 — identity와 relocation은 정규화 지문으로 한다 (exact byte가 아니다)

> **고친 문제:** 초안은 원문 바이트 해시(`rawHash`)를 **id의 일부이자 relocation
> 키**로 썼다. prettier 재정렬·들여쓰기·따옴표 스타일·후행 콤마만 바뀌어도 바이트가 달라져
> relocation이 실패하고 evidence가 `missing`이 된다. 더 나쁜 것은 **hash가 id 안에 있어서**
> 재제안해도 **다른 id**가 나온다는 점이다 — grounding을 복구할 수조차 없고 churn이 생긴다.
> 엔진 evidence는 R1으로 이 문제에서 벗어났는데 agent evidence만 노출되어 있었다.

세 가지를 분리한다.

**① `anchorFingerprint` — 정규화 토큰 지문 (identity와 relocation의 유일한 기준)**

```text
1. 범위를 렉싱한다 (TS/JS는 TypeScript scanner, 그 외는 공백/구두점 토크나이저)
2. 버린다:  공백 · 줄바꿈 · 주석
3. 정규화:  따옴표 스타일 통일 ('x' 와 "x" 는 같은 문자열 리터럴 토큰)
            후행 콤마 · 불필요한 세미콜론
4. 남긴다:  식별자 · 키워드 · 리터럴 **값** · 연산자 · 구조적 구두점
5. anchorFingerprint = sha1(tokens.join(""))
```

포매팅 변경에는 안정적이고, 코드가 실제로 바뀌면 달라진다.

**② relocation — 바이트 검색이 아니라 지문 검색**

```text
파일 contentHash가 바뀌면:
  a. 파일 전체를 렉싱하고 같은 토큰 길이의 창을 밀며 지문이 일치하는 창을 찾는다
       정확히 1개  → relocate. location · fileContentHash · observedAtVersion 갱신.
                      **id는 그대로. Grounding이 살아남는다.**  (relocationConfidence: "exact")
       0개        → c로
       2개 이상   → missing (모호하므로 재제안 필요)
  b. degraded 매칭: 식별자만 남긴 부분수열로 유사도 임계값 이상 + **유일**한 후보를 찾는다
       유일       → relocate, relocationConfidence: "degraded" + warning
                      (블록이 편집됐지만 같은 것으로 알아볼 수 있는 경우)
       그 외      → missing
  c. missing → 참조하는 Concept/Claim이 이번 turn의 할 일이 된다
```

유일성을 요구하므로 **스캔 순서가 결과에 영향을 주지 않는다** — 결정론이다.

**③ `excerpt` / `rawHash` — 사람 확인용이지 identity가 아니다**

원문은 화면에 보여주고 사람이 검증하는 데 쓴다. `rawHash`(§6.2의 exact 바이트 해시)는
"이 근거의 코드가 수정되었습니다"라는 **UI 신호**이자 EvidenceDiff의 `cosmetic` 판정 입력일 뿐,
id에도 relocation에도 들어가지 않는다.

#### S2 — `propose_evidence`는 analyze transaction에 넣고 `analysisVersion`을 올리지 않는다

> **고친 문제:** 초안은 발급 시점에 `observedAtVersion`을 주며 버전 체계에 참여하는 것처럼
> 썼다. 두 가지가 깨진다. (a) 제안이 `analysisVersion`을 올리면 `baseAnalysisVersion = N`으로
> 계산 중이던 patch가 **agent 자신의 tool 호출 때문에** stale-base로 거절된다 — 제안 → 거절 →
> 재조회 → 제안의 **self-deadlock**이다. (b) `analysisVersion`은 Trace cache의 staleness 키인데,
> agent가 근거 하나를 더했다고 모든 캐시가 무효가 될 이유가 없다.

**`analysisVersion`의 뜻을 하나로 고정한다: "결정론적 저장소 인덱스의 상태."**
Evidence Engine이 (재)인덱싱할 때만 오른다. 그 외 어떤 것도 올리지 않는다.

```ts
type AnalyzeTransaction = {
  taskId: string;
  baseAnalysisVersion: number;      // 이 turn이 작업하는 인덱스 상태. turn 내내 불변
  pendingEvidence: Evidence[];      // 검증되어 id를 받았지만 아직 evidence.json에 없다
};
```

- 검증된 제안은 즉시 `get_evidence`로 **읽히고 grounding할 수 있다** — 단 이 task 안에서만.
- `observedAtVersion = tx.baseAnalysisVersion`. 새 버전이 아니다.
- **커밋은 patch와 함께 하나의 generation으로 나간다** (§5 T4). 검증을 모두 통과하면
  `pendingEvidence` + memory patch + `semanticVersion++`가 새 generation에 쓰이고 HEAD가 한 번의
  `rename(2)`으로 넘어간다.
- patch가 끝내 참조하지 않은 제안은 버린다. 단 조용히가 아니라 `events.ndjson`에
  `evidence/proposed-unused`로 남긴다 — 쓰이지 않은 제안은 프롬프트 품질의 신호다.
- turn이 실패·중단되거나 **working-tree race로 abort되면**(§6.3 T3) transaction을 통째로
  버린다. 반쯤 쓰인 evidence는 없다.
- transaction의 수명은 **하나의 analysisVersion**이다. task 하나 안에서도 재인덱싱이 일어나면
  새 transaction이 열린다 (§6.3 T3). `POST /api/tasks/:id/stop`이 폐기한다.

제안에는 `normalizationProfile`(§6.2 T1)과 선택적 `graph` 힌트(§6.6 T2)를 실을 수 있다.
Core가 프로파일 기본값을 extent의 성격에서 정하고, `graph`의 EntityRef가 인덱스에서 해석되지
않으면 **비순회 evidence로 저장하고 warning**을 낸다 — 제안 자체를 거절하지는 않는다.

`baseAnalysisVersion`에 무엇을 넣어야 하는지도 이것으로 답이 된다 — **turn 시작 시점의 값,
turn 내내 그대로.**

### 6.6 Trace View는 결정론적 투영이다 (AI가 만들지 않는다)

> **고친 문제 (R4):** 초안은 Trace도 View Planner turn으로 만들게 했다. §37의 TraceIR은
> `codeEntities` + `links`뿐인데 **그 안의 모든 것이 이미 Evidence에 결정론적으로 존재한다.**
> AI에 맡기면 지연과 환각 표면만 늘고 의미 이득이 없다.

#### T2 — Evidence Entity와 Evidence Link의 endpoint schema

> **고친 문제:** "evidence 그래프를 따라 확장"이라고 썼지만 **노드가 무엇이고 엣지가 무엇이며
> 엣지가 끝점을 어떻게 지칭하는지**를 정하지 않았다. `Evidence`는 `filePath`/`symbolId`를 가진
> 평평한 레코드일 뿐 `from`/`to`가 없어서 `projectTrace`가 순회할 대상이 없었다.

**Evidence Entity** — 링크가 가리킬 수 있는 주소. 모든 evidence가 entity인 것은 아니다.

```ts
type EntityRef =
  | { kind: "file";   filePath: string }        // entityKey: "file:src/a.ts"
  | { kind: "symbol"; symbolId: string }        //            "symbol:src/a.ts#requestFollow"
  | { kind: "route";  routeKey: string }        //            "route:POST /api/follow"
  | { kind: "model";  modelKey: string };       //            "model:prisma:FollowRequest"

type EvidenceGraphRole =
  | { role: "entity"; entity: EntityRef; label: string }
  | { role: "link";   from: EntityRef; to: EntityRef; linkKind: string };
```

`entityKey(ref)`는 정규 문자열이고 **그 자체로 전순서**다 — S4의 정렬 tie-break이 이것으로 단순해진다.

| evidence kind | graph role | from → to |
|---|---|---|
| `file` | entity (file) | |
| `symbol` · `definition` | entity (symbol) | |
| `route` · `api_handler` | entity (route) | |
| `db_entity` | entity (model) | |
| `contains` (P0에서 파생) | link | file → symbol |
| `reference` · `call` | link | symbol(참조하는 쪽) → symbol(참조되는 쪽) |
| `api_handler` (링크 면) | link | route → symbol(핸들러) |
| `ui_event` | link | symbol(컴포넌트) → symbol(핸들러) |
| `db_read` · `db_write` | link | symbol(호출부) → model |
| `config` | link | file → symbol \| route \| model |

`graph`가 없는 evidence(`git_change`, 그리고 대부분의 `propose_evidence` 산출물)는
**순회 대상이 아니다.** Concept를 grounding하는 데는 그대로 쓰이지만 Trace에는 나오지 않는다.
이 구분은 정직하고 유용하다 — "이 의미의 근거는 있지만 코드 그래프 상의 위치로는 표현되지
않는다"가 실제로 있는 상태다.

`propose_evidence`는 `graph` 힌트를 **선택적으로** 실을 수 있고, Core가 검증한다:
`from`/`to`의 EntityRef가 인덱스에 실재하는 entity로 해석되어야 한다. 해석되지 않으면
제안 자체는 받되 **비순회 evidence로** 저장하고 warning을 낸다.

`@onto/core`의 `projectTrace(anchor, hops = 2)`가 이 위에서 계산한다.

- **노드** = entity (`entityKey`로 식별)
- **엣지** = 양 끝점이 모두 노드 집합 안에 있는 link-evidence
- **seed** = anchor의 grounding evidence에서 얻는 entity
  (entity-role은 자기 자신, link-role은 양 끝점 둘 다)
- TraceIR의 `codeEntities[i].id = entityKey`,
  `links[j].evidenceRefs` = 그 엣지를 정당화하는 evidence id들
  (같은 두 심볼 사이의 호출부 여러 개는 **엣지 하나 + refs 여러 개**로 접힌다 — 결정론적이고
  View를 bounded하게 유지한다)
- `hops`는 **entity hop**을 센다.

#### S4 — Evidence 그래프는 cycle을 갖는다. 처리 규칙을 정한다

> **고친 문제:** 초안은 `projectTrace`가 결정론이라고 단언했지만 cycle을 어떻게 다루는지 쓰지
> 않았다. Evidence 그래프에는 cycle이 흔하다 — 상호 재귀, `A imports B / B imports A`,
> 서비스 → 리포지토리 → 이벤트 → 같은 서비스, React 컴포넌트 ↔ 훅. 단순 DFS는 무한 루프에
> 빠지거나 순회 순서에 따라 다른 결과를 낸다.

> **고친 문제 2:** 초안의 `visited`는 `Set<evidenceId>`였는데 T2에서 노드를 **entity**로
> 정의했으므로 어긋난다. evidenceId로 방문 표시를 하면 같은 entity를 그것을 건드리는 evidence
> 수만큼 여러 번 확장하게 되고 hop 배정이 일관되지 않는다.
>
> **고친 문제 3:** `target.hop <= source.hop`을 **cycle 판정으로 쓴 것이 틀렸다.** cycle이 없어도
> 성립한다. `A→B, A→C, B→C`에서 `B→C`는 `hop(C)=1 <= hop(B)=1`이지만 이 그래프는 DAG다.
> 이것은 **레이아웃상 앞으로 가지 않는 엣지**를 뜻할 뿐 순환을 뜻하지 않는다.

세 가지를 분리한다. **BFS는 경계, SCC는 cycle 판정, hop 비교는 레이아웃.**

```text
projectTrace(anchor, hops = 2):

  1. seeds := anchor의 grounding evidence에서 얻은 entity 집합
             (entity-role은 자기 자신, link-role은 양 끝점 둘 다), entityKey로 정렬

  2. **BFS로 bounded entity set을 고른다** (DFS 아님)
     visited := Set<entityKey>          ← evidenceId가 아니다
     각 entity는 hop = **처음 도달한 거리**를 갖는다.
     BFS이므로 최단 거리이고 따라서 순회 순서와 무관하다

     **기본 순회는 outgoing·incoming 양방향이다.** anchor에서 나가는 것만 따라가면
     "이 함수를 누가 부르는가"가 화면에서 사라진다 — Trace가 답해야 하는 질문의 절반이다.
     hop은 방향과 무관한 거리다.
     **다만 link의 실제 방향은 그대로 보존한다** — 역방향으로 도달했다고 해서
     엣지를 뒤집지 않는다. `from`/`to`는 언제나 코드에 있는 그대로다.
     (`ViewRequest.scope`로 `outgoing`/`incoming`만 볼 수 있게 좁힐 수 있다.)

  3. edge := 양 끝점이 모두 노드 집합 안에 있는 link-evidence 전부.
     역방향으로 도달한 엣지와 self-loop **포함**. 그래프는 cycle을 그대로 갖는다.
     경계가 지어지는 것은 **노드 집합이지 edge 집합이 아니다**

  4. **SCC로 진짜 cycle을 판정한다** (Tarjan, bounded 노드 집합 위에서)
     cycle: true      ⟺ 양 끝점이 크기 > 1 인 같은 SCC 안에 있다
     selfLoop: true   ⟺ from === to
     각 노드에 sccId를 붙인다. sccId는 그 컴포넌트 안 **최소 entityKey**로 정해
     순서와 무관하게 안정적으로 만든다

  5. **hop 비교는 레이아웃 전용이다**
     nonForward: true ⟺ hop(to) <= hop(from)
     "앞으로 가지 않으므로 옆 레일에 그린다"는 뜻일 뿐, 순환 주장이 아니다

  6. 정렬 (전순서):
     nodes  (hop, entityKey)          ← entityKey 자체가 전순서라 tie-break이 더 필요 없다
     edges  (fromId, toId, kind)
     Tarjan은 이 정렬된 노드 순서로, 각 노드의 out-edge도 정렬된 순서로 돌린다 → 결정론

  7. 절단: 노드 수가 renderer safety ceiling을 넘으면 **hop 경계에서** 자른다.
     hop 중간에서 자르지 않는다 — 그러면 결과가 hop 안의 순서에 의존하게 된다.
     `truncatedAtHop`을 기록하고 뷰어가 화면에 말한다
```

```ts
type TraceLink = {
  fromId: string;          // entityKey
  toId: string;            // entityKey
  kind: string;
  evidenceRefs: string[];  // 이 엣지를 정당화하는 link-evidence들
  cycle?: boolean;         // SCC 판정 — 실제 순환
  nonForward?: boolean;    // hop 비교 — 레이아웃 전용
  selfLoop?: boolean;
};
```

**결정론 주장:** 노드가 `entityKey`로 식별되고, 평생 한 번만 확장되며, BFS 최단 hop을 갖고,
전순서로 정렬되고, SCC를 그 정렬 순서로 돌리므로 — **같은 anchor + 같은 evidence 인덱스는
항상 바이트 단위로 동일한 TraceIR을 낸다.** cycle이 이것을 위협하지 않는다.

**두 플래그의 역할을 섞지 않는다.**

| 플래그 | 무엇으로 정하는가 | 무엇에 쓰는가 |
|---|---|---|
| `cycle` | **SCC** — 양 끝점이 크기 > 1 인 같은 컴포넌트 | **의미 전달.** 같은 SCC 노드들을 묶어 "이 부분은 서로 맞물려 있습니다"로 표시한다 |
| `nonForward` | **hop 비교** — `hop(to) <= hop(from)` | **레이아웃 전용.** 옆 레일의 회귀 호로 그린다 (Scenario의 back edge(§6.8)와 같은 처리라 두 View가 시각적으로 일관된다) |
| `selfLoop` | `from === to` | 노드에 작은 루프 배지 |

`nonForward`인데 `cycle`이 아닌 엣지는 흔하다 — 그것은 순환이 아니라 그냥 앞으로 가지 않는
엣지다. 화면에서도 그렇게 읽혀야 한다.

따르는 결과:
- `submit_view_ir`은 `trace`를 **받지 않는다.** `POST /api/views`가 동기로 응답한다.
- AI가 Trace에 기여하는 것은 anchor Concept의 **label**뿐이고 그것은 이미 memory에 있다.
- **환각 표면이 0이다.** acceptance가 결과를 정확히 단언할 수 있다.
- **분석 전에도 동작한다.** Evidence만 있으면 되므로 프로젝트를 열자마자 코드 구조를 볼 수 있다.

### 6.7 Bounded View: soft warning + renderer safety ceiling

> **고친 문제 (R6):** 초안은 `participants ≤ 6`, `steps ≤ 20`을 **schema `maxItems`로** 걸었다.
> "실제 흐름에 참여자가 7이면 안 된다"는 검증되지 않은 **제품 존재론 주장**이고, 하드 실패로
> 두면 agent가 통과하려고 **의미 있는 내용을 조용히 버린다.**

| 층 | 성격 | 동작 |
|---|---|---|
| **Schema** | 구조적 유효성만 | 개수 제한 **없음** |
| **Soft budget** | view kind별 설정값 | 초과 시 `severity: "warning"` `view/over-budget` + supportedFixes. **제출은 성공한다.** `events.ndjson`에 기록, UI에 "정보량이 많습니다" |
| **Renderer safety ceiling** | 뷰어가 멈추지 않게 하는 것이 유일한 목적. 일부러 넉넉하게 | IR을 거절하지 **않는다.** 넘는 부분을 "…외 N개"로 접고 **접었다는 사실을 화면에 말한다.** 조용히 자르지 않는다 |

budget 수치는 설계 약속이 아니라 **§53 View Utility에서 측정해 조정할 값**이다.
초기값과 근거를 `@onto/core/viewBudget.ts` 주석에 적고 eval이 실제 분포를 리포트한다.

### 6.8 Scenario의 그래프 가정과 loop 규칙

> **고친 문제 (R5):** 초안은 "transition DAG의 topological rank"라고 써서 **비순환을 가정**했다.
> 실제 흐름에는 재시도·폴링·"승인 대기 → 수정 → 재신청" 루프가 흔하고 §28에는 비순환 제약이 없다.

**ScenarioIR은 DAG를 요구하지 않는다.** 대신 흐름의 시작과 끝을 요구한다.

```ts
entryStepId: string;
outcomeStepIds: string[];      // 하나 이상의 종료 지점
```

§24가 Scenario를 "하나의 목적을 설명하는 **대표 흐름**"이라고 정의했으므로 시작점과 도착점이
있는 것이 정의상 맞고 layout도 이것으로 잘 정의된다.

**Loop 규칙**
- back edge는 **합법이다.** 단 `loop: true`로 표시하고 `condition`을 **반드시** 갖는다.
- 렌더는 옆 레일의 라벨 붙은 회귀 호로 그린다. **step 순서를 재배치하지 않는다.**
- **Loop compression:** agent는 루프를 반복된 step으로 펼치면 안 된다. 같은 행동이 같은
  `conceptRefs`로 두 번 나오면 그것은 **step 하나 + back edge**다. Validator가 `conceptRefs`가
  동일하고 label이 매우 유사한 step 쌍을 발견하면 warning `scenario/loop-unrolled` +
  `supportedFixes: ["하나의 step으로 합치고 condition을 가진 back edge를 추가하라"]`.

**layout의 rank 계산 (결정론):**

```text
1. entryStepId에서 DFS로 back edge를 식별한다
2. back edge를 제거한 DAG에서 topological rank를 계산한다  → y
3. participantId → x lane
4. entryStepId에서 도달 불가능한 step은 error `scenario/unreachable-step`
5. branch의 paths[].nextStepId는 도달 가능해야 한다.
   branch는 lane 안에서 병렬 열을 만들 뿐 새 lane을 만들지 않는다
```

### 6.9 `apps/bridge` — agent 배선

byoa에서 포팅: `agents/types.ts`, `agents/codex/adapter.ts`, `agents/codex/appServerClient.ts`,
`agents/claude/adapter.ts`, `platform.ts`, `state.ts`. 바뀌는 것은 MCP 서버 이름과
`TaskMode`(`"analyze" | "view" | "chat"`)뿐이다.

`analyze`는 프로젝트의 `AGENTS.md`/`CLAUDE.md`를 로드하지 않는다 — 그것은 기능1의 인계
산출물이지 분석 turn의 규칙이 아니다 (B5, spike §14가 정확히 이 문제로 깨졌다).

**반드시 유지할 provider 설정 (B3):**
`approvalPolicy: { granular: { mcp_elicitations: true, … } }`,
elicitation에서 **우리 서버 이름만 accept.**

```text
GET  /api/health · /api/models · /api/state
POST /api/projects/analyze     { projectPath, mode: "full" | "incremental" | "index-only" }
GET  /api/memory · /api/memory/concepts/:id
POST /api/views                trace            → Core가 동기로 투영해 즉시 응답 (§6.6)
                               overview·scenario → 캐시가 fresh하면 즉시, 아니면 view turn
                                                   (freshness 기준은 §6.4 V2)
GET  /api/views/:id
POST /api/tasks/:taskId/stop · /api/sessions/reset · /api/sessions/resume · GET /api/sessions
/internal/*                    토큰 가드. MCP server 전용 (B1)
```

WS `/events` — replay 버퍼는 **taskId로 필터링** (B8).

**분석 turn — 결정론 먼저, AI 나중. generation transition이 두 번 일어난다.**

`evidence.json`은 `gen/<generation>/` 안에 있으므로, Evidence Engine이 만든 새 인덱스를
agent가 읽으려면 **먼저 그 상태가 HEAD가 가리키는 generation이 되어야 한다.**
그래서 인덱싱과 의미 갱신은 각각 독립된 커밋이다.

```text
[커밋 1] Repository re-index
  1. Evidence Engine 실행 (모델 호출 없음)
  2. EvidenceDiff(§6.2 T1)로 **SemanticWorkSet**(§6.2 U1)을 만든다.
     dirty = contentChange ∈ {modified, appeared, missing}  — **cosmetic 제외, relocated 무관**
  3. 새 generation 생성
       analysisVersion++
       semanticVersion 유지          ← 의미는 아직 아무것도 바뀌지 않았다
       semanticReconciledAnalysisVersion:
         SemanticWorkSet이 **비어 있으면**  → 새 analysisVersion으로 advance
         SemanticWorkSet이 **있으면**       → 기존 값 유지
  4. atomic HEAD switch

[준비]
  5. AnalyzeTransaction 생성 (baseAnalysisVersion = 방금 커밋된 값, turn 내내 불변)
  6. agent에게 `affected*`("재검토할 기존 의미")와
     `ungroundedAppearedEvidenceIds`("아직 의미가 없는 새 근거")를 **구별해서** 준다

[커밋 2] Agent semantic analysis
  7. agent turn (mode: "analyze")
       digest + 할 일 목록 + identity 후보를 준다
       agent: get_evidence / 파일 직접 탐색 / propose_evidence → submit_semantic_patch
       실패하면 diagnostics를 받아 같은 turn에 다시 submit
  8. Validator ⓪~⑤ 통과 → 새 generation 생성
       analysisVersion 유지          ← 인덱스는 그대로다
       semanticVersion++
       semanticReconciledAnalysisVersion = 현재 analysisVersion 으로 advance
       pendingEvidence(agent-origin)도 여기서 함께 커밋된다
  9. atomic HEAD switch → SemanticDiff를 WS로 push
 10. stale해진 View IR cache 표시 (§6.4 V2 — View 종류마다 기준이 다르다)
```

**이렇게 나누는 이유:** agent 분석이 실패하거나 중단되어도 **커밋 1은 남는다.**
"최신 Evidence Index는 있고 Semantic Memory만 이전 버전"이라는 상태를 정직하게 표현할 수 있고,
다음 turn이 인덱싱부터 다시 하지 않아도 된다.

**`semanticReconciledAnalysisVersion` — 그 사이 상태에 이름을 붙인다.**
현재 Semantic Memory가 **어느 시점의 코드와 맞춰진 것인지**를 나타낸다.

```text
semanticReconciledAnalysisVersion === analysisVersion
    → Semantic Memory가 현재 코드와 맞춰져 있다 (reconcile current)

semanticReconciledAnalysisVersion <  analysisVersion
    → 코드는 앞서 갔고 의미는 아직 따라가지 못했다 (reconcile stale)
```

포매팅만 바뀐 커밋에서는 SemanticWorkSet이 비므로 **커밋 1에서 자동으로 advance된다** —
agent를 부르지 않고도 reconcile은 current로 남는다. 그것이 §6.2 T1의 `cosmetic` 분류가
실제로 값을 만들어 내는 지점이다.

§6.3 T3의 race 재인덱싱도 **커밋 1과 같은 종류의 transition**이다 — analysisVersion만 오르고
semanticVersion은 그대로이며, `semanticReconciledAnalysisVersion`도 같은 규칙으로 처리된다.
그 위에서 새 AnalyzeTransaction이 열린다.

**프롬프트** — C9의 evidence-first 제약을 넣되 한 줄을 바꾼다:

```text
경로·심볼·줄번호를 지어내지 마라.
모든 conceptRefs/claimRefs/evidenceRefs는 실재하는 id여야 한다.
엔진이 인덱싱하지 못한 근거를 발견했다면 버리지 말고 propose_evidence로 등록을 요청하라.
사용자에게 보이는 label은 파일명/함수명이 아니라
  ① Intent에서 이미 쓴 용어 ② 저장소의 도메인 용어 ③ 네가 복원한 제품 의미 순으로 고른다.
기술 세부는 Trace View에서만 노출한다.        (§50.1, I12)
```

### 6.10 `apps/web` — React viewer

byoa `apps/web`(React 19 + Vite)의 WS 배선과 셸을 포팅하고 View 컴포넌트를 새로 쓴다.

| 컴포넌트 | layout |
|---|---|
| `OverviewView` | area → item 트리. presentation hierarchy이지 Core ontology가 아니다 (§22) |
| `ScenarioView` | swimlane. §6.8의 rank 규칙. branch는 마름모 + 라벨 갈래, back edge는 옆 레일 회귀 호, `stateChange`는 원인 step 옆에 `팔로우 요청: 없음 → 승인 대기` 주석 (§34) |
| `TraceView` | hop으로 층을 나눈다. **`nonForward` 엣지**를 Scenario back edge와 **같은** 회귀 호로 그리고, **`cycle`**은 SCC 묶음 표시로 따로 보여준다. 링크 방향은 코드에 있는 그대로 (§6.6) |

**Progressive Disclosure** (§41): Overview item → Scenario / Scenario step → StepDetail
패널 → "실제 코드 보기" → 그 step을 anchor로 한 TraceView.

**Grounding을 항상 만질 수 있게 한다.** 모든 label이 자기 `evidenceRefs`를 들고 있고, hover하면
`file:line`, 클릭하면 소스 발췌가 열린다. **그 위치와 발췌는 View IR에 굳어 있지 않고 렌더
시점에 Evidence Store에서 resolve된다** (§6.4 V2) — 코드가 옮겨져도 View를 다시 만들지 않는다.
구분해서 보여줄 것:
- `origin: "agent"` — 엔진이 확인한 것과 agent가 주장한 것은 신뢰 수준이 다르다
- `relocationConfidence: "degraded"` — "코드가 바뀌어 위치를 추정했습니다"
- `relocated: true` — "이 근거의 코드가 옮겨졌습니다"
- `contentChange` 변화 — "이 근거의 코드가 수정되었습니다"
- `status: 'uncertain'` / 낮은 confidence — **숨기지 않고 약하게.** 숨기면 검증할 기회를 잃는다

---

## 7. 검증

### 7.1 회귀 게이트 — `npm run acceptance`

**agent의 자기 보고를 신뢰의 근거로 삼지 않고** 파일시스템과 두 증거원을 직접 본다
(B4, SPIKE_FINDINGS §8). 아래는 전부 **hard**다.

```text
 1. evidence.json이 생성되고 analysisVersion이 올라간다
 2. agent가 get_evidence를 호출했다               [agent-stream 증거]
 3. 같은 호출이 bridge에 도달했다                  [bridge-endpoint 증거]   ← 둘 다 있어야 통과
 4. submit_semantic_patch가 Validator ⓪~⑤를 통과했다
 5. §7.2의 **structural** coverage를 만족한다       (smoke/semantic은 게이트가 아니다)
 6. 모든 evidenceRefs가 present 상태의 실재 evidence를 가리킨다   (허구 Grounding 0)
 7. propose_evidence가 지어낸 범위(파일 끝 너머, "../" 경로)를 거절한다
 8. propose_evidence가 analysisVersion을 올리지 **않는다**,
    그리고 같은 turn의 patch가 stale-base로 거절되지 **않는다**     (§6.5 S2 self-deadlock)
 9. stale base로 보낸 patch가 version/stale-base로 거절된다
10. 커밋 직전에 참조 파일을 바꾸면 evidence/file-changed-during-turn으로
    **쓰기가 일어나지 않고**, transaction이 abort되며, 같은 session에서
    새 baseAnalysisVersion으로 새 transaction이 열린다              (§6.3 S3 · T3)
11. OverviewIR / ScenarioIR이 schema를 통과한다
12. TraceIR이 같은 anchor에 대해 두 번 호출해도 바이트 단위로 동일하다   (§6.6 결정론)
13. **cycle이 있는 anchor**(상호 재귀 fixture)에서 projectTrace가 종료하고,
    SCC로 판정된 cycle이 표시되며, 두 번 호출이 동일하다             (§6.6 S4·U2)
13b. **DAG fixture**(`A→B, A→C, B→C`)에서 `B→C`가 `nonForward: true`이지만
    **`cycle`은 붙지 않는다** — hop 비교를 cycle 판정으로 쓰지 않는다는 것의 직접 시험
14. link-evidence의 from/to EntityRef가 모두 실재 entity로 해석되고,
    같은 두 심볼 사이의 호출부 여러 개가 **엣지 하나 + refs 여러 개**로 접힌다  (§6.6 T2)
15. Scenario의 모든 step이 evidenceRef ≥ 1이고 entry에서 전부 도달 가능하다
16. 파일을 **포매팅만** 바꿔 커밋 (prettier 재정렬 + 따옴표 + 주석 추가)
    → engine·agent evidence 모두 하나도 끊기지 않고,
      **contentChange가 전부 unchanged/cosmetic이라 dirty set이 비어 있다**
      (`relocated`는 true여도 무방하다 — 판정에 참여하지 않는다)
      → `semanticReconciledAnalysisVersion`이 **커밋 1에서 자동 advance되고**,
        Overview/Scenario cache가 재생성되지도 needs review로 바뀌지도 않는다
                                          (§6.2 R1 · T1 · §6.5 S1 · §6.9 · §6.4 V2)
17. 심볼의 **본문 의미**를 바꾸고 커밋 (id는 그대로 살아남는 변경)
    → 그 evidence가 **contentChange = modified**로 분류되어 dirty set에 들어가고,
      grounding된 Concept/Claim이 할 일 목록에 나타나며,
      `semanticReconciledAnalysisVersion`이 **advance되지 않아** 기존 Overview/Scenario가
      **삭제되지 않고 needs review로 표시된다**       (§6.2 T1 — 조용한 부패 방지 · §6.9)
18. 심볼을 **삭제**하고 커밋 → 그 evidence만 missing이 되고,
    참조하던 Concept/Claim이 할 일 목록에 나타난다
18b. **기능 파일을 통째로 새로 추가**하고 커밋 →
    `ungroundedAppearedEvidenceIds`가 비어 있지 않고, agent가 그것에 대해
    새 Concept를 만든다. **기존 의미에 아무것도 걸려 있지 않아도 할 일이 생긴다**
                                                    (§6.2 U1 — 새 기능 발견)
18c. 같은 `caller → callee` 사이에 호출부가 여러 개인 fixture에서
    **앞쪽에 새 호출부를 하나 추가**해도 기존 call evidence id가 그대로 남는다
    (새 것 하나만 appeared로 늘어난다)                              (§6.2 U3)
19. 커밋 중간(HEAD rename 직전)에 프로세스를 SIGKILL → 재시작 시 **옛 generation이
    온전히 읽히고**, 고아 generation이 청소된다                     (§5 T4 crash-consistency)
20. Stop이 task.error가 아니라 task.interrupted가 된다
```

16과 17은 **한 쌍으로만 의미가 있다.** 16만 있으면 "아무것도 dirty로 만들지 않는" 구현이
통과하고, 17만 있으면 "전부 dirty로 만드는" 구현이 통과한다. 둘을 같이 걸어야 T1의 분류가
실제로 작동한다는 뜻이 된다.
19는 §5 T4가 막는다고 주장한 실패 모드를 직접 재현한다 — 주장했으면 시험해야 한다.
8·10은 transaction 규칙(self-deadlock 없음, race 시 abort)을 직접 본다.
20은 byoa에서 자동 검증을 빠져나가 수동으로만 발견된 항목이다(Finding 7).

### 7.2 개수가 아니라 fixture-specific semantic coverage

> **고친 문제 (R7):** 초안의 `Concept ≥ 8, Claim ≥ 10`은 **볼륨을 보상한다.** §43·§53이 원하는
> 것과 정반대이고 쓰레기로도 통과한다.

`fixtures/fixture-app/expectations.json`에 사람이 한 번 정해 둔다 (fixture의 `design.json`에서 유도).

```jsonc
{
  "requiredConcepts": [
    { "key": "follow-request",
      "acceptableNames": ["팔로우 요청", "친구 신청", "팔로우 신청"],
      "mustGroundIn": ["prisma/schema.prisma#FollowRequest",
                       "src/services/follow.ts#requestFollow"] }
  ],
  "requiredClaims": [
    { "key": "private-account→follow-request",
      "subjectKey": "private-account", "objectKey": "follow-request",
      "mustGroundIn": ["src/services/follow.ts#requestFollow"],
      "meaningKeywords": ["승인", "요청"] }
  ],
  "forbiddenConcepts": ["PrismaClient", "FollowButton", "useEffect"],
  "requiredScenarios": [
    { "key": "follow", "mustIncludeConceptKeys": ["follow-request", "follow-relation"] }
  ],
  "reviewedPredicates": [
    { "claimKey": "private-account→follow-request",
      "predicate": "팔로우 시 상대 사용자의 승인을 요구한다",
      "verdict": "correct", "reviewedAtVersion": 3 }
  ]
}
```

#### S6 — Claim 검사를 세 층으로 나눈다

> **고친 문제:** `meaningKeywords`를 **hard**로 두었다. predicate에 "승인"과 "요청"이 있다고
> 의미가 맞는 것이 아니다 — "승인 요청을 무시한다"도 통과한다. 키워드는 스모크 테스트이지
> 증명이 아니다.

| 층 | 검사 | 성격 | 왜 |
|---|---|---|---|
| **structural** | subject/object concept 쌍이 존재하고 Claim이 `mustGroundIn` evidence에 grounding되어 있다 | **hard** | 구조 + 근거는 진짜로 증명된다 |
| **smoke** | predicate에 `meaningKeywords`가 나타난다 | **warning** | 없으면 "확인 필요"로 표시할 뿐 게이트를 막지 않는다 |
| **semantic** | predicate가 기대 의미와 실제로 같은가 | **자동 판정하지 않는다** | eval이 사람 리뷰 큐에 올린다. 판정 결과는 `reviewedPredicates`에 누적되어 다음 실행부터 회귀 검사로 쓰인다. 같은 claimKey에 **다른 predicate**가 나오면 재리뷰 대상이지 자동 통과도 자동 실패도 아니다 |

Concept 쪽도 같은 원칙이다.

| 검사 | 성격 |
|---|---|
| Grounding truthfulness — 허구 evidenceRef 0 | **hard** (I9) |
| Concept coverage — 이름이 `acceptableNames` 중 하나(또는 alias) **이면서** `mustGroundIn` evidence에 grounding | **hard** — 이름만으로는 통과하지 않는다. **grounding이 진짜 기준이다** |
| Abstraction level — `forbiddenConcepts`가 승격되지 않았다 | **hard** (§29) |
| Scenario coverage — 필수 scenario가 존재하고 필수 concept를 step에서 다룬다 | **hard** |
| 정보량 (budget 초과) | **warning** (§6.7) |
| Meaning correctness | **사람 판정** — §53 Semantic Quality의 지표이지 게이트가 아니다 |

### 7.3 평가와 비교 arm — `npm run eval`

> **고친 문제 (R8 → S5):** 초안에는 비교 대상이 없었다. 그래서 arm을 하나 만들었는데,
> 그것을 `baseline-classifier`라고 불렀다. **그것은 classifier-first가 아니다.** CoderMind의
> classifier-first는 고정 taxonomy로 파일을 분류한 뒤 결정론적 트리 정규화를 거쳐 typed RPG를
> 만드는 파이프라인이고, 우리가 만든 것은 그냥 "미리 만든 evidence 요약만 받은 AI 분석"이다.
> 그 이름을 쓰면 우리 arm과 원래 비교 대상을 **둘 다 잘못 표현한다.**

우리 arm이 실제로 조작하는 변수는 하나다 — **저장소를 직접 탐색하게 하는가, 미리 만든 인덱스
요약만 주는가.**

```text
agent-first  (제품 경로)   evidence digest를 seed로 주고 저장소를 직접 탐색하게 한다
                           propose_evidence 허용

index-only   (비교 arm)    evidence.json만으로 만든 file/symbol 요약 번들을 주고
                           그것으로 Concept/Claim을 만들라고 지시한다
                           탐색을 금지하지 않고 **탐색했는지를 측정한다**
                           (Codex에 파일 도구를 확실히 끊을 방법이 없다.
                            강제 대신 관측으로 다룬다 — 탐색했다면 그 자체가 findings다)
```

두 arm 모두 **같은 모델·같은 Validator·같은 fixture**를 쓰므로 직접 비교된다.

```text
arm           concept   claim         forbidden   grounding   agent-origin   탐색한   turn/
              coverage  (structural)  (낮을수록)  coverage    evidence 비율  파일 수  token
agent-first
index-only
```

증분 안정성 (§46) — 같은 fixture를 두 번 분석해서:

```text
Concept identity preservation     v1 Concept 중 v2에서 같은 id로 남은 비율
Claim identity preservation       ← Concept와 **따로** 잰다. §54 Q4가 이것이다
Canonical Scenario id 안정성
Name-only churn                   grounding이 같은데 이름만 바뀐 수
Unnecessary split / merge         1:N / N:1
Grounding coverage                origin: engine / agent 분리 집계
Agent evidence relocation         exact / degraded / missing 비율   ← §6.5 S1이 실제로 버티는가
EvidenceDiff contentChange 분포    unchanged / cosmetic / modified / appeared / missing
                                  ← cosmetic 비율이 높은데 dirty set이 크면 T1이 새고 있는 것이다
EvidenceDiff relocated 비율        (별도 축) 코드가 얼마나 옮겨 다니는가
```

`EvidenceDiff 분포`는 실사용에서 §6.2 T1의 정규화가 **너무 엄격한지(거짓 양성으로 재검토가
폭발) 너무 느슨한지(의미 변화를 놓침)**를 보는 유일한 계기판이다. 거짓 음성은 이 표에 안
잡히므로, 17번 acceptance와 사람 리뷰로 따로 확인한다.

### 7.4 손으로 돌려보는 절차

```bash
cd prototypes/ontology
npm install && npm run build
npm run fixture              # fixtures/fixture-app → tmp/fixture-app + git init + 첫 커밋
npm run mcp:register         # Codex를 쓸 때만 (Claude는 options.mcpServers로 직접 전달)
npm run bridge               # 창 1
npm run web                  # 창 2 → tmp/fixture-app 선택 → Trace는 바로 보인다 → Analyze
npm run acceptance           # 창 3 — codex·claude 각 23개 항목
npm run eval                 # agent-first vs index-only + 증분 안정성
```

---

## 8. 진행 순서

| | 내용 | 끝났다고 말할 수 있는 근거 |
|---|---|---|
| **M0** | **이 계획을 `docs/ontology/implementation_plan.md`로 추출해 저장한다.** 이어서 모노레포 스캐폴딩, `@onto/protocol` 타입 + schema, **generation/pointer Store**(§5 T4) | 계획이 저장소 안에 남는다 (`ontology_schema.md` 옆). typecheck 통과. **acceptance 19(SIGKILL 복구)가 여기서 이미 통과한다** — 저장 구조는 뒤늦게 바꾸기 가장 비싼 것이므로 먼저 못 박는다 |
| **M1** | Evidence Engine P0~P1 + **ID/freshness + EvidenceDiff**(§6.2 R1·T1·**U3**) | acceptance 1·18c. **16·17의 engine 절반** — 분류가 양방향으로 맞아야 한다 |
| **M2** | Evidence Engine P2~P3 + **entity/link schema**(T2) + `projectTrace`(**BFS/SCC/nonForward** S4·U2) | acceptance 12·13·13b·14. route/ui_event/db evidence가 fixture에서 잡힌다 |
| **M3** | MCP server + bridge + codex/claude adapter | acceptance 2·3 — **두 증거원이 모두** 관측된다 |
| **M4** | `propose_evidence`(지문·프로파일·graph 힌트) + AnalyzeTransaction(S2·T3) + Validator ⓪~⑤ + IdentityResolver | acceptance 6·7·8·9·10, **16·17의 agent 절반** |
| **M5** | Semantic Patch 루프 + 증분 갱신 + **SemanticWorkSet**(U1) | acceptance 4·5·18·**18b** |
| **M6** | View Planner (Overview·Scenario) + schema/validator + budget | acceptance 11·15 |
| **M7** | React viewer 3개 View + Progressive Disclosure | 브라우저에서 Overview → Scenario → Step → Trace가 끝까지 이어진다. acceptance 20 |
| **M8** | index-only arm + eval | §7.3 표가 채워지고 §9의 질문에 답이 붙는다 |

M1~M2와 M3는 독립이라 병행 가능하다. M4는 M2·M3 둘 다 필요하다.
**Trace는 M2에서 이미 동작한다** — Semantic Memory를 기다리지 않는다 (§6.6).

### 구현 중 규칙 — architecture는 freeze다

이 문서의 구조와 방향은 확정되었다. 구현하다가 계획과 현실이 어긋나면
**임의로 architecture를 바꾸지 않는다.** 대신 `prototypes/ontology/FINDINGS.md`에 적는다.

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

byoa spike의 `SPIKE_FINDINGS.md`와 같은 형식이고, 같은 목적이다 — 바꾼 이유가 남지 않으면
다음 사람이 같은 판단을 다시 해야 한다.

---

## 9. 이 프로토타입이 답해야 할 질문 (§54)

끝나면 `prototypes/ontology/FINDINGS.md`에 spike와 같은 형식으로 기록한다.

| # | 질문 | 어떻게 답하는가 |
|---|---|---|
| **1** | ~~agent-first가 classifier-first보다 의미 품질이 높은가?~~ | **이 프로토타입으로 답하지 않는다.** classifier-first 파이프라인(고정 taxonomy 분류 + 결정론적 트리 정규화)을 구현하지 않았으므로 비교 대상이 없다. **열린 질문으로 남긴다** |
| **1′** | 같은 모델·Validator·fixture에서 **저장소를 직접 탐색하게 하는 것**이 **미리 만든 Evidence 요약만 주는 것**보다 의미 품질이 높은가? | §7.3의 agent-first vs index-only. **단일 fixture이므로 "이 fixture에서"로만 말한다** — 벤치마크가 아니다 |
| 2 | Evidence Index는 어느 수준까지 필요한가? | `origin: "agent"` evidence의 비율과 kind 분포. agent가 계속 같은 종류를 제안하면 그것이 다음 adapter다 |
| 3 | Concept/Claim만으로 Persistent Semantic Memory가 충분한가? | §7.2 structural coverage + View가 실제로 만들어지는지 |
| 4 | 자유 predicate Claim이 얼마나 안정적인가? | §7.3의 **Claim identity preservation** (Concept와 분리 측정) |
| 5 | Semantic Identity를 얼마나 안정적으로 유지할 수 있는가? | §7.3의 churn / split / merge + **agent evidence relocation 비율** + **EvidenceDiff 분포** (정규화가 너무 엄격/느슨한지) |
| 6 | ScenarioIR이 실제 비전공자 이해에 도움이 되는가? | 사람 평가. §53 View Utility |
| 9 | On-demand Anchor-based View가 자연스럽게 동작하는가? | 여러 anchor에서 Scenario/Trace를 뽑아 본다 |

7(여러 IR 유지 비용)은 View 3개에서 부분적으로만, 8(Canonical Scenario 자동 발견)은 §6.4의
얇은 index로 일부만, 10(Drift)은 이번 범위 밖이다.
**답할 수 있는 만큼만 적고 나머지는 열린 질문으로 남긴다.**
