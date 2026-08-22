/**
 * TraceView — hop으로 층을 나눈다(§6.6).
 *
 * **`nonForward` 엣지를 Scenario back edge와 같은 회귀 호로 그리고, `cycle`은 SCC 묶음
 * 표시로 따로 보여준다.** 링크 방향은 코드에 있는 그대로다 — 역방향으로 도달했다고 뒤집지
 * 않는다.
 *
 * 정방향 링크는 schema2 §1.2 A10·M10대로 port spread + elbow routing을 쓴다(edgeRouting.js).
 * `nonForward` 회귀 호와 self-loop는 이 라우팅 대상이 아니다 — Scenario back edge와 같은
 * 이유로 별도 arc로 남긴다.
 */
import type { TraceIR } from "@onto/protocol";

import { type Box, resolveLabelOverlaps, routedPath, routeEdges } from "../layout/edgeRouting.js";
import { computeTraceLayout } from "../layout/traceLayout.js";

const COL_WIDTH = 260;
const ROW_HEIGHT = 70;
const BOX_WIDTH = 210;
const BOX_HEIGHT = 48;
const MARGIN_X = 40;
const MARGIN_Y = 40;
const LABEL_CHAR_WIDTH = 7.5;
const LABEL_HEIGHT = 14;

/** sccId 문자열에서 안정적인 색을 뽑는다 — 실행마다 같은 SCC는 같은 색이어야 한다. */
function colorForScc(sccId: string): string {
  let hash = 0;
  for (let i = 0; i < sccId.length; i += 1) hash = (hash * 31 + sccId.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 65%, 55%)`;
}

export function TraceView({
  ir,
  onSelectEntity,
}: {
  ir: TraceIR;
  onSelectEntity?: (entityId: string) => void;
}): React.JSX.Element {
  const layout = computeTraceLayout(ir.codeEntities);
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

  const forwardLinks = ir.links
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => !link.selfLoop && !link.nonForward);
  const routed = new Map(
    routeEdges(
      forwardLinks.map(({ link, index }) => ({ key: `l-${index}`, fromId: link.fromId, toId: link.toId })),
      (id) => boxes.get(id),
    ).map((edge) => [edge.key, edge] as const),
  );

  // self-loop 라벨끼리도 세로로 붙어 있으면 밀어낸다.
  const selfLoopLabels = ir.links
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => link.selfLoop)
    .map(({ link, index }) => {
      const box = boxes.get(link.fromId);
      if (!box) return null;
      const text = "↻ self";
      return { id: `sl-${index}`, x: box.right + 4, y: box.cy, width: Math.max(24, text.length * LABEL_CHAR_WIDTH), height: LABEL_HEIGHT, text };
    })
    .filter((item): item is { id: string; x: number; y: number; width: number; height: number; text: string } => item !== null);
  const labelOffsets = resolveLabelOverlaps(selfLoopLabels);

  return (
    <div className="trace-view">
      <h2>Trace</h2>
      {ir.truncatedAtHop !== undefined && (
        <p className="trace-truncated">
          hop {ir.truncatedAtHop}에서 잘렸습니다 — 뷰어가 멈추지 않도록 여기서 접었습니다.
        </p>
      )}
      <div className="scenario-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas">
          <defs>
            <marker id="trace-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--edge-color, #888)" />
            </marker>
          </defs>

          {layout.columns.map((column) => (
            <text key={column.hop} x={MARGIN_X + column.hop * COL_WIDTH + BOX_WIDTH / 2} y={20} className="lane-label" textAnchor="middle">
              hop {column.hop}
            </text>
          ))}

          {ir.links.map((link, index) => {
            if (link.selfLoop) {
              const label = selfLoopLabels.find((l) => l.id === `sl-${index}`);
              if (!label) return null;
              return (
                <text
                  key={index}
                  x={label.x}
                  y={label.y + (labelOffsets.get(label.id) ?? 0)}
                  className="edge-label"
                  fontSize={11}
                  data-edge-from={link.fromId}
                  data-edge-to={link.toId}
                >
                  {label.text}
                </text>
              );
            }
            // nonForward는 Scenario back edge와 같은 회귀 호로 그린다 (§6.6).
            if (link.nonForward) {
              const from = boxes.get(link.fromId);
              const to = boxes.get(link.toId);
              if (!from || !to) return null;
              const archX = Math.max(from.right, to.right) + 50;
              const path = `M ${from.right} ${from.cy} C ${archX} ${from.cy}, ${archX} ${to.cy}, ${to.right} ${to.cy}`;
              return (
                <path
                  key={index}
                  d={path}
                  className="edge edge-back"
                  markerEnd="url(#trace-arrow)"
                  data-edge-from={link.fromId}
                  data-edge-to={link.toId}
                />
              );
            }
            const route = routed.get(`l-${index}`);
            if (!route) return null;
            return (
              <path
                key={index}
                d={routedPath(route.fromPort, route.toPort)}
                className="edge"
                markerEnd="url(#trace-arrow)"
                data-edge-from={link.fromId}
                data-edge-to={link.toId}
              />
            );
          })}

          {ir.codeEntities.map((entity) => {
            const box = boxes.get(entity.id);
            if (!box) return null;
            return (
              <g key={entity.id} data-node-id={entity.id}>
                <foreignObject x={box.left} y={box.top} width={BOX_WIDTH} height={BOX_HEIGHT}>
                  <button
                    type="button"
                    className="trace-entity"
                    style={entity.sccId ? { borderColor: colorForScc(entity.sccId) } : undefined}
                    onClick={() => onSelectEntity?.(entity.id)}
                    title={`${entity.kind}${entity.filePath ? ` · ${entity.filePath}` : ""}`}
                  >
                    <span className="trace-entity-kind" data-detail="context">{entity.kind}</span>
                    <span className="trace-entity-label">{entity.label}</span>
                    {entity.sccId && <span className="scc-mark" title="이 그룹은 서로 순환 참조합니다">⟲</span>}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="scenario-legend">
        <span className="legend-swatch legend-back" /> 회귀(nonForward, 레이아웃 전용) · ⟲ 순환(SCC, 색이 같으면 같은 그룹)
      </p>
    </div>
  );
}
