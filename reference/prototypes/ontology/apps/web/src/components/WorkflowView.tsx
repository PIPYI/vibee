/**
 * WorkflowView — schema3 §3.3, §3.4. archify workflow.json이 보여주던 사용자 기반 흐름을
 * 재현한다. lane은 `WorkflowLane`이 이미 순서를 주고, rank는 `workflowLayout.ts`가
 * 결정론적으로 계산한다(A7 재확인). `mainPath`는 해피패스로 강조한다.
 *
 * **엣지 라벨 클릭** — `sequenceRef`가 있는 edge의 라벨(예: "위치 · 추천 조회")을 클릭하면
 * `onSelectEdge`가 불린다. 그 시퀀스는 분석 시점에 이미 생성되어 있으므로(§3.4) 클릭은
 * 조회일 뿐 새 요청을 만들지 않는다 — 상위 컴포넌트가 이미 들고 있는 `sequences[]`에서
 * `sequenceRef`로 찾기만 한다.
 */
import type { WorkflowEdge, WorkflowIR } from "@onto/protocol";

import { type Box, type LabelBox, resolveLabelOverlaps, routedPath, routeEdges } from "../layout/edgeRouting.js";
import { computeWorkflowLayout, edgeKey } from "../layout/workflowLayout.js";

const COL_WIDTH = 240;
const ROW_HEIGHT = 110;
const BOX_WIDTH = 190;
const BOX_HEIGHT = 56;
const MARGIN_X = 160;
const MARGIN_Y = 50;
const LABEL_CHAR_WIDTH = 7.5;
const LABEL_HEIGHT = 14;
const SUB_SLOT_HEIGHT = 26;

function x(rank: number): number {
  return MARGIN_X + rank * COL_WIDTH;
}
/** `laneSlot`/`slotCount`는 같은 (rank, lane) 칸에 겹치는 노드가 둘 이상일 때만 0이 아니다. */
function y(laneIndex: number, laneSlot = 0, slotCount = 1): number {
  const offset = slotCount > 1 ? (laneSlot - (slotCount - 1) / 2) * SUB_SLOT_HEIGHT : 0;
  return MARGIN_Y + laneIndex * ROW_HEIGHT + offset;
}

function labelBox(id: string, cx: number, cy: number, text: string): LabelBox {
  const width = Math.max(24, text.length * LABEL_CHAR_WIDTH);
  return { id, x: cx - width / 2, y: cy - LABEL_HEIGHT, width, height: LABEL_HEIGHT };
}

export function WorkflowView({
  ir,
  onSelectNode,
  onSelectEdge,
}: {
  ir: WorkflowIR;
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edge: WorkflowEdge) => void;
}): React.JSX.Element {
  const layout = computeWorkflowLayout(ir);
  const mainPathSet = new Set(ir.mainPath);
  const mainPathEdgeKeys = new Set(
    ir.mainPath.slice(0, -1).map((id, index) => edgeKey(id, ir.mainPath[index + 1]!)),
  );

  const width = x(layout.maxRank) + BOX_WIDTH + 60;
  const height = y(Math.max(layout.lanes.length - 1, 0)) + BOX_HEIGHT + 60 + SUB_SLOT_HEIGHT * 2;

  const boxes = new Map<string, Box>();
  for (const node of ir.nodes) {
    const pos = layout.positions.get(node.id);
    const left = x(pos?.rank ?? 0);
    const top = y(pos?.laneIndex ?? 0, pos?.laneSlot ?? 0, pos?.slotCount ?? 1);
    boxes.set(node.id, { id: node.id, left, top, right: left + BOX_WIDTH, bottom: top + BOX_HEIGHT, cy: top + BOX_HEIGHT / 2 });
  }
  const boxCenter = (nodeId: string): { cx: number; cy: number; left: number; right: number } => {
    const box = boxes.get(nodeId);
    return box
      ? { cx: (box.left + box.right) / 2, cy: box.cy, left: box.left, right: box.right }
      : { cx: 0, cy: 0, left: 0, right: 0 };
  };

  const forwardEdges = ir.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => !layout.backEdgeKeys.has(edgeKey(edge.from, edge.to)));
  const routed = new Map(
    routeEdges(
      forwardEdges.map(({ edge, index }) => ({ key: `e-${index}`, fromId: edge.from, toId: edge.to })),
      (id) => boxes.get(id),
    ).map((route) => [route.key, route] as const),
  );

  type PendingLabel = { id: string; cx: number; baseY: number; text: string; clickable: boolean; edge: WorkflowEdge };
  const pendingLabels: PendingLabel[] = [];
  for (const { edge, index } of forwardEdges) {
    if (!edge.label) continue;
    const route = routed.get(`e-${index}`);
    if (!route) continue;
    const cx = (route.fromPort.x + route.toPort.x) / 2;
    const cy = (route.fromPort.y + route.toPort.y) / 2 - 6;
    pendingLabels.push({ id: `e-${index}`, cx, baseY: cy, text: edge.label, clickable: Boolean(edge.sequenceRef), edge });
  }
  ir.edges.forEach((edge, index) => {
    if (!layout.backEdgeKeys.has(edgeKey(edge.from, edge.to)) || !edge.label) return;
    const from = boxCenter(edge.from);
    const to = boxCenter(edge.to);
    const archX = Math.max(from.right, to.right) + 60;
    pendingLabels.push({
      id: `eb-${index}`,
      cx: archX + (edge.label.length * LABEL_CHAR_WIDTH) / 2,
      baseY: (from.cy + to.cy) / 2,
      text: edge.label,
      clickable: Boolean(edge.sequenceRef),
      edge,
    });
  });
  const labelOffsets = resolveLabelOverlaps(pendingLabels.map((l) => labelBox(l.id, l.cx, l.baseY, l.text)));

  return (
    <div className="workflow-view">
      <h2>{ir.title}</h2>
      <div className="scenario-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas">
          <defs>
            <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--edge-color, #888)" />
            </marker>
            <marker id="wf-arrow-main" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
            </marker>
          </defs>

          {layout.lanes.map((laneId, index) => {
            const inUse = ir.nodes.some((node) => node.laneId === laneId);
            if (!inUse) return null;
            const lane = ir.lanes.find((l) => l.id === laneId);
            return (
              <text key={laneId} x={10} y={y(index) + BOX_HEIGHT / 2} className="lane-label">
                {lane?.label ?? laneId}
              </text>
            );
          })}

          {ir.edges.map((edge, index) => {
            const isBack = layout.backEdgeKeys.has(edgeKey(edge.from, edge.to));
            const isMain = mainPathEdgeKeys.has(edgeKey(edge.from, edge.to));
            const label = pendingLabels.find((l) => l.id === (isBack ? `eb-${index}` : `e-${index}`));
            const labelEl = label && (
              <text
                x={label.cx}
                y={label.baseY + (labelOffsets.get(label.id) ?? 0)}
                className={`edge-label workflow-edge-label${label.clickable ? " workflow-edge-label-clickable" : ""}`}
                textAnchor={isBack ? "start" : "middle"}
                data-detail={label.clickable ? undefined : "context"}
                onClick={label.clickable ? () => onSelectEdge?.(label.edge) : undefined}
                role={label.clickable ? "button" : undefined}
                tabIndex={label.clickable ? 0 : undefined}
              >
                {isBack ? "↺ " : ""}
                {label.text}
                {label.clickable ? " ▶" : ""}
              </text>
            );
            if (isBack) {
              const from = boxCenter(edge.from);
              const to = boxCenter(edge.to);
              const archX = Math.max(from.right, to.right) + 60;
              const path = `M ${from.right} ${from.cy} C ${archX} ${from.cy}, ${archX} ${to.cy}, ${to.right} ${to.cy}`;
              return (
                <g key={edge.id} data-edge-from={edge.from} data-edge-to={edge.to}>
                  <path d={path} className={`edge edge-back workflow-edge-${edge.role}`} markerEnd="url(#wf-arrow)" />
                  {labelEl}
                </g>
              );
            }
            const route = routed.get(`e-${index}`);
            if (!route) return null;
            return (
              <g key={edge.id} data-edge-from={edge.from} data-edge-to={edge.to}>
                <path
                  d={routedPath(route.fromPort, route.toPort)}
                  className={`edge workflow-edge-${edge.role}${isMain ? " workflow-edge-main" : ""}`}
                  markerEnd={isMain ? "url(#wf-arrow-main)" : "url(#wf-arrow)"}
                />
                {labelEl}
              </g>
            );
          })}

          {ir.nodes.map((node) => {
            const box = boxes.get(node.id);
            if (!box) return null;
            const isMain = mainPathSet.has(node.id);
            return (
              <g key={node.id} data-node-id={node.id}>
                <foreignObject x={box.left} y={box.top} width={BOX_WIDTH} height={BOX_HEIGHT}>
                  <button
                    type="button"
                    className={`scenario-step workflow-node${isMain ? " workflow-node-main" : ""}`}
                    onClick={() => onSelectNode?.(node.id)}
                    title={node.sublabel ?? node.label}
                  >
                    <span className={`pt-dot pt-${node.presentationType}`} data-detail="context" />
                    <span className="scenario-step-label">{node.label}</span>
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="scenario-legend">
        <span className="legend-swatch" style={{ background: "var(--accent)" }} /> mainPath(해피패스) ·{" "}
        <span className="legend-swatch legend-back" /> 회귀 · 라벨 뒤 ▶는 클릭하면 시퀀스가 열립니다
      </p>
    </div>
  );
}
