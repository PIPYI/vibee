/**
 * ScenarioView — swimlane (§6.8, §6.10).
 *
 * branch는 마름모 대신 **분기 표시가 붙은 step**에서 갈라지는 라벨 달린 선으로 그린다.
 * back edge(§6.8의 loop)는 옆 레일의 회귀 호로, `stateChange`는 원인 step 옆에
 * `팔로우 요청: 없음 → 승인 대기` 형태의 주석으로 붙인다(§34).
 */
import type { ScenarioIR, ScenarioStep } from "@onto/protocol";

import { computeScenarioLayout, edgeKey, UNASSIGNED_LANE } from "../layout/scenarioLayout.js";

const COL_WIDTH = 240;
const ROW_HEIGHT = 120;
const BOX_WIDTH = 190;
const BOX_HEIGHT = 60;
const MARGIN_X = 160;
const MARGIN_Y = 50;

function x(rank: number): number {
  return MARGIN_X + rank * COL_WIDTH;
}
function y(laneIndex: number): number {
  return MARGIN_Y + laneIndex * ROW_HEIGHT;
}

export function ScenarioView({
  ir,
  onSelectStep,
  resolveConceptName,
}: {
  ir: ScenarioIR;
  onSelectStep: (step: ScenarioStep) => void;
  resolveConceptName?: (conceptId: string) => string;
}): React.JSX.Element {
  const layout = computeScenarioLayout(ir);
  const stepById = new Map(ir.steps.map((step) => [step.id, step] as const));
  const branchSourceIds = new Set((ir.branches ?? []).map((branch) => branch.sourceStepId));
  const stateChangesByStep = new Map<string, ScenarioIR["stateChanges"]>();
  for (const change of ir.stateChanges ?? []) {
    if (!stateChangesByStep.has(change.causedByStepId)) stateChangesByStep.set(change.causedByStepId, []);
    stateChangesByStep.get(change.causedByStepId)!.push(change);
  }

  const width = x(layout.maxRank) + BOX_WIDTH + 60;
  const laneCount = layout.lanes.filter(
    (id) => id === UNASSIGNED_LANE ? ir.steps.some((step) => !step.participantId) : true,
  ).length;
  const height = y(Math.max(laneCount - 1, 0)) + BOX_HEIGHT + 60;
  const nameOf = resolveConceptName ?? ((id: string) => id);

  const boxCenter = (stepId: string): { cx: number; cy: number; left: number; right: number } => {
    const pos = layout.positions.get(stepId);
    const left = x(pos?.rank ?? 0);
    const top = y(pos?.laneIndex ?? 0);
    return { cx: left + BOX_WIDTH / 2, cy: top + BOX_HEIGHT / 2, left, right: left + BOX_WIDTH };
  };

  return (
    <div className="scenario-view">
      <h2>{ir.name}</h2>
      {ir.goal && <p className="scenario-goal">{ir.goal}</p>}
      <div className="scenario-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--edge-color, #888)" />
            </marker>
          </defs>

          {/* lane 라벨 */}
          {layout.lanes.map((laneId, index) => {
            const inUse = ir.steps.some((step) => (step.participantId ?? UNASSIGNED_LANE) === laneId);
            if (!inUse) return null;
            const participant = ir.participants.find((p) => p.id === laneId);
            return (
              <text key={laneId} x={10} y={y(index) + BOX_HEIGHT / 2} className="lane-label">
                {laneId === UNASSIGNED_LANE ? "(참여자 미지정)" : (participant?.label ?? laneId)}
              </text>
            );
          })}

          {/* transitions */}
          {ir.transitions.map((transition, index) => {
            const isBack = layout.backEdgeKeys.has(edgeKey(transition.fromStepId, transition.toStepId));
            const from = boxCenter(transition.fromStepId);
            const to = boxCenter(transition.toStepId);
            if (isBack) {
              const archX = Math.max(from.right, to.right) + 60;
              const path = `M ${from.right} ${from.cy} C ${archX} ${from.cy}, ${archX} ${to.cy}, ${to.right} ${to.cy}`;
              return (
                <g key={`t-${index}`} data-edge-from={transition.fromStepId} data-edge-to={transition.toStepId}>
                  <path d={path} className="edge edge-back" markerEnd="url(#arrow)" />
                  {transition.condition && (
                    <text x={archX} y={(from.cy + to.cy) / 2} className="edge-label edge-label-back" textAnchor="start" data-detail="context">
                      ↺ {transition.condition}
                    </text>
                  )}
                </g>
              );
            }
            return (
              <g key={`t-${index}`} data-edge-from={transition.fromStepId} data-edge-to={transition.toStepId}>
                <line x1={from.right} y1={from.cy} x2={to.left} y2={to.cy} className="edge" markerEnd="url(#arrow)" />
                {transition.condition && (
                  <text x={(from.right + to.left) / 2} y={(from.cy + to.cy) / 2 - 6} className="edge-label" textAnchor="middle" data-detail="context">
                    {transition.condition}
                  </text>
                )}
              </g>
            );
          })}

          {/* branch paths */}
          {(ir.branches ?? []).map((branch, branchIndex) =>
            branch.paths.map((path, pathIndex) => {
              const from = boxCenter(branch.sourceStepId);
              const to = boxCenter(path.nextStepId);
              return (
                <g
                  key={`b-${branchIndex}-${pathIndex}`}
                  data-edge-from={branch.sourceStepId}
                  data-edge-to={path.nextStepId}
                >
                  <line
                    x1={from.right}
                    y1={from.cy}
                    x2={to.left}
                    y2={to.cy}
                    className="edge edge-branch"
                    markerEnd="url(#arrow)"
                  />
                  <text x={(from.right + to.left) / 2} y={(from.cy + to.cy) / 2 - 6} className="edge-label" textAnchor="middle" data-detail="context">
                    {path.label}
                  </text>
                </g>
              );
            }),
          )}

          {/* steps */}
          {ir.steps.map((step) => {
            const pos = layout.positions.get(step.id);
            const left = x(pos?.rank ?? 0);
            const top = y(pos?.laneIndex ?? 0);
            const changes = stateChangesByStep.get(step.id) ?? [];
            const isEntry = step.id === ir.entryStepId;
            const isOutcome = ir.outcomeStepIds.includes(step.id);
            return (
              <g key={step.id} data-node-id={step.id}>
                <foreignObject x={left} y={top} width={BOX_WIDTH} height={BOX_HEIGHT}>
                  <button
                    type="button"
                    className={`scenario-step ${isEntry ? "scenario-step-entry" : ""} ${isOutcome ? "scenario-step-outcome" : ""}`}
                    onClick={() => onSelectStep(step)}
                    title={step.label}
                  >
                    {branchSourceIds.has(step.id) && <span className="branch-mark" title="분기점">◇</span>}
                    <span className="scenario-step-label">{step.label}</span>
                  </button>
                </foreignObject>
                {changes.length > 0 && (
                  <foreignObject x={left} y={top + BOX_HEIGHT + 2} width={BOX_WIDTH} height={changes.length * 16 + 4}>
                    <div className="state-change-note" data-detail="context">
                      {changes.map((change, index) => (
                        <div key={index}>
                          {nameOf(change.subjectConceptId)}: {change.from ?? "∅"} → {change.to ?? "∅"}
                        </div>
                      ))}
                    </div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="scenario-legend">
        <span className="legend-swatch legend-entry" /> 시작({stepById.get(ir.entryStepId)?.label ?? ir.entryStepId}) ·{" "}
        <span className="legend-swatch legend-outcome" /> 종료 · ◇ 분기 · <span className="legend-swatch legend-back" /> 회귀(loop)
      </p>
    </div>
  );
}
