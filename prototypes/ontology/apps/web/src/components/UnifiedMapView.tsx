import { useMemo, useState } from "react";

import type { AnalysisBundle, ArchitectureComponent, ScenarioIR, ScenarioStep, SequenceIR } from "@onto/protocol";

import { componentReferenceSet, journeyReferenceSet, relatedComponentIds, stepReferenceSet } from "../layout/unifiedMap.js";
import { ArchitectureRelationshipMap } from "./ArchitectureRelationshipMap.js";
import { UserMapView } from "./UserMapView.js";

function CoverageStrip({ bundle }: { bundle: AnalysisBundle }): React.JSX.Element {
  const topology = bundle.repositoryTopology;
  const coverage = topology?.coverage;
  const complete = coverage
    ? coverage.missingRuntimeIds.length === 0 &&
      coverage.missingDataStoreIds.length === 0 &&
      coverage.sharedBoundaryRuntimeIds.length === 0
    : false;
  return (
    <section className={`unified-coverage${complete ? " unified-coverage-complete" : ""}`} aria-label="분석 범위">
      <div>
        <span className="overview-eyebrow">분석 범위</span>
        <strong>{topology ? (complete ? "저장소 범위를 모두 표현했습니다" : "확인이 필요한 저장소 요소가 있습니다") : "레거시 분석 결과"}</strong>
      </div>
      <div className="unified-coverage-metrics">
        {coverage && <span><b>{coverage.representedRuntimeCount}/{coverage.detectedRuntimeCount}</b> 실행 단위</span>}
        {coverage && <span><b>{coverage.representedDataStoreCount}/{coverage.detectedDataStoreCount}</b> 로컬 데이터</span>}
        <span><b>{bundle.architecture.components.length}</b> 구성요소</span>
        <span className={bundle.freshness === "current" ? "is-current" : "is-review"}>
          {bundle.freshness === "current" ? "● 최신" : "● 재검토 필요"}
        </span>
      </div>
    </section>
  );
}

export function UnifiedMapView({
  bundle,
  onSelectComponent,
  onOpenSequence,
}: {
  bundle: AnalysisBundle;
  onSelectComponent: (componentId: string) => void;
  onOpenSequence: (sequence: SequenceIR) => void;
}): React.JSX.Element {
  const [focusRefs, setFocusRefs] = useState<Set<string>>(new Set());
  const [focusSource, setFocusSource] = useState<"system" | "journey" | null>(null);
  const highlightedComponentIds = useMemo(
    () => relatedComponentIds(bundle.architecture.components, focusRefs),
    [bundle.architecture.components, focusRefs],
  );

  const focusComponent = (component: ArchitectureComponent): void => {
    setFocusRefs(componentReferenceSet(component));
    setFocusSource("system");
    onSelectComponent(component.id);
  };
  const focusStep = (step: ScenarioStep): void => {
    setFocusRefs(stepReferenceSet(step));
    setFocusSource("journey");
  };
  const focusJourney = (journey: ScenarioIR): void => {
    setFocusRefs(journeyReferenceSet(journey));
    setFocusSource("journey");
  };

  return (
    <div className="unified-map">
      <header className="unified-map-title">
        <div><p className="detail-eyebrow">V3 통합 지도</p><h2>{bundle.architecture.title}</h2></div>
        {focusRefs.size > 0 && (
          <button type="button" onClick={() => { setFocusRefs(new Set()); setFocusSource(null); }}>강조 해제 ×</button>
        )}
      </header>
      <CoverageStrip bundle={bundle} />
      <nav className="unified-anchor-nav" aria-label="지도 안에서 이동">
        <a href="#system-map">시스템 구조</a><a href="#journey-map">사용자 여정</a>
        {focusSource && <span>{focusSource === "system" ? "시스템 선택과 관련된 여정을 강조 중" : "여정과 관련된 시스템을 강조 중"}</span>}
      </nav>

      <section id="system-map" className="unified-section" aria-labelledby="system-map-title">
        <div className="unified-section-heading">
          <div><p className="detail-eyebrow">시스템 구조</p><h3 id="system-map-title">코드가 나뉘고 연결되는 방식</h3></div>
          <p>카드를 누르면 근거를 확인하고, 아래 여정에서 같은 근거를 쓰는 단계를 함께 찾습니다.</p>
        </div>
        <ArchitectureRelationshipMap
          ir={bundle.architecture}
          topology={bundle.repositoryTopology}
          sequences={bundle.sequences}
          highlightedComponentIds={highlightedComponentIds}
          hasExternalFocus={focusSource === "journey" && focusRefs.size > 0}
          onSelectComponent={(id) => {
            const component = bundle.architecture.components.find((item) => item.id === id);
            if (component) focusComponent(component);
          }}
        />
      </section>

      <section id="journey-map" className="unified-section" aria-labelledby="journey-map-title">
        <div className="unified-section-heading">
          <div><p className="detail-eyebrow">사용자 여정</p><h3 id="journey-map-title">이 구조로 사용자가 할 수 있는 일</h3></div>
          <p>단계를 누르면 위 시스템 지도에서 같은 코드·개념 근거를 가진 구성요소를 강조합니다.</p>
        </div>
        <UserMapView
          userMap={bundle.userMap}
          workflow={bundle.workflow}
          sequences={bundle.sequences}
          focusRefs={focusSource === "system" ? focusRefs : new Set()}
          onFocusJourney={focusJourney}
          onFocusStep={focusStep}
          onOpenSequence={onOpenSequence}
        />
      </section>
    </div>
  );
}
