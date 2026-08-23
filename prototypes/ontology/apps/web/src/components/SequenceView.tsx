/**
 * SequenceView — schema3 §3.4~§3.5. 워크플로우 엣지 라벨을 클릭하면 열리는 시퀀스 다이어그램.
 * archify sequence.json의 표현 문법(lifeline · activation bar · phase segment)을 빌린
 * `ScenarioActivation`/`ScenarioPhase`를 그대로 쓴다(schema2 §5).
 *
 * `SequenceMessage.order`는 좌표가 아니라 정수 전순서다(A7·A12 재확인) — 렌더러가 정렬한
 * 순서대로 행(row)을 배정한다. activation/phase의 `fromStepId`/`toStepId`는 `SequenceIR`에
 * `steps[]`가 없으므로 **`SequenceMessage.id`**를 가리키는 것으로 해석한다
 * (`analysis-bundle-validator.ts`가 이렇게 검증한다).
 */
import type { SequenceIR } from "@onto/protocol";

const LANE_WIDTH = 180;
const ROW_HEIGHT = 56;
const MARGIN_X = 40;
const MARGIN_TOP = 70;
const MARGIN_BOTTOM = 30;
const ACTIVATION_WIDTH = 10;

export function SequenceView({ ir }: { ir: SequenceIR }): React.JSX.Element {
  const participants = ir.participants;
  const laneX = new Map(participants.map((p, index) => [p.id, MARGIN_X + index * LANE_WIDTH + LANE_WIDTH / 2]));

  const orderedMessages = [...ir.messages].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rowOf = new Map(orderedMessages.map((message, index) => [message.id, index]));
  const rowY = (row: number): number => MARGIN_TOP + row * ROW_HEIGHT;

  const width = MARGIN_X * 2 + Math.max(1, participants.length) * LANE_WIDTH;
  const height = MARGIN_TOP + Math.max(1, orderedMessages.length) * ROW_HEIGHT + MARGIN_BOTTOM;

  const phases = ir.phases ?? [];
  const activations = ir.activations ?? [];

  return (
    <div className="sequence-view">
      <h3>{ir.title}</h3>
      <div className="scenario-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas">
          <defs>
            <marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--edge-color, #888)" />
            </marker>
            <marker id="seq-arrow-return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="none" stroke="var(--edge-color, #888)" strokeWidth="1" />
            </marker>
          </defs>

          {/* phase band — 가로 전체를 덮는 국면 구간 */}
          {phases.map((phase) => {
            const fromRow = rowOf.get(phase.fromStepId);
            const toRow = rowOf.get(phase.toStepId);
            if (fromRow === undefined || toRow === undefined) return null;
            const top = rowY(Math.min(fromRow, toRow)) - ROW_HEIGHT / 2;
            const bottom = rowY(Math.max(fromRow, toRow)) + ROW_HEIGHT / 2;
            return (
              <g key={phase.id} data-detail="context">
                <rect x={4} y={top} width={width - 8} height={bottom - top} className="phase-band" rx={10} />
                <text x={12} y={top + 14} className="phase-band-label">
                  {phase.label}
                </text>
              </g>
            );
          })}

          {/* lifelines */}
          {participants.map((participant) => {
            const cx = laneX.get(participant.id) ?? MARGIN_X;
            return (
              <g key={participant.id}>
                <line x1={cx} y1={MARGIN_TOP - 20} x2={cx} y2={height - MARGIN_BOTTOM + 10} className="sequence-lifeline" />
                <text x={cx} y={MARGIN_TOP - 30} className="lane-label" textAnchor="middle">
                  {participant.label}
                </text>
              </g>
            );
          })}

          {/* activation bars */}
          {activations.map((activation, index) => {
            const cx = laneX.get(activation.participantId);
            const fromRow = rowOf.get(activation.fromStepId);
            const toRow = rowOf.get(activation.toStepId);
            if (cx === undefined || fromRow === undefined || toRow === undefined) return null;
            const top = rowY(Math.min(fromRow, toRow));
            const bottom = rowY(Math.max(fromRow, toRow));
            return (
              <rect
                key={`act-${index}`}
                x={cx - ACTIVATION_WIDTH / 2}
                y={top}
                width={ACTIVATION_WIDTH}
                height={Math.max(ROW_HEIGHT / 2, bottom - top)}
                className="sequence-activation"
                data-detail="context"
              />
            );
          })}

          {/* messages */}
          {orderedMessages.map((message) => {
            const row = rowOf.get(message.id) ?? 0;
            const cy = rowY(row);
            const fromX = laneX.get(message.fromParticipantId);
            const toX = laneX.get(message.toParticipantId);
            if (fromX === undefined || toX === undefined) return null;
            const isSelf = message.fromParticipantId === message.toParticipantId;
            const isReturn = message.kind === "return";
            if (isSelf) {
              return (
                <g key={message.id} data-node-id={message.id}>
                  <path
                    d={`M ${fromX} ${cy} C ${fromX + 40} ${cy - 14}, ${fromX + 40} ${cy + 14}, ${fromX} ${cy + 2}`}
                    className="edge"
                    markerEnd="url(#seq-arrow)"
                  />
                  <text x={fromX + 46} y={cy} className="edge-label" data-detail="context">
                    {message.label}
                  </text>
                </g>
              );
            }
            return (
              <g key={message.id} data-node-id={message.id}>
                <line
                  x1={fromX}
                  y1={cy}
                  x2={toX}
                  y2={cy}
                  className={`edge${isReturn ? " edge-return" : ""}`}
                  markerEnd={isReturn ? "url(#seq-arrow-return)" : "url(#seq-arrow)"}
                  strokeDasharray={isReturn ? "4 3" : undefined}
                />
                <text x={(fromX + toX) / 2} y={cy - 6} className="edge-label" textAnchor="middle" data-detail="context">
                  {message.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
