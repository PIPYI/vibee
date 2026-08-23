# Someday — 지금 당장 하지 않는 파이프라인/스키마 아이디어

이 문서는 "지금은 안 건드리지만 나중에 판단해볼" 항목만 모아둔다. v2(현재 진행 중, `docs/ontology/structure/v2/`)는 시각화(View 레이어)만 건드리고, 여기 적힌 항목은 전부 Stage 3 프롬프트·IR 스키마·validator처럼 분석 파이프라인 자체를 건드리는 것들이라 별도 확인 없이 착수하지 않는다.

## 1. Stage 3가 boundary를 하나만 만든다

`apps/bridge/src/prompt.ts`의 7단계 조립 지시(`buildAssemblyPrompt`) 중 `architecture.components`(3번), `architecture.connections`(4번), `workflow.nodes/edges`(5번)는 만들라고 명시하지만 `boundaries`는 단 한 번도 언급되지 않는다. 에이전트 입장에서는 "묶어서 표시할 boundary를 몇 개로 어떻게 나눠라"라는 기준 자체를 받은 적이 없으니, 스키마상 `boundaries: []`가 비어있으면 안 되니까(빈 배열이면 시각적으로 아무 것도 안 감싸짐) 가장 안전한 선택인 "전체를 감싸는 boundary 1개"로 수렴한 것으로 보인다. `ArchitectureBoundary.kind`도 스키마에 고정 enum이 없는 `string`이라 에이전트가 참고할 예시값조차 없었다.

**우선순위가 낮아진 이유**: v2에서 View 레이어가 `computeArchitectureLayout`의 rank를 재해석해 "구성 개요" 탭(화면/중간 로직/핵심 서비스)을 스키마 변경 없이 만들어냈다 — boundary가 여러 개여야만 얻을 수 있던 "구조를 나눠서 보여주기"라는 목적을 이미 View 레이어에서 스키마 변경 없이 달성했다. 그래서 Stage 3 프롬프트를 고쳐 boundary를 여러 개 만들게 하는 건 더 이상 급하지 않다. 다만 진짜 물리적으로 분리된 런타임(예: 여행자 앱과 관리자 웹처럼 서로 다른 배포 단위)이 있는 프로젝트에서는 여전히 boundary가 그 경계를 표현하는 유일한 수단이라, 그런 사례가 나오면 재검토한다.

## 2. `connection.role`이 항상 비어 있다

`role?: "sync" | "async" | "data" | "control"`은 원래 optional 필드인데, Stage 3 조립 프롬프트의 4번 지시("connections를 만든다 — traceLinkRefs에 ... 넣는다")는 `traceLinkRefs`만 언급하고 `role`은 아예 안 나온다. 그러니 에이전트가 채울 이유가 없었고, 결과적으로 `ArchitectureView.tsx`의 `.arch-edge-async`/`.arch-edge-data`/`.arch-edge-control` 스타일(role 기반 엣지 스타일링)을 넣어놔도 실전에서는 전부 `undefined`라 아무 시각적 구분이 안 생기는 상태다.

문제냐 아니냐: validator가 깨지거나 크래시 나는 건 아니다(optional/스키마상 허용). 다만 스키마에 정의해둔 표현 기능이 실제로는 죽은 필드가 되어 있는 상태 — "설계는 했는데 프롬프트가 안 시켜서 안 씀"이다. `presentationType` 쏠림(아래 3번)과 달리 이건 프로젝트 특성 문제가 아니라 순수 프롬프트 공백이다.

**제안**: `ASSEMBLY_RULES`에 "connection.role은 동기 호출인지 비동기/이벤트인지 데이터 참조인지 판단해서 채워라" 같은 지시를 추가하면 바로 개선될 가능성이 높다.

## 3. `presentationType`이 client-only 프로젝트에서 frontend/unknown으로만 쏠린다

실제 chungnam-mission-app 실행에서 19개 컴포넌트 중 13개가 frontend, 6개가 unknown, backend/database가 0개였다. 이 프로젝트가 실제로 클라이언트 전용(백엔드 없이 로컬 JSON+메모리 스토어) 앱이라 어느 정도는 사실을 반영한 결과지만, "unknown"이 실질적으로 "로직/서비스"를 대신 표현하고 있어 분류 정밀도가 낮다.

**제안**: Stage 3 프롬프트에 `unknown`을 쓰기 전에 로컬 상태 관리/도메인 로직 계층인지 먼저 판단하도록 유도하는 문구 추가를 검토한다.

## 4. `phase` 축 — AI가 흐름의 국면을 직접 부여하는 새 의미 필드

"1단계: 인증", "2단계: 결제"처럼 흐름의 국면(phase)을 매기는 축은 v2의 rank 기반 티어링(화면/중간 로직/핵심 서비스, 구조적 중심성)과는 다른 축이다. role(`presentationType`)은 이미 존재하고 그래프 구조와 무관하게 AI가 채우지만, phase는 그래프 구조만으로는 절대 도출할 수 없다 — "이 컴포넌트 묶음이 결제 여정에 속한다"는 건 Stage 2 Semantic Memory/CanonicalScenario 이해가 있어야만 알 수 있다.

**스펙 초안**:
- `WorkflowPhase[]`(신규 컬렉션) — `{ id: string; label: string; order: number }`.
- `WorkflowNode`/`ArchitectureComponent`에 `phaseRef?: string` 필드 추가.
- Stage 3 프롬프트에 phase 배정 지시 추가, validator에 `phaseRef`가 실재하는 `WorkflowPhase.id`를 가리키는지 검증 추가.
- 기존 chungnam 번들을 포함해 이미 커밋된 generation은 phase 데이터가 없으므로 재분석이 필요하다.

**나중에 결합 가능한 지점**: rank 기반 티어(구조적 중심성)와 phase(비즈니스 흐름 단계)는 서로 다른 축이므로, phase가 생기면 "열 = phase, 행 = 티어"처럼 구성 개요 카드 그리드를 2차원으로 확장할 수 있다.

## 5. 전체 구조 탭 — AI가 거시적 레이아웃(맵)을 직접 설계

v2 §4-1에서 뷰 레이어 클러스터링(Jaccard 유사도 + Union-Find)으로 노드 수는 크게 줄였지만(chungnam 실측 19→9), 사용자는 여전히 전체 구조 탭의 결과물에 만족하지 못했다 — "결국 AI가 전체적인 맥락 기반으로 전체 구조를 지도처럼 설계하게 해야 할 것 같다"는 방향(archify 방식 차용)을 다시 제안했다.

archify는 AI가 컴포넌트마다 `pos`/`size`(픽셀 좌표)를 직접 쓰고, `geometry.mjs`(린터)가 결과의 기하학적 결함(교차·겹침·라벨 충돌)을 찾아 AI에게 돌려주는 반복 수정 루프로 다듬는다. 우리 시스템은 A7 원칙(IR에 좌표를 두지 않고 렌더러가 결정론적으로 배치)을 지키고 있고, 이번 세션에서 이미 세 차례(barycenter, archify geometry.mjs 재검토, AI-phase 하이브리드 제안) 이 원칙을 재확인했다. AI가 좌표를 직접 쓰게 하려면:

- Stage 3 프롬프트가 `pos`/`size`(또는 최소한 "이 컴포넌트들을 하나의 그룹/맵 영역으로 묶어라" 같은 거시적 배치 힌트)를 만들도록 지시해야 하고,
- IR 스키마에 좌표 또는 배치 힌트 필드를 추가해야 하며,
- validator가 그 필드를 검증해야 하고,
- 우리에게는 아직 archify의 `geometry.mjs`처럼 "AI가 만든 배치를 검사해서 AI에게 재수정을 요청하는" 반복 루프가 없다 — 좌표를 한 번 받고 끝나면 archify 수준의 품질이 안 나올 가능성이 높다(이 루프 자체를 새로 만들어야 함).

즉 스키마·프롬프트·validator·(어쩌면) 반복 수정 루프까지 건드리는 큰 파이프라인 변경이라 view-레이어만 다루는 v2 범위 밖이다. **지금 당장은** 뷰 레이어에서 해결 가능한 문제(라벨 겹침, 레이아웃 깨짐, 텍스트 가려짐)부터 고치고, AI 기반 맵 설계는 여기 남겨서 나중에 판단한다. 재검토할 때 확인할 것: (a) 클러스터링만으로 얼마나 개선되는지 실사용 피드백을 더 모은 뒤에도 부족한지, (b) A7을 부분적으로 완화(좌표가 아니라 "구역/그룹" 같은 상위 수준 배치 힌트만 AI가 주는 절충안)하는 것으로 충분한지 아니면 진짜 좌표까지 필요한지.
