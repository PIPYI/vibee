import { useEffect, useMemo, useState } from "react";

import type { AnalysisBundle, ArchitectureComponent, ScenarioIR, ScenarioStep, SequenceIR, SystemFactStore } from "@onto/protocol";

import { componentReferenceSet, journeyReferenceSet, relatedComponentIds, stepReferenceSet } from "../layout/unifiedMap.js";
import { ArchitectureRelationshipMap } from "./ArchitectureRelationshipMap.js";
import { SystemStructureMap } from "./SystemStructureMap.js";
import { UserMapView } from "./UserMapView.js";

export function UnifiedMapView({
  bundle,
  onSelectComponent,
  onOpenSequence,
  systemFacts,
  architectureSvg,
}: {
  bundle: AnalysisBundle;
  onSelectComponent: (componentId: string) => void;
  onOpenSequence: (sequence: SequenceIR) => void;
  systemFacts?: SystemFactStore | null;
  /** 저작된 시스템 구조 지도(SVG). 있으면 결정론적 관계 지도 대신 이것을 그린다. */
  architectureSvg?: string | null;
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
  const clearFocus = (): void => {
    setFocusRefs(new Set());
    setFocusSource(null);
  };

  useEffect(() => {
    if (focusRefs.size === 0) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") clearFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusRefs.size]);

  return (
    <div className="unified-map">
      <header className="unified-map-title">
        <div><p className="detail-eyebrow">V4 통합 지도</p><h2>{bundle.architecture.title}</h2></div>
      </header>

      <section id="system-map" className="unified-section" aria-labelledby="system-map-title">
        <div className="unified-section-heading">
          <div><p className="detail-eyebrow">시스템 구조</p><h3 id="system-map-title">코드가 나뉘고 연결되는 방식</h3></div>
          <p>카드를 누르면 근거를 확인하고, 아래 여정에서 같은 근거를 쓰는 단계를 함께 찾습니다.</p>
        </div>
        {architectureSvg ? (
          <SystemStructureMap svg={architectureSvg} />
        ) : (
          <ArchitectureRelationshipMap
            ir={bundle.architecture}
            topology={bundle.repositoryTopology}
            sequences={bundle.sequences}
            highlightedComponentIds={highlightedComponentIds}
            hasExternalFocus={focusSource === "journey" && focusRefs.size > 0}
            hasFocus={focusRefs.size > 0}
            focusMessage={focusSource === "system" ? "관련 사용자 여정 강조 중" : "선택한 여정과 관련된 구성요소 강조 중"}
            onClearFocus={clearFocus}
            onSelectComponent={(id) => {
              const component = bundle.architecture.components.find((item) => item.id === id);
              if (component) focusComponent(component);
            }}
            systemFacts={systemFacts}
          />
        )}
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
