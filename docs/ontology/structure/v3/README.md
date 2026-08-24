# Ontology Structure V3 — 증분 분석과 통합 지도

## 문서 상태

- 상태: 구현 진행 중
- 기준 구현: `docs/ontology/structure/v2`
- 대상: 다음 대규모 분석 런타임·UX 개편
- 원칙: V2.x 문서는 당시 구현의 기록으로 동결하고, 이후 결정과 변경은 이 디렉토리에만 기록한다.

V3는 서로 연결되지만 독립적으로 검증할 수 있는 두 축으로 나눈다.

1. [분석 런타임](./analysis_runtime.md): 검증 재시도, 세션 수명, 토큰 계측, 증분 Assembly를 개선한다.
2. [통합 지도](./unified_map.md): 프로젝트 지도와 사용자 지도의 탭을 없애고 시스템 구조와 사용자 여정을 한 화면에서 연결한다.

## V2.x 기준선

V2.x에서 확보한 것은 유지한다.

- Core가 탐지한 `RepositoryTopology`와 런타임·로컬 데이터 완전성 검사
- 런타임 행 × 의미 layer 열의 관계 상세 지도
- 백엔드/API 교체 지점, 방향이 명시된 edge, 보수적인 Sequence 연결
- Canonical Scenario마다 하나의 `UserMapIR.journey`
- 대표 경로와 분기·재시도·상태 변화
- 노드·단계·edge에서 실제 Evidence를 여는 모달

V3는 이 데이터를 다시 발명하지 않는다. 분석 결과의 source of truth는 계속 Core의 Evidence,
Semantic Memory, RepositoryTopology, AnalysisBundle이다. 바꾸는 것은 분석 세션의 수명과
AnalysisBundle 갱신 단위, 그리고 사용자가 결과를 읽는 정보 구조다.

## 핵심 결정

### D1. 복구 가능한 검증 실패와 분석 실패를 구분한다

`submit_analysis_bundle`이 진단을 반환하고 같은 turn에서 고쳐 재제출한 경우는 파이프라인
실패가 아니다. UI와 이벤트 모델은 이를 `자동 보정`으로 표현한다. 재시도 끝에도 유효한
Bundle이 없거나 turn 자체가 종료된 경우만 분석 실패로 취급한다.

### D2. 분석 정확성을 대화 이력에 의존하지 않는다

분석용 agent 세션은 Core 상태의 독자가 되어야 한다. 이전 분석 대화를 계속 resume해서
정확성을 유지하지 않는다. 필요한 과거 정보는 Core가 버전과 diff가 있는 입력으로 제공한다.

### D3. 재분석은 전체 재생성보다 영향 범위 패치를 우선한다

Repository re-index와 Semantic Memory reconciliation은 유지하되, Assembly는 변경된
component, connection, journey, sequence만 다시 구성하는 것을 기본 경로로 한다. 전체
Assembly는 첫 분석, IR 버전 변경, 무결성 복구 같은 명시적 조건에서만 실행한다.

### D4. 두 지도를 단순히 쌓지 않고 상호 강조한다

상단 시스템 구조와 하단 사용자 여정은 같은 Evidence·Concept 참조를 통해 연결된다. 한쪽의
노드나 단계를 선택하면 다른 쪽의 관련 항목을 강조한다. 이것이 탭 제거의 제품적 이유다.

### D5. `먼저 읽을 흐름`은 별도 섹션에서 제거한다

`architecture.viewPlan.primaryPath`는 실행 흐름이나 사용자 여정이 아니라 비전공자를 위한
설명 순서였다. 통합 지도에서는 별도 카드 줄로 노출하지 않고 시스템 지도의 선택적
`핵심 관계` 추천 탐색 순서로만 사용한다.

## 구현 순서 제안

1. 분석 이벤트와 토큰 계측을 고쳐 현재 비용과 재시도 원인을 정확히 보이게 한다.
2. 분석 세션 정책을 대화형 세션과 분리하고 Stage별 수명을 명시한다.
3. Assembly preflight와 부분 패치 계약을 도입한다.
4. 기존 프로젝트/사용자 탭을 하나의 스크롤 화면으로 합친다.
5. 사용자 여정의 대표 경로 아래에 분기·루프를 직접 연결한다.
6. 시스템 구조 ↔ 사용자 여정 상호 강조를 연결한다.
7. 실제 대형·소형 저장소와 좁은 화면에서 회귀 검증한다.

분석 런타임 변경은 UI 개편보다 먼저 착수하는 것을 권장한다. 잘못된 사용량 계측과 누적
세션을 그대로 둔 상태에서는 UX 검증을 반복할수록 비용과 결과 변동성이 커지기 때문이다.

## 공통 비목표

- Vibee가 픽셀 좌표를 생성하게 하지 않는다.
- Evidence 없이 새 연결이나 사용자 단계를 만들지 않는다.
- 모든 edge를 Sequence로 펼치지 않는다.
- V2.x 레거시 Bundle을 다시 커밋하거나 자동 변환하지 않는다.
- 탭을 없앤다는 이유로 모든 상세 정보를 초기 화면에 동시에 펼치지 않는다.

## 완료 조건

V3는 다음 조건을 모두 만족할 때 완료로 본다.

- 동일 프로젝트의 연속 재분석에서 agent 대화 이력이 무제한 누적되지 않는다.
- UI가 Stage별 실제 토큰과 캐시 사용량을 합산해 표시한다.
- 복구 가능한 검증 재시도가 최종 오류처럼 보이지 않는다.
- 작은 코드 변경에서 영향받지 않은 AnalysisBundle 영역이 재생성되지 않는다.
- 시스템 구조와 사용자 여정을 탭 전환 없이 한 화면에서 탐색할 수 있다.
- 사용자 여정의 분기와 재시도가 발생 단계에 시각적으로 연결된다.
- 시스템 노드와 사용자 단계가 Evidence/Concept 기반으로 양방향 강조된다.

## 구현 현황 — 2026-08-24 1차 슬라이스

완료:

- Semantic/Assembly/온디맨드 View가 프로젝트별 누적 대화를 resume하지 않도록 Stage 시작 전
  세션 포인터를 분리했다. 사용자 chat 세션 정책은 유지한다.
- provider 사용량을 `StageUsage`로 정규화하고 같은 turn의 누적 알림은 대체, 서로 다른
  Semantic/Assembly turn은 합산하도록 바꿨다. Claude cache read/create도 보고된 경우 보존한다.
- AnalysisBundle Validator 거절을 `validation.retrying`으로 분류하고, 최종 커밋이 있으면 자동
  보정 횟수와 generation을 함께 남긴다. Assembly turn이 Bundle 없이 끝나면 성공으로 처리하지
  않는다.
- Assembly prompt에 `workflow.mainPath`의 모든 인접 node 쌍이 실제 edge로 연결돼야 한다는
  preflight 규칙을 명시했다.
- 프로젝트 지도/사용자 지도 상위 탭과 Architecture 하위 3개 탭을 기본 렌더 경로에서 제거했다.
- 시스템 관계 지도 → 사용자 여정 순서의 한 화면을 구현하고, 메인 탐색을 방해하던 coverage
  strip과 sticky anchor navigation은 제거했다. 분석 범위 데이터 자체는 Bundle에 보존한다.
- `viewPlan.primaryPath`를 별도 `먼저 읽을 흐름`이 아니라 `핵심 관계`의 `추천 01` 순번
  강조로 바꿨다. 실제 실행 순서가 아니라는 설명도 지도 안에 표시한다.
- 사용자 여정 선택기를 compact하게 바꾸고 대표 경로·분기·재시도를 하나의 스크롤 좌표계에
  배치했다. 카드 DOM을 실측해 SVG branch/loop 선과 화살표를 연결한다.
- component/step/journey의 exact Evidence·Concept·Entity ref 교집합으로 양방향 강조를 연결했다.
- 전역 헤더의 강조 해제 버튼을 시스템 관계 지도 툴바로 옮기고 `Esc` 해제를 지원한다.
- 1280×720 및 390×844 브라우저 검증에서 body 가로 overflow가 없음을 확인했다.

남은 작업:

- MCP 두 증거원을 안정적인 `toolCallId`로 합쳐 호출 횟수별 한 줄 요약과 배선 이상 상태를 만든다.
- cache write를 제공하지 않는 provider의 `unknown` 표시와 분석 완료 후 영구 사용량 UI를 다듬는다.
- `PreviousBundleDigest`, batch retrieval, `BundleImpactSet`, `AnalysisBundlePatch` 계약을 구현한다.
- 분기가 많은 여정에서 SVG lane 충돌 회피와 loop arc 곡률을 고도화한다.
- runtime/layer/role/search 필터와 URL 기반 focus 상태, modal focus trap을 구현한다.
