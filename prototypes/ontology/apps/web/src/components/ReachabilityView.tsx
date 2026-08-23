/**
 * ReachabilityView — schema2 §6, M12. **Impact가 아니라 authored reachability**다.
 *
 * 결정론적 투영이라 Trace와 같은 layout(hop 컬럼)을 그대로 쓴다 — `ReachabilityNode`가
 * `{id, kind, label, hop}`을 이미 갖고 있어 `computeTraceLayout`을 다시 구현하지 않는다.
 * 엣지 라우팅도 M10의 `routeEdges`/`routedPath`를 그대로 쓴다 — cycle·nonForward·selfLoop
 * 개념이 없어 Trace보다 단순하다(그 자체가 결정: 인과가 아니라 도달 가능성만 보여준다).
 */
import type { ReachabilityIR } from "@onto/protocol";

import { type Box, routedPath, routeEdges } from "../layout/edgeRouting.js";
import { computeTraceLayout } from "../layout/traceLayout.js";

const COL_WIDTH = 260;
const ROW_HEIGHT = 70;
const BOX_WIDTH = 210;
const BOX_HEIGHT = 48;
const MARGIN_X = 40;
const MARGIN_Y = 40;

export function ReachabilityView({
  ir,
  onSelectNode,
}: {
  ir: ReachabilityIR;
  onSelectNode?: (nodeId: string) => void;
}): React.JSX.Element {
  const layout = computeTraceLayout(ir.nodes);
  const boxes = new Map<string, Box>();
  for (const column of layout.columns) {
    column.entities.forEach((entity, index) => {
      const left = MARGIN_X + column.hop * COL_WIDTH;
      const top = MARGIN_Y + index * ROW_HEIGHT;
      boxes.set(entity.id, { id: entity.id, left, top, right: left + BOX_WIDTH, bottom: top + BOX_HEIGHT, cy: top + BOX_HEIGHT / 2 });
    });
  }
  const maxRows = Math.max(1, ...layout.columns.map((c) => c.entities.length));
  const width = MARGIN_X + (layout.maxHop + 1) * COL_WIDTH + 40;
  const height = MARGIN_Y + maxRows * ROW_HEIGHT + 40;

  const routed = new Map(
    routeEdges(
      ir.links.map((link, index) => ({ key: `l-${index}`, fromId: link.fromId, toId: link.toId })),
      (id) => boxes.get(id),
    ).map((edge) => [edge.key, edge] as const),
  );

  const directionLabel = ir.direction === "upstream" ? "업스트림 — 무엇이 여기로 이어지는가" : "다운스트림 — 여기서 무엇으로 이어지는가";

  return (
    <div className="trace-view">
      <h2>도달 범위(authored reachability)</h2>
      <p className="scenario-goal">
        {directionLabel}. <span className="dim">인덱싱된 관계로 도달 가능하다는 뜻이며, 실행 시 영향·인과를 보장하지 않습니다.</span>
      </p>
      {ir.truncatedAtHop !== undefined && (
        <p className="trace-truncated">
          hop {ir.truncatedAtHop}에서 잘렸습니다 — 뷰어가 멈추지 않도록 여기서 접었습니다.
        </p>
      )}
      <div className="scenario-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas">
          <defs>
            <marker id="reach-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--edge-color, #888)" />
            </marker>
          </defs>

          {layout.columns.map((column) => (
            <text key={column.hop} x={MARGIN_X + column.hop * COL_WIDTH + BOX_WIDTH / 2} y={20} className="lane-label" textAnchor="middle">
              hop {column.hop}
            </text>
          ))}

          {ir.links.map((link, index) => {
            const route = routed.get(`l-${index}`);
            if (!route) return null;
            return (
              <path
                key={index}
                d={routedPath(route.fromPort, route.toPort)}
                className="edge"
                markerEnd="url(#reach-arrow)"
                data-edge-from={link.fromId}
                data-edge-to={link.toId}
              />
            );
          })}

          {ir.nodes.map((node) => {
            const box = boxes.get(node.id);
            if (!box) return null;
            return (
              <g key={node.id} data-node-id={node.id}>
                <foreignObject x={box.left} y={box.top} width={BOX_WIDTH} height={BOX_HEIGHT}>
                  <button
                    type="button"
                    className="trace-entity"
                    onClick={() => onSelectNode?.(node.id)}
                    title={`${node.kind}${node.filePath ? ` · ${node.filePath}` : ""}`}
                  >
                    <span className="trace-entity-kind" data-detail="context">{node.kind}</span>
                    <span className="trace-entity-label">{node.label}</span>
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
