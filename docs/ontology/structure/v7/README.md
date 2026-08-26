# Ontology Structure V7 — Architecture 뷰의 Archify 패턴 전면 도입

## 0. 문서 상태와 기준선

- 상태: 설계 완료, **구현 전**. 코드 변경은 아직 없다.
- 기준 커밋: `72dd6a8` (`Guard duplicate submit_analysis_bundle and batch get_evidence lookups`).
  V6.1(재색인 dedup·packet 거버넌스·미지언어 catch-all)은 이 문서가 건드리는 파일과 겹치지
  않으므로 먼저 커밋될 필요는 없다(§7).
- 대상: `prototypes/ontology/`의 두 시각화(Architecture, Workflow) 중 **Architecture 뷰만**.
  Workflow/UserMap/Sequence는 이 문서의 범위 밖이며 기존 core+ai 파이프라인을 그대로 쓴다.
- 문서 역할: V6/V6.1을 대체하지 않는다. V6/V6.1이 다룬 토큰/시간 최적화와 이 문서가 다루는
  Architecture 뷰 파이프라인 교체는 서로 다른 문제다. 이 문서는 V4/V5/V6/V6.1이 세운 용어
  (관찰/결정/미결정)를 그대로 쓴다.

---

## 1. 배경

기능2(코드 시각화)는 처음부터 두 시각화(Architecture, Workflow)로 구성됐다(`v1/ontology_schema3.md
§6.2` — 6-view 메뉴를 접고 "archify류 결과물처럼 아키텍처+워크플로우 두 다이어그램을 바로
보여주는 형태"로 대체). 지금까지 둘 다 같은 core+ai 파이프라인을 탄다: Evidence Engine이
결정론적으로 색인 → System Fact/증분 상태로 grounding → AI가 MCP 도구로 근거를 조회하며 Assembly
산출물(`AnalysisBundle`)을 제출 → Core가 I20-v4/coverage로 검증·커밋 → `apps/web`이 좌표 없는
IR을 결정론적으로 레이아웃.

`v5/README.md`는 QA-Maker 픽스처로 실측 비교를 남겼다: 같은 저장소에서 core+ai는 컴포넌트 8개/
연결 2개/외부연동 0개, 참고 도구 archify는 컴포넌트 6개/연결 6개(정확한 서브라벨 포함)를 냈다.
V5는 원인 네 가지를 지목했다.

### 1.1 관찰: V5가 지목한 네 원인 중 셋은 이미 고쳐져 있었다

이 문서를 쓰기 전 코드를 직접 확인했다(V5 문서 자체는 스냅샷이고, 이후 커밋에서 세 항목이
이미 반영됐다):

| V5가 지목한 원인 | 현재 상태 | 근거 |
|---|---|---|
| (a) `ArchitectureConnection`에 certainty 필드 없어 비확정 링크가 통째로 사라짐 | **이미 고쳐짐 (V5 A4)** | `packages/protocol/src/index.ts:1094,1125`에 `certainty?: FactCertainty` 존재. `analysis-bundle-validator.ts:295-336`은 inferred link를 hard reject 대신 `connection.certainty`를 낮추고 warning만 남긴다. `status`(valid/relocated)만 여전히 hard error. |
| (c) 외부연동 탐지가 manifest 선언 의존성만 스캔 | **이미 고쳐짐 (V5 A1)** | `packages/core/src/discovery.ts:17,222,228` — `NODE_BUILTIN_MODULES`/`PYTHON_STDLIB_MODULES` 차단 후 `[...manifests.keys(), ...manifestLessImportNames]`로 후보 확장. |
| route-surface가 프레임워크 adapter에만 의존 | **이미 고쳐짐 (V5 A2/A3)** | `packages/evidence/src/generic-patterns.ts` 존재, `repository-topology.ts:278-296`가 adapter origin과 무관하게 route evidence로 `routeSurfaces` 구성. |
| (b) `detectRepositoryTopology()`의 런타임 탐지가 `package.json`에만 의존 | **아직 열려있음** | `packages/core/src/repository-topology.ts:197` — `manifestPaths`가 유일한 `RepositoryRuntime` 출처. route-surface는 manifest-독립적이 됐지만 런타임 엔티티 자체는 여전히 Node 프로젝트에 닫혀있어, `missingRuntimeIds` coverage gate가 manifest 없는 Flask/Rails/Go 서비스를 못 본다. |
| (d) Assembly 단계에서 evidence가 유실됨 | **아직 열려있고 미측정** | `v6/v6.1.md §7`이 명시적으로 미해결·별도 문제로 남겼다. |

즉 "v6.1을 테스트했는데 만족스럽지 않다"는 관찰은 당연하다 — v6.1이 고친 세 가지는 전부 토큰/
시간 버그이지 시각적 품질과 무관했고, 시각적 품질에 관련된 V5의 네 원인 중 셋은 이미 고쳐졌는데도
격차가 남아있다면, 남은 격차의 상당 부분은 "grounding을 하면서 매번 MCP 왕복으로 정확한 그림을
만드는" 접근 자체의 근본적 비용/복잡도 구조에서 온다고 봐야 한다.

### 1.2 관찰: archify는 분석 엔진이 아니라 AI 저작 파이프라인이다

`v4/README.md §1.3`은 "매 분석마다 저장소를 처음부터 재탐색하게 하면 Archify와 같은 문제(토큰/
시간이 저장소 크기에 비례해 매번 반복, 비결정성)가 생긴다"고 경고했다. 실제로
`reference/archify-main`을 확인한 결과, archify에는 코드 분석/추출 엔진이 없다: AI(Claude)가
저장소를 직접 읽고 작은 typed JSON(`components`/`boundaries`/`connections`/`cards`, 최대 12
노드, 좌표까지 AI가 직접 씀)을 손으로 쓰면, archify 툴(`archify/SKILL.md` + `bin/archify.mjs`)은
그 JSON을 스키마+geometry로 결정론적 검증하고, 고정된 SVG 렌더러(`renderers/architecture/
render-architecture.mjs`)로 그리며, 인용된 파일:라인은 git으로 사후 진위만 검증한다
(`renderers/shared/repository-evidence.mjs`). 이 구조라서 evidence가 파일 전체가 아니라
`path/line/label` 포인터 수준으로 작다(`reference/output_example/cal-diy.architecture.json`은
40줄).

### 1.3 결정: Architecture 뷰에 한해 archify 패턴을 전면 도입한다

grounding 전제(Evidence Engine/System Fact/MCP 왕복)를 버리고 AI가 저장소를 직접 읽어 좌표
포함 typed JSON을 저작하며, archify 스타일 렌더러로 그린다. Workflow/UserMap/Sequence는 기존
core+ai 파이프라인을 그대로 유지해 얽히지 않게 한다. `reference/`는 패턴만 차용하고 코드를
그대로 복사하지 않는다는 기존 프로젝트 정책에 따라 archify 코드를 vendoring하지 않고
TypeScript로 네이티브 재구현한다.

`v2/architecture_viewer.md`가 "AI는 좌표를 쓰지 않는다, layout은 렌더러가 계산한다"를 명시적으로
결정해둔 상태였으나, 이번 결정은 **Architecture 뷰에 한해** 그 원칙을 뒤집는다. AI가 archify처럼
`pos`/`size`를 직접 쓰고, archify 스타일 렌더러로 그린다.

---

## 2. 목표와 비목표

### 2.1 목표

- Architecture 뷰 생성이 저장소를 직접 읽는 AI 저작 + 결정론적 검증/렌더 파이프라인으로 동작한다.
- Workflow/UserMap/Sequence 파이프라인은 이 변경으로 동작이 바뀌지 않는다.
- V5의 아직 열린 결함(원인 (b): 런타임 탐지가 manifest 전용)을 "특정 프레임워크 하드코딩"이 아닌
  일반화된 방식으로 고친다.
- evidence/근거가 파일 전체 내용이 아니라 인용 포인터(`path`/`line`/`label`) 수준으로 작게
  유지된다.

### 2.2 비목표

- Workflow/UserMap/Sequence를 archify 패턴으로 바꾸는 것 — 별도 논의 대상.
- archify의 전체 시각적 세련도(pan/zoom, 검색/포커스, 테마 동기화, WebM 내보내기)를 1단계에서
  재현하는 것 — §6에서 단계적으로 미룬다.
- QA-Maker-main 원본 픽스처로 archify 벤치마크와 재비교해 "격차를 닫았다"고 확정하는 것 — 외부
  픽스처·실제 API 비용이 필요한 별도 후속 작업이다(§9).

---

## 3. 패키지 구조

새 워크스페이스 패키지 `packages/architecture-view/` (`@onto/architecture-view`)를
`packages/core`/`packages/evidence`와 나란히 추가한다. `packages/core`에 얹지 않는 이유: core는
기존 grounding 파이프라인이 의존하는 validator/store/topology 로직이라, 여기 새 코드를 섞으면
Workflow 경로와의 의도치 않은 결합이 생긴다. 별도 패키지면 "이 변경이 Workflow 경로를 건드리는가"
가 `grep -l architecture-view packages/core apps/*/src`로 바로 확인 가능해진다.

```
packages/architecture-view/
  src/
    validator.ts        # validateArchitectureView(doc, ctx) -> Diagnostic[]
    geometry.ts          # 축소된 geometry 체크 (겹침/viewBox/참조 무결성/기본 교차)
    completeness.ts       # 일반화된 결정론적 완전성 체크 (§5.2)
    citation.ts           # git 기반 sources[] 진위 검증 (§5.3)
    render.ts             # renderArchitectureViewSvg / renderArchitectureViewStandaloneHtml
  schemas/
    architecture-view.schema.json   # AI가 Read하는 정식 스키마 파일
    common.schema.json
  examples/
    minimal.architecture-view.json  # AI가 Read하는 예시 1개
  test/
```

새 타입은 `packages/protocol/src/architecture-view.ts`에 두고 기존 `agent.ts`/`schemas.ts` 분리
패턴대로 `index.ts`에서 `export *`. Node-builtin-free 제약(브라우저 번들이 import함)을 유지한다.

---

## 4. 타입/스키마 — `AnalysisBundle`과 분리된 새 제출 경로

기존 `ArchitectureIR`/`ArchitectureComponent`(`protocol/src/index.ts:825` 부근)는 "좌표 필드
없음(A7) — layout은 렌더러가 계산"이 명시적 불변식이다. 여기 좌표를 얹으면 `AnalysisBundle`의
다른 소비자(`analysis-bundle-validator.ts`, `SystemImpactSet.architectureComponentIds`,
`apps/web`의 기존 레이아웃 코드) 전체가 optional 좌표를 신경 써야 한다. **`AnalysisBundle`을
건드리지 않고 완전히 별도 타입/제출 경로로 만든다.**

```ts
// packages/protocol/src/architecture-view.ts
export type ArchitectureViewComponentType =
  | "frontend" | "backend" | "database" | "cloud" | "security" | "messagebus" | "external";

export type ArchitectureViewSource = { path: string; line?: number; endLine?: number; label?: string };

export type ArchitectureViewComponent = {
  id: string; type: ArchitectureViewComponentType; label: string; sublabel?: string;
  pos: [number, number]; size: [number, number]; sources?: ArchitectureViewSource[];
};

export type ArchitectureViewBoundary = { id?: string; kind: string; label: string; wraps: string[]; pad?: number };
export type ArchitectureViewConnection = {
  id?: string; from: string; to: string; label?: string;
  variant?: "default" | "emphasis" | "security" | "dashed";
};
export type ArchitectureViewCard = { dot?: string; title: string; items: string[] };

export type ArchitectureViewDocument = {
  schemaVersion: 1; title: string; viewBox?: [number, number];
  repository?: { url?: string; revision?: string };
  components: ArchitectureViewComponent[]; boundaries: ArchitectureViewBoundary[];
  connections: ArchitectureViewConnection[]; cards?: ArchitectureViewCard[];
};
```

`ArchitectureComponent`/`ArchitectureConnection`과 이름을 의도적으로 다르게 둔다 — 이 IR은
저작된 것이지 파생된 것이 아니라서 evidence-grounding 필드(`certainty`, `evidenceRefs`,
`systemLinkRefs`)를 갖지 않는다는 신호다. `packages/architecture-view/schemas/*.schema.json`은
손으로 유지하는 draft 2020-12 JSON Schema (`additionalProperties:false`) — `mcp-server/test/
schema-contract.test.mjs`처럼 TS 타입과 크로스체크하는 테스트를 추가한다.

---

## 5. 파이프라인 설계

### 5.1 프롬프트/스킬

`apps/bridge/src/prompt.ts`에 `buildAssemblyPrompt`(line 373 부근)의 변형이 아니라 완전히
독립된 함수를 추가한다:

```ts
export function buildArchitectureViewPrompt(projectPath: string): string
```

`buildEvidenceBundle`도 `ASSEMBLY_RULES`도 참조하지 않고, `get_assembly_context`/`get_evidence`/
`get_system_facts` 호출 지시도 없다. archify SKILL.md의 "Fast authoring path"(스키마 1개 + 예시
1개만 읽고, 최대 12개 컴포넌트로 저작, validate 후 반복 수정, 두 라운드 연속 개선 없으면 중단하고
보고)를 프롬프트 텍스트로 재구현한다.

저장소 직접 탐색용 새 도구는 필요 없다. `apps/bridge/src/agents/claude/adapter.ts:177-180`가
모든 `TaskMode`에 이미 native `Read`/`Grep`/`Glob`을 무조건 부여한다. Codex 어댑터
(`agents/codex/adapter.ts`)는 도구 allowlist 대신 `sandboxPolicy`로 파일 접근을 제어하는데,
구현 시 기본 툴셋에 파일 읽기가 포함되는지 확인이 필요하다(Stage 2/3가 이미 파일을 읽으므로
있을 가능성이 높지만 가정하지 말고 확인한다).

`packages/protocol/src/agent.ts:58`의 `TaskMode`(`"analyze"|"view"|"chat"|"assembly"`)에
`"architecture"`를 추가한다. 기존 `"view"` 모드를 재사용하지 않는 이유: `"view"`는 이미
`ViewCacheKey`/`semanticVersion` freshness 결합을 갖고 있어 Architecture 뷰가 원치 않는
캐시-신선도 모델을 강제로 물려받게 된다. `apps/bridge/src/index.ts`와 두 adapter의 모든
`switch(mode)`/`if (mode===...)` 지점을 grep해서 새 case를 빠짐없이 추가해야 한다(TS
exhaustiveness는 switch가 실제로 exhaustive하게 작성된 경우만 잡아준다).

`packages/mcp-server/src/index.ts`에 `validate_architecture_view`(입력: 후보 JSON, 출력:
기존 `Diagnostic` 형태의 배열)와 `submit_architecture_view`(통과한 문서를 커밋) 두 도구를
기존 `callBridge(...)` 프록시 패턴대로 등록한다.

### 5.2 Validator

`packages/architecture-view/src/validator.ts`:

```ts
export function validateArchitectureView(
  doc: unknown,
  ctx: { projectPath: string; repositoryTopology: RepositoryTopology; gitRevision?: string },
): Diagnostic[]
```

세 계층, 각각 독립적으로 테스트 가능:

**(a) 스키마 + geometry** — archify `generated-validators.mjs`/`geometry.mjs` 패턴의 네이티브
재구현이되, 1단계는 축소판으로 시작: pos/size가 viewBox 안에 있는지, 컴포넌트 겹침 여부,
`boundaries[].wraps`/`connections[].from|to`가 존재하는 id를 가리키는지, 기본 edge-crossing(포트
계약 없이 컴포넌트 bounding box와의 교차만). archify급 automatic port-spread는 렌더러가 정적
SVG인 1단계에서는 투자 대비 이득이 낮으므로 인터랙션을 추가하는 2단계로 미룬다.

**(b) 일반화된 완전성 체크** — 아직 열려있는 §1.1의 원인 (b)와, "특정 예제 프로젝트에만 맞춘
개별 패치를 짜지 않는다"는 원칙이 만나는 지점. `completeness.ts`가 `packages/core/src/
repository-topology.ts`의 `detectRepositoryTopology()` 결과를 재사용한다. 새 파이프라인엔
`EvidenceIndex`가 없으므로(결정: AI가 grounding 없이 저작), **AI 턴 전에 서버 측에서 조용히
`indexProject()`+`detectRepositoryTopology()`를 한 번 돌려 `RepositoryTopology`만 뽑는다** —
AI에게 MCP evidence 도구로 노출하지 않고, 저작을 막는 게이트로도 쓰지 않는다. AI는 자기가 읽은
대로 자유롭게 저작하고, 제출 후에 완전성 체크가 `architecture-view/runtime-not-represented` 같은
repair diagnostic을 만든다(탐지된 런타임/데이터스토어/route-surface에 대응하는 `sources[]`
경로가 컴포넌트 중 하나에도 없으면). 이건 v4 §1.3이 경고한 비용을 일부 되살리지만, 비용이 컸던
지점은 색인 자체가 아니라 Assembly의 MCP 왕복 사용이었다(v5 문서: 959KB `system-facts.json`
수집 자체는 저렴했다) — 이 트레이드오프를 여기 명시해둔다.

완전성 체크가 "일반화됐다"고 부르려면 먼저 원인 (b)를 고쳐야 한다: `repository-topology.ts:197`
의 런타임 탐지를 package.json 전용에서 벗어나야 한다. 권장 수정은 `isNeverSource()` 전례
(`v6/v6.1.md §4` — "허용목록 대신 차단목록, 특정 언어를 하드코딩하지 않는다")를 그대로 따른다:
런타임 후보를 (i) 인식된 manifest가 루트인 경우(기존, 확정 케이스로 유지) 또는 (ii) manifest
없이 route-surface/인식된 언어 파일 밀집 클러스터가 있는 디렉터리 루트로 일반화한다 —
route-surface 탐지가 이미 manifest-독립적이 된 것과 같은 방향. 이건 `repository-topology.ts`
한 곳만 고치면 되지만, **기존 Workflow 경로의 coverage gate도 같은 파일을 읽으므로(§7) 공유
파일 리스크로 별도 취급**해야 한다.

**(c) 인용 진위 체크** — `citation.ts`, archify `repository-evidence.mjs` 패턴의 네이티브
재구현: `doc.repository`+`sources[]`가 있으면 git으로(`packages/evidence/src/git.ts`의
`spawnSync("git",...)` 헬퍼 패턴 재사용/확장) 인용된 커밋/파일/라인범위가 실재하는지 확인한다.
`sources[]`가 있을 때만 동작하는 선택적 체크이며 LLM 왕복 없이 저렴하다.

**반복 수정 루프의 강제 지점**: archify는 CLI라서 SKILL.md 산문의 규율에 의존할 수 있지만, 이
저장소의 에이전트는 한 provider turn 안에서 MCP를 호출한다. "두 라운드 연속 무개선 시 중단"
규칙을 프롬프트 텍스트로도 넣되, **`apps/bridge` 오케스트레이션에 하드 캡도 반드시 건다**(예:
`MAX_ARCHITECTURE_VIEW_VALIDATE_CALLS = 6`, 기존 다른 곳의 usage/round 캡 패턴과 동일) — 프롬프트
규율만 믿지 않는다.

### 5.3 렌더러

```ts
// packages/architecture-view/src/render.ts
export function renderArchitectureViewSvg(doc: ArchitectureViewDocument): string
export function renderArchitectureViewStandaloneHtml(doc: ArchitectureViewDocument): string
```

archify `render-architecture.mjs`의 "손으로 SVG 문자열 생성, 런타임 의존성 0" 패턴을 네이티브
재구현(코드 포팅 아님). 1단계: 저작된 pos/size 그대로, boundary는 라벨 붙은 `<rect>`, connection은
직선/단순 절곡 `<path>`(자동 포트 분산 없음 — §5.2(a)의 축소 geometry 체크와 정합), variant는
stroke 스타일에 매핑, cards는 SVG 밖 일반 블록으로.

**임베딩 결정 (권장안)**: archify 자체의 독립 HTML(pan/zoom/theme/검색/내보내기 내장,
`assets/template.html` 13.7k줄)을 그대로 기본 뷰로 쓰지 않고, **SVG 문자열을 `apps/web`의 기존
chrome에 임베드**하는 걸 권장한다 — `apps/web/src/components/ArchitectureView.tsx`가
`renderArchitectureViewSvg()` 결과를 `dangerouslySetInnerHTML`로 `ViewerShell.tsx`의 기존
pan/zoom 안에 마운트. 이유: 나머지 세 뷰(Workflow/UserMap/Sequence)와 같은 SPA 네비게이션/테마
컨텍스트 안에 머물러야 사용자가 뷰 전환 시 별도 문서로 튕기지 않는다. archify식 "공유 가능한
독립 산출물" 특성은 `renderArchitectureViewStandaloneHtml()`을 호출하는 별도 "HTML로 내보내기"
액션으로만 제공한다.

권장 phasing: 1단계 정적 SVG 임베드(pan/zoom도 아직 없음, 작고 테스트 가능하게) → 2단계
`ViewerShell.tsx`의 기존 pan/zoom을 SVG에 연결 + 내보내기 액션 → 3단계(요청 시에만) 검색/포커스/
테마 동기화.

---

## 6. Store/generation 통합

**새 산출물은 `analysis-bundle-commit.ts`/`analysis-bundle-validator.ts`를 전혀 거치지 않고,
`AnalysisBundle.architecture` 필드를 대체하지도 않는다.** `commitAnalysisBundle()`은 Architecture+
Workflow+UserMap+Sequences를 한 `store.commit()` 클로저에서 한꺼번에 검증하므로, 여기 결합시키면
"Workflow 경로와 얽히지 않기" 결정을 정면으로 어긴다. `AnalysisBundle.architecture: ArchitectureIR`
은 완전히 그대로 둔다.

대신 `packages/protocol/src/node.ts`의 `STATE_FILES`/`MANIFEST_MEMBERS`에 새 멤버
`architectureView: "architecture-view.json"`을 추가하고, `packages/core/src/store.ts`의
`StateSnapshot`에 `architectureView: ArchitectureViewDocument | null`을 추가해 `writeGeneration`/
`readGeneration`에 통과시킨다. V6.1의 `discoveryBaselineVersion` 전례와 같은 패턴: 이전
generation에 이 필드가 없으면 `null`로 읽는다(V6.1 §7이 자기 backfill을 실제 구 generation
데이터로 검증하지 않았다고 인정한 것과 같은 실수를 반복하지 않도록, 이번엔 구 generation
디렉터리 픽스처를 만들어 `readGeneration()`이 안 던지고 `null`을 돌려주는지 테스트한다).

커밋 함수는 `packages/architecture-view`쪽에 두고(방향을 `packages/core`가
`@onto/architecture-view`를 몰라도 되게) `@onto/core`의 `SemanticStore`/`StateSnapshot` 타입에만
의존한다. 클라이언트가 "검증 통과"라고 보고해도 서버가 다시 검증(defense in depth)한 뒤
`architectureView` 필드만 쓰고 나머지는 이전 generation과 바이트 동일하게 유지한다.
`SemanticVersion.source`(`protocol/src/index.ts:105`)에 `"architecture-view"` 멤버를 추가해 이
커밋을 구분한다.

---

## 7. 건드리지 않는 것 / 공유 파일 리스크

**그대로 두는 파일**: `prompt.ts`의 `buildFullAnalyzePrompt`/`buildIncrementalAnalyzePrompt`/
`buildAssemblyPrompt`/`ASSEMBLY_RULES`, `analysis-bundle-validator.ts`의 I20-v4/coverage 로직,
`analysis-bundle-commit.ts`, `system-fact-lifecycle.ts`, `apps/web`의 Workflow/UserMap/Sequence
레이아웃·컴포넌트, `packages/evidence/src/indexer.ts`의 출력 형태.

**두 경로가 함께 의존하게 되는 공유 인프라 — 얽힘 위험 명시**:

- `packages/core/src/repository-topology.ts` — §5.2(b)의 런타임 탐지 일반화는 **구 파이프라인의
  coverage gate도 같이 읽는 파일**을 고치는 것이다. "manifest만"에서 "manifest 또는 route-surface
  밀집"으로 넓히면, 이전엔 안 걸리던 fixture가 새로 `missingRuntimeIds`에 걸릴 수 있다. 이번
  계획에서 가장 위험도가 높은 공유 파일 수정이며, `fixtures/v5/*` 전체에 대한 회귀 테스트를
  Architecture 뷰 작업과 별개로 반드시 통과시켜야 한다.
- `packages/protocol/src/node.ts`(`STATE_FILES`)와 `packages/core/src/store.ts`(`StateSnapshot`,
  `writeGeneration`/`readGeneration`) — 모든 generation 쓰기가 거치는 지점. 구 generation
  backfill을 실제 픽스처로 테스트한다.
- `packages/protocol/src/index.ts:105`(`SemanticVersion.source`)와 `agent.ts:58`(`TaskMode`) —
  닫힌 union에 멤버 추가. 모든 기존 switch를 grep해서 새 case 처리를 빠뜨리지 않았는지 확인한다.
- `packages/evidence/src/git.ts` — citation 체크용으로 확장(재작성 아님). 기존
  `changedFilesSince`/`isGitRepository` 호출부를 건드리지 않는다.

---

## 8. 미결정 / 아직 정해지지 않은 것

- Codex 어댑터가 기본으로 파일 read/grep 접근을 이미 갖는지 — 구현 착수 시 확인 필요, 이 문서는
  가정만 했다.
- 완전성 체크(§5.2b)의 diagnostic 문구/임계치(예: route-surface 밀집을 얼마나 봐야 "런타임"으로
  볼지)는 실제 픽스처로 튜닝해야 하며 이 문서는 방향만 정했다.
- 렌더러 임베딩 방식(§5.3)은 권장안일 뿐 확정이 아니다 — `apps/web`의 `ViewerShell.tsx` pan/zoom
  구현이 SVG 문자열 삽입과 실제로 호환되는지는 구현 중 검증이 필요하다.

---

## 9. 검증 계획 (과장 금지)

완전성 체크는 warning/repair diagnostic을 만들 뿐 hard reject가 아니므로, 어떤 보고서에서도
"hard gate"·"보장한다" 같은 표현을 쓰지 않는다. 단일 픽스처 결과를 일반 벤치마크처럼 말하지 않는다.

1. **픽스처**: 저장소 안에 QA-Maker는 없다(v5 문서의 QA-Maker-main은 외부 경로). 가장 가까운
   대체로 `fixtures/v5/python-no-manifest`(manifest 없는 백엔드 시나리오)를 주 비교 대상으로,
   구조가 다른 `fixtures/v5/java-spring`(manifest 있음, adapter 기반)을 두 번째 픽스처로 쓴다.
2. **보고 형식**: "`python-no-manifest`에서 구 파이프라인 N개 컴포넌트/M개 연결, 신규 파이프라인
   N'/M'"처럼 픽스처 이름을 붙인 raw 숫자로만 보고한다. 퍼센트 개선이나 일반화된 주장을 하지
   않는다 — V5가 지적한 문제는 개수 부족만이 아니라 라벨/서브라벨 정확도였으므로, 사람이 두
   출력을 직접 읽고 정확도를 판단하기 전까지는 "달라졌다" 이상의 형용사를 쓰지 않는다.
3. **"격차를 닫았다"고 말하려면** 원래 QA-Maker-main 픽스처로 v5가 남긴 archify 벤치마크와
   재비교해야 하는데, 이는 외부 픽스처+실제 API 비용이 드는 라이브 실행이 필요해 이번 계획의
   자동 검증 범위 밖이다 — 별도 수동 후속 작업으로 남긴다.
4. **§7 공유 파일 회귀 체크**: `repository-topology.ts` 런타임 탐지 일반화 전/후로
   `packages/core/test/route-surface-coverage.test.mjs`, `packages/core/test/
   unrecognized-source-language.test.mjs`, `fixtures/v5/*` 전체 테스트를 돌려 구 파이프라인
   테스트에 새로운 실패가 없는지 확인한다 — "새 기능이 동작한다"보다 엄격한 "구 기능이 몰래
   깨지지 않았다" 기준이다.

---

## 핵심 파일

- `prototypes/ontology/packages/protocol/src/index.ts`
- `prototypes/ontology/packages/protocol/src/agent.ts`
- `prototypes/ontology/packages/protocol/src/node.ts`
- `prototypes/ontology/packages/core/src/repository-topology.ts`
- `prototypes/ontology/packages/core/src/store.ts`
- `prototypes/ontology/apps/bridge/src/prompt.ts`
- `prototypes/ontology/apps/bridge/src/index.ts`
- `prototypes/ontology/packages/mcp-server/src/index.ts`
- `prototypes/ontology/apps/web/src/components/ArchitectureView.tsx`
- `prototypes/ontology/apps/web/src/components/ViewerShell.tsx`
- (신규) `prototypes/ontology/packages/architecture-view/`
- (신규) `prototypes/ontology/packages/protocol/src/architecture-view.ts`
