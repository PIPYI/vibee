# Ontology Structure V5 — Coverage 일반화와 신뢰 등급 표시

## 0. 문서 상태와 버전 경계

- 상태: 계획 단계 — 구현 전
- 기준 구현: V4(Phase 0~8 완료, `docs/ontology/structure/v4/README.md`)
- 문서 역할: V4 파이프라인이 실제 예제 프로젝트에서 Archify 대비 왜 빈약한 결과를 내는지 진단하고,
  탐지·검증을 특정 예제에 종속되지 않게 일반화하는 작업의 source of truth
- 기준 사례: `/Users/ehoi/Downloads/QA-Maker-main`(README/매니페스트가 없는 Flask 백엔드 +
  React + Firebase + GraphRAG/OpenAI 프로젝트), Archify가 같은 프로젝트에 대해 낸 벤치마크 출력
  (`qa-maker.architecture.json`)과의 비교

V4는 "Core가 먼저 모델링하지 못한 프레임워크·SDK는 Vibee가 알아내도 시스템 구조로 승격할 수
없다"는 폐쇄 세계 문제를 열린 세계 발견(discovery gap) 구조로 바꿨다. 이 V5 계획은 V4가 만든
discovery/coverage 메커니즘이 **QA-Maker-main 같은 실제 프로젝트에서 왜 여전히 대부분의 evidence를
버렸는지**를 코드 레벨로 추적한 결과다. 원인은 discovery 후보군이 매니페스트에만 의존하는 버그와,
커버리지 검증이 런타임에만 걸려 있고 라우트·외부연동에는 걸려 있지 않다는 구조적 공백이었다.
V5는 이 공백을 프로젝트별 패치가 아니라 일반화된 메커니즘으로 메운다.

---

# 우리 도구가 Archify보다 뒤처지는 이유 — 구조적 진단 + 일반화된 개선 계획

## Context (배경)

QA-Maker-main(Flask + React + Firebase + GraphRAG/OpenAI QA 시스템)을 대상으로 우리 V4 파이프라인과
Archify 벤치마크를 비교했다. 처음에는 이 프로젝트 하나에서 발견된 6개 gap을 개별적으로 고치는 계획을
세웠지만, 검토 과정에서 두 가지를 짚었다:

1. 6개 gap 중 일부(매니페스트 없는 Python 런타임 폴백, 타임스탬프 데이터 폴더 판별)는 QA-Maker에서
   관찰된 패턴에 좁게 맞춰져 있어서, 스택이 다른 다음 예제 프로젝트(Java Spring, Go, Rails 등)에는
   그대로 적용되지 않는다.
2. "Core가 먼저 검증하고 AI가 나중에 해석한다"는 우리 설계가 "AI가 전부 판단하는" 접근보다 구조적으로
   불리한지 확인했다 — 이번 사례에서는 아니었다(원인은 신뢰 게이트가 아니라 AI에게 조사 대상 자체를
   넘겨주지 못한 상류 배관 버그였다). 다만 스키마에 실제로 존재하는 진짜 정책적 한계를 하나 확인했다:
   `ArchitectureConnection`(`protocol/src/index.ts:1076-1087`)에는 `certainty`/`confidence` 필드가
   전혀 없다 — evidence가 검증된 `confirmed`/`grounded` SystemLink로 이어지지 않으면 그 연결은
   화면에 아예 나타나지 않는 이분법 구조다. Archify가 더 관대하게(evidence가 약해도) edge를 그린다면,
   이 정책 차이만으로도 우리는 항상 더 빈약해 보인다 — 이건 버그가 아니라 우리가 명시적으로 내린
   설계 결정이다.

그래서 이 문서는 QA-Maker의 gap을 **개별 버그 리스트**로 다루지 않고, 그 gap들이 공통으로 가리키는
**구조적/정책적 문제 4가지**를 먼저 정의하고, QA-Maker에서 나온 구체적 아이디어(discovery 후보군 버그
수정, 커버리지 검증기 일반화, data-root 판별, sublabel 프롬프트, connection 승격 규칙)를 그 구조 안의
**첫 적용 사례**로 재배치한다.

### QA-Maker에서 실제로 확인된 것 (요약)

Stage 1 원본 evidence(`system-facts.json`, 959KB)에는 Flask 라우트 40개, 블루프린트 13개, 백엔드
심볼 384개, GraphRAG를 import하는 정확한 심볼까지 전부 있었다. 그런데 최종 번들
(`analysis-bundle.json`)에는 컴포넌트 8개 · 연결 2개 · 외부 연동 0개만 남았다. Archify 벤치마크
(컴포넌트 6개 · 연결 6개, sublabel과 cloud 타입까지 정확)와 비교하면 격차가 뚜렷했다. 근본 원인은
"탐지 실패"가 아니라 **"이미 모은 evidence가 조립(assembly) 단계에서 버려짐"**이었다:
- `detectRepositoryTopology()`(`repository-topology.ts:129`)가 `package.json` 계열만 런타임
  신호로 보기 때문에, 매니페스트가 없는 Flask 백엔드가 런타임으로 잡히지 않음.
- `buildExternalIntegrationCatalog()`(`discovery.ts:125`, 154행)의 후보군이
  `manifests.keys()`뿐이라, 매니페스트 없이 import된 `graphrag`가 애초에 LLM에게 보이는
  discovery-gap 목록에 오르지 못함.
- Semantic Memory concept 커버리지(5개, 전부 "채팅 happy path")는 위 두 gap의 부수 증상 —
  gap 신호가 없으니 LLM이 나머지 5개 백엔드 서비스를 조사할 이유가 없었음.
- `dataRoot()`(`repository-topology.ts:117`)가 내용 검사 없이 폴더 이름만 보고, GraphRAG
  자체가 생성한 파이프라인 실행 결과물을 "database"로 잘못 표시.
- `sublabel` 필드는 스키마에 이미 있지만(`protocol/src/index.ts:1047`) 프롬프트가 언급한 적이
  없음.
- FE↔BE HTTP 등 이미 존재하는 evidence조차 `architecture.connections`로 승격되지 않고
  `workflow.edges`에만 머묾.

---

## 설계 원칙 (이번 계획이 따르는 4가지 구조적 결정)

### 원칙 1 — 프레임워크별 adapter보다 언어/프레임워크에 최대한 독립적인 범용 신호를 우선한다
지금 Stage 1은 Next.js×2 / Express / React JSX / Prisma×2 / config, 총 7개의 하드코딩된 adapter와
정규식 기반 Python 파서뿐이다. 새 예제 프로젝트를 넣을 때마다 새 프레임워크가 나오면, adapter를
하나씩 추가하는 방식은 확장이 느리고 항상 한 발 늦는다. 대신 **패턴 기반, 언어 비종속 범용 탐지기
두 개**를 우선 구축한다:
- **"라우트처럼 생긴 선언" 탐지기**: `@app.route`, `@router.get`, `@RequestMapping`,
  `@GetMapping`, `[HttpGet]`류의 데코레이터/애노테이션 문자열 패턴을 언어에 상관없이 매칭하는
  확장 가능한 패턴 목록으로 구현한다. 프레임워크별 AST adapter가 아니라, 알려진 패턴 목록을
  계속 넓혀가는 구조로 만들어서 "이번엔 Django, 다음엔 Spring"처럼 adapter를 새로 짜지 않아도
  대부분의 웹 프레임워크에서 라우트 후보를 뽑아낼 수 있게 한다.
- **"SDK 호출처럼 생긴 identifier.method() + import" 탐지기**: 이건 이미 #2(아래 실행계획
  A1)에서 discovery 쪽에 만드는 원시 로직과 같은 primitive다 — "매니페스트에 없어도 import되고
  실제로 호출되면 후보로 본다"를 외부 연동뿐 아니라 라우트/DB/큐 탐지 전반에 재사용 가능한 공용
  유틸로 승격한다.

이 두 탐지기는 QA-Maker의 Flask 사례에서 나온 "매니페스트 없는 Python 런타임 폴백" 아이디어를
포함하지만 그것보다 넓다 — Python/Flask 전용 휴리스미틱 대신, 다음에 Java/Go/Ruby 프로젝트가
들어와도 같은 메커니즘이 작동한다.

### 원칙 2 — 커버리지 검증은 탐지된 대상 전체에 대해 하나의 일반화된 메커니즘으로 강제한다
지금은 런타임 커버리지만 `AnalysisBundle` 검증 게이트에 연결돼 있다
(`analysis-bundle-validator.ts:348-384`). 라우트 표면, 외부 연동 후보는 Core가 계산할 수 있음에도
검증되지 않는다. 이 계획의 flagship은 이 커버리지 체크를 **일반화된 하나의 메커니즘**으로 만드는
것이다 — 원칙 1의 범용 탐지기가 새로운 종류의 evidence를 뽑아낼 때마다, 이 메커니즘에 새 카탈로그
하나만 추가하면 자동으로 "이게 화면에 나타났는가"가 검증되도록 설계한다. 즉 원칙 1과 2는 세트다:
탐지 범위가 넓어질수록 검증 커버리지도 자동으로 넓어지는 구조.

### 원칙 3 — 확정되지 않은(inferred) 사실에도 신뢰 등급을 표시해 화면에 남긴다
`certainty: "confirmed" | "grounded" | "inferred"`는 SystemLink 단계엔 이미 있지만,
`ArchitectureConnection`/`ArchitectureComponent`에는 전달되지 않고 이분법으로 끊긴다. 이건
정책을 바꿔야 하는 부분이다: I20-v4를 "inferred는 절대 확정 edge가 될 수 없다"에서 "inferred는
절대 **표시 없이** 확정 edge가 될 수 없다"로 완화하고, 렌더러가 inferred 항목을 점선/회색 등으로
구분해서 보여주게 한다. 이렇게 하면 evidence 추출이 어려운 프로젝트에서도 완전히 사라지는 대신
"AI 추정 · 코드 근거 부족"으로 표시되어 남는다 — 우리의 recall 격차를 완성도 부족이 아니라
신뢰 등급이 표시된 그래프라는 차별화 포인트로 바꾼다.

### 원칙 4 — 예제 프로젝트가 늘어날 때마다 생기는 예외를 반응적 버그 수정이 아니라 벤치마크 인프라로 흡수한다
"앞으로도 여러 예제 프로젝트를 넣었을 때 예외 경우들이 생길 것"이라는 우려에 대한 직접적인 답이다.
QA-Maker 하나로 찾은 gap을 하나씩 고치는 대신, 스택이 다른 예제 프로젝트(Django, FastAPI, Spring,
Rails, Next.js, Go/Gin 등)를 fixture로 지속적으로 축적하고, 원칙 2의 일반화된 커버리지 검증기를
그 위에서 정기적으로 돌려 "이 프로젝트에서는 무엇이 대표되지 않았는가"를 자동 리포트하는 하네스를
만든다. 이후 새 예제 프로젝트를 넣을 때마다 생기는 예외는 개별 버그가 아니라 "패턴 목록에 이 프레임워크
패턴을 추가하라"는 명확한 작업 단위로 좁혀진다.

---

## 실행 계획

### Phase A — 구조적 기반 (특정 프로젝트에 묶이지 않는 일반 메커니즘)

#### A1. Discovery 후보군 버그 수정 (원칙 1의 첫 조각, 즉시 적용 가능)
**파일**: `packages/core/src/discovery.ts` — `buildExternalIntegrationCatalog()`(125행),
후보 목록 계산부(154행).

현재 후보군이 `manifests.keys()`뿐이라, 매니페스트 없이 import된 패키지는 아예 후보에 오르지
못한다. Python stdlib 차단 목록(`sys.stdlib_module_names` 하드코딩) + Node
`builtinModules`를 이용해, "매니페스트가 전혀 없는 스코프에서 import되고 non-stdlib인 이름"을
후보로 추가한다. `isCovered()`/`status` 계산은 그대로 — 후보가 되기만 하면 기존 로직이 이미
`discovery-gap` 상태를 부여해 LLM에게 전달한다. 이 원시 로직("import + 호출 흔적이 있으면
후보로 본다")을 A3에서 라우트/서비스 탐지 전반에 재사용하는 공용 유틸로 뽑아낼 예정이므로, 이번
수정에서부터 재사용 가능한 형태로 작성한다. 난이도: 중간. 완전히 일반적이며 QA-Maker에 종속되지
않음.

#### A2. 범용 "라우트/서비스 호출" 탐지기 (원칙 1의 핵심, 신규 승격)
**신규 파일 제안**: `packages/evidence/src/generic-patterns.ts` (또는 유사 위치).

- 라우트 데코레이터/애노테이션 패턴 목록을 언어 비종속으로 관리하는 구조를 만든다. 시작 목록:
  Python(`@app.route`, `@router.get/post/...`, `@blueprint.route`), Java
  (`@RequestMapping`, `@GetMapping`, `@PostMapping`), C#(`[HttpGet]`, `[Route]`),
  Ruby(`get '...' do`, `resources :...`), Go(`router.GET(...)`, `mux.HandleFunc(...)`).
  패턴은 정규식 매칭이며, 매칭되면 A1과 동일한 `kind:"route"` Evidence를 만든다 — 기존
  `packages/evidence/src/indexer.ts:225-253`가 이미 소비하는 형태이므로 하위 파이프라인은
  변경할 필요가 없다.
- A1에서 만든 "import + 호출 흔적" 유틸을 공용화해서, 라우트 탐지기가 못 잡는 프레임워크에서도
  최소한 "이 파일이 알려지지 않은 외부 패키지를 실제로 호출한다"는 신호는 만들어지게 한다.
- QA-Maker의 Flask 사례(원래 계획의 "매니페스트 없는 Python 런타임 폴백")는 이 범용 탐지기의
  **첫 적용 사례**로 흡수된다 — Python 전용 특수 케이스가 아니라, 패턴 목록에 Flask 데코레이터
  형태가 등록되어 있고 매니페스트가 없어도 동작하는 일반 메커니즘의 결과가 된다.
- 난이도/위험도: 큼 — 새로운 서브시스템이며 패턴 목록의 오탐(false positive) 관리가 필요하다.
  다만 결정론적이고 LLM을 부르지 않으므로 리스크는 억제 가능하다. Phase D(벤치마크 하네스)를
  이 탐지기의 회귀 테스트 기반으로 바로 활용한다.

#### A3. Flagship: 라우트/런타임/외부 연동/데이터스토어 커버리지를 하나의 일반화된 메커니즘으로 검증
**파일**: `packages/protocol/src/index.ts`(+ `schemas.ts` 미러),
`packages/core/src/repository-topology.ts`, `packages/core/src/analysis-bundle-validator.ts`.

- `RepositoryTopology`/`RepositoryCoverage`(`protocol/src/index.ts:1115-1151`)에
  `routeSurfaces: RepositoryRouteSurface[]`를 추가한다. A2가 만드는 `kind:"route"` Evidence를
  포함해 (adapter 기반이든 범용 패턴 기반이든) `filePath`로 그룹핑한다.
- `assessRepositoryCoverage()`(`repository-topology.ts:201-266`)에 기존 `representedStores`
  루프(234-238행)와 동일한 구조로 `representedRouteSurfaces` 체크를 추가한다.
- "파일 X가 어떤 컴포넌트의 `entityRefs`에 참조되는가"라는 공용 체크를
  `componentsCoveringPath(architecture, filePath)` 헬퍼로 추출해서, 런타임/데이터스토어/라우트
  세 가지 커버리지 체크가 모두 이 헬퍼를 공유하게 만든다 — 원칙 2가 요구하는 "일반화된 하나의
  메커니즘"이 바로 이것이다. 새로운 카탈로그가 추가될 때마다(예: 향후 큐/이벤트 탐지) 이 헬퍼를
  재사용하는 루프 하나만 추가하면 된다.
- `analysis-bundle-validator.ts`에 `bundle/route-surface-not-represented`(error)를 기존
  런타임/데이터스토어 체크와 같은 블록(348-384행)에 연결한다.
- 외부 연동은 `buildExternalIntegrationCatalog()`를 `validateAnalysisBundle()` 안에서 호출해,
  `status === "discovery-gap"` && `callPaths.length > 0`인 후보가 어떤 컴포넌트의 `entityRefs`에도
  커버되지 않으면 `bundle/external-integration-not-represented`(처음엔 warning, false-positive
  비율을 관찰한 뒤 error로 승격)를 발생시킨다.
- 난이도/위험도: 큼 — 프로토콜 변경, 검증기 루프 신규, 스키마 미러 갱신이 필요하지만 각 조각은
  이미 신뢰받는 기존 코드의 기계적 평행 확장이다.

#### A4. `certainty`/신뢰 등급을 Architecture 레벨까지 전달 (원칙 3, 정책 변경)
**파일**: `packages/protocol/src/index.ts`(`ArchitectureConnection`, `ArchitectureComponent`
타입에 `certainty?: "confirmed" | "grounded" | "inferred"` 추가) + `schemas.ts` 미러,
`packages/core/src/analysis-bundle-validator.ts`(I20-v4 규칙 완화 — `inferred` SystemLink를
참조하는 connection을 **거부**하지 않고 `certainty:"inferred"`로 통과시키되 diagnostic으로
기록), 렌더링 레이어(`apps/web` 쪽, 이번 계획 범위 밖이지만 스키마가 준비돼야 착수 가능함을
명시).

- I20-v4의 "inferred는 절대 확정 edge가 될 수 없다"는 원칙 자체는 유지하되, "확정(confirmed로
  표시)"과 "화면에 나타남"을 분리한다 — `certainty:"inferred"`인 connection/component는 여전히
  번들에 포함되고 화면에 나타나지만, 소비자(렌더러)가 명확히 다른 시각적 처리를 하도록 스키마
  차원에서 신호를 준다.
- Core의 검증 로직(`sourceContractFailure` 등)은 변경하지 않는다 — 무엇이 `confirmed`/
  `grounded`/`inferred`인지 판단하는 기준은 그대로 두고, 오직 "inferred라고 판단된 것을 어떻게
  다룰지"만 바꾼다. 따라서 "Core는 제품 의미론을 판단하지 않는다"는 기존 invariant와 충돌하지
  않는다.
- 난이도/위험도: 중간(프로토콜/검증기) + 별도 후속 작업(렌더러). 이번 계획에서는 스키마와 검증기
  변경까지만 다루고, 렌더러의 시각적 처리는 후속 계획으로 분리할 것을 권장한다.

### Phase B — 벤치마크 인프라 (원칙 4, 지속적으로 실행)

#### B1. 다중 프로젝트 fixture/벤치마크 하네스
**신규**: `prototypes/ontology/fixtures/`에 스택이 다른 예제 프로젝트를 fixture로 추가하고,
A3의 커버리지 검증기를 각 fixture에 대해 CI/스크립트로 정기 실행해 "무엇이 대표되지 않았는가"를
리포트하는 스크립트를 만든다. 최소 1차 목표: QA-Maker-main(Flask, 이미 확보), Django/FastAPI
예제 1개, 프레임워크 없는 순수 Node/Express 예제 1개, non-JS 매니페스트 없는 예제 1개(Go 또는
Rails). 각 fixture가 드러내는 gap은 A2의 패턴 목록에 항목을 추가하는 작업으로 좁혀서 처리한다.
- 난이도/위험도: 중간, 반복 투자. 이 하네스가 있으면 이후 "새 예제 프로젝트를 넣었더니 또
  빠진 게 있다"는 상황이 계획 재수립이 아니라 하네스가 자동으로 잡아내는 회귀로 처리된다.

### Phase C — QA-Maker에서 나온 나머지 구체적 개선 (여전히 유효, 특정 사례지만 위험도 낮고 즉시 적용 가능)

#### C1. 생성물 데이터 폴더 판별 (data-root discriminator)
**파일**: `packages/core/src/repository-topology.ts` — `dataRoot()`(117행), `grouped`
구성부(153-168행).

QA-Maker에서 나온 아이디어를 그대로 채택하되, "일반적인 생성물 폴더 탐지 문제"의 첫 사례로
포지셔닝한다: 후보 data root의 자식 디렉터리 다수가 타임스탬프형 패턴이고 동일 파일명이 반복되면
`origin:"generated-artifact"`로 표시(삭제하지 않음). `RepositoryDataStore`에
`origin: "declared" | "generated-artifact"` 필드 추가(+ `schemas.ts` 미러). 커버리지 게이트에서
`generated-artifact`는 `missingDataStoreIds` 집계에서 제외. `presentationType:"cloud"` 유도는
Core 규칙이 아니라 `ASSEMBLY_RULES`(`apps/bridge/src/prompt.ts:303-335`)에 안내 문구 한 줄
추가로 처리(장식적 필드 원칙 유지). 난이도/위험도: 작음-중간.

#### C2. `sublabel` 프롬프트 문구
**파일**: `apps/bridge/src/prompt.ts` — `ASSEMBLY_RULES`(303행). 필드는 이미 스키마에 존재
(`protocol/src/index.ts:1047`, `schemas.ts:562`) — 순수 프롬프트 한 줄 추가. 난이도: 매우 작음.

#### C3. Cross-boundary connection 승격 규칙
**파일**: `apps/bridge/src/prompt.ts`(`ASSEMBLY_RULES`),
`packages/core/src/analysis-bundle-validator.ts`(새 warning, 236-346행 근처). 서로 다른
boundary의 컴포넌트 쌍이 `workflow.edges`에 있는데 대응하는 `architecture.connections`가 없으면
`bundle/cross-boundary-edge-not-promoted`(warning)를 발생시킨다.
`repository-topology.ts:212-249`의 `componentBoundaryIds`/`runtimesByBoundary` 맵 패턴 재사용.
A1/A2/A3가 반영되면 상당 부분 자동으로 해소된다. 난이도: 작음-중간.

---

## 순서 권장

1. **A1** (discovery 후보군 버그) — 독립적, 즉시 적용, A2의 재사용 유틸 기반.
2. **A2** (범용 라우트/서비스 탐지기) — A1의 유틸을 확장. 가장 큰 신규 서브시스템이므로 먼저
   설계 검토를 한 번 더 거칠 것을 권장(패턴 목록 오탐 관리).
3. **A3** (flagship 커버리지 일반화) — A1/A2가 만든 evidence를 소비. 프로토콜/스키마 변경 포함.
4. **B1** (벤치마크 하네스) — A3를 검증 도구로 바로 활용할 수 있도록 A3와 동시 착수 가능.
5. **A4** (certainty 등급 전달) — A1~A3와 독립적, 정책 변경이므로 별도로 합의 후 진행 권장.
6. **C1/C2/C3** — 모두 독립적, 병렬로 즉시 진행 가능.

---

## 핵심 파일 목록
- `prototypes/ontology/packages/core/src/repository-topology.ts` — 런타임/데이터스토어/라우트
  탐지, 커버리지 평가
- `prototypes/ontology/packages/core/src/discovery.ts` — 매니페스트/import 스캔, 외부 연동
  후보 카탈로그
- `prototypes/ontology/packages/core/src/analysis-bundle-validator.ts` — I20-v4 + 커버리지
  게이트
- `prototypes/ontology/packages/protocol/src/index.ts` / `schemas.ts` — 정식 스키마 및 ajv
  미러
- `prototypes/ontology/apps/bridge/src/prompt.ts` — `ASSEMBLY_RULES`, `buildAssemblyPrompt`
- `prototypes/ontology/packages/evidence/src/` — A2의 신규 범용 패턴 탐지기가 들어갈 위치
  (`indexer.ts`가 소비하는 Evidence 형태는 변경 불필요, 참고용)
- `prototypes/ontology/fixtures/` — B1의 다중 프로젝트 fixture 저장 위치

## 검증 방법
1. **유닛 테스트**: A2의 각 언어 패턴, A1/A3의 매니페스트-없음 폴백, C1의 생성물 판별 로직마다
   최소 1개의 양성/음성 fixture를 추가한다. 기존 `i20-v4.test.mjs` 등 스위트를 돌려 회귀가
   없는지 확인한다.
2. **스키마 동기화 확인**: `protocol/src/index.ts` 변경마다 `schemas.ts` 미러와 ajv 검증을
   갱신한다.
3. **QA-Maker-main 회귀 테스트**: `.project-intel/gen/000005/`의 기존 출력과 새 출력을 diff해서,
   Flask가 두 번째 런타임으로 나타나는지, `graphrag`가 외부 연동으로 나타나는지, `data/` 폴더가
   더 이상 4개의 "database"로 나오지 않는지, connection 수가 Archify의 6개에 가까워지는지
   확인한다.
4. **다중 프로젝트 회귀(B1 하네스)**: Django/FastAPI, 순수 Node/Express, non-JS 매니페스트 없는
   예제 각각에 대해 새 커버리지 검증기가 무엇을 "대표되지 않음"으로 잡아내는지 확인하고, 이미
   잘 동작하던 기존 fixture(Next.js/Express/Prisma 등)에서 false positive가 생기지 않는지
   확인한다.
