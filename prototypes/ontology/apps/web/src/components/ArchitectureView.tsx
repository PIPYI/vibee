/**
 * ArchitectureView — schema3 §3.2, §7. archify architecture.json이 보여주던 결과물 형태를
 * 재현하되, 좌표는 IR에 없고 이 렌더러가 `architectureLayout.ts`로 결정론적으로 계산한다
 * (A7 재확인). `boundaries[]`는 member component들의 계산된 bounding box를 감싸는 배경
 * 박스로 그린다 — boundary 자체에는 좌표가 없다.
 *
 * 엣지 라우팅은 `edgeRouting.ts`(M10)를 TraceView/ScenarioView와 동일하게 재사용한다.
 */
import type { ArchitectureComponent, ArchitectureIR } from "@onto/protocol";

import { computeArchitectureLayout } from "../layout/architectureLayout.js";
import { type Box, routedPath, routeEdges } from "../layout/edgeRouting.js";

const COL_WIDTH = 260;
const ROW_HEIGHT = 92;
const BOX_WIDTH = 210;
const BOX_HEIGHT = 64;
const MARGIN_X = 40;
const MARGIN_Y = 60;
const BOUNDARY_PAD = 20;

const ROLE_LABEL: Record<string, string> = { sync: "동기", async: "비동기", data: "데이터", control: "제어" };

function presentationDot(component: ArchitectureComponent): React.JSX.Element {
  return (
    <span
      className={`pt-dot pt-${component.presentationType}`}
      title={
        component.presentationTypeConfidence !== undefined
          ? `${component.presentationType} (신뢰도 ${component.presentationTypeConfidence.toFixed(2)})`
          : component.presentationType
      }
    />
  );
}

export function ArchitectureView({
  ir,
  onSelectComponent,
}: {
  ir: ArchitectureIR;
  onSelectComponent?: (componentId: string) => void;
}): React.JSX.Element {
  const layout = computeArchitectureLayout(ir);
  const boxes = new Map<string, Box>();
  for (const component of ir.components) {
    const pos = layout.positions.get(component.id);
    const left = MARGIN_X + (pos?.rank ?? 0) * COL_WIDTH;
    const top = MARGIN_Y + (pos?.index ?? 0) * ROW_HEIGHT;
    boxes.set(component.id, {
      id: component.id,
      left,
      top,
      right: left + BOX_WIDTH,
      bottom: top + BOX_HEIGHT,
      cy: top + BOX_HEIGHT / 2,
    });
  }

  const maxRows = Math.max(1, ...[...layout.rowsByRank.values()]);
  const width = MARGIN_X + (layout.maxRank + 1) * COL_WIDTH + 40;
  const height = MARGIN_Y + maxRows * ROW_HEIGHT + 40;

  const forwardConnections = ir.connections
    .map((connection, index) => ({ connection, index }))
    .filter(({ connection }) => connection.from !== connection.to);
  const routed = new Map(
    routeEdges(
      forwardConnections.map(({ connection, index }) => ({ key: `c-${index}`, fromId: connection.from, toId: connection.to })),
      (id) => boxes.get(id),
    ).map((edge) => [edge.key, edge] as const),
  );

  const boundaryBoxes = ir.boundaries
    .map((boundary) => {
      const members = boundary.wraps.map((id) => boxes.get(id)).filter((box): box is Box => Boolean(box));
      if (members.length === 0) return null;
      return {
        id: boundary.id,
        label: boundary.label,
        left: Math.min(...members.map((box) => box.left)) - BOUNDARY_PAD,
        top: Math.min(...members.map((box) => box.top)) - BOUNDARY_PAD - 18,
        right: Math.max(...members.map((box) => box.right)) + BOUNDARY_PAD,
        bottom: Math.max(...members.map((box) => box.bottom)) + BOUNDARY_PAD,
      };
    })
    .filter((box): box is { id: string; label: string; left: number; top: number; right: number; bottom: number } => box !== null);

  return (
    <div className="architecture-view">
      <h2>{ir.title}</h2>
      <div className="scenario-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas">
          <defs>
            <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--edge-color, #888)" />
            </marker>
          </defs>

          {boundaryBoxes.map((boundary) => (
            <g key={boundary.id} data-detail="context">
              <rect
                x={boundary.left}
                y={boundary.top}
                width={boundary.right - boundary.left}
                height={boundary.bottom - boundary.top}
                className="arch-boundary"
                rx={12}
              />
              <text x={boundary.left + 10} y={boundary.top + 16} className="arch-boundary-label">
                {boundary.label}
              </text>
            </g>
          ))}

          {ir.connections.map((connection, index) => {
            if (connection.from === connection.to) {
              const box = boxes.get(connection.from);
              if (!box) return null;
              return (
                <text
                  key={connection.id}
                  x={box.right + 4}
                  y={box.cy}
                  className="edge-label"
                  fontSize={11}
                  data-edge-from={connection.from}
                  data-edge-to={connection.to}
                >
                  ↻ {connection.label ?? "self"}
                </text>
              );
            }
            const route = routed.get(`c-${index}`);
            if (!route) return null;
            const cx = (route.fromPort.x + route.toPort.x) / 2;
            const cy = (route.fromPort.y + route.toPort.y) / 2 - 6;
            return (
              <g key={connection.id} data-edge-from={connection.from} data-edge-to={connection.to}>
                <path
                  d={routedPath(route.fromPort, route.toPort)}
                  className={`edge arch-edge-${connection.role ?? "sync"}`}
                  markerEnd="url(#arch-arrow)"
                />
                {connection.label && (
                  <text x={cx} y={cy} className="edge-label" textAnchor="middle" data-detail="context">
                    {connection.label}
                    {connection.role && <title>{ROLE_LABEL[connection.role] ?? connection.role}</title>}
                  </text>
                )}
              </g>
            );
          })}

          {ir.components.map((component) => {
            const box = boxes.get(component.id);
            if (!box) return null;
            return (
              <g key={component.id} data-node-id={component.id}>
                <foreignObject x={box.left} y={box.top} width={BOX_WIDTH} height={BOX_HEIGHT}>
                  <button
                    type="button"
                    className="trace-entity arch-component"
                    onClick={() => onSelectComponent?.(component.id)}
                    title={component.sublabel ?? component.label}
                  >
                    <span className="trace-entity-kind" data-detail="context">
                      {presentationDot(component)}
                      {component.presentationType}
                    </span>
                    <span className="trace-entity-label">{component.label}</span>
                    {component.sublabel && (
                      <span className="dim arch-component-sublabel" data-detail="context">
                        {component.sublabel}
                      </span>
                    )}
                  </button>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="scenario-legend">
        {(["external", "frontend", "backend", "database", "queue", "security", "job", "cloud", "unknown"] as const).map(
          (type) => (
            <span key={type} className="arch-legend-item">
              <span className={`pt-dot pt-${type}`} /> {type}
            </span>
          ),
        )}
      </p>
    </div>
  );
}
