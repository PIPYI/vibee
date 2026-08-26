# V8 — 시스템 구조 지도 품질 · 호출 보기 · 분석 대기 화면

> 상태: **설계 문서(미구현)**. 구현은 별도 세션에서 진행한다.
> 선행 문서: `docs/ontology/structure/v7/README.md`(archify 패턴 Architecture 뷰),
> `docs/ontology/structure/v6/v6.1.md`(토큰/재색인 개선).

## 0. V7 대비 무엇이 달라지는가

V7은 "Architecture 뷰를 archify 패턴(AI가 좌표까지 저작 → 결정론적 검증 → 전용 렌더러)으로
전면 교체한다"는 계획이었고 코드까지 들어갔다. V8은 그 방향을 **되돌리지 않는다.** 좌표
저작 주체는 V7 원안대로 **AI**로 유지한다(사용자 재확인).

바뀌는 것은 두 가지다.

1. **V7이 "동작한다"는 전제가 실측으로 깨졌다.** 아래 §1에서 서술하듯, 실제 저장소 분석에서
   `architecture-view.json`은 단 한 번도 만들어지지 않았다. 즉 지금까지 사용자가 평가해 온
   "시스템 구조 지도"는 V7 산출물이 아니라 **구 결정론적 지도**다. V7의 성패는 아직 측정된
   적이 없다.
2. **AI가 좌표를 쓰는 이상 검증기와 렌더러가 archify 수준이어야 하는데, 둘 다 아니다.**
   V7 렌더러는 구 지도보다도 나쁘다(§1.5). V8의 실질은 "AI 저작 파이프라인을 실제로 쓸 수
   있는 품질까지 끌어올리는 것"이다.

여기에 사용자가 함께 지적한 두 가지 — **호출 보기 모달에 return/event가 안 보이는 문제**와
**분석 대기 화면·토큰 집계 문제** — 를 같은 문서에서 다룬다.

원칙(사용자 지시): 특정 프로젝트에 과적합하지 않는다. 분석 엔진과 시각화 방식은 바꿔도
된다. archify는 최대한 포용한다. `reference/`의 코드는 **패턴만 차용하고 복사하지 않는다.**

---

## 1. 현재 상태 — 문서가 아니라 산출물 기준

QA-Maker 저장소를 실제로 분석한 결과(`/Users/ehoi/Downloads/QA-Maker-main/.project-intel`)를
직접 열어 확인한 사실이다. V5~V7 문서의 "이미 고쳤다"는 서술을 근거로 쓰지 않았다.

### 1.1 archify 경로(V7)는 한 번도 산출물을 만든 적이 없다

gen `000001`~`000005` 전부 `architecture-view.json`이 `null`이다. HEAD는 generation 5이고
`versions.json`의 마지막 항목은 `source: "bundle"` — architecture-view 커밋은 존재하지 않는다.

그리고 **실패가 화면에 전혀 드러나지 않는다.**

- `apps/web/src/App.tsx:266-276` — 배경 architecture task의 이벤트를 early-return으로 전부
  삼킨다. 진행 표시도 오류 표시도 없다.
- `App.tsx:254-264` `runArchitectureView` — 시작 실패(`{error}`)를 조용히 무시한다.
- 브리지가 보내는 `architecture-view.ready` 이벤트를 웹앱이 **한 곳에서도 처리하지 않는다.**

결과적으로 "아직 안 돌았다"와 "돌았는데 실패했다"가 사용자에게 구분되지 않는다.

### 1.2 구 결정론적 경로의 출력이 archify 대비 구조적으로 부실하다

같은 저장소, 같은 시점 기준.

| | 우리 (`gen/000005/analysis-bundle.json`) | archify (참고 산출물) |
|---|---|---|
| 컴포넌트 | 8개 — 그중 4개(`c-json-store`/`c-yaml-store`/`c-python-store`/`c-csv-store`)는 `data/` **샘플 출력 폴더**에서 나온 고아 노드 | 6개 (사용자·React·Flask API·QA/문서 서비스·Firebase·GraphRAG/OpenAI) |
| 연결 | 5개 — 그중 4개가 `c-api-surface → c-domain-services`로 **라벨만 다른 중복** | 6개, 모두 의미가 다름 |
| 프론트↔백엔드 | **없음** | `React → Flask API` (HTTP/JSON) |
| 외부 서비스 | **0개** | Firebase(Firestore·Storage), GraphRAG·OpenAI |
| 그래프 형태 | 섬 2개 + 고아 4개 (비연결) | 단일 연결 그래프 |
| 설명 카드 | 없음 | 3장 (웹/서버/외부 의존성 계층) |

`viewPlan.primaryPath`는 `c-ui → c-fe-orchestration → c-api-surface → c-domain-services →
c-csv-store`인데, 이 경로의 **두 번째와 세 번째 사이에 실제 connection이 없다.** 주 경로가
끊어진 채로 저장돼 있다.

### 1.3 프론트↔백엔드 엣지는 지금 코드로는 저작이 "불가능"하다

- evidence kind: `contains | symbol | call | file | reference | ui_event | api_handler | route | config`
- SystemLink kind: `contains | call | reference | api_handler | uses | ui_event`

**HTTP 클라이언트 호출을 라우트에 잇는 종류가 없다.** `call` 링크는 동일 언어 내 심볼 호출만
잡는다. 그런데 `packages/core/src/analysis-bundle-validator.ts:277-294`는 `systemLinkRefs`가
비면 `bundle/connection-not-grounded-in-system-graph`를 **hard error**로 낸다.

즉 어떤 웹앱에서도 가장 중요한 엣지가 구조적으로 막혀 있다. QA-Maker에는
`frontend/src/api/*.js`에 `fetch(\`${BASE_URL}/crawl-and-structure/${pageId}\`)` 형태의 호출이
20개 넘게 있고, 서버 쪽에도 `route:ANY /crawl-and-structure/<page_id>`가 정상 색인돼 있다.
양쪽 사실이 다 있는데 둘을 잇는 fact의 **종류 자체가 없다.**

### 1.4 외부 서비스는 fact로 존재하는데 지도에 올라오지 않는다

`system-facts.json`에 `external_library` 엔티티 20개가 `status: valid`로 있다 —
`resource:npm:firebase/{app,auth,firestore,storage,analytics}`,
`resource:python:{openai,graphrag,selenium,networkx,tiktoken,...}`. `uses` 링크(`mechanism:
"direct runtime call"`)도 함께 있다. 엔티티 배열 인덱스 226~245로 **`assemblyContext`의
500개 cap 안에 들어간다** — 잘려서 못 본 것이 아니다.

그럼에도 어떤 컴포넌트도 이 엔티티를 `entityRefs`로 인용하지 않았다. 롤아웃 리포트의
`externalIntegrations: 0`이 그 결과다. **authoring 실패**이며, 이를 잡아낼 완전성 진단도 없다.

다만 별개 문제로 entities 670 / links 699는 cap 500에 실제로 걸린다. cap이 kind와 무관하게
일괄 적용돼서, 심볼 물량이 많은 저장소에서는 소수 kind가 잘릴 수 있다.

### 1.5 V7 렌더러 자체가 구 지도보다 나쁘다

`packages/architecture-view/src/render.ts` (156줄):

- 연결이 **중심-대-중심 직선 `<line>`**이고, z-order가 boundary → connection → **component
  마지막**이다. → **화살촉이 대상 상자 밑에 파묻혀 절대 보이지 않는다.** 선도 출발 상자
  내부에서 튀어나온다.
- 엣지마다 `<defs><marker>`를 새로 만든다(N개 중복 정의).
- 라벨 폭을 `label.length * 6.4`로 추정 → 한국어에서 마스크 폭이 어긋난다.
- 라벨 충돌 회피가 전혀 없다. 같은 쌍의 엣지 여러 개가 정확히 겹쳐 그려진다.
- 범례·제목·`<style>`·테마·grid 배경이 없다. 팔레트는 인라인 hex 하드코딩.
- boundary `kind`가 스타일에 반영되지 않는다 — 모든 boundary가 동일한 회색 점선.
- `cards`는 스키마에 있고 AI가 저작하고 검증·저장되지만 **표시되는 곳이 없다.**
  유일한 렌더러 `renderArchitectureViewStandaloneHtml`은 어디서도 호출되지 않는 dead code다.

그리고 `UnifiedMapView.tsx:69-87`은 SVG가 있으면 구 지도를 **통째로 대체**한다. 그 순간
잃는 것: 포트 분산, gutter 라우팅, 라벨 충돌 회피, 범례, 근거 클릭(System Link/Evidence),
시퀀스 drill-down, journey↔system 상호 강조, pan/zoom, resize 재배치. 구 지도
(`ArchitectureRelationshipMap.tsx`, 536줄)는 이걸 전부 갖고 있다 — 특히 화살촉을 대상 카드
**10px 앞에서 끊는 처리**(293-296행)가 이미 있는데, V7 렌더러에는 없다.

### 1.6 호출 보기 모달 — return/event

스키마도 validator도 렌더러도 세 종류를 모두 허용/처리한다.
`SequenceMessage.kind: "call" | "return" | "event"` (`packages/protocol/src/index.ts:1289-1298`),
`SEQUENCE_IR_SCHEMA`의 `kind: { enum: [...] }` (`schemas.ts:733-769`), validator는 `kind`를
**읽지도 않는다**(`analysis-bundle-validator.ts:710-726`).

그런데 실제 산출물은 메시지 8개 중 `call` 7 / `return` 1 / `event` 0이다. 원인은 세 겹이다.

1. **프롬프트가 `kind`를 한 번도 언급하지 않는다.** `buildAssemblyPrompt` 7번과
   `assemblyRules()` 8번은 참조 무결성(`edge.sequenceRef` ↔ `triggeredByEdgeId`)만 말한다.
   "return을 쓰라"는 유일한 문장은 `buildScenarioPrompt`(258-263행)에 있는데, 그건 **다른
   타입**(`ScenarioTransition.kind`)이고 `(선택)`으로 표시돼 있다. `event`는 어떤 프롬프트
   에서도 언급되지 않는다.
2. **계약 digest에 빠져 있다.** `analysisContractDigest()`(`schemas.ts:797-807`)는 다른 enum을
   전부 나열하면서 `sequences[].messages[].kind`만 빠뜨린다. 이 digest가 프롬프트
   (`prompt.ts:396`)와 MCP 도구 설명(`mcp-server/src/index.ts:631`) 양쪽에 들어간다. 모델은
   값을 추측하게 되고, `"request"` 같은 값을 쓰면 strict `z.enum`에서 **제출 전체가 transport
   레벨에서 실패**한다. 가장 싼 회피가 "전부 `call`"이다.
3. **grounding 경로가 막혀 있다.** `requireGrounded`가 메시지마다 비지 않은 `evidenceRefs`를
   요구하는데(`validator.ts:725`), 색인기가 만드는 evidence에 "return evidence"라는 게 없다.
   모델이 규칙을 문자 그대로 읽으면 return을 근거 지을 수 없다고 결론 내린다.

부차적으로 렌더러 충실도 문제가 있어서, **있어도 안 보인다**:
`seq-arrow`와 `seq-arrow-return`의 path가 **바이트 동일**하고(`SequenceView.tsx:42-47`),
self-message는 marker를 `url(#seq-arrow)`로 하드코딩하며(99행), `event`는 삼항의 else로 빠져
call 화살촉을 쓰고(113행), 범례는 **존재하지 않는 값** `"request"`를 표시한다(124행).

### 1.7 분석 대기 화면과 토큰

**레이아웃** — `styles.css:248-256`의 `.analyzing-pane`이 `max-width: 640px` + `align-items:
flex-start`라, 넓은 화면에서 좌측에 붙은 좁은 띠가 되고 오른쪽이 통째로 빈다. 4단계
`PhaseStepper`와 6단계 `StageLedger`가 **겹쳐 쌓인다**(진행 모델이 둘). `.stage-live-dot`은
유일한 모션인데 실패해도 계속 초록으로 뛴다. `.stage-ledger-head`와 그 자식 div가 둘 다
`justify-content: space-between`이라 점과 단계명이 좌우로 벌어진다(347-352행).

**피드백** — `agent.message.delta`가 소켓으로 수신되고도 `default: break`로 **버려진다**
(`App.tsx:364-365`). `agent.file.explored`도 마찬가지. 도구 호출은 **기본 접힌**
`DiagnosticsDrawer`에만 들어간다(`App.tsx:113`). 프로토콜에 이미 있는
`completedUnits`/`totalUnits`(`agent.ts:110-111`)는 렌더되지 않는다. heartbeat는 15초 간격에
6단계 중 3단계에만 붙고(`index.ts:646,1106,1206`) 클라이언트 tick이 없어 그 사이 시간이
멈춰 보인다. `ws.ts`는 재접속 시 재동기화를 하지 않아 끊긴 동안의 이벤트가 영구 유실된다.

**토큰** — provider 간 정의가 다르다.

- Claude(`claude/adapter.ts:281-298` + `usage.ts`, `inputIncludesCacheRead: false`):
  `input + output + cache_read + cache_creation`. `cache_creation`은 캐시에 **쓴** 토큰이고
  그 토큰은 이후 호출마다 `cache_read`로 **다시 세어진다.** 긴 agentic turn에서 cache_read는
  도구 호출 수에 비례해 커진다. QA-Maker의 "1,732,795 토큰 / provider turn 2회"가 그 결과다.
- Codex(`codex/adapter.ts:367-396`, `inputIncludesCacheRead: true`): `input + output`
  (cache는 빼고 다시 더해 상쇄). 사실상 순수 input+output.

같은 작업이 provider에 따라 자릿수가 달라진다. 추가로:

- `turnId`가 한 번이라도 비면 같은 turn이 **두 행으로 합산**된다(`state.ts:214-216`,
  `App.tsx:317`). codex는 `turn/start` 해석 전 도착한 `thread/tokenUsage/updated`를 turnId
  없이 내보낼 수 있다(`codex/adapter.ts:247,272-277,381`).
- `총`은 모든 stage를 더하는데 행은 `semantic|assembly`만 그린다(`App.tsx:596-601`) —
  행 합계와 총계가 구조적으로 안 맞는다.
- codex의 `total.totalTokens`를 presence gate로만 쓰고 버린다(379행). 필드가 이동하면 영구히
  `집계 대기`가 뜨고 원인을 알 수 없다.
- `V4AnalysisSummary.tsx:39`에 다르게 반올림되는 **두 번째 토큰 표시**가 있다.

---

## 2. archify에서 가져올 것 (패턴만)

`reference/archify-main/archify/`를 읽고 정리한, 우리 문제에 직접 대응하는 메커니즘.

| Reference behavior | 우리 문제와의 관련성 | 차용 | 수정해서 적용할 방식 |
|---|---|---|---|
| `automaticPortSpread` — 같은 `(node, side)`로 모이는 엣지를 상대 노드 좌표순 정렬 후 오프셋 분산 (`geometry.mjs:1125`) | 같은 쌍 엣지 4개가 완전히 겹쳐 그려짐 | O | TS 재구현. `gutter 16 / maxSpacing 14` 기본값은 우리 박스 크기로 재조정 |
| 변(side) 앵커 + `defaultFromSide/ToSide` + `routeHonorsEndpointSides` (첫·끝 세그먼트가 side에 수직) | 중심-대-중심 직선 때문에 선이 상자 내부에서 나옴 | O | TS 재구현 |
| `routeVia` — H-first/V-first dogleg 후보를 만들고 `routeClearsComponents`로 거름, 근평행 포트는 바깥 채널 우회 (`render-architecture.mjs:821`) | 엣지가 무관한 상자를 가로지름 | O | 후보 생성·필터 구조만 차용 |
| `roundedPath(points, r)` — 꺾임에 Q 곡선 (`geometry.mjs:1214`) | 직각 꺾임이 거칠다 | O | 그대로 재구현 |
| 의미 CSS 클래스 + `:root` 팔레트 + `prefers-color-scheme`/`[data-theme]` 오버라이드 | 인라인 hex라 테마가 없음 | O | 우리 앱 토큰(`--panel`, `--border` 등)에 맞춰 재작성 |
| `quality_profile: showcase` — 9개 검사 / error 0 / warning 0을 통과해야 수용 | 검증이 느슨해 repair 루프가 헛돎 | 부분 | 우리 진단 코드 체계로 재구성(§3.2). "hard gate"라고 부르지 않는다 |
| 컴포넌트 타입 7종 / variant 4종, boundary `region`·`security-group` | 이미 동일 어휘를 씀 | O | 유지 + boundary kind별 스타일 분화 |
| 사용된 kind만 뽑는 legend, 결론 `cards` | 둘 다 없음/dead code | O | legend는 SVG, cards는 제품 UI HTML |
| "≤12 노드, 하나의 명확한 주 경로, 라벨은 의미 데이터" | 프롬프트에 레이아웃 기술 지침이 없음 | O | 프롬프트 규칙으로 재작성(§3.3) |
| repository evidence — 인용한 `path/line`을 git으로 사후 검증 | 이미 `citation.ts`로 구현됨 | 유지 | — |
| 독립 HTML 뷰어(pan/zoom/검색/포커스/내보내기) | 제품은 SPA 안에 있어야 함 | 대체 | **기존 `ViewerShell.tsx` 재사용**(§3.4). 독립 HTML은 "내보내기" 액션으로만 |

가져오지 않는 것: 브랜드 마크 카탈로그, 5종 다이어그램 타입 라우터, Mermaid 입력,
guided views/story trail/share card 같은 뷰어 런타임 기능, WebM 내보내기.

---

## 3. 설계 — 시스템 구조 지도

좌표를 AI가 쓴다는 결정을 유지하므로, **검증기와 렌더러가 archify 수준이어야 한다.**

### 3.1 렌더러 전면 재작성 — `packages/architecture-view/src/render.ts`

- `anchor(rect, side)` / `defaultFromSide` / `defaultToSide` — 중심이 아니라 **변에서** 출발·도착.
- `automaticPortSpread(connections, boxes)` — 같은 `(componentId, side)`에 모이는 엣지를
  상대 노드 중심 좌표순으로 정렬해 오프셋 분산.
- 라우팅: 축 정렬이면 직선, 아니면 H-first/V-first dogleg 후보를 만들어
  `routeHonorsEndpointSides` + `routeClearsComponents`로 거른다. 근평행 포트는 바깥 채널로
  우회. 전부 실패하면 결정론적 fallback(검증기가 이유를 보고하게 둔다).
- `roundedPath(points, 8)`.
- **화살촉을 대상 상자 경계에서 끊는다** — 마지막 세그먼트를 target rect와 교차시켜 8~10px
  앞에서 종료. 구 지도가 이미 하는 처리이고, 지금 화살촉이 안 보이는 직접 원인이다.
- **z-order**: grid → boundary → connection → component → connection label → boundary label
  → legend.
- `<defs>` **1개**: variant별 marker 4개 + grid `<pattern>`.
- 인라인 hex 대신 **CSS 클래스 + custom property**, SVG 안에 `<style>` 블록. 라이트 팔레트를
  `:root`에 두고 `@media (prefers-color-scheme: dark)`와 `[data-theme]`로 오버라이드.
- 타입별 semantic sigil(작은 글리프), boundary `kind`별 스타일 분화.
- 라벨 마스크 폭을 **CJK 인지 방식**으로 추정(전각 1.0em / 반각 0.55em).
- 라벨 충돌 회피: 상자와 이미 배치된 라벨을 피해 후보 오프셋 `[0,-24,24,-48,48,-72,72]`를
  순회 (구 지도 `measure()`와 같은 아이디어).
- 사용된 타입만 뽑는 범례, 제목 텍스트.
- 상호작용 훅: `data-component-id`, `data-connection-id`, `data-sources`(JSON).
- `cards`는 SVG가 아니라 제품 UI에서 HTML로 그린다(텍스트 선택 가능하게).
  `renderArchitectureViewStandaloneHtml`은 "HTML로 내보내기" 액션이 생길 때까지 유지하되
  dead code임을 주석에 명시한다.

### 3.2 geometry 검증 강화 — `packages/architecture-view/src/geometry.ts`

검증기는 **렌더러가 실제로 보장하는 것과 일치**해야 하고, 진단마다
`subject`/`evidence`/`supportedFixes`가 있어야 repair 루프가 헛돌지 않는다.

유지: bounds, dangling ref. 강화·추가:

- `overlap` — "겹침 면적 2% 미만 무시" 관용을 없애고 **최소 간격**(예 24px)을 요구. 라우팅
  통로가 생긴다.
- `edge-crosses-component` — 중심선이 아니라 **실제 라우팅된 폴리라인**으로 판정하고,
  불투명 상자를 가로지르면 `error`(현재 warning).
- `label-collision` — 엣지 라벨이 상자/다른 라벨과 겹치는지.
- `duplicate-connection` — 같은 `from/to`의 사실상 동일한 관계 중복.
- `component-disconnected` (warning) — 어떤 연결에도 참여하지 않는 컴포넌트.
- `viewBox-balance` (warning) — 한 줄짜리 스트립이나 세로가 지나치게 비는 구성.
- `validate_architecture_view` 응답에 **계산된 레이아웃 리포트**(각 박스의 실제 rect, 라우팅된
  points)를 함께 반환한다. AI가 원인을 추측하지 않고 고칠 수 있다.

`MAX_ARCHITECTURE_VIEW_VALIDATE_CALLS`(현 6)는 유지하되 **submit도 같은 카운터를 소비**하도록
고친다 — 현재 `/internal/submit-architecture-view`는 카운터를 증가시키지 않아 무한 submit이
가능하다.

완전성 진단(`completeness.ts`)은 **계속 warning이며 hard gate가 아니다.** 어떤 보고서에서도
"보장한다"는 표현을 쓰지 않는다.

### 3.3 프롬프트 + 저장소 브리핑 — `apps/bridge/src/prompt.ts`

`buildArchitectureViewPrompt`는 레이아웃 지침이 "viewBox 안, 서로 겹치지 않게" 한 줄뿐이고
예시가 **가로 한 줄 3박스**다. 출력 품질의 천장이다.

1. **저장소 브리핑을 결정론적으로 만들어 주입한다.** `POST /api/architecture-view`가 이미
   `indexProject` + `detectRepositoryTopology`를 돌리므로, 그 결과와 system facts에서:
   - 탐지된 런타임(rootPath / entrypoint / `origin`)
   - route surface와 대표 route key 몇 개
   - data store — `origin: "generated-artifact"`는 **"샘플 출력이니 컴포넌트로 만들지 말 것"**
     으로 표시(§1.2의 고아 4개를 정면으로 막는다)
   - **외부 라이브러리·서비스 목록**(`resource:npm:*` / `resource:python:*` + `uses` 링크)
   - §4에서 새로 생기는 **HTTP 호출 ↔ 라우트 매칭** 목록

   AI는 이걸 "존재한다고 알려진 것들"로 받고 대표 여부는 스스로 판단한다(게이트 아님).
2. **레이아웃 기술 지침**: 좌→우 계층 밴드(사용자 → 프론트 → API → 서비스 → 저장소/외부),
   권장 박스 크기(145~200 × 70~80), 열 간 통로 ≥ 60px, 행 간 ≥ 24px, 기본 viewBox 1200×760,
   런타임/외부 그룹은 boundary로 감싼다, `variant` 의미(`emphasis`=주 경로, `security`=인증/
   외부 비밀 경유, `dashed`=비동기·추정), `cards` 3장, `sublabel`에 구체 기술명.
3. **교차 런타임 규칙 명시**: 프론트엔드가 백엔드를 HTTP로 호출하면 반드시 하나의 connection
   이다. 외부 SaaS/LLM/스토리지는 `external`/`cloud` 노드 후보로 반드시 검토한다.
4. **예시 교체** — `examples/minimal.architecture-view.json`을 6 컴포넌트 / 2 boundary /
   6 connection / 3 card짜리 **일반 도메인** 예시로 바꾼다(특정 프로젝트 어휘를 넣지 않는다).
5. `describeSession`(`prompt.ts:491`)의 `"Architecture 뷰 저작 (archify 패턴)"`은 UI 노출
   가능성이 있으므로 `"시스템 구조 지도 저작"`으로 바꾼다. 프롬프트 첫 줄과 prefix 매칭,
   `prompt.test.mjs`의 assertion을 함께 수정한다.

### 3.4 뷰어 통합 — 회귀 없이

- `SystemStructureMap.tsx`를 **`ViewerShell`로 감싼다.** `ViewerShell.tsx`(427줄)는 이미
  pan/zoom, fit-to-content, 노드 finder, radar(미니맵), focus, 딥링크를 제공하고 **현재
  아무도 쓰지 않는다.** 재사용하면 archify 뷰어 기능 상당수를 새로 짜지 않아도 된다.
  `nodes`에는 문서의 components(`{id, label, sublabel}`)를 넘긴다.
- 컴포넌트/연결 클릭 → `data-sources`를 읽어 근거 패널(파일:라인) 표시. 기존 `Passport.tsx`
  /`Grounding.tsx` 패턴 재사용.
- **journey ↔ system 상호 강조 복원** — `sources[].path`와 여정 단계 evidence의 파일 경로를
  맞춰 강조 집합을 만든다. 현재 SVG 경로에서는 이 연결이 통째로 끊긴다.
- `cards`를 SVG 아래 블록으로 렌더.
- **실패 가시화** — `architecture-view.ready`를 실제로 처리하고, 섹션 헤더에
  `저작 중… / 실패 · 다시 시도` 칩을 둔다. 실패 시 구 결정론적 지도로 폴백하되 **그 사실을
  문구로 알린다.** `runArchitectureView`의 시작 오류도 삼키지 않는다.
- `styles.css`에 `.system-structure-map` 규칙이 아예 없다 — 추가한다.

---

## 4. 설계 — 분석 엔진(교차 런타임 사실)

Architecture 뷰는 AI가 코드를 직접 읽으므로 §4 없이도 프론트↔백엔드 엣지를 그릴 수는 있다.
§4가 필요한 이유는 **(i) §3.3 브리핑이 신뢰할 만해지고, (ii) 호출 보기(§5)의 교차 런타임
메시지가 grounding 가능해지며, (iii) 구 bundle 경로의 hard error가 풀린다**는 것이다.

### 4.1 HTTP 호출 evidence + 라우트 매칭 링크

`packages/evidence/src/generic-patterns.ts`의 전례를 따른다 — 프레임워크별 AST adapter를 새로
짜지 않고 **패턴 목록**에 항목을 더한다(V5 설계 원칙 1, `isNeverSource()` 차단목록 전례).

- 신규 `packages/evidence/src/http-calls.ts`의 `parseHttpCallPatterns(text)`:
  `fetch(<str>)`, `axios.<verb>(<str>)` / `axios({url})`, `XMLHttpRequest.open(<verb>,<str>)`,
  `$.ajax`, python `requests.<verb>(<str>)` / `httpx.<verb>`, Java `RestTemplate`/`WebClient`/
  OkHttp, Go `http.NewRequest`. **같은 줄에 명시적 URL 리터럴이 있을 때만** 잡는다.
- 경로 정규화: `${...}` / `{...}` / `:param` / `<param>` → `*`. 라우트 쪽도 같은 함수로
  정규화해 비교한다 (`/crawl-and-structure/${pageId}` ↔ `/crawl-and-structure/<page_id>`).
- 신규 evidence kind `http_call`, 신규 SystemLink kind `http_call`(symbol/file → route entity).
  정확히 일치하면 `certainty: "grounded"`, 접미사/부분 일치면 `"inferred"`. V5 A4 이후
  inferred 링크는 connection을 거부하지 않고 `certainty`만 낮춘다.
- `mechanism`에 `"HTTP <METHOD> <path>"`를 남긴다.

**공유 파일 위험**: 이 링크가 생기면 `analysis-bundle-validator.ts`의 coverage 계산과
`repository-topology.ts` 결과가 함께 바뀐다. §6.1의 회귀 확인을 **먼저** 통과시킨다.

### 4.2 외부 서비스와 packet 잘림

- `assemblyContext`(`apps/bridge/src/memory-api.ts:164-192`)의 `limit`이 entity/link 전체에
  일괄 500이라 심볼 물량이 많은 저장소에서 소수 kind가 잘릴 수 있다. **kind별로 배분**하도록
  바꾸고 `truncated`도 kind별로 보고한다.
- `completeness.ts`에 `external-service-not-represented`(warning) 추가 — `uses` 링크가 있는
  외부 라이브러리 중 어떤 컴포넌트도 인용하지 않는 것이 있으면 알린다.
- `completeness.ts`의 경로 매칭이 **정확 문자열 일치**라 폴리글랏에서 헛경보가 난다. 경로
  접두 매칭으로 바꾸고, route-cluster 런타임의 `rootPath === ""`일 때 "모든 것을 커버한다"고
  착각하는 경로를 막는다.

---

## 5. 설계 — 호출 보기 모달(return / event)

### 5.1 계약 노출 (가장 큰 원인)

- `packages/protocol/src/schemas.ts:797-807` `analysisContractDigest()`에
  `sequences[].messages[].kind: call | return | event` 한 줄 추가. 이 digest는 프롬프트와
  MCP 도구 설명에 동시에 들어간다.
- MCP 도구 설명의 sequences 필드 나열(`mcp-server/src/index.ts:623-625`)에도 enum 값을 적는다.

### 5.2 프롬프트

`assemblyRules()` 8번과 `buildAssemblyPrompt` 7번에 추가:

- 동기 호출이 의미 있는 결과를 돌려주면 `kind: "return"` 메시지를 짝으로 넣는다.
- 비동기 발행/구독, 웹훅, UI 이벤트는 `kind: "event"`.
- **grounding**: `return`은 그 호출을 만든 **같은 call evidence**를 인용해도 된다(호출 지점이
  양방향의 근거다). `event`는 `ui_event` evidence를 인용한다 — QA-Maker에서만 54개가 색인돼
  있는데 시퀀스에서 한 번도 쓰이지 않았다. 이를 명시하지 않아 모델이 `requireGrounded`에
  막혀 return을 생략했다.
- 3~6개 메시지짜리 미니 예시 1개(call → call → return → event).

### 5.3 렌더러 — `apps/web/src/components/SequenceView.tsx`

- `seq-arrow-return`을 **열린 V자**(fill none, stroke)로 바꾼다. 현재 `seq-arrow`와 path가
  바이트 동일하다.
- `event`용 marker 추가(속 빈 원 또는 반쪽 화살촉) + 점선 유지.
- self-message(99행)의 하드코딩된 marker를 `kind`에 따라 고른다.
- 113행 삼항을 `kind`별 lookup으로 바꿔 `event`가 call 화살촉을 쓰지 않게 한다.
- 범례(124행) `request / call` → `호출(call) / 반환(return) / 이벤트(event)`.
- call↔return 쌍을 시각적으로 묶는다(같은 참여자 쌍의 인접 call/return을 괄호/들여쓰기로).
- 라벨 폭 계산도 CJK 인지 방식으로(115행).

---

## 6. 설계 — 분석 대기 화면 + 토큰

### 6.1 레이아웃 재구성

`.analyzing-pane`의 640px 좌측 고정을 버리고 **전체 폭 2열**로:

- **상단 스트립**: 프로젝트명 · 에이전트/모델 · 총 경과(클라이언트 1초 tick) · 현재 단계 ·
  중지 버튼(툴바가 아니라 여기). 분석 중에는 비활성 모델 툴바를 접는다.
- **좌열 — 단계 타임라인**: 6단계 `AnalysisPipelineStage` **하나의 모델만** 쓴다. 4단계
  `PhaseStepper`는 제거하거나 이 타임라인의 그룹 헤더로 흡수한다. 각 단계에 상태·경과·
  `completedUnits`/`totalUnits` 진행 바(프로토콜에 이미 있고 한 번도 안 그려졌다).
- **우열 — 라이브 활동**: 두 트랙을 시간순으로.
  1. 활동: `agent.action.started`, `mcp.tool.called`, `agent.file.explored`(현재 버려짐)
  2. 모델 출력: `agent.message.delta`(현재 버려짐)를 throttle해서 스트리밍

  기본 펼침. `DiagnosticsDrawer`는 raw 로그 전체 보기로 남긴다.
- 실패 시 `.stage-live-dot`이 계속 초록으로 뛰는 문제, `.stage-ledger-head`의 dot/이름 분리
  문제를 고친다.

### 6.2 이벤트 신뢰성

- `startStageHeartbeat`를 6단계 전부에 붙인다(현재 3단계).
- heartbeat 15초 사이를 **클라이언트 타이머로 보간**한다.
- `ws.ts`: `onopen`에서 `api.bridgeState()`로 재동기화한다.

### 6.3 토큰 — 정의 통일 + 분해

- 대표값을 **`billableTokens = inputTokens + outputTokens`**(캐시 제외)로 통일하고,
  `cacheReadTokens` / `cacheWriteTokens`는 **별도 보조 수치**로 분리 표시한다.
- `StageUsage`에 `billableTokens`를 추가하거나 `totalTokens`의 의미를 재정의하고, 주석을
  실제 동작과 일치시킨다(현재 주석은 "input은 cache read 제외"라고 하는데 Claude 경로에서는
  그렇지 않다).
- **turnId 누락 중복 합산 버그**: turnId 없는 항목은 같은 stage의 turnId 있는 항목이 도착하면
  대체되도록 고친다.
- 행은 실제로 존재하는 모든 stage를 그리고, `총`은 **그린 행들의 합**이 되게 한다.
- codex의 `total.totalTokens`를 버리지 말고 교차 검증에 쓰고, 불일치 시 경고를 남긴다.
- `V4AnalysisSummary.tsx:39`의 두 번째·다르게 반올림되는 토큰 표시를 통일한다.

---

## 7. 검증 계획 (과장 금지)

완전성 체크는 warning일 뿐 hard gate가 아니므로 어떤 보고서에서도 "hard gate"·"보장한다"는
표현을 쓰지 않는다. 단일 픽스처 결과를 일반 벤치마크처럼 말하지 않는다.

1. **회귀 우선** — §4.1(공유 파일)을 넣기 전/후로 `packages/core/test/route-surface-coverage.test.mjs`,
   `unrecognized-source-language.test.mjs`, `fixtures/v5/*` 전체, 전체 테스트 스위트를 돌려
   **새로운 실패가 0인지** 먼저 확인한다. "새 기능이 동작한다"보다 엄격한 "구 기능이 몰래
   깨지지 않았다" 기준이다.
2. **렌더러 단위 테스트** — 문자열 포함 확인에서 기하 확인으로 올린다: 화살촉 끝점이 target
   rect 밖인지, 같은 쌍의 두 엣지가 서로 다른 포트에서 나가는지, 라벨 rect가 어떤 컴포넌트
   rect와도 겹치지 않는지, `<defs>`가 1개인지, 범례에 사용된 타입만 있는지.
3. **geometry 검증기 테스트** — 일부러 겹친 문서 / 상자를 가로지르는 엣지 / 고아 컴포넌트 /
   중복 연결 문서를 만들어 각 진단이 정확히 한 번 나오는지, `supportedFixes`가 비지 않았는지.
4. **http_call 링커 테스트** — 프론트 `fetch(\`${BASE}/x/${id}\`)` + 백엔드
   `@app.route("/x/<id>")`를 둔 작은 픽스처를 추가해 링크가 정확히 1개 생기고 정규화가 맞는지.
   매칭 실패 케이스(외부 도메인 절대 URL)도 함께.
5. **SequenceView 테스트 신설** — 세 kind가 서로 다른 marker id를 쓰는지. 현재
   `kind: "event"`는 저장소 전체의 테스트·픽스처·프롬프트 어디에도 없다.
6. **엔드투엔드(수동)** — 빌드·전체 테스트 통과 후 실제 저장소로 다시 분석해
   (a) `architecture-view.json`이 더 이상 `null`이 아닌지, (b) 프론트↔백엔드 엣지와 외부
   서비스 노드가 나오는지, (c) 샘플 출력 폴더에서 나온 고아 노드가 사라졌는지, (d) 시퀀스에
   `return`/`event`가 나오는지, (e) 대기 화면에 모델 출력이 흐르는지, (f) 토큰 수치가
   provider 간 자릿수 차이 없이 설명 가능한지를 **원시 숫자로** 기록한다. 개선률이나
   일반화된 주장은 쓰지 않는다.
7. **라이브 비교의 한계 명시** — V5가 남긴 archify 벤치마크와의 정면 재비교는 외부 픽스처와
   실제 API 비용이 드는 라이브 실행이 필요하다. 자동 검증 범위 밖이며 수동 후속으로 남긴다.

---

## 8. 건드리지 않는 것

`buildFullAnalyzePrompt` / `buildIncrementalAnalyzePrompt` / `ASSEMBLY_RULES`의 나머지,
`analysis-bundle-commit.ts`, `system-fact-lifecycle.ts`, Workflow/UserMap 레이아웃과 컴포넌트,
`AnalysisBundle.architecture: ArchitectureIR` 타입 자체.

**두 경로가 함께 의존하게 되는 공유 인프라(얽힘 위험 명시)**:

- `packages/evidence/src/indexer.ts` + `packages/protocol`의 evidence/link kind union —
  §4.1이 새 멤버를 추가한다. 닫힌 union이므로 모든 기존 `switch`를 확인한다.
- `packages/core/src/repository-topology.ts` — §4.1의 결과가 route surface/coverage에 영향을 준다.
- `apps/bridge/src/memory-api.ts`의 `assemblyContext` — §4.2가 cap 배분을 바꾼다. Assembly
  경로 전체가 이 packet을 쓴다.
- `packages/protocol/src/schemas.ts`의 `analysisContractDigest()` — §5.1이 프롬프트와 MCP 도구
  설명 양쪽을 동시에 바꾼다.

---

## 9. 핵심 파일

**시스템 구조 지도**
- `prototypes/ontology/packages/architecture-view/src/render.ts` (전면 재작성)
- `prototypes/ontology/packages/architecture-view/src/geometry.ts` (강화)
- `prototypes/ontology/packages/architecture-view/src/completeness.ts`
- `prototypes/ontology/packages/architecture-view/examples/minimal.architecture-view.json` (교체)
- `prototypes/ontology/apps/bridge/src/prompt.ts` (`buildArchitectureViewPrompt`, `describeSession`)
- `prototypes/ontology/apps/bridge/src/index.ts` (브리핑 주입, submit도 캡 소비)
- `prototypes/ontology/apps/web/src/components/SystemStructureMap.tsx` (ViewerShell 통합·cards·클릭)
- `prototypes/ontology/apps/web/src/components/UnifiedMapView.tsx` (상호 강조·폴백 문구)
- `prototypes/ontology/apps/web/src/App.tsx` (`architecture-view.ready`, 실패 노출)
- `prototypes/ontology/apps/web/src/styles.css`
- 참고 패턴(복사 금지): `reference/archify-main/archify/renderers/shared/geometry.mjs`,
  `renderers/architecture/render-architecture.mjs`, `archify/SKILL.md`

**분석 엔진**
- (신규) `prototypes/ontology/packages/evidence/src/http-calls.ts`
- `prototypes/ontology/packages/evidence/src/indexer.ts`
- `prototypes/ontology/packages/protocol/src/index.ts` (evidence / link kind)
- `prototypes/ontology/apps/bridge/src/memory-api.ts` (`assemblyContext` kind별 cap)

**호출 보기**
- `prototypes/ontology/packages/protocol/src/schemas.ts` (`analysisContractDigest`)
- `prototypes/ontology/packages/mcp-server/src/index.ts` (도구 설명)
- `prototypes/ontology/apps/bridge/src/prompt.ts` (`assemblyRules`, `buildAssemblyPrompt`)
- `prototypes/ontology/apps/web/src/components/SequenceView.tsx`

**대기 화면·토큰**
- `prototypes/ontology/apps/web/src/components/AnalyzingConsole.tsx` (재구성)
- `prototypes/ontology/apps/web/src/App.tsx`
- `prototypes/ontology/apps/web/src/ws.ts`
- `prototypes/ontology/apps/bridge/src/agents/usage.ts`,
  `agents/claude/adapter.ts`, `agents/codex/adapter.ts`, `src/state.ts`, `src/index.ts`
- `prototypes/ontology/packages/protocol/src/agent.ts` (`StageUsage` 의미 정리)
