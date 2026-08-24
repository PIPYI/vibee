# 통합 지도 V3 — 시스템 구조와 사용자 여정 한 화면

> 구현 메모(2026-08-24): 탭 없는 통합 정보 구조, compact coverage, `처음 보기`, compact
> journey selector, 발생 step 아래 분기, exact ref 기반 양방향 강조를 1차 구현했다. 분기선의
> DOM 실측 SVG routing, 고급 필터, URL focus, modal focus trap은 후속 작업이다. 세부 상태는
> [README 구현 현황](./README.md#구현-현황--2026-08-24-1차-슬라이스)을 따른다.

## 1. 목표

프로젝트 지도와 사용자 지도 탭을 제거하고, 비전공자가 한 화면에서 다음 두 질문을 이어서
답할 수 있게 한다.

1. 이 프로젝트는 어떤 실행 단위·화면·서비스·데이터로 이루어져 있는가?
2. 사용자는 이 구조를 통해 어떤 목적을 어떤 단계로 달성하는가?

단순히 기존 화면 두 개를 세로로 붙이는 것이 목표가 아니다. 시스템 구조와 사용자 여정을
Evidence·Concept 기반으로 연결해 한쪽의 선택이 다른 쪽을 설명하게 한다.

## 2. 정보 구조

```text
프로젝트 제목 · 분석 상태 · 다시 분석
┌─────────────────────────────────────────────────────────┐
│ 분석 범위 strip                                        │
│ 실행 단위 2/2 · 로컬 데이터 2/2 · 구성요소 11 · 최신 │
└─────────────────────────────────────────────────────────┘

시스템 구조
┌─────────────────────────────────────────────────────────┐
│ 관계 상세 지도                                         │
│ runtime boundary × actor/interface/service/state/data  │
└─────────────────────────────────────────────────────────┘

사용자 여정
┌─────────────────────────────────────────────────────────┐
│ 여정 선택                                               │
│ 대표 경로 한 줄 + 발생 단계 아래의 분기·루프          │
└─────────────────────────────────────────────────────────┘
```

페이지가 길어지므로 데스크톱에서는 `시스템 구조 / 사용자 여정` 앵커를 가진 작은 sticky
내비게이션을 허용한다. 이는 내용을 숨기는 탭이 아니라 같은 문서 안의 위치 이동이다.

## 3. V2.x 화면의 유지·흡수·폐기

| V2.x 요소 | V3 처리 | 이유 |
|---|---|---|
| 프로젝트 지도/사용자 지도 상위 탭 | 폐기 | 구조와 행위를 분리하지 않음 |
| 프로젝트 한눈에 | 별도 화면 폐기 | 관계 상세와 내용 중복 |
| 분석 범위 확인 | 상단 compact strip으로 유지 | AI 생략 여부를 숨기지 않음 |
| 먼저 읽을 흐름 | 별도 섹션 폐기 | 실제 흐름·사용자 여정으로 오해 가능 |
| `viewPlan.primaryPath` | `처음 보기` 강조에 재사용 | 비전공자 온보딩 기능은 유지 |
| 구성요소 카드 그리드 | 노드 상세 모달로 흡수 | 같은 구성요소를 두 번 나열하지 않음 |
| 관계 상세 | 시스템 구조의 메인 시각화 | 가장 많은 실제 관계를 보존 |
| 여정 한눈에 카드 | compact selector로 유지 | 목적 선택 필요 |
| 대표 경로 | 여정 그래프의 spine으로 유지 | 목표까지의 기본 흐름 |
| 다른 경로 카드 섹션 | 폐기 | 발생 위치와 분리돼 의미 파악이 어려움 |
| 단계/edge/Sequence 모달 | 유지·연결 강화 | progressive disclosure |

## 4. `먼저 읽을 흐름`의 의미

V2.x의 `architecture.viewPlan.primaryPath`는 런타임 실행 순서나 사용자 행동 순서가 아니다.
복잡한 아키텍처에서 비전공자가 먼저 볼 3~7개의 거시 component를 vibee가 고른 설명
순서다.

V3에서는 데이터는 유지하되 다음처럼 표현한다.

- 기본 시스템 지도는 전체 관계를 사실대로 표시한다.
- `처음 보기`를 켜면 primaryPath 노드에 1, 2, 3 순번을 붙인다.
- 관련 edge만 강조하고 나머지는 흐리게 한다.
- UI 문구는 `추천 탐색 순서`처럼 실행 흐름과 구분되는 표현을 사용한다.
- 사용자 여정의 대표 경로와 같은 선형 컴포넌트로 렌더하지 않는다.

## 5. 시스템 구조 섹션

기존 `ArchitectureRelationshipMap`의 원칙을 메인 화면으로 승격한다.

### 5.1 레이아웃

- 행: 독립 실행 runtime boundary
- 열: actor → interface → service → state → data → external
- 카드: 하나의 Architecture component, 합치거나 `×N`으로 축약하지 않음
- 연결: SVG가 카드 뒤에서 그리고 DOM 카드가 위치를 소유
- 좁은 화면: 페이지가 아니라 지도 내부만 가로 스크롤

### 5.2 상단 도구

- `처음 보기` / `전체 관계`
- runtime 필터
- layer 필터
- 관계 role 필터: 호출, 비동기, 데이터, 제어
- 검색
- 범례

필터는 노드를 제거해 레이아웃을 크게 흔들기보다 기본적으로 비관련 항목을 흐리게 한다.
사용자가 명시적으로 `선택 항목만 보기`를 켰을 때만 재배치한다.

### 5.3 색과 기호

| 의미 | 표현 |
|---|---|
| runtime/data boundary | amber 점선 |
| interface | cyan |
| service | mint |
| state/data | violet |
| external | gray |
| API·백엔드 교체 접점 | green accent + `교체 지점` 배지 |
| 동기 호출 | 실선 화살표 |
| 비동기 | 점선 화살표 |
| 데이터 이동 | green 화살표 |
| 제어/인증 | amber 또는 red 화살표 |
| Sequence 가능 | `SEQ` 배지 |

모든 방향성 connection에는 화살촉을 표시한다. 선 종류와 색은 role을 뜻하며 화살촉 유무에
별도 의미를 부여하지 않는다.

### 5.4 상세 열기

- component 클릭: 선택 component와 1-hop 관계를 남기고 설명·근거가 큰 모달을 차지
- edge label 클릭: 양 끝 component와 relation 근거 표시
- `SEQ` 클릭: 보수적으로 연결된 기존 Sequence 모달 표시
- 모달을 닫으면 지도 위치와 필터 상태 복원

## 6. 사용자 여정 섹션

### 6.1 여정 선택

기존 큰 카드 그리드를 compact selector로 줄인다.

- 사용자 여정과 시스템 흐름을 색·아이콘으로 구분
- 이름, 목표, 단계 수, 결과만 표시
- 한 번에 하나의 여정을 펼침
- 전체/사용자/시스템 필터 유지

여정이 많으면 가로 chip 나열보다 검색 가능한 좌측 selector 또는 combobox를 사용한다.

### 6.2 대표 경로와 분기의 통합

대표 경로는 한 줄의 spine으로 배치한다.

```text
[진입] → [미션 선택] → [수행] → [인증] → [보상]
                         │          └─ 실패 → [재시도] ─┐
                         └─ 취소 → [목록 복귀]          │
                                      └─────────────────┘
```

분기 배치 규칙:

1. 대표 경로의 각 step에 rank를 부여한다.
2. 대표 경로 밖 transition은 source step의 바로 아래 lane에서 시작한다.
3. forward branch는 도착 step rank까지 아래 lane으로 진행한다.
4. loop는 출발과 복귀 step을 감싸는 되돌림 arc로 그린다.
5. 여러 branch가 겹치면 짧은 branch를 위 lane, 긴 branch를 아래 lane에 둔다.
6. 카드 높이와 라벨을 측정한 뒤 connector를 그린다.
7. branch 전용 카드 목록을 별도로 만들지 않는다.

### 6.3 여정 표현 체계

| 종류 | 색/기호 | 의미 |
|---|---|---|
| 대표 경로 | cyan/mint 실선 | 목표까지의 기본 경로 |
| 선택 분기 | violet `◇` | 사용자 또는 조건에 따른 선택 |
| 실패/예외 | amber `!` | 정상 경로를 벗어난 조건 |
| 재시도 | amber 점선 `↺` | 이전 단계로 되돌아감 |
| 시스템 자동 단계 | gray/mint gear | 사용자 행동 없이 처리 |
| 결과 단계 | filled accent + check | journey outcome |
| 코드 호출 가능 | `호출 보기` 배지 | exact evidence로 연결된 Sequence |

색만으로 의미를 구분하지 않는다. 아이콘, 선 패턴, 텍스트 범례를 함께 사용한다.

### 6.4 반응형

- 넓은 화면: 대표 경로 가로, branch는 아래 lane
- 중간 화면: 여정 캔버스 내부 가로 스크롤
- 모바일: 대표 경로를 세로 spine으로 전환하고 branch는 오른쪽으로 펼침
- body 전체에는 가로 overflow를 만들지 않음

## 7. 시스템 구조 ↔ 사용자 여정 연결

통합 화면의 핵심 상호작용이다.

### 7.1 연결 근거

직접적인 새 추론을 만들지 않고 기존 참조의 교집합을 사용한다.

우선순위:

1. exact `evidenceRefs` 교집합
2. `conceptRefs`와 component의 Semantic Concept 연결
3. Sequence message evidence와 Architecture connection의 `traceLinkRefs` 교집합
4. entity/evidence를 통한 결정적 1-hop 연결

라벨 유사도만으로 연결하지 않는다. 연결 근거가 없으면 상호 강조도 하지 않는다.

### 7.2 상호작용

- 시스템 component 선택 → 관련 journey selector와 step을 강조
- Architecture edge 선택 → 관련 transition과 Sequence 배지 강조
- journey 선택 → 관련 runtime boundary와 component를 약하게 강조
- journey step 선택 → 관련 component/connection만 강하게 강조
- Sequence 모달 → 시스템 edge와 사용자 transition의 공통 기술 상세로 열림

강조 상태는 URL 또는 로컬 view state로 표현해 뒤로 가기와 모달 닫기 후 복원할 수 있게 한다.

### 7.3 미연결 상태

근거가 없는 경우 억지로 선을 만들지 않는다.

```text
이 단계와 직접 연결된 시스템 구성요소를 코드 근거에서 찾지 못했습니다.
```

이는 분석 실패가 아니라 현재 Evidence의 한계를 정직하게 보여주는 상태다.

## 8. 모달과 정보 밀도

다이어그램 옆에 고정된 좁은 패널을 두지 않는다. 선택 시 배경 지도를 유지하면서 정보 모달이
더 큰 영역을 차지한다.

- 데스크톱: 맥락 38% / 상세 62%
- 모바일: 위쪽 맥락 / 아래쪽 상세
- Evidence file:line과 source excerpt 제공
- 관련 단계·component로 모달 안에서 이동
- Esc 닫기, focus trap, 원래 선택 요소로 focus 복원
- 모달을 열어도 캔버스 zoom/scroll 상태를 보존

## 9. 데이터와 렌더러 책임

### Core/Assembly

- ArchitectureIR, UserMapIR, SequenceIR의 사실과 설명을 만든다.
- Evidence와 Canonical Scenario 불변식을 검증한다.
- 픽셀 좌표는 만들지 않는다.

### Web projection

- `primaryJourneyPath` 계산
- branch lane과 loop arc 계산
- component↔step exact reference index 계산
- DOM 측정 후 connector routing
- 필터, focus, dim, 모달 상태 관리

상호 강조를 위해 새로운 영속 IR을 바로 추가하지 않는다. 우선 Web에서 기존 ref를
결정적으로 투영하고, 성능이나 설명 가능성 문제가 확인될 때만 Core index 승격을 검토한다.

## 10. 접근성·성능

- 모든 노드와 edge action을 키보드로 접근 가능하게 한다.
- 선을 클릭하기 어려운 사용자를 위해 동일한 관계 목록을 모달 안에 제공한다.
- 색, 패턴, 아이콘, 텍스트를 함께 사용한다.
- `prefers-reduced-motion`에서는 강조 전환 애니메이션을 제거한다.
- 대형 지도는 `ResizeObserver` 측정과 edge routing을 animation frame 단위로 batch한다.
- 선택되지 않은 journey 상세는 렌더하지 않는다.
- 노드 수가 큰 경우에도 DOM 카드 identity와 focus가 재배치 중 유지돼야 한다.

## 11. 수용 기준

1. 프로젝트 지도/사용자 지도 상위 탭이 없다.
2. 초기 화면에 시스템 구조와 사용자 여정의 존재가 모두 보인다.
3. `프로젝트 한눈에`와 `구성요소`의 별도 중복 화면이 없다.
4. RepositoryTopology coverage는 compact strip으로 유지된다.
5. `먼저 읽을 흐름`은 별도 섹션이 아니며 `처음 보기` 강조로만 사용된다.
6. 대표 경로와 branch/loop가 하나의 여정 캔버스에 연결된다.
7. branch는 실제 source step 아래에서 시작하며 별도 카드 섹션에 복제되지 않는다.
8. 시스템 component 선택이 근거 기반 관련 journey step을 강조한다.
9. journey step 선택이 근거 기반 관련 component를 강조한다.
10. 근거 없는 항목은 억지로 연결하지 않는다.
11. 1280×720과 모바일 폭에서 body 가로 overflow가 없다.
12. 모달을 닫으면 기존 지도 위치·필터·focus가 복원된다.
13. Sequence 연결은 V2.x의 보수적인 exact-evidence 기준을 유지한다.
14. 키보드만으로 지도 탐색, 상세 열기, 닫기가 가능하다.

## 12. 검증 시나리오

### 소형 단일 런타임

- 5~8 component
- 사용자 journey 1개
- branch 없음
- 불필요한 빈 섹션이나 과도한 캔버스 높이가 없어야 한다.

### 다중 런타임과 로컬 데이터

- 모바일 앱 + 관리자 웹
- 각 runtime의 로컬 JSON store
- boundary가 겹치지 않고 교체 지점이 구분돼야 한다.

### 분기와 재시도

- 대표 경로 5~8 step
- forward branch 2개
- retry loop 1개
- branch label과 선이 step card를 가리지 않아야 한다.

### 대형 프로젝트

- component 30개 이상
- journey 10개 이상
- 선택·필터 전에는 정보 밀도를 제어하고, 검색 후 관련 항목을 잃지 않아야 한다.

### 레거시 Bundle

- `userMap` 없음
- Web의 읽기 전용 projection으로 표시
- 분석 상태를 미래 시점 문구로 오해시키지 않고 현재 데이터 한계를 설명해야 한다.
