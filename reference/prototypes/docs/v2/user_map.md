# 사용자 지도 — Scenario 중심 구조

## 목적

비전공자가 “이 프로젝트에서 누가 어떤 목적을 달성할 수 있는가”를 먼저 이해하게 한다.
기술 모듈 전체를 한 그래프에 늘어놓지 않고, 하나의 목적을 하나의 journey로 유지한다.

## 데이터 경계

- `SemanticMemory.canonicalScenarios`: 안정적인 여정 목록과 identity의 원천
- `AnalysisBundle.userMap`: active Canonical Scenario를 펼친 `ScenarioIR[]`
- `AnalysisBundle.workflow`: 레거시 호환과 `WorkflowEdge.sequenceRef` 역참조를 위해 유지
- `AnalysisBundle.sequences`: 코드 호출을 볼 가치가 있는 전환의 기술 상세

`UserMapIR`은 별도 그래프 문법을 만들지 않는다. 기존 `ScenarioIR`의 goal, outcome,
participants, branches, stateChanges, phases, entry/outcome을 그대로 재사용한다.

## 생성 규칙

1. active Canonical Scenario마다 journey 하나를 만든다.
2. 사용자 목적과 시스템 목적을 한 journey에 합치지 않는다.
3. 모든 step과 transition은 present Evidence를 가져야 한다.
4. entry에서 모든 step이 도달 가능해야 한다.
5. loop는 condition을 반드시 갖는다.
6. 좌표는 생성하지 않는다. Renderer가 결정론적으로 배치한다.

## UI 구조

### 여정 한눈에

목표별 카드와 사용자/시스템 필터를 제공한다. 카드에는 목표, 단계 수, 참여자 수,
결과 지점만 표시한다.

### 여정 상세

- 대표 경로: entry에서 outcome으로 향하는 가장 긴 단순 경로
- 다른 경로: 대표 경로 밖의 transition, branch, loop
- 상태 변화: `stateChanges`를 별도 strip으로 표시
- 코드 호출: 명시 `sequenceRef` 또는 exact evidence 교집합이 있을 때만 Sequence 모달 연결

이 구조는 선이 교차하는 거대한 그래프보다 사용자의 목표와 결과를 우선한다. 기술 상세는
progressive disclosure로 분리한다.

## 레거시 호환

`userMap`이 없는 기존 bundle은 Web에서만 읽기 전용으로 투영한다.

- `workflow.mainPath` → 대표 여정
- mainPath 밖에서 한 hop으로 연결된 node → 별도 주변 여정
- 명시된 `WorkflowEdge.sequenceRef` → 기존 Sequence 유지

새 분석이나 저장소 상태를 만들지 않으며, 다음 분석부터 정식 `userMap`을 사용한다.
