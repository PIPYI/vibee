import { useEffect, useMemo, useState } from "react";

import type { ScenarioStep, SequenceIR, UserMapIR, WorkflowIR } from "@onto/protocol";

import {
  buildUserJourneys,
  primaryJourneyPath,
  sequenceForTransition,
  transitionKey,
  type UserJourney,
} from "../layout/userMap.js";
import { journeyReferenceSet, referencesIntersect, stepReferenceSet } from "../layout/unifiedMap.js";
import { EvidenceList } from "./Grounding.js";

type Filter = "all" | "user" | "system";

function typeLabel(type: "user" | "system"): string {
  return type === "user" ? "사용자 여정" : "시스템 흐름";
}

function participantLabel(journey: UserJourney, step: ScenarioStep): string {
  return journey.ir.participants.find((participant) => participant.id === step.participantId)?.label ?? "공통";
}

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
  const primaryKeys = new Set(path.slice(0, -1).map((id, index) => `${id}\u0000${path[index + 1]}`));
  const otherTransitions = ir.transitions.filter((transition) => !primaryKeys.has(transitionKey(transition)));
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
          <div><p className="detail-eyebrow">대표 경로</p><h3>목표까지 이어지는 핵심 단계</h3></div>
          <p className="dim">단계를 누르면 근거를, 호출 배지가 있는 연결을 누르면 시퀀스를 확인할 수 있습니다.</p>
        </div>
        <div className="journey-rail">
          {path.map((stepId, index) => {
            const step = stepById.get(stepId);
            if (!step) return null;
            const nextId = path[index + 1];
            const transition = nextId
              ? ir.transitions.find((item) => item.fromStepId === stepId && item.toStepId === nextId)
              : undefined;
            const sequence = transition ? sequenceForTransition(journey, transition, sequences) : undefined;
            const isOutcome = ir.outcomeStepIds.includes(step.id);
            return (
              <div className="journey-rail-unit" key={step.id}>
                <button
                  type="button"
                  className={`journey-step${isOutcome ? " journey-step-outcome" : ""}${referencesIntersect(stepReferenceSet(step), focusRefs) ? " journey-step-related" : ""}`}
                  onClick={() => { setSelectedStepId(step.id); onFocusStep?.(step); }}
                  aria-label={`${step.label}${isOutcome ? ", 결과 단계" : ""}`}
                >
                  <span className="journey-step-number">{index + 1}</span>
                  <span className="journey-step-participant">{participantLabel(journey, step)}</span>
                  <strong>{step.label}</strong>
                  <span className="journey-step-evidence">근거 {step.evidenceRefs.length}개</span>
                  {isOutcome && <span className="journey-step-result">결과</span>}
                </button>
                {transition && (
                  <button
                    type="button"
                    className={`journey-connector${sequence ? " journey-connector-sequence" : ""}`}
                    onClick={sequence ? () => onOpenSequence(sequence) : undefined}
                    disabled={!sequence}
                    aria-label={sequence ? `${transition.condition ?? "다음 단계"} 시퀀스 열기` : transition.condition ?? "다음 단계"}
                  >
                    <span>{transition.condition ?? "다음"}</span>
                    <b>{sequence ? "호출 보기 ↗" : "→"}</b>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {(otherTransitions.length > 0 || (ir.branches?.length ?? 0) > 0) && (
          <div className="journey-inline-branches" aria-label="대표 경로에서 갈라지는 분기와 재시도">
            <p className="journey-inline-label"><span>↳</span> 각 경로가 시작되는 대표 단계 아래에 연결했습니다</p>
            {otherTransitions.map((transition, index) => {
              const from = stepById.get(transition.fromStepId);
              const to = stepById.get(transition.toStepId);
              const sequence = sequenceForTransition(journey, transition, sequences);
              const sourceRank = Math.max(0, path.indexOf(transition.fromStepId));
              return (
                <article
                  className={`journey-branch journey-branch-attached${transition.loop ? " journey-branch-loop" : ""}`}
                  style={{ gridColumnStart: sourceRank + 1 }}
                  key={`${transitionKey(transition)}-${index}`}
                >
                  <span className="journey-branch-kind">{transition.loop ? "↺ 재시도" : "↗ 분기"} · {from?.label ?? transition.fromStepId}에서</span>
                  <strong>{to?.label ?? transition.toStepId}</strong>
                  <p>{transition.condition ?? "이 단계에서 다른 흐름으로 이어집니다."}</p>
                  {sequence && <button type="button" onClick={() => onOpenSequence(sequence)}>코드 호출 보기 →</button>}
                </article>
              );
            })}
            {(ir.branches ?? []).map((branch) => (
              <article
                className="journey-branch journey-branch-attached journey-branch-decision"
                style={{ gridColumnStart: Math.max(0, path.indexOf(branch.sourceStepId)) + 1 }}
                key={`${branch.sourceStepId}-${branch.conditionLabel}`}
              >
                <span className="journey-branch-kind">◇ 선택 · {stepById.get(branch.sourceStepId)?.label ?? branch.sourceStepId}에서</span>
                <strong>{branch.conditionLabel}</strong>
                <ul>{branch.paths.map((path) => <li key={`${path.label}-${path.nextStepId}`}>{path.label} → {stepById.get(path.nextStepId)?.label ?? path.nextStepId}</li>)}</ul>
              </article>
            ))}
          </div>
        )}
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
