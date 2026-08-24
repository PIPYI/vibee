# Architecture Viewer v2 — 저장소 완전성 + 단계적 시각화

이 문서는 [ontology_schema3.md](../v1/ontology_schema3.md)(v1)가 확정한 파이프라인·IR 위에서, 저장소 완전성 검사와 시각화(View 레이어)를 함께 개선한 기록이다. 실전 검증 결과 문제는 렌더링만이 아니었다. `admin`처럼 별도 실행되는 앱과 로컬 JSON 데이터가 Evidence에는 있어도 Assembly 결과에서 사라질 수 있었고, 그 상태에서는 아무리 레이아웃을 다듬어도 “전체 구조”라고 부를 수 없다.

## 배경

v1의 아키텍처 탭은 `AnalysisBundle.architecture.components`를 전부 한 그래프에 펼치기만 했다. 원래 목표(`ontology_schema3.md` §1)였던 "비전공자가 한눈에 이해"를 그래프 하나로는 달성하지 못했다 — 19개 컴포넌트짜리 그래프는 전공자에게도 한눈에 안 들어온다. 또한 화면 19개가 실제 저장소 전체를 대표하는지 확인할 기계적 장치가 없었다.

## 0. RepositoryTopology — AI가 생략할 수 없는 저장소 골격

Core는 LLM 없이 package manifest, runnable script/framework, 관례적 entrypoint, `data/fixtures/mocks/seeds` 자산을 읽어 `RepositoryTopology`를 만든다. 이 데이터는 의미 구조가 아니라 완전성 하한선이다.

- 독립 실행 런타임마다 별도 boundary와 entrypoint-backed component가 있어야 한다.
- 로컬 데이터 저장소마다 해당 파일을 `entityRefs`로 가진 data component가 있어야 한다.
- 여러 런타임이 하나의 boundary로 합쳐지면 거절한다.
- 검사 결과는 `AnalysisBundle.repositoryTopology.coverage`에 Core가 찍는다. Agent가 이 영수증을 작성할 수 없다.

실제 `chungnam-mission-app-master`에서는 모바일 앱(root)과 관리자 웹(`admin`) 2개 런타임, `src/data` 15개와 `admin/src/data` 5개의 JSON 파일을 탐지했다. 기존 Assembly가 관리자 웹을 빠뜨리면 이제 `bundle/runtime-not-represented`와 `bundle/data-store-not-represented`로 제출이 실패한다.

Assembly는 픽셀 좌표 대신 `component.layer`, `connection.role`, `viewPlan.primaryPath/groups`를 저작한다. Core가 정한 사실과 AI가 정한 설명 우선순위를 분리한 것이다.

## 1. 구성 개요 티어링 — 의미 layer 우선, rank는 레거시 폴백

새 Bundle은 Assembly가 저작한 `component.layer`(`interface/service/state/data` 등)를 구성 개요의 우선 축으로 쓴다. 연결 방향에서 계산한 `rank`는 layer가 없는 레거시 Bundle에서만 안전한 폴백으로 사용한다. 이로써 상태 저장소가 우연한 연결 방향 때문에 “화면”이나 “핵심 서비스”로 바뀌는 문제를 줄인다.

**실측 검증** — chungnam-mission-app 실제 분석 결과(19개 컴포넌트, `/tmp/chungnam-bundle.json`)의 실제 in-degree 분포:

| id | in-degree | rank | 티어 |
|---|---|---|---|
| location-map-service | 10 | 2 | 핵심 서비스 |
| mission-catalog-service | 10 | 2 | 핵심 서비스 |
| mission-progress-service | 8 | 2 | 핵심 서비스 |
| reward-services | 3 | 2 | 핵심 서비스 |
| verification-reward-service | 3 (out 4) | 1 | 중간 로직 |
| session-store | 6 | 1 | 중간 로직 |
| review-service | 1 | 1 | 중간 로직 |
| (화면 12개) | 0 | 0 | 화면 |

rank 재해석만으로 정확히 화면 12 / 중간 로직 3 / 핵심 서비스 4로 나뉘었다 — 참고 mockup(이전 세션에서 만든 검증용 아티팩트 `chungnam_report.html`의 "이 앱은 무엇으로 이루어져 있는가" 섹션)과 정확히 일치한다. 메커니즘: `verification-reward-service`(rank 1)만 유일하게 핵심 서비스 4개 전부로 나가는 통로라, 화면에서 직접 많이 불리는 서비스들(높은 in-degree)도 rank가 2로 끌어올려진다.

`layout/architectureComposition.ts`의 `computeArchitectureComposition(ir)`는 layer가 있으면 화면/서비스/상태·데이터로 분류하고, 없으면 기존 rank 기반 화면/중간 로직/핵심 서비스 분류를 유지한다.

**예외 처리**:
- flat-graph 폴백: 컴포넌트 간 연결이 거의 없어 `maxRank === 0`이면 3단 분류를 강제하지 않고 단일 그룹으로 반환한다.
- 다중 boundary: `ir.boundaries.length > 1`이면 boundary별로 티어링을 각각 적용한다(참고 mockup의 "여행자 앱"/"관리자 웹" 분리 같은 경우). boundary에 안 감싸인 컴포넌트는 버려지지 않고 "그 외" 그룹으로 남는다.

## 2. 아키텍처 탭 구조 — 서브탭

`ArchitectureView.tsx`가 "프로젝트 지도" 탭 전체를 소유한다. 안에 `[프로젝트 한눈에] [구성요소] [관계 상세]` 서브탭이 있다:

- **프로젝트 한눈에**(기본 진입) — Core coverage 영수증, AI가 고른 주 경로, 런타임별 역할·진입점·로컬 데이터를 일반 DOM으로 보여준다.
- **구성요소** — `ArchitectureComposition.tsx` 카드 그리드.
- **관계 상세** — 컴포넌트를 합치지 않는 런타임 행 × 의미 layer 열의 DOM 지도. HTML 카드가 레이아웃을 소유하고 SVG는 카드 뒤의 연결선만 그린다. 핵심 관계/모든 관계 전환은 노드가 아니라 edge의 읽기 밀도만 바꾼다.

서브탭 전환은 로컬 state만 바꾼다 — 이미 받아온 `AnalysisBundle`을 다시 그릴 뿐 `GET /api/analysis-bundle` 재요청이 없다("탭 전환은 API를 안 부른다"는 v1의 불변을 그대로 지킨다).

## 3. 레거시·Workflow 렌더러 개선 — crossing 최소화 + cycle 방어

`architectureLayout.ts`/`workflowLayout.ts`의 rank 배정은 Sugiyama 레이어드 그래프 알고리즘의 정식 1단계(longest-path layering)를 따르고 있었지만, 같은 rank 안에서 노드를 배치하는 순서는 `list.sort()`(id 알파벳 순)뿐이었다 — crossing reduction(2단계)이 통째로 빠져 있었다. v2에서 추가한 것:

- **barycenter 정렬**: 인접 노드의 평균 위치로 rank 안 순서를 정한다. rank를 왼쪽→오른쪽, 다음 스윕은 오른쪽→왼쪽으로 번갈아 훑고 **한 rank를 옮기자마자 인덱스를 다시 세운다** — 그렇게 안 하면 인접한 두 rank가 서로의 스윕 전 스냅샷만 보고 동시에 뒤집었다 되돌리기를 반복해 수렴하지 않는다(두 rank가 서로 X자로 꼬인 가장 단순한 경우에서 실제로 오실레이션을 확인하고 고쳤다 — `test/architectureLayout.test.mjs`의 barycenter 테스트가 이 케이스를 정확히 재현한다).
- **`architectureLayout.ts`에 cycle 방어 추가**: `workflowLayout.ts`가 이미 하던 DFS back-edge 탐지를 architecture 쪽에도 이식했다.
- **archify `renderers/shared/geometry.mjs` 재검토**: 이 파일은 레이아웃 엔진이 아니라 린터다 — archify는 좌표를 AI가 직접 쓰고, geometry.mjs는 그 결과의 기하학적 결함을 찾아 AI에게 돌려주는 반복 수정 루프용이다. 우리는 A7 원칙상 AI가 좌표를 안 쓰므로 "찾아서 보고"하는 절반은 이식하지 않았다. 대신 순수 기하 판정만 이식해서 렌더러가 "찾아서 스스로 고치는" 데 썼다:
  - `properSegmentIntersection`/`segmentIntersectsRect`를 `edgeRouting.ts`에 이식.
  - `countCrossings`: 실제 라우팅된 엣지 사이의 교차를 센다. **대각선 X자 교차뿐 아니라 같은 통로를 겹쳐 지나가는 경우(`collinearOverlapLength`)도 같이 세야 한다** — 같은 rank 쌍을 잇는 elbow는 기본 midX가 똑같아서 진짜 X자가 아니라 세로 구간이 완전히 겹치는 경우가 더 흔했다(테스트로 직접 확인).
  - `reduceCrossings`: barycenter로 정한 순서를 실제 라우팅된 엣지로 검증해, 인접 두 노드를 스왑했을 때 교차 수가 줄면 받아들이는 로컬 탐색. barycenter는 근사치라 이 검증 단계가 있어야 확실히 줄어든다.
  - `routedPathAvoiding`: rank를 건너뛰는 엣지가 중간 rank의 다른 노드 박스를 가로지르면 세로 구간의 x를 옆으로 밀어 피해간다.
- `workflowLayout.ts`는 rank/lane이 이미 고정된 그리드라 barycenter를 그대로 적용할 자리가 없었다 — 대신 같은 (rank, laneIndex)에 노드가 둘 이상 겹치는 경우(병렬 분기)를 barycenter(연결된 이웃의 평균 laneIndex)로 갈라 배치하는 `laneSlot`을 추가했다(이런 겹침은 v1에서 다뤄지지 않았던 별개의 결함이었다).
- dagre/ELK 같은 외부 레이아웃 라이브러리는 도입하지 않았다 — 이 규모(컴포넌트 10~20개대)에서는 위 추가만으로 충분하고, 이미 확립된 archify 스타일 커스텀 기하학과의 일관성을 유지하는 쪽을 택했다.

## 4. 디자인 토큰

내부 개발 도구이고 v1도 다크 전용이라, 다크 테마를 심화하는 데 집중했다(라이트 테마는 범위 밖).

- **Color**: `--bg`를 더 깊은 네이비(`#0a0c11`)로, boundary 전용 amber 토큰(`--boundary`), 엣지 focus 상태 전용 mint/gray 토큰(`--edge-match`/`--edge-dim`) 추가. `presentationType` 9색은 유지하되 `pt-chip`(구성 개요 카드의 큰 배지)/`pt-chip-mini`(그래프 노드의 작은 배지)로 노출을 키웠다.
- **Layout**: `.viewer-canvas`에 은은한 dot-grid 배경(`radial-gradient` 반복 패턴)을 추가해 그래프 캔버스에 좌표 감각을 줬다. boundary는 기존 파란빛 점선 대신 amber 점선 + 라벨로 바꿨다.
- **Focus 색**: `[data-focus-state="match"]`/`"dim"`인 엣지에 색(mint/gray)을 더했다 — 여전히 종류가 아니라 focus 상태가 근거이므로 기존 I16("색은 종류가 아니라 focus 상태에서만 온다")을 위반하지 않는다.

## 4-1. 관계 상세 v3 — 노드 클러스터링 폐기

초기 v2는 비슷한 이웃을 가진 컴포넌트를 Jaccard 유사도로 합쳐 `×5` 같은 클러스터를 만들었다. 노드 수는 줄었지만 사용자가 알고 싶은 실제 구성요소 이름을 감췄고, 펼칠 때 boundary와 좌표가 다시 계산되면서 런타임 박스가 겹쳤다. 따라서 관계 상세 경로에서는 `architectureClustering.ts`와 `ViewerShell`을 더 이상 사용하지 않는다(유틸리티와 회귀 테스트는 레거시 연구 기록으로 남아 있다).

새 `ArchitectureRelationshipMap.tsx`/`architectureRelationships.ts`의 규칙:

- component는 `component.boundaryId`를 우선해 정확히 한 런타임 행에만 속한다. 레거시 `boundary.wraps`가 중첩돼도 첫 소유권만 택해 경계가 겹치지 않는다.
- 열은 `actor → interface → service → state → data → external` 고정 순서다. 명시적 `component.layer`가 우선이고, 없을 때만 presentation type으로 추정한다.
- 노드는 절대 합치거나 숨기지 않는다. `viewPlan.primaryPath`는 기본 화면에서 표시할 connection만 고르며, “모든 관계”로 즉시 전환할 수 있다.
- 카드 위치는 CSS Grid/일반 HTML이 정한다. `ResizeObserver`가 실제 DOM 박스를 측정한 뒤 SVG edge를 카드 뒤에 그린다. 카드와 라벨은 서로 다른 z-layer이고, 라벨은 열 사이 전용 거터에 놓인다.
- relation label을 누르면 전체 지도를 어둡게 유지한 채 해당 두 컴포넌트와 근거만 큰 모달에 표시한다. component 클릭도 우측 고정 패널 대신 선택 노드와 1-hop 관계만 왼쪽에 남기는 38/62 모달을 쓴다.
- 좁은 화면에서는 페이지 전체가 아니라 관계 지도 내부만 가로 스크롤한다. 모바일 상세 모달은 위(관계 맥락)/아래(정보)로 바뀐다.

Workflow의 sequence label은 축소 맞춤 상태에서도 숨기지 않는다. 클릭하면 별도 고정 패널이 아니라 큰 모달에서 participant card, lifeline, phase band, activation, call/return/event 범례를 가진 시퀀스 다이어그램을 보여준다.

**알려진 한계**: 현재 Core 런타임 탐지는 JS/TS package manifest 중심이며, Python/Java/Go의 실행 단위 탐지는 후속 adapter가 필요하다. `ScenarioParticipant`에는 presentation type이 없어서 Sequence 렌더러는 label을 표시용 type으로만 추정하며 의미 판정에는 사용하지 않는다.

## 유지 / 폐기

**유지**: Workflow의 `computeWorkflowLayout`, `edgeRouting.ts`, `ViewerShell` pan/zoom/finder/radar. Architecture의 과거 rank/clustering 코드는 레거시 테스트와 연구 비교를 위해 남기되 관계 상세 렌더 경로에서는 호출하지 않는다.

**신규**: Core `RepositoryTopology`·completeness gate, data asset Evidence와 `data_import`, `ArchitectureIR.viewPlan/layer`, `ProjectOverview.tsx`, 3단계 서브탭, 런타임×layer 관계 지도, edge/Passport 맥락 모달, Sequence 대형 모달.

**후속**: Sequence participant에 표시용 type/sublabel을 명시적으로 저작하도록 IR을 확장할지 검토한다. 연결이 수백 개인 저장소에서는 primaryPath 외에 도메인/role 필터가 추가로 필요하다.
