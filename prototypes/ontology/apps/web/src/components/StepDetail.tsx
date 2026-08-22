/**
 * Progressive Disclosure의 세 번째 칸 (§41): Scenario step → StepDetail 패널 →
 * "실제 코드 보기" → 그 step을 anchor로 한 TraceView.
 */
import type { ScenarioIR, ScenarioStep } from "@onto/protocol";

import { EvidenceList } from "./Grounding.js";

export function StepDetail({
  step,
  ir,
  resolveConceptName,
  resolveClaimPredicate,
  onViewTrace,
  onClose,
}: {
  step: ScenarioStep;
  ir: ScenarioIR;
  resolveConceptName: (conceptId: string) => string;
  resolveClaimPredicate: (claimId: string) => string | undefined;
  onViewTrace: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const participant = ir.participants.find((p) => p.id === step.participantId);
  const changes = (ir.stateChanges ?? []).filter((change) => change.causedByStepId === step.id);

  return (
    <aside className="step-detail">
      <div className="step-detail-header">
        <h3>{step.label}</h3>
        <button type="button" className="close-button" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      {participant && <p className="dim">참여자: {participant.label}</p>}

      {step.conceptRefs.length > 0 && (
        <section>
          <h4>관련 Concept</h4>
          <ul className="chip-list">
            {step.conceptRefs.map((id) => (
              <li key={id} className="chip">
                {resolveConceptName(id)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(step.claimRefs?.length ?? 0) > 0 && (
        <section>
          <h4>관련 Claim</h4>
          <ul>
            {step.claimRefs!.map((id) => (
              <li key={id}>{resolveClaimPredicate(id) ?? id}</li>
            ))}
          </ul>
        </section>
      )}

      {changes.length > 0 && (
        <section>
          <h4>상태 변화</h4>
          <ul>
            {changes.map((change, index) => (
              <li key={index}>
                {resolveConceptName(change.subjectConceptId)}: {change.from ?? "∅"} → {change.to ?? "∅"}
                {change.changeKind ? ` (${change.changeKind})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4>근거</h4>
        <EvidenceList ids={step.evidenceRefs} />
      </section>

      <button type="button" className="primary-button" onClick={onViewTrace}>
        실제 코드 보기 →
      </button>
    </aside>
  );
}
