import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ScenarioStep, SequenceIR, UserMapIR, WorkflowIR } from "@onto/protocol";

import {
  buildUserJourneys,
  primaryJourneyPath,
  sequenceForTransition,
  transitionKey,
  type UserJourney,
} from "../layout/userMap.js";
import { buildJourneyCanvasLayout } from "../layout/journeyCanvas.js";
import { journeyReferenceSet, referencesIntersect, stepReferenceSet } from "../layout/unifiedMap.js";
import { EvidenceList } from "./Grounding.js";

type Filter = "all" | "user" | "system";

function typeLabel(type: "user" | "system"): string {
  return type === "user" ? "사용자 여정" : "시스템 흐름";
}

function participantLabel(journey: UserJourney, step: ScenarioStep): string {
  return journey.ir.participants.find((participant) => participant.id === step.participantId)?.label ?? "공통";
}

type JourneyEdgeGeometry = {
  id: string;
  path: string;
  labelX: number;
  labelY: number;
};

const JOURNEY_STEP_WIDTH = 188;
const JOURNEY_COLUMN_WIDTH = 300;
const JOURNEY_LEFT_GUTTER = 112;
const JOURNEY_TOP = 62;
const JOURNEY_LANE_HEIGHT = 184;

export function UserMapView({
  userMap,
  workflow,
  sequences,
  focusRefs = new Set<string>(),
  onFocusJourney,
  onFocusStep,
  onOpenSequence,
}: {
  userMap?: UserMapIR;
  workflow: WorkflowIR;
  sequences: SequenceIR[];
  focusRefs?: ReadonlySet<string>;
  onFocusJourney?: (journey: UserJourney["ir"]) => void;
  onFocusStep?: (step: ScenarioStep) => void;
  onOpenSequence: (sequence: SequenceIR) => void;
}): React.JSX.Element {
  const journeys = useMemo(() => buildUserJourneys(userMap, workflow), [userMap, workflow]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(() => journeys[0]?.ir.id ?? null);
  const selected = journeys.find((journey) => journey.ir.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !journeys.some((journey) => journey.ir.id === selectedId)) setSelectedId(journeys[0]?.ir.id ?? null);
    if (!selectedId && journeys.length > 0) setSelectedId(journeys[0]!.ir.id);
  }, [journeys, selectedId]);

  const visible = journeys.filter((journey) => filter === "all" || journey.ir.type === filter);

  const primaryCount = journeys.filter((journey) => journey.source !== "legacy-support").length;
  return (
    <section className="user-map" aria-labelledby="user-map-title">
      <header className="user-map-hero">
        <div>
          <p className="detail-eyebrow">여정 선택</p>
          <h2 id="user-map-title">{userMap?.title ?? "프로젝트에서 할 수 있는 일"}</h2>
          <p className="dim">
            목적을 고르면 대표 경로와 그 단계에서 갈라지는 선택·재시도를 한 캔버스에서 보여줍니다.
          </p>
        </div>
        <div className="user-map-summary" aria-label="사용자 지도 요약">
          <strong>{primaryCount}</strong><span>대표 여정</span>
          <strong>{journeys.reduce((count, journey) => count + journey.ir.steps.length, 0)}</strong><span>근거 있는 단계</span>
        </div>
      </header>

      {!userMap && (
        <p className="user-map-legacy-note">
          이 결과에는 목적별 여정 데이터가 없습니다. 현재 확인 가능한 기존 워크플로우만 읽기 전용으로 정리했습니다.
        </p>
      )}

      <div className="user-map-toolbar" role="group" aria-label="여정 종류 필터">
        {(["all", "user", "system"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "all" ? "전체" : typeLabel(value)}
          </button>
        ))}
      </div>

      <div className="journey-selector" role="list" aria-label="분석된 여정">
        {visible.map((journey) => {
          const outcomes = journey.ir.outcomeStepIds
            .map((id) => journey.ir.steps.find((step) => step.id === id)?.label)
            .filter(Boolean);
          return (
            <button
              type="button"
              className={`journey-selector-item journey-selector-item-${journey.ir.type}${selectedId === journey.ir.id ? " is-selected" : ""}${referencesIntersect(journeyReferenceSet(journey.ir), focusRefs) ? " is-related" : ""}`}
              key={journey.ir.id}
              onClick={() => { setSelectedId(journey.ir.id); onFocusJourney?.(journey.ir); }}
            >
              <span className="journey-card-type">{typeLabel(journey.ir.type)}</span>
              <strong>{journey.ir.name}</strong>
              <span className="journey-card-meta">
                {journey.ir.steps.length}단계 · {journey.ir.participants.length}참여자
              </span>
              {outcomes.length > 0 && <span className="journey-card-outcome">결과 · {outcomes.join(" / ")}</span>}
            </button>
          );
        })}
      </div>
      {selected && (
        <JourneyDetail
          journey={selected}
          sequences={sequences}
          focusRefs={focusRefs}
          onFocusStep={onFocusStep}
          onOpenSequence={onOpenSequence}
        />
      )}
    </section>
  );
}

function JourneyDetail({
  journey,
  sequences,
  focusRefs,
  onFocusStep,
  onOpenSequence,
}: {
  journey: UserJourney;
  sequences: SequenceIR[];
  focusRefs: ReadonlySet<string>;
  onFocusStep?: (step: ScenarioStep) => void;
  onOpenSequence: (sequence: SequenceIR) => void;
}): React.JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const { ir } = journey;
  const stepById = new Map(ir.steps.map((step) => [step.id, step] as const));
  const path = primaryJourneyPath(ir);
  const evidenceCount = new Set([
    ...(ir.evidenceRefs ?? []),
    ...ir.steps.flatMap((step) => step.evidenceRefs),
    ...ir.transitions.flatMap((transition) => transition.evidenceRefs),
  ]).size;

  return (
    <section className="user-map journey-detail" aria-labelledby="journey-detail-title">
      <header className={`journey-detail-hero journey-detail-hero-${ir.type}`}>
        <div>
          <p className="detail-eyebrow">{typeLabel(ir.type)}</p>
          <h2 id="journey-detail-title">{ir.name}</h2>
          {ir.goal && <p className="journey-goal"><span>목표</span>{ir.goal}</p>}
          {ir.outcome && <p className="journey-outcome"><span>결과</span>{ir.outcome}</p>}
        </div>
        <div className="journey-detail-stats">
          <span><strong>{ir.steps.length}</strong> 단계</span>
          <span><strong>{ir.participants.length}</strong> 참여자</span>
          <span><strong>{evidenceCount}</strong> 코드 근거</span>
        </div>
      </header>

      {ir.phases && ir.phases.length > 0 && (
        <div className="journey-phases" aria-label="여정 국면">
          {ir.phases.map((phase, index) => <span key={phase.id}><b>{index + 1}</b>{phase.label}</span>)}
        </div>
      )}

      <section className="journey-main-section">
        <div className="journey-section-heading">
          <div><p className="detail-eyebrow">하나의 여정 지도</p><h3>대표 경로와 갈라지는 흐름</h3></div>
          <p className="dim">단계를 누르면 근거를, 호출 배지가 있는 연결을 누르면 시퀀스를 확인할 수 있습니다.</p>
        </div>
        <JourneyCanvas
          journey={journey}
          path={path}
          sequences={sequences}
          focusRefs={focusRefs}
          onSelectStep={(step) => { setSelectedStepId(step.id); onFocusStep?.(step); }}
          onOpenSequence={onOpenSequence}
        />
      </section>

      {(ir.stateChanges?.length ?? 0) > 0 && (
        <section className="journey-state-strip">
          <strong>이 여정에서 바뀌는 상태</strong>
          {ir.stateChanges!.map((change, index) => (
            <span key={`${change.subjectConceptId}-${index}`}>{change.from ?? "없음"} → {change.to ?? change.changeKind ?? "변경"}</span>
          ))}
        </section>
      )}

      {selectedStepId && stepById.has(selectedStepId) && (
        <JourneyStepModal
          journey={journey}
          step={stepById.get(selectedStepId)!}
          sequences={sequences}
          onClose={() => setSelectedStepId(null)}
          onSelectStep={setSelectedStepId}
          onOpenSequence={onOpenSequence}
        />
      )}
    </section>
  );
}

function JourneyCanvas({
  journey,
  path,
  sequences,
  focusRefs,
  onSelectStep,
  onOpenSequence,
}: {
  journey: UserJourney;
  path: string[];
  sequences: SequenceIR[];
  focusRefs: ReadonlySet<string>;
  onSelectStep: (step: ScenarioStep) => void;
  onOpenSequence: (sequence: SequenceIR) => void;
}): React.JSX.Element {
  const layout = useMemo(() => buildJourneyCanvasLayout(journey.ir, path), [journey.ir, path]);
  const [geometries, setGeometries] = useState<JourneyEdgeGeometry[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const stepById = useMemo(() => new Map(journey.ir.steps.map((step) => [step.id, step] as const)), [journey.ir.steps]);
  const nodeById = useMemo(() => new Map(layout.nodes.map((node) => [node.stepId, node] as const)), [layout.nodes]);
  const canvasWidth = JOURNEY_LEFT_GUTTER + (layout.columnCount - 1) * JOURNEY_COLUMN_WIDTH + JOURNEY_STEP_WIDTH + 56;
  const canvasHeight = JOURNEY_TOP + (layout.laneCount - 1) * JOURNEY_LANE_HEIGHT + 116 + 84;

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const next: JourneyEdgeGeometry[] = [];
    layout.edges.forEach((edge, index) => {
      const fromElement = stage.querySelector<HTMLElement>(`[data-journey-node="${CSS.escape(edge.fromStepId)}"]`);
      const toElement = stage.querySelector<HTMLElement>(`[data-journey-node="${CSS.escape(edge.toStepId)}"]`);
      if (!fromElement || !toElement) return;
      const from = fromElement.getBoundingClientRect();
      const to = toElement.getBoundingClientRect();
      const sourceNode = nodeById.get(edge.fromStepId);
      const targetNode = nodeById.get(edge.toStepId);
      if (!sourceNode || !targetNode) return;

      if (edge.kind === "primary" && sourceNode.lane === 0 && targetNode.lane === 0 && to.left > from.right) {
        const startX = from.right - stageRect.left + 8;
        const endX = to.left - stageRect.left - 10;
        const y = from.top - stageRect.top + from.height / 2;
        next.push({ id: edge.id, path: `M ${startX} ${y} H ${endX}`, labelX: (startX + endX) / 2, labelY: y - 18 });
        return;
      }

      const startX = from.left - stageRect.left + from.width / 2;
      const startY = from.bottom - stageRect.top + 6;
      const targetBelow = to.top >= from.bottom;
      const endX = to.left - stageRect.left + to.width / 2;
      const endY = targetBelow ? to.top - stageRect.top - 9 : to.bottom - stageRect.top + 9;
      const baseY = Math.max(from.bottom, to.bottom) - stageRect.top + 30;
      const channelY = baseY + (index % 3) * 24;
      next.push({
        id: edge.id,
        path: `M ${startX} ${startY} V ${channelY} H ${endX} V ${endY}`,
        labelX: startX + (endX - startX) / 2,
        labelY: channelY - 14,
      });
    });
    setGeometries(next);
  }, [layout.edges, nodeById]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    stage.querySelectorAll("[data-journey-node]").forEach((node) => observer.observe(node));
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry] as const));
  return (
    <div className="journey-canvas-scroll" aria-label="대표 경로와 분기·재시도 통합 지도">
      <div className="journey-canvas" ref={stageRef} style={{ width: canvasWidth, height: canvasHeight }}>
        <div className="journey-canvas-row-label journey-canvas-row-primary"><b>대표 경로</b><span>목표까지 이어지는 기본 흐름</span></div>
        {layout.laneCount > 1 && (
          <div className="journey-canvas-branch-boundary" style={{ top: JOURNEY_TOP + 142 }}>
            <span>분기 · 예외 · 재시도</span>
          </div>
        )}

        {layout.nodes.map((node) => {
          const step = stepById.get(node.stepId);
          if (!step) return null;
          const incomingKinds = layout.edges.filter((edge) => edge.toStepId === step.id).map((edge) => edge.kind);
          const branchKind = incomingKinds.includes("loop") ? "loop" : "branch";
          const isOutcome = journey.ir.outcomeStepIds.includes(step.id);
          return (
            <button
              key={step.id}
              type="button"
              data-journey-node={step.id}
              className={`journey-step journey-canvas-step${node.lane > 0 ? ` journey-canvas-step-${branchKind}` : ""}${isOutcome ? " journey-step-outcome" : ""}${referencesIntersect(stepReferenceSet(step), focusRefs) ? " journey-step-related" : ""}`}
              style={{ left: JOURNEY_LEFT_GUTTER + node.column * JOURNEY_COLUMN_WIDTH, top: JOURNEY_TOP + node.lane * JOURNEY_LANE_HEIGHT }}
              onClick={() => onSelectStep(step)}
              aria-label={`${step.label}${node.lane > 0 ? ", 분기 단계" : ""}${isOutcome ? ", 결과 단계" : ""}`}
            >
              <span className="journey-step-number">{node.primaryIndex !== undefined ? node.primaryIndex + 1 : branchKind === "loop" ? "↺" : "◇"}</span>
              <span className="journey-step-participant">{participantLabel(journey, step)}</span>
              <strong>{step.label}</strong>
              <span className="journey-step-evidence">근거 {step.evidenceRefs.length}개</span>
              {node.lane > 0 && <span className={`journey-step-flow-kind journey-step-flow-${branchKind}`}>{branchKind === "loop" ? "재시도" : "분기"}</span>}
              {isOutcome && <span className="journey-step-result">결과</span>}
            </button>
          );
        })}

        <svg className="journey-canvas-edge-layer" aria-hidden="true">
          <defs>
            <marker id="journey-arrow-primary" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" /></marker>
            <marker id="journey-arrow-branch" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" /></marker>
            <marker id="journey-arrow-loop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" /></marker>
          </defs>
          {layout.edges.map((edge) => {
            const geometry = geometryById.get(edge.id);
            if (!geometry) return null;
            return <path key={edge.id} d={geometry.path} className={`journey-canvas-edge journey-canvas-edge-${edge.kind}`} markerEnd={`url(#journey-arrow-${edge.kind})`} />;
          })}
        </svg>

        <div className="journey-canvas-label-layer">
          {layout.edges.map((edge) => {
            const geometry = geometryById.get(edge.id);
            if (!geometry) return null;
            const sequence = edge.transition ? sequenceForTransition(journey, edge.transition, sequences) : undefined;
            return (
              <button
                type="button"
                key={edge.id}
                className={`journey-canvas-edge-label journey-canvas-edge-label-${edge.kind}${sequence ? " journey-canvas-edge-label-sequence" : ""}`}
                style={{ left: geometry.labelX, top: geometry.labelY }}
                disabled={!sequence}
                onClick={sequence ? () => onOpenSequence(sequence) : undefined}
                aria-label={sequence ? `${edge.condition ?? "다음 단계"} 코드 호출 시퀀스 열기` : edge.condition ?? "다음 단계"}
              >
                <span>{edge.kind === "loop" ? "↺ " : edge.kind === "branch" ? "◇ " : ""}{edge.condition ?? (edge.kind === "primary" ? "다음" : "다른 경로")}</span>
                {sequence && <b>호출 보기 ↗</b>}
              </button>
            );
          })}
        </div>

        <div className="journey-canvas-legend" aria-label="사용자 여정 선 범례">
          <span><i className="legend-primary" />대표 경로</span>
          <span><i className="legend-branch" />◇ 선택·분기</span>
          <span><i className="legend-loop" />↺ 실패·재시도</span>
        </div>
      </div>
    </div>
  );
}

function JourneyStepModal({
  journey,
  step,
  sequences,
  onClose,
  onSelectStep,
  onOpenSequence,
}: {
  journey: UserJourney;
  step: ScenarioStep;
  sequences: SequenceIR[];
  onClose: () => void;
  onSelectStep: (stepId: string) => void;
  onOpenSequence: (sequence: SequenceIR) => void;
}): React.JSX.Element {
  const stepById = new Map(journey.ir.steps.map((item) => [item.id, item] as const));
  const relationships = journey.ir.transitions
    .filter((transition) => transition.fromStepId === step.id || transition.toStepId === step.id)
    .map((transition) => {
      const outgoing = transition.fromStepId === step.id;
      const counterpartId = outgoing ? transition.toStepId : transition.fromStepId;
      return {
        transition,
        outgoing,
        counterpartId,
        counterpart: stepById.get(counterpartId),
        sequence: sequenceForTransition(journey, transition, sequences),
      };
    });
  return (
    <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="detail-modal journey-step-modal" role="dialog" aria-modal="true" aria-label={`${step.label} 근거`}>
        <div className="sequence-modal-head">
          <div><p className="detail-eyebrow">{participantLabel(journey, step)} · 여정 단계</p><h3>{step.label}</h3></div>
          <button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="journey-step-modal-body">
          {relationships.length > 0 && (
            <section>
              <h4>이 단계와 이어지는 흐름</h4>
              <div className="journey-step-relations">
                {relationships.map(({ transition, outgoing, counterpartId, counterpart, sequence }, index) => (
                  <div key={`${transitionKey(transition)}-${index}`}>
                    <button type="button" onClick={() => onSelectStep(counterpartId)}>
                      <span>{outgoing ? "→" : "←"}</span><strong>{counterpart?.label ?? counterpartId}</strong>
                      <small>{transition.condition ?? (transition.loop ? "재시도" : "연결")}</small>
                    </button>
                    {sequence && <button type="button" className="journey-step-sequence" onClick={() => onOpenSequence(sequence)}>호출 보기 ↗</button>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {(step.conceptRefs.length > 0) && (
            <section><h4>연결된 의미</h4><div className="chip-list">{step.conceptRefs.map((ref) => <span className="chip" key={ref}>{ref.replace(/^concept:/, "")}</span>)}</div></section>
          )}
          <section>
            <h4>연관된 코드 파일</h4>
            <EvidenceList ids={step.evidenceRefs} />
          </section>
        </div>
      </section>
    </div>
  );
}
