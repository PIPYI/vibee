# Vibee V4 — 시각화 인터랙션/가독성 개선 + 쉬운보기 제거 계획

## 0. 문서 상태와 기준선

- 상태: **설계 완료, 구현 착수 전 계획 문서.**
- 선행 문서: `docs/v1_plan.md`/`v1_impl.md`, `docs/v2_plan.md`/`v2_impl.md`, `docs/v3_plan.md`/`v3_impl.md`.
- V4는 V3에서 만든 `av-connection-label-bg`/`MAX_PORT_SPACING` 개선 위에, 사용자가 실제 렌더링 결과를 보고 지적한 잔여 가독성 문제(라벨이 선에 가려짐, 곡선 화살표가 어색하게 붙음)를 마저 고치고, "쉬운보기"(단순/기술 이중 렌더링) 기능을 제거하는 대신 호버 인터랙션·라벨 말줄임·범례 한글 병기·실행 그룹 표기·라이트 모드 고정을 추가한다. 새 스키마 버전 도입은 아니며, `ArchitectureViewDocument`의 구조(컴포넌트/경계/연결선 목록)는 유지하되 `presentation`(audience) 관련 필드만 제거한다.
- 이 문서는 구현 전에 고정한다. 구현 완료 후 실제 변경점과 검증 결과는 `docs/v4_impl.md`에 별도로 기록한다.

---

## 1. 배경

사용자가 실제 렌더링된 다이어그램 스크린샷을 보고 두 가지 문제를 지적했다: (1) 선 위에 있는 연결선 라벨 문장이 가려지는 경우가 있다, (2) 곡선(dogleg) 연결선에서 화살표가 어색한 위치/방향으로 붙는 경우가 있다. 이어서, 앱이 이미 한글로 기술 구조를 설명하고 있어 굳이 "쉬운보기"(`ArchitectureAudienceTabs`가 제공하는 simple/technical 이중 렌더링) 탭이 필요 없다고 판단해 이를 제거하기로 했고, 대신 다음 UX 개선을 요청했다: 연결선 호버 시 관련 블럭 강조, 라벨 말줄임+호버 확장, 범례 한글 병기, 다크모드 제거(라이트 전용), "RUNTIME" 배지를 "실행 그룹 N"으로 교체.

사전 조사(Explore 서브에이전트)로 다음을 확인했다:
- "쉬운보기"는 단순 UI 토글이 아니라 `packages/protocol`(`ArchitectureAudience`/`AudiencePresentation` 타입), `packages/architecture-view`(`presentation.ts`의 `applyAudiencePresentation`/`resolveVisibility`), `apps/bridge`(오디언스별 프롬프트 지시 + 커밋 조회 시 simple/technical 두 SVG를 함께 렌더링), `apps/web`(탭 컴포넌트, `ArchitectureView.tsx`의 오디언스 상태, `ArchitectureInspector.tsx`의 클라이언트측 중복 라벨 계산 로직, `api.ts`의 `svgByAudience` 응답 타입)까지 전 스택에 걸쳐 있는 기능이다.
- 다크모드도 마찬가지로 `apps/web/src/index.css`(미디어쿼리), `ArchitectureView.tsx`(테마 토글 버튼 + `data-theme` DOM 조작), `render.ts`(`RenderOptions.theme`, 라이트/다크 색상 팔레트 이중 정의, `accentColorDark()`), 독립 실행형 HTML export(`renderArchitectureViewStandaloneHtml`)의 자체 테마 토글 스크립트까지 4곳에 흩어져 있다.
- "RUNTIME" 배지는 AI가 생성하는 값이 아니라 `render.ts`의 `renderBoundary()`에 하드코딩된 영문 리터럴("RUNTIME · ")이며, `boundary.kind === "runtime"`일 때만 그려진다. `boundary.label`과는 별개의 `<text>` 요소로, 같은 y좌표에 이어 붙여 그린다.
- 연결선 라벨은 현재 배경 rect(`av-connection-label-bg`, V3에서 추가)는 있지만 텍스트 자체의 폭 제한/말줄임은 없다 — 긴 라벨은 항상 전체 폭으로 그려져 배경판을 넘어서거나 인접 요소와 겹칠 수 있다.
- SVG는 `apps/web`에서 `dangerouslySetInnerHTML`로 그대로 삽입되고(신뢰 가능한 자체 렌더러 출력), 연결선/컴포넌트 요소에는 이미 `data-connection-id`/`data-edge-from`/`data-edge-to`/`data-component-id` 속성이 있어 호버 시 관련 컴포넌트를 찾는 데 그대로 재사용할 수 있다. 다만 연결선(먼저 그려짐)이 컴포넌트(나중에 그려짐)를 가리키는 교차 참조는 순수 CSS 셀렉터로 해결할 수 없어(값 대 값 매칭 불가), 기존 클릭 선택 기능과 동일하게 JS(`ArchitectureView.tsx`의 `mountRef` 이벤트 위임)로 처리해야 한다.
- 곡선 화살표 문제의 유력 원인: `geometry.ts`의 `shortenRouteEnd`(직선 폴리라인 기준 선형 보간으로 끝점을 당김)와 `roundedPath`(같은 폴리라인의 모서리를 베지어 곡선으로 둥글림)가 서로 독립적으로 같은 구간을 다르게 처리해, 마커(`orient="auto-start-reverse"`)가 계산하는 종단 접선 방향이 실제로 그려지는 곡선의 방향과 어긋날 수 있다.

---

## 2. 목표

1. "쉬운보기"(오디언스 이중 렌더링) 기능을 프로토콜/렌더러/브릿지/웹 전 스택에서 제거하고 단일 SVG 렌더링으로 단순화한다.
2. 연결선에 마우스를 올리면 그 연결선과 연결된 두 컴포넌트 블럭이 확대되며 강조되고, 연결선 자체와 라벨도 함께 강조되게 한다.
3. 연결선 라벨은 기본적으로 길면 말줄임(…)으로 표시하고, 호버 시 배경판이 부드럽게 확장되며 전체 텍스트가 드러나게 한다.
4. 하단 범례에서 각 타입을 영문 약어(아이콘) + 영문 풀네임 + 한글 단어를 함께 표기한다.
5. 다크모드를 완전히 제거하고 라이트 모드만 지원한다(웹 앱 헤더의 테마 토글, SVG의 다크 팔레트/미디어쿼리, standalone export의 테마 토글 스크립트 모두 제거).
6. "RUNTIME" 하드코딩 영문 배지를 문서 내 runtime 종류 경계(boundary)들의 등장 순서에 따라 "실행 그룹1", "실행 그룹2", ... 로 교체한다.
7. (사용자가 스크린샷으로 지적한 버그) 곡선(dogleg) 연결선에서 화살표 머리가 실제 곡선의 진행 방향과 어긋나 보이는 문제를 원인 분석 후 수정한다.

## 3. 비목표 (이번 라운드에서 명시적으로 제외)

- 완전한 edge-bundling/경로 교차 회피 알고리즘 — V3와 동일하게 범위 밖.
- 언어 선택 UI, 테마 선택 UI 등 사용자 설정 토글 — 앱이 이미 한글 전용/라이트 전용으로 고정되므로 토글 자체를 만들지 않고 제거한다.
- 이미 `.vibee/`에 커밋된 과거 문서(구버전 `presentation` 필드를 포함할 수 있음)의 소급 마이그레이션 스크립트 — 스키마/검증기가 알 수 없는 필드를 허용(non-strict)하는지 확인하고, 만약 엄격 검증으로 인해 과거 문서 로드가 깨진다면 이는 알려진 한계로 `docs/v4_impl.md`에 명시한다(별도 마이그레이션 도구는 만들지 않음).
- 터치 디바이스에서의 호버 대체 인터랙션(예: 탭-투-하이라이트) — 이번 요청은 마우스 호버 기준이므로 범위 밖.
- 연결선 호버 히트 영역 확장(투명한 넓은 hit-path 추가)은 인터랙션이 실제로 사용 가능한 수준이 되도록 필요한 범위에서만 최소한으로 추가하고, 그 외 히트 테스트 정교화는 하지 않는다.

---

## 4. 설계

### 4.1 "쉬운보기" 제거

- `packages/protocol/src/architecture-view.ts`: `ArchitectureAudience`, `AudiencePresentation` 타입과 컴포넌트/경계/연결선의 `presentation` 필드, `defaultAudience`를 제거한다.
- `packages/architecture-view/src/presentation.ts`: 삭제. `render.ts`에서 `applyAudiencePresentation` 호출 제거하고, 각 엔티티의 canonical `label`/`sublabel`을 그대로 사용한다. `RenderOptions.audience` 제거.
- `apps/bridge/src/prompts/audience-presentation-contract.ts`: 삭제하고 `apps/bridge/src/prompt.ts`에서의 참조 제거.
- `apps/bridge/src/index.ts`: 커밋 조회 시 `renderArchitectureViewSvg(doc, { audience: "simple"|"technical" })` 두 번 호출하던 것을 단일 호출로 축소, 응답 필드 `svgByAudience: {simple, technical}` → `svg: string`.
- `apps/web/src/components/ArchitectureAudienceTabs.tsx`: 삭제.
- `apps/web/src/components/ArchitectureView.tsx`: 오디언스 상태/탭 렌더링 제거, 단일 `svg` 사용.
- `apps/web/src/components/ArchitectureInspector.tsx`: audience 분기 로직(중복 구현된 `resolveLabel`/`resolveSublabel`) 제거, canonical 필드 직접 사용.
- `apps/web/src/api.ts`, `apps/web/src/App.tsx`: 타입/props 갱신.
- 과거 `.vibee/`에 저장된 문서가 `presentation` 필드를 담고 있어도 검증기가 이를 무시(비엄격 스키마)하는지 확인한다. 만약 엄격 검증(zod `.strict()` 등)으로 로드가 실패한다면, 검증기 단계에서 알 수 없는 필드를 허용하도록 최소 조정한다(새 스키마 버전을 만들지 않는 선에서).

### 4.2 연결선 호버 → 블럭 강조

- `packages/architecture-view/src/render.ts`: `renderStyle()`에 호버 강조용 CSS 클래스 추가 — `.av-component.av-hover-active`(확대 + 테두리 강조, `transform-box: fill-box`/`transform-origin: center`로 SVG 요소 스케일), `.av-connection.av-hover-active`(선 강조 + 라벨 강조). 연결선 호버 히트 영역이 너무 얇으면(현재 stroke-width 확인 필요) 눈에 보이지 않는 넓은 stroke의 히트패스를 연결선 그룹 맨 앞에 추가해 호버가 실제로 잘 걸리게 한다.
- `apps/web/src/components/ArchitectureView.tsx`: 기존 클릭-선택(`handleMountClick`, `data-component-id`/`data-connection-id` 매칭 패턴)과 동일한 방식으로 `mouseover`/`mouseout` 이벤트 위임 핸들러를 추가한다. 연결선(`[data-connection-id]`)에 마우스가 올라가면 `data-edge-from`/`data-edge-to` 값으로 해당 `[data-component-id]` 두 개를 찾아 연결선 자신과 함께 `av-hover-active` 클래스를 부여하고, 마우스가 벗어나면 제거한다.

### 4.3 연결선 라벨 말줄임 + 호버 확장

- `geometry.ts`: 라벨 표시 최대 폭 상수(예: 기존 `labelMaskWidth`가 쓰는 CJK 폭 추정 로직 재사용)와 `truncateLabelForDisplay(label, maxWidth)` 함수를 추가해 폭 초과 시 말줄임표(…)를 붙인 축약 문자열을 계산한다.
- `render.ts`의 `renderConnection()`: 라벨이 말줄임 대상이면 축약 텍스트(`av-connection-label-short`, 기본 표시)와 전체 텍스트(`av-connection-label-full`, 기본 `opacity:0`) 두 `<text>` 요소를 같은 중심점에 그리고, 배경 rect의 폭/좌표를 축약/전체 두 가지로 인라인 CSS 커스텀 프로퍼티로 지정해 `av-hover-active`(4.2와 동일한 클래스, 라벨도 연결선 그룹 안에 있으므로 같은 호버가 함께 트리거됨) 상태에서 `transition`으로 부드럽게 확장/크로스페이드되게 한다. 말줄임이 필요 없는 라벨은 기존처럼 단일 `<text>`만 그린다.

### 4.4 범례 한글 병기

- `render.ts`의 `TYPE_META`에 각 타입별 한글 단어(`nameKo`: 프론트엔드/백엔드/데이터베이스/클라우드/보안/메시지 버스/외부)를 추가하고, `renderLegend()`에서 `"${name} · ${nameKo}"` 형식으로 함께 표기한다. 텍스트가 길어지는 만큼 범례 박스 폭 계산을 재검토한다.

### 4.5 다크모드 제거

- `render.ts`: `RenderOptions.theme`, `themeAttr`, 다크 팔레트 미디어쿼리 블록과 `svg.av-root[data-theme="dark"]` 명시 오버라이드, `accentColorDark()`를 제거하고 라이트 팔레트만 남긴다. `renderArchitectureViewStandaloneHtml()`의 테마 토글 버튼/인라인 스크립트도 제거한다.
- `apps/web/src/index.css`: `@media (prefers-color-scheme: dark)` 블록 제거, `color-scheme: light`로 고정.
- `apps/web/src/components/ArchitectureView.tsx`: `ThemeChoice`/`nextTheme`/`themeButtonLabel`/헤더의 테마 토글 버튼/`data-theme` DOM 조작 이펙트를 모두 제거한다.

### 4.6 "RUNTIME" → "실행 환경 N"

- `render.ts`: 문서의 boundary 배열을 순회하며 `kind === "runtime"`인 것들에 등장 순서대로 1부터 번호를 매기는 맵을 렌더 진입 시 미리 계산한다. `renderBoundary()`가 이 번호를 받아 하드코딩된 `"RUNTIME · "` 대신 `` `실행 환경${n} · ` `` 을 그리도록 바꾸고, 이 새 접두사 문자열 기준으로 `labelDisplayWidth`를 다시 계산해 옆의 `boundary.label`이 정확히 이어지도록 한다.

### 4.7 곡선 연결선 화살표 위치 보정

- `geometry.ts`의 `shortenRouteEnd`/`roundedPath`/마커 종단 접선 계산을 실제로 재현(예: dogleg 경로를 가진 연결선 하나를 렌더링해 `d` 속성의 마지막 구간 방향과 마커가 기대하는 방향을 비교)해 불일치 원인을 확정한 뒤, 최소 범위로 수정한다(예: 모서리 라운딩 반경이 `ARROW_SHORTEN_DISTANCE`보다 커서 끝부분에 곧은 구간이 안 남는 경우를 보정하거나, 라운딩 이후의 실제 종단 벡터를 기준으로 화살표 끝점을 재계산). 기존 직선 연결선 렌더링에는 영향이 없어야 한다.

---

## 5. 검증 계획

1. `npm run typecheck --workspaces`, `npm run build --workspaces`, `npm run test --workspaces` 전체 통과.
2. `packages/architecture-view`의 `render.test.ts`/`geometry.test.ts`를 갱신 — 오디언스 옵션 제거, 범례 한글 텍스트, 실행 그룹 번호, 라벨 말줄임 요소 존재 여부 등을 검증하는 테스트 추가/수정.
3. `npm run bridge` + `npm run web`로 `fixtures/sample-app`을 실제 분석해 브라우저에서 직접 확인: 쉬운보기 탭이 없음, 테마 토글이 없고 항상 라이트, 범례에 한글이 병기됨, runtime 경계가 "실행 그룹1"처럼 표기됨, 긴 라벨이 말줄임으로 보이다가 호버 시 부드럽게 전체 텍스트로 확장됨, 연결선에 마우스를 올리면 연결된 두 블럭이 확대 강조됨, 곡선 연결선의 화살표가 곡선 진행 방향과 자연스럽게 맞음.
4. 과거 `.vibee/`에 저장된(구버전 `presentation` 필드가 있을 수 있는) 문서를 하나 골라 정상 로드/렌더링되는지 확인 — 실패 시 알려진 한계로 기록.

## 6. 핵심 파일

- `packages/protocol/src/architecture-view.ts`
- `packages/architecture-view/src/presentation.ts` (삭제)
- `packages/architecture-view/src/render.ts`
- `packages/architecture-view/src/geometry.ts`
- `packages/architecture-view/src/test/render.test.ts`, `geometry.test.ts`
- `apps/bridge/src/prompt.ts`, `apps/bridge/src/prompts/audience-presentation-contract.ts` (삭제)
- `apps/bridge/src/index.ts`
- `apps/web/src/components/ArchitectureAudienceTabs.tsx` (삭제)
- `apps/web/src/components/ArchitectureView.tsx`
- `apps/web/src/components/ArchitectureInspector.tsx`
- `apps/web/src/api.ts`, `apps/web/src/App.tsx`
- `apps/web/src/index.css`
