# Architecture Viewer v2 — 구성 개요 탭 + 시각화 리디자인

이 문서는 [ontology_schema3.md](../v1/ontology_schema3.md)(v1)가 확정한 파이프라인·IR 위에서, 시각화(View 레이어)만 다시 설계한 기록이다. 분석 파이프라인(Evidence → Semantic Memory → Assembly)은 이번 개정에서 건드리지 않는다 — 실전 검증(chungnam-mission-app 실제 분석)으로 이미 확인됐고, 문제는 그 결과를 "전부 펼쳐서 보여주기만 하는" 시각화 쪽이었다.

## 배경

v1의 아키텍처 탭은 `AnalysisBundle.architecture.components`를 전부 한 그래프에 펼치기만 했다. 원래 목표(`ontology_schema3.md` §1)였던 "비전공자가 한눈에 이해"를 그래프 하나로는 달성하지 못했다 — 19개 컴포넌트짜리 그래프는 전공자에게도 한눈에 안 들어온다.

## 1. 구성 개요 티어링 — 새 알고리즘이 아니라 rank의 재해석

`layout/architectureLayout.ts`의 `computeArchitectureLayout()`은 v1부터 이미 결정론적 `rank`(root로부터의 최장 경로)를 계산하고 있었다 — 그래프 뷰의 컬럼 위치를 정하는 데만 썼을 뿐이다. v2는 이 `rank`를 큐레이션 축으로 재해석한다: rank 0(아무도 의존하지 않는 진입점)은 "화면", rank 1은 "중간 로직", rank 2 이상은 전부 "핵심 서비스"로 묶는다(3단계로 캡).

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

**View 레이어 전용** — Stage 3(Assembly)/스키마는 건드리지 않는다. `layout/architectureComposition.ts`의 `computeArchitectureComposition(ir)`가 `computeArchitectureLayout`을 내부에서 호출해 rank를 얻고 화면/중간 로직/핵심 서비스로 재분류할 뿐이다.

**예외 처리**:
- flat-graph 폴백: 컴포넌트 간 연결이 거의 없어 `maxRank === 0`이면 3단 분류를 강제하지 않고 단일 그룹으로 반환한다.
- 다중 boundary: `ir.boundaries.length > 1`이면 boundary별로 티어링을 각각 적용한다(참고 mockup의 "여행자 앱"/"관리자 웹" 분리 같은 경우). boundary에 안 감싸인 컴포넌트는 버려지지 않고 "그 외" 그룹으로 남는다.

## 2. 아키텍처 탭 구조 — 서브탭

`ArchitectureView.tsx`가 "아키텍처" 탭 전체를 소유한다. 안에 `[구성 개요] [전체 구조]` 서브탭이 있다:

- **구성 개요**(기본 진입) — `ArchitectureComposition.tsx`, 카드 그리드. `ViewerShell`(SVG pan/zoom) 밖의 일반 DOM이다 — 스크롤 가능한 카드 리스트가 이 매체에 맞다.
- **전체 구조** — 기존 rank/lane SVG 그래프(`ArchitectureGraph`, `ArchitectureView.tsx` 내부). `ViewerShell` 안에서 pan/zoom/finder/radar를 그대로 쓴다.

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

## 유지 / 폐기

**유지**: `computeArchitectureLayout`/`computeWorkflowLayout`의 rank 계산 골격, `edgeRouting.ts`의 port-spread·elbow 라우팅·라벨 겹침 해소, `ViewerShell`의 pan/zoom/finder/radar, Passport 패널 연결(변경 없음).

**신규(이번 v2)**: `layout/architectureComposition.ts`, `components/ArchitectureComposition.tsx`, `ArchitectureView.tsx`의 서브탭 구조, `edgeRouting.ts`의 crossing 최소화/장애물 회피, `workflowLayout.ts`의 `laneSlot`.

**후속(다음 v2 단계, 아직 안 함)**: Workflow/Sequence 뷰어의 시각적 리디자인 — 이번 패스는 아키텍처 뷰어에 한정했다.
