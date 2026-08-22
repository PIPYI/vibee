/**
 * ScenarioView — swimlane (§6.8, §6.10).
 *
 * branch는 마름모 대신 **분기 표시가 붙은 step**에서 갈라지는 라벨 달린 선으로 그린다.
 * back edge(§6.8의 loop)는 옆 레일의 회귀 호로, `stateChange`는 원인 step 옆에
 * `팔로우 요청: 없음 → 승인 대기` 형태의 주석으로 붙인다(§34).
 *
 * 엣지 라우팅은 schema2 §1.2 A10·M10 — 한 노드의 같은 면에서 만나는 엣지는 세로로 펼치고
 * (routeEdges), 세로로 어긋난 포트는 직선 대신 둥근 elbow로 잇는다(routedPath). 라벨은
 * 겹치면 자동으로 밀려난다(resolveLabelOverlaps). 좌표는 이 렌더러가 IR로부터 결정론적으로
 * 계산할 뿐 IR에도 store에도 쓰지 않는다(A7·I10).
 */
import type { ScenarioIR, ScenarioStep } from "@onto/protocol";

import { type Box, type LabelBox, resolveLabelOverlaps, routedPath, routeEdges } from "../layout/edgeRouting.js";
import { computeScenarioLayout, edgeKey, UNASSIGNED_LANE } from "../layout/scenarioLayout.js";

const COL_WIDTH = 240;
const ROW_HEIGHT = 120;
const BOX_WIDTH = 190;
const BOX_HEIGHT = 60;
const MARGIN_X = 160;
const MARGIN_Y = 50;
/** 라벨 충돌 판정용 대략치 — 한글·영문 혼용 텍스트를 안전 쪽으로 넉넉하게 잡는다. */
const LABEL_CHAR_WIDTH = 7.5;
const LABEL_HEIGHT = 14;

function x(rank: number): number {
  return MARGIN_X + rank * COL_WIDTH;
}
function y(laneIndex: number): number {
  return MARGIN_Y + laneIndex * ROW_HEIGHT;
}

function labelBox(id: string, cx: number, cy: number, text: string): LabelBox {
  const width = Math.max(24, text.length * LABEL_CHAR_WIDTH);
  return { id, x: cx - width / 2, y: cy - LABEL_HEIGHT, width, height: LABEL_HEIGHT };
}

type PendingLabel = { id: string; cx: number; baseY: number; text: string; className: string; textAnchor: "start" | "middle" };

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

  // 라우팅 대상 = back edge가 아닌 transition + 모든 branch path. back edge는 별도 arc로 그린다.
  const boxes = new Map<string, Box>();
  for (const step of ir.steps) {
    const pos = layout.positions.get(step.id);
    const left = x(pos?.rank ?? 0);
    const top = y(pos?.laneIndex ?? 0);
    boxes.set(step.id, { id: step.id, left, top, right: left + BOX_WIDTH, bottom: top + BOX_HEIGHT, cy: top + BOX_HEIGHT / 2 });
  }
  const forwardTransitions = ir.transitions
    .map((transition, index) => ({ transition, index }))
    .filter(({ transition }) => !layout.backEdgeKeys.has(edgeKey(transition.fromStepId, transition.toStepId)));
  const routableEdges = [
    ...forwardTransitions.map(({ transition, index }) => ({
      key: `t-${index}`,
      fromId: transition.fromStepId,
      toId: transition.toStepId,
    })),
    ...(ir.branches ?? []).flatMap((branch, branchIndex) =>
      branch.paths.map((path, pathIndex) => ({
        key: `b-${branchIndex}-${pathIndex}`,
        fromId: branch.sourceStepId,
        toId: path.nextStepId,
      })),
    ),
  ];
  const routed = new Map(routeEdges(routableEdges, (id) => boxes.get(id)).map((edge) => [edge.key, edge] as const));

  // 라벨 충돌 회피 — 모든 edge label(back edge 포함)을 한 번에 모아 계산한다.
  const pendingLabels: PendingLabel[] = [];
  for (const { transition, index } of forwardTransitions) {
    if (!transition.condition) continue;
    const route = routed.get(`t-${index}`);
    if (!route) continue;
    const cx = (route.fromPort.x + route.toPort.x) / 2;
    const cy = (route.fromPort.y + route.toPort.y) / 2 - 6;
    pendingLabels.push({ id: `t-${index}`, cx, baseY: cy, text: transition.condition, className: "edge-label", textAnchor: "middle" });
  }
  ir.transitions.forEach((transition, index) => {
    if (!layout.backEdgeKeys.has(edgeKey(transition.fromStepId, transition.toStepId)) || !transition.condition) return;
    const from = boxCenter(transition.fromStepId);
    const to = boxCenter(transition.toStepId);
    const archX = Math.max(from.right, to.right) + 60;
    pendingLabels.push({
      id: `tb-${index}`,
      cx: archX + (transition.condition.length * LABEL_CHAR_WIDTH) / 2,
      baseY: (from.cy + to.cy) / 2,
      text: `↺ ${transition.condition}`,
      className: "edge-label edge-label-back",
      textAnchor: "start",
    });
  });
  (ir.branches ?? []).forEach((branch, branchIndex) => {
    branch.paths.forEach((path, pathIndex) => {
      const key = `b-${branchIndex}-${pathIndex}`;
      const route = routed.get(key);
      if (!route) return;
      const cx = (route.fromPort.x + route.toPort.x) / 2;
      const cy = (route.fromPort.y + route.toPort.y) / 2 - 6;
      pendingLabels.push({ id: key, cx, baseY: cy, text: path.label, className: "edge-label", textAnchor: "middle" });
    });
  });
  const labelOffsets = resolveLabelOverlaps(pendingLabels.map((l) => labelBox(l.id, l.cx, l.baseY, l.text)));

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
            <marker id="arrow-return" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="none" stroke="var(--edge-color, #888)" strokeWidth="1" />
            </marker>
          </defs>

          {/* phase band — schema2 §5. 국면 구간을 배경에 깐다. Reading Depth가 MAP에서 접는다. */}
          {(ir.phases ?? []).map((phase) => {
            const from = boxCenter(phase.fromStepId);
            const to = boxCenter(phase.toStepId);
            if (!from || !to) return null;
            const left = Math.min(from.left, to.left) - 16;
            const right = Math.max(from.right, to.right) + 16;
            return (
              <g key={phase.id} data-detail="context">
                <rect x={left} y={8} width={right - left} height={height - 16} className="phase-band" rx={10} />
                <text x={left + 8} y={22} className="phase-band-label">
                  {phase.label}
                </text>
              </g>
            );
          })}

          {/* activation bar — schema2 §5. 참여자가 활성인 step 구간을 lane 아래 얇은 띠로 보여준다. */}
          {(ir.activations ?? []).map((activation, index) => {
            const laneIndex = layout.lanes.indexOf(activation.participantId);
            if (laneIndex < 0) return null;
            const from = boxCenter(activation.fromStepId);
            const to = boxCenter(activation.toStepId);
            if (!from || !to) return null;
            const left = Math.min(from.left, to.left);
            const right = Math.max(from.right, to.right);
            return (
              <rect
                key={`act-${index}`}
                x={left}
                y={y(laneIndex) + BOX_HEIGHT + 6}
                width={right - left}
                height={4}
                className="activation-bar"
                data-detail="context"
              />
            );
          })}

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
            if (isBack) {
              const from = boxCenter(transition.fromStepId);
              const to = boxCenter(transition.toStepId);
              const archX = Math.max(from.right, to.right) + 60;
              const path = `M ${from.right} ${from.cy} C ${archX} ${from.cy}, ${archX} ${to.cy}, ${to.right} ${to.cy}`;
              const label = pendingLabels.find((l) => l.id === `tb-${index}`);
              return (
                <g key={`t-${index}`} data-edge-from={transition.fromStepId} data-edge-to={transition.toStepId}>
                  <path d={path} className="edge edge-back" markerEnd="url(#arrow)" />
                  {label && (
                    <text
                      x={label.cx}
                      y={label.baseY + (labelOffsets.get(label.id) ?? 0)}
                      className={label.className}
                      textAnchor={label.textAnchor}
                      data-detail="context"
                    >
                      {label.text}
                    </text>
                  )}
                </g>
              );
            }
            const route = routed.get(`t-${index}`);
            if (!route) return null;
            const label = pendingLabels.find((l) => l.id === `t-${index}`);
            const isReturn = transition.kind === "return";
            return (
              <g key={`t-${index}`} data-edge-from={transition.fromStepId} data-edge-to={transition.toStepId}>
                <path
                  d={routedPath(route.fromPort, route.toPort)}
                  className={`edge${isReturn ? " edge-return" : ""}`}
                  markerEnd={isReturn ? "url(#arrow-return)" : "url(#arrow)"}
                />
                {label && (
                  <text
                    x={label.cx}
                    y={label.baseY + (labelOffsets.get(label.id) ?? 0)}
                    className={label.className}
                    textAnchor={label.textAnchor}
                    data-detail="context"
                  >
                    {label.text}
                  </text>
                )}
              </g>
            );
          })}

          {/* branch paths */}
          {(ir.branches ?? []).map((branch, branchIndex) =>
            branch.paths.map((path, pathIndex) => {
              const key = `b-${branchIndex}-${pathIndex}`;
              const route = routed.get(key);
              if (!route) return null;
              const label = pendingLabels.find((l) => l.id === key);
              return (
                <g key={key} data-edge-from={branch.sourceStepId} data-edge-to={path.nextStepId}>
                  <path d={routedPath(route.fromPort, route.toPort)} className="edge edge-branch" markerEnd="url(#arrow)" />
                  {label && (
                    <text
                      x={label.cx}
                      y={label.baseY + (labelOffsets.get(label.id) ?? 0)}
                      className={label.className}
                      textAnchor={label.textAnchor}
                      data-detail="context"
                    >
                      {label.text}
                    </text>
                  )}
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
