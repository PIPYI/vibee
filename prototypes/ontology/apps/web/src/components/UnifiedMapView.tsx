import { useEffect, useMemo, useState } from "react";

import type { AnalysisBundle, ArchitectureComponent, ArchitectureViewDocument, ScenarioIR, ScenarioStep, SequenceIR, SystemFactStore } from "@onto/protocol";

import { isUnavailable, queryEvidence } from "../api.js";
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
  architectureDocument,
  architectureStatus = "idle",
  architectureError,
  onRetryArchitecture,
}: {
  bundle: AnalysisBundle;
  onSelectComponent: (componentId: string) => void;
  onOpenSequence: (sequence: SequenceIR) => void;
  systemFacts?: SystemFactStore | null;
  /** 저작된 시스템 구조 지도(SVG). 있으면 결정론적 관계 지도 대신 이것을 그린다. */
  architectureSvg?: string | null;
  architectureDocument?: ArchitectureViewDocument | null;
  architectureStatus?: "idle" | "authoring" | "ready" | "failed";
  architectureError?: string | null;
  onRetryArchitecture?: () => void;
}): React.JSX.Element {
  const [focusRefs, setFocusRefs] = useState<Set<string>>(new Set());
  const [focusSource, setFocusSource] = useState<"system" | "journey" | null>(null);
  const [journeySourcePaths, setJourneySourcePaths] = useState<Set<string>>(new Set());
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

  // 기존 결정론적 지도는 evidence/entity ref를 직접 비교할 수 있다. 저작 지도는 sources
  // 주소만 가지므로, 선택된 여정의 evidence ID를 파일 경로로 한 번 해석해 같은 파일을
  // 인용한 component/connection을 강조한다. 개념 ref는 queryEvidence에서 자연스럽게 빠진다.
  useEffect(() => {
    if (focusSource !== "journey" || focusRefs.size === 0) {
      setJourneySourcePaths(new Set());
      return;
    }
    let cancelled = false;
    void queryEvidence({ ids: [...focusRefs], limit: Math.min(200, focusRefs.size) }).then((result) => {
      if (cancelled || isUnavailable(result)) return;
      setJourneySourcePaths(new Set(result.evidence.flatMap((item) => item.filePath ? [item.filePath] : [])));
    }).catch(() => {
      if (!cancelled) setJourneySourcePaths(new Set());
    });
    return () => { cancelled = true; };
  }, [focusRefs, focusSource]);

  return (
    <div className="unified-map">
      <header className="unified-map-title">
        <div><p className="detail-eyebrow">V4 통합 지도</p><h2>{bundle.architecture.title}</h2></div>
      </header>

      <section id="system-map" className="unified-section" aria-labelledby="system-map-title">
        <div className="unified-section-heading">
          <div><p className="detail-eyebrow">시스템 구조</p><h3 id="system-map-title">코드가 나뉘고 연결되는 방식</h3></div>
          <div className="architecture-authoring-status">
            {architectureStatus === "authoring" && <span className="architecture-status architecture-status-running">저작 중…</span>}
            {architectureStatus === "ready" && <span className="architecture-status architecture-status-ready">저작 지도</span>}
            {architectureStatus === "failed" && (
              <span className="architecture-status architecture-status-failed" title={architectureError ?? undefined}>
                저작 실패 · 기본 지도 표시
                {onRetryArchitecture && <button type="button" onClick={onRetryArchitecture}>다시 시도</button>}
              </span>
            )}
            <p>카드를 누르면 근거를 확인하고, 아래 여정에서 같은 근거를 쓰는 단계를 함께 찾습니다.</p>
          </div>
        </div>
        {architectureSvg ? (
          <SystemStructureMap
            svg={architectureSvg}
            document={architectureDocument}
            highlightedSourcePaths={focusSource === "journey" ? journeySourcePaths : new Set()}
          />
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
