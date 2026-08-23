/**
 * Progressive Disclosure의 세 번째 칸 (§41): Scenario step → StepDetail 패널 →
 * "실제 코드 보기" → 그 step을 anchor로 한 TraceView.
 *
 * M12(schema2 §6) — 같은 자리에 authored reachability 진입점을 둔다. Trace가 "이 코드는
 * 어떻게 생겼는가"에 답한다면, 이건 "여기서 인덱싱된 관계로 어디까지 닿는가"에 답한다 —
 * impact/인과가 아니다.
 */
import type { ScenarioIR, ScenarioStep } from "@onto/protocol";

import { EvidenceList } from "./Grounding.js";

export function StepDetail({
  step,
  ir,
  resolveConceptName,
  resolveClaimPredicate,
  onViewTrace,
  onViewReachability,
  onClose,
}: {
  step: ScenarioStep;
  ir: ScenarioIR;
  resolveConceptName: (conceptId: string) => string;
  resolveClaimPredicate: (claimId: string) => string | undefined;
  onViewTrace: () => void;
  onViewReachability: (direction: "upstream" | "downstream") => void;
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
      <div className="reachability-buttons">
        <button type="button" onClick={() => onViewReachability("upstream")} title="무엇이 여기로 이어지는가">
          ← 업스트림
        </button>
        <button type="button" onClick={() => onViewReachability("downstream")} title="여기서 무엇으로 이어지는가">
          다운스트림 →
        </button>
      </div>
    </aside>
  );
}
