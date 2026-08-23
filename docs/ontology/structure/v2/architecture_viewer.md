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
- **관계 상세** — rank/lane SVG 그래프. `ViewerShell` 안에서 pan/zoom/finder/radar를 쓴다. 최초 진입과 0 키는 좌상단 100%가 아니라 전체 내용 맞춤이다.

서브탭 전환은 로컬 state만 바꾼다 — 이미 받아온 `AnalysisBundle`을 다시 그릴 뿐 `GET /api/analysis-bundle` 재요청이 없다("탭 전환은 API를 안 부른다"는 v1의 불변을 그대로 지킨다).

## 3. 렌더러 자체 개선 — crossing 최소화 + cycle 방어

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

## 4-1. 전체 구조 탭 — 구조적 노드 클러스터링

브라우저로 실제 chungnam 데이터를 열어보니 §3의 crossing 최소화·장애물 회피를 다 적용해도 19개 컴포넌트·41개 connection을 전부 그리면 라벨이 겹쳐 한눈에 안 들어왔다. 원인은 렌더러 품질이 아니라 **큐레이션 없이 원본 그래프를 통째로 그린다**는 것이었다 — 구성 개요 탭은 rank 재해석으로 이미 큐레이션돼 있는데 전체 구조 탭만 빠져 있었다.

**처음 시도(반려)**: "같은 tier 안에서 이웃 집합이 완전히 동일한 노드만 합친다"는 exact-match 방식을 생각했지만, 실제 데이터에서 화면들은 공통 서비스 몇 개는 같이 부르면서도 나머지 연결은 조금씩 갈려서 완전히 똑같은 경우가 드물어 대응 범위가 너무 좁다는 지적을 받았다. §2(구성 개요 티어링)는 rank를 재사용할 뿐 새 알고리즘이 필요 없었지만, **클러스터링은 실제로 새로운 그래프 알고리즘이 필요하다** — 다만 AI/스키마가 아니라 순수 그래프 유사도 알고리즘이라는 점은 같다.

**최종 알고리즘 — `layout/architectureClustering.ts`**: `viewPlan.groups`가 있으면 그 의미 그룹을 우선 사용한다. 없는 항목에만 같은 boundary·같은 layer/tier 안에서 Jaccard 유사도(`|A∩B|/|A∪B|`) 0.6 이상인 노드를 자동 클러스터링한다. 서로 다른 앱의 화면이 연결 모양만 비슷하다는 이유로 합쳐지지 않는다. 합친 component와 connection은 원본 `entityRefs/evidenceRefs/traceLinkRefs/role`을 합집합으로 보존한다.

**실측 검증(chungnam 실제 번들)**: 19개 컴포넌트·41개 connection → **9개 노드·10개 connection**으로 줄었다.
- `cluster:screen:1`(화면 9개): `bus-stop-detail, complete-screen, history-screen, home-screen, mission-detail-screen, missions-tab, progress-screen, recommend-screen, verify-screen` — 나머지 화면 3개(`badges-screen`, `ranking-screen`, `agent-showcase`)는 이웃 집합이 충분히 달라 threshold 미달로 남았다.
- `cluster:core:0`(핵심 서비스 3개): `location-map-service, mission-catalog-service, mission-progress-service` — 거의 같은 화면 집합에서 호출받아 유사도가 높았다. `reward-services`는 호출 경로가 달라 남았다.
- exact-match였다면 이 정도 축소는 나오지 않았을 것 — threshold 기반 유사도가 실제로 필요했다는 게 이 실측으로 확인됐다.

**펼치기(확정: 전체 구조 안에서 바로 펼치기)**: `ArchitectureGraph`가 `expandedMemberIds: Set<string>`(원본 컴포넌트 id, 클러스터 id 아님) 로컬 state를 갖는다. 렌더링마다 `computeClusteredArchitectureIR(ir, { excludeFromClustering: expandedMemberIds })`를 다시 호출 — 이미 펼친 컴포넌트는 유사도 계산에서 빠져 원본 그대로 나온다. 클러스터 노드 클릭 시 그 클러스터의 원본 멤버 id를 `expandedMemberIds`에 더한다(클러스터 id 자체가 재호출마다 바뀔 수 있어 안정적인 원본 id로 추적한다). 접기는 그룹별이 아니라 "펼친 항목 접기" 버튼 하나로 전체를 되돌린다(단순화). 클러스터 노드는 클릭해도 `onSelectComponent`(Passport 패널)를 열지 않는다 — 클러스터는 특정 컴포넌트가 아니므로 펼쳐서 개별 노드가 나온 뒤에만 동작한다. 전부 로컬 state라 API 재요청이 없다("탭 전환은 API를 안 부른다"가 "펼치기/접기도 API를 안 부른다"로 확장).

**알려진 한계**: `ViewerShell`의 찾기는 원본 컴포넌트 목록 전체를 검색한다. 접힌 클러스터 안의 항목을 선택하면 아직 자동으로 그룹을 펼치지 못한다. 또한 현재 Core 런타임 탐지는 JS/TS package manifest 중심이며, Python/Java/Go의 실행 단위 탐지는 후속 adapter가 필요하다.

## 유지 / 폐기

**유지**: `computeArchitectureLayout`/`computeWorkflowLayout`의 rank 계산 골격, `edgeRouting.ts`의 port-spread·elbow 라우팅·라벨 겹침 해소, `ViewerShell`의 pan/zoom/finder/radar, Passport 패널 연결(변경 없음).

**신규(이번 v2)**: Core `RepositoryTopology`·completeness gate, data asset Evidence와 `data_import`, `ArchitectureIR.viewPlan/layer`, `ProjectOverview.tsx`, 3단계 서브탭, 내용 맞춤 캔버스, 근거를 보존하는 boundary-safe 클러스터링, 실제 우회 경로 기준 edge label 배치.

**후속(다음 v2 단계, 아직 안 함)**: Workflow/Sequence 뷰어의 시각적 리디자인 — 이번 패스는 아키텍처 뷰어에 한정했다. `ViewerShell` 찾기(finder)가 접힌 클러스터 안의 노드를 자동으로 펼쳐서 포커스하도록 하는 것(§4-1의 "알려진 한계" 참고).
