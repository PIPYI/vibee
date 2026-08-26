/** 분석 시점에 생성된 SequenceIR을 Archify식 lifeline 다이어그램으로 렌더한다. */
import type { PresentationType, SequenceIR } from "@onto/protocol";

const LANE_WIDTH = 190;
const ROW_HEIGHT = 54;
const MARGIN_X = 34;
const MARGIN_TOP = 126;
const MARGIN_BOTTOM = 52;
const ACTIVATION_WIDTH = 10;
const PARTICIPANT_WIDTH = 148;
const PARTICIPANT_HEIGHT = 58;

type SequenceMessage = SequenceIR["messages"][number];
type MessageKind = SequenceMessage["kind"];

type CallReturnPair = {
  id: string;
  callId: string;
  returnId: string;
  x: number;
  top: number;
  bottom: number;
};

const MARKER_BY_KIND: Record<MessageKind, string> = {
  call: "url(#seq-arrow)",
  return: "url(#seq-arrow-return)",
  event: "url(#seq-arrow-event)",
};

const WIDE_CHARACTER = /[\u1100-\u11ff\u2e80-\u9fff\uf900-\ufaff\uff01-\uff60\uac00-\ud7af]/u;

function labelDisplayWidth(label: string): number {
  return [...label].reduce((width, character) => {
    if (/\s/u.test(character)) return width + 0.38;
    return width + (WIDE_CHARACTER.test(character) ? 1 : 0.62);
  }, 0);
}

function labelMaskWidth(label: string): number {
  return Math.max(68, Math.ceil(22 + labelDisplayWidth(label) * 9));
}

function findCallReturnPairs(
  messages: readonly SequenceMessage[],
  laneX: ReadonlyMap<string, number>,
  rowY: (row: number) => number,
): CallReturnPair[] {
  const pairs: CallReturnPair[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const call = messages[index];
    const response = messages[index + 1];
    if (
      !call ||
      !response ||
      call.kind !== "call" ||
      response.kind !== "return" ||
      call.fromParticipantId !== response.toParticipantId ||
      call.toParticipantId !== response.fromParticipantId ||
      call.fromParticipantId === call.toParticipantId
    ) continue;

    const callFromX = laneX.get(call.fromParticipantId);
    const callToX = laneX.get(call.toParticipantId);
    if (callFromX === undefined || callToX === undefined) continue;
    pairs.push({
      id: `${call.id}--${response.id}`,
      callId: call.id,
      returnId: response.id,
      x: Math.max(callFromX, callToX) + 16,
      top: rowY(index) - 10,
      bottom: rowY(index + 1) + 10,
    });
  }
  return pairs;
}

function participantType(label: string, index: number): PresentationType {
  const value = label.toLowerCase();
  if (/사용자|여행자|관리자|visitor|user|actor/.test(value)) return "external";
  if (/화면|앱|web|page|client|ui/.test(value)) return "frontend";
  if (/db|data|store|데이터|postgres|prisma/.test(value)) return "database";
  if (/보안|인증|guard|security|auth/.test(value)) return "security";
  if (/외부|cloud|calendar|provider/.test(value)) return "cloud";
  return index === 0 ? "external" : "backend";
}

const TYPE_SHORT: Record<string, string> = {
  external: "ACTOR", frontend: "UI", backend: "SERVICE", database: "DATA",
  security: "SECURITY", cloud: "EXTERNAL", queue: "QUEUE", job: "JOB", unknown: "SYSTEM",
};

export function SequenceView({ ir }: { ir: SequenceIR }): React.JSX.Element {
  const participants = ir.participants;
  const laneX = new Map(participants.map((participant, index) => [participant.id, MARGIN_X + index * LANE_WIDTH + LANE_WIDTH / 2]));
  const orderedMessages = [...ir.messages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const rowOf = new Map(orderedMessages.map((message, index) => [message.id, index]));
  const rowY = (row: number): number => MARGIN_TOP + row * ROW_HEIGHT;
  const width = MARGIN_X * 2 + Math.max(1, participants.length) * LANE_WIDTH;
  const height = MARGIN_TOP + Math.max(1, orderedMessages.length) * ROW_HEIGHT + MARGIN_BOTTOM;
  const callReturnPairs = findCallReturnPairs(orderedMessages, laneX, rowY);
  const pairByMessageId = new Map<string, CallReturnPair>();
  for (const pair of callReturnPairs) {
    pairByMessageId.set(pair.callId, pair);
    pairByMessageId.set(pair.returnId, pair);
  }

  return (
    <div className="sequence-view">
      <div className="sequence-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas sequence-canvas" role="img" aria-label={ir.title}>
          <defs>
            <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
            <marker id="seq-arrow-return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1,1 L8.5,5 L1,9" />
            </marker>
            <marker id="seq-arrow-event" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <circle cx="5" cy="5" r="3" />
            </marker>
          </defs>

          {(ir.phases ?? []).map((phase) => {
            const fromRow = rowOf.get(phase.fromStepId);
            const toRow = rowOf.get(phase.toStepId);
            if (fromRow === undefined || toRow === undefined) return null;
            const top = rowY(Math.min(fromRow, toRow)) - ROW_HEIGHT / 2;
            const bottom = rowY(Math.max(fromRow, toRow)) + ROW_HEIGHT / 2;
            return (
              <g key={phase.id} className="sequence-phase">
                <rect x={8} y={top} width={width - 16} height={bottom - top} rx={10} />
                <text x={18} y={top + 16}>{phase.label}</text>
              </g>
            );
          })}

          {participants.map((participant, index) => {
            const cx = laneX.get(participant.id) ?? MARGIN_X;
            const type = participantType(participant.label, index);
            return (
              <g key={participant.id} className={`sequence-participant sequence-type-${type}`}>
                <line x1={cx} y1={MARGIN_TOP - 24} x2={cx} y2={height - MARGIN_BOTTOM + 12} className="sequence-lifeline" />
                <foreignObject x={cx - PARTICIPANT_WIDTH / 2} y={24} width={PARTICIPANT_WIDTH} height={PARTICIPANT_HEIGHT}>
                  <div className="sequence-participant-card">
                    <span>{TYPE_SHORT[type] ?? "SYSTEM"}</span>
                    <strong>{participant.label}</strong>
                  </div>
                </foreignObject>
              </g>
            );
          })}

          {(ir.activations ?? []).map((activation, index) => {
            const cx = laneX.get(activation.participantId);
            const fromRow = rowOf.get(activation.fromStepId);
            const toRow = rowOf.get(activation.toStepId);
            if (cx === undefined || fromRow === undefined || toRow === undefined) return null;
            const top = rowY(Math.min(fromRow, toRow)) - 3;
            const bottom = rowY(Math.max(fromRow, toRow)) + 8;
            return <rect key={`activation-${index}`} x={cx - ACTIVATION_WIDTH / 2} y={top} width={ACTIVATION_WIDTH} height={Math.max(28, bottom - top)} className="sequence-activation" rx={3} />;
          })}

          {callReturnPairs.map((pair) => (
            <g key={pair.id} className="sequence-call-return-pair">
              <path d={`M ${pair.x - 8} ${pair.top} H ${pair.x} V ${pair.bottom} H ${pair.x - 8}`} />
              <title>동기 호출과 반환</title>
            </g>
          ))}

          {orderedMessages.map((message) => {
            const cy = rowY(rowOf.get(message.id) ?? 0);
            const fromX = laneX.get(message.fromParticipantId);
            const toX = laneX.get(message.toParticipantId);
            if (fromX === undefined || toX === undefined) return null;
            const isSelf = message.fromParticipantId === message.toParticipantId;
            const pair = pairByMessageId.get(message.id);
            if (isSelf) {
              return (
                <g key={message.id} className={`sequence-message sequence-message-${message.kind}${pair ? " sequence-message-paired" : ""}`}>
                  <path d={`M ${fromX} ${cy} h 42 v 26 h -42`} markerEnd={MARKER_BY_KIND[message.kind]} />
                  <text x={fromX + 48} y={cy + 13}>{message.label}</text>
                  <title>근거 {message.evidenceRefs.length}개</title>
                </g>
              );
            }
            const direction = toX >= fromX ? 1 : -1;
            const maskWidth = labelMaskWidth(message.label);
            return (
              <g key={message.id} className={`sequence-message sequence-message-${message.kind}${pair ? " sequence-message-paired" : ""}`}>
                <line
                  x1={fromX + direction * 6}
                  y1={cy}
                  x2={toX - direction * 6}
                  y2={cy}
                  markerEnd={MARKER_BY_KIND[message.kind]}
                />
                <rect x={(fromX + toX) / 2 - maskWidth / 2} y={cy - 18} width={maskWidth} height={16} rx={3} />
                <text x={(fromX + toX) / 2} y={cy - 6} textAnchor="middle">{message.label}</text>
                <title>근거 {message.evidenceRefs.length}개</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="sequence-legend" aria-label="시퀀스 범례">
        <span><i className="sequence-legend-call" /> 호출(call)</span>
        <span><i className="sequence-legend-return" /> 반환(return)</span>
        <span><i className="sequence-legend-event" /> 이벤트(event)</span>
        <span className="dim">세로 막대는 해당 구성요소가 처리 중인 구간입니다.</span>
      </div>
    </div>
  );
}
