/**
 * ArchitectureView — schema3 §3.2, §7, v2 §1·§4. archify architecture.json이 보여주던
 * 결과물 형태를 재현하되, 좌표는 IR에 없고 이 렌더러가 `architectureLayout.ts`로
 * 결정론적으로 계산한다(A7 재확인).
 *
 * v2: 이 컴포넌트가 "아키텍처" 탭 전체를 소유한다 — 안에 [구성 개요] [전체 구조] 서브탭이
 * 있다. 구성 개요(기본 진입)는 `ArchitectureComposition`(카드 그리드, ViewerShell 밖)이고,
 * 전체 구조는 아래 `ArchitectureGraph`(ViewerShell 안의 rank/lane SVG, 기존 로직)다. 서브탭
 * 전환은 로컬 state만 바꾼다 — 이미 받아온 `AnalysisBundle`을 다시 그릴 뿐 재요청은 없다.
 *
 * v2 §4-1: `ArchitectureGraph`는 원본 IR을 그대로 그리지 않고 `computeClusteredArchitectureIR`로
 * 먼저 큐레이션한다 — 같은 tier 안에서 이웃 집합이 충분히 비슷한 노드를 하나로 묶어(예:
 * "화면 6개") 그려야 원본 그래프를 그대로 펼쳤을 때 생기던 시각적 복잡도를 줄일 수 있다.
 * 펼치기(`expandedMemberIds`)도 순수 로컬 state라 API 재요청이 없다.
 */
import { useState } from "react";

import type { ArchitectureComponent, ArchitectureIR } from "@onto/protocol";

import { computeClusteredArchitectureIR } from "../layout/architectureClustering.js";
import { computeArchitectureLayout } from "../layout/architectureLayout.js";
import { type Box, type LabelBox, reduceCrossings, resolveLabelOverlaps, routeEdges, routedPathAvoiding } from "../layout/edgeRouting.js";
import { ArchitectureComposition } from "./ArchitectureComposition.js";
import { ViewerShell, type ViewerNode } from "./ViewerShell.js";

const COL_WIDTH = 280;
const ROW_HEIGHT = 100;
const BOX_WIDTH = 230;
const BOX_HEIGHT = 76;
const MARGIN_X = 40;
const LABEL_CHAR_WIDTH = 9.5;
const LABEL_HEIGHT = 14;

function labelTextWidth(text: string): number {
  return Math.max(24, text.length * LABEL_CHAR_WIDTH);
}

function labelBox(id: string, cx: number, cy: number, text: string): LabelBox {
  const width = labelTextWidth(text);
  return { id, x: cx - width / 2, y: cy - LABEL_HEIGHT, width, height: LABEL_HEIGHT };
}

/** 라벨이 선·다른 박스 위에 떠도 읽히도록 배경 판을 깔아준다(v2, 겹침·가려짐 대응). */
function EdgeLabel({ cx, cy, text }: { cx: number; cy: number; text: string }): React.JSX.Element {
  const width = labelTextWidth(text) + 8;
  return (
    <>
      <rect x={cx - width / 2} y={cy - LABEL_HEIGHT + 2} width={width} height={LABEL_HEIGHT} className="edge-label-bg" rx={3} />
      <text x={cx} y={cy} className="edge-label" textAnchor="middle" data-detail="context">
        {text}
      </text>
    </>
  );
}
const MARGIN_Y = 60;
const BOUNDARY_PAD = 20;

const ROLE_LABEL: Record<string, string> = { sync: "동기", async: "비동기", data: "데이터", control: "제어" };

const PT_SHORT: Record<string, string> = {
  external: "EXT",
  frontend: "UI",
  backend: "SRV",
  database: "DB",
  queue: "Q",
  security: "SEC",
  job: "JOB",
  cloud: "CLD",
  unknown: "?",
};

function presentationBadge(component: ArchitectureComponent): React.JSX.Element {
  return (
    <span
      className={`pt-chip-mini pt-${component.presentationType}`}
      title={
        component.presentationTypeConfidence !== undefined
          ? `${component.presentationType} (신뢰도 ${component.presentationTypeConfidence.toFixed(2)})`
          : component.presentationType
      }
    >
      {PT_SHORT[component.presentationType] ?? component.presentationType}
    </span>
  );
}

function ArchitectureGraph({
  ir: fullIr,
  onSelectComponent,
}: {
  ir: ArchitectureIR;
  onSelectComponent?: (componentId: string) => void;
}): React.JSX.Element {
  const [expandedMemberIds, setExpandedMemberIds] = useState<Set<string>>(new Set());
  const { ir, clusters } = computeClusteredArchitectureIR(fullIr, { excludeFromClustering: expandedMemberIds });

  const isCluster = (componentId: string): boolean => clusters.has(componentId);
  const handleNodeClick = (componentId: string): void => {
    const members = clusters.get(componentId);
    if (members) {
      setExpandedMemberIds((prev) => new Set([...prev, ...members.map((m) => m.id)]));
      return;
    }
    onSelectComponent?.(componentId);
  };

  const layout = computeArchitectureLayout(ir);
  const componentById = new Map(ir.components.map((c) => [c.id, c]));

  let byRank = new Map<number, string[]>();
  for (const component of ir.components) {
    const pos = layout.positions.get(component.id);
    const rank = pos?.rank ?? 0;
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank)!.push(component.id);
  }
  for (const [rank, list] of byRank) {
    list.sort((a, b) => (layout.positions.get(a)?.index ?? 0) - (layout.positions.get(b)?.index ?? 0));
    byRank.set(rank, list);
  }

  const buildBoxes = (order: Map<number, string[]>): Map<string, Box> => {
    const boxes = new Map<string, Box>();
    for (const [rank, list] of order) {
      list.forEach((id, index) => {
        const left = MARGIN_X + rank * COL_WIDTH;
        const top = MARGIN_Y + index * ROW_HEIGHT;
        boxes.set(id, { id, left, top, right: left + BOX_WIDTH, bottom: top + BOX_HEIGHT, cy: top + BOX_HEIGHT / 2 });
      });
    }
    return boxes;
  };

  const forwardConnections = ir.connections
    .map((connection, index) => ({ connection, index }))
    .filter(({ connection }) => connection.from !== connection.to);
  const forward = forwardConnections.map(({ connection, index }) => ({ key: `c-${index}`, fromId: connection.from, toId: connection.to }));

  byRank = reduceCrossings(byRank, buildBoxes, forward);
  const boxes = buildBoxes(byRank);

  const maxRows = Math.max(1, ...[...byRank.values()].map((list) => list.length));
  const width = MARGIN_X + (layout.maxRank + 1) * COL_WIDTH + 40;
  const height = MARGIN_Y + maxRows * ROW_HEIGHT + 40;

  const routed = new Map(routeEdges(forward, (id) => boxes.get(id)).map((edge) => [edge.key, edge] as const));

  // v2: 라벨끼리 겹치면(특히 같은 rank 쌍을 잇는 여러 연결의 라벨이 한 자리에 몰리는 경우)
  // 위아래로 밀어낸다 — WorkflowView.tsx가 이미 하던 것과 같은 패턴(resolveLabelOverlaps).
  const pendingLabels = forwardConnections
    .map(({ connection, index }) => {
      if (!connection.label) return null;
      const route = routed.get(`c-${index}`);
      if (!route) return null;
      const cx = (route.fromPort.x + route.toPort.x) / 2;
      const cy = (route.fromPort.y + route.toPort.y) / 2 - 6;
      return { key: `c-${index}`, cx, cy, text: connection.label };
    })
    .filter((l): l is { key: string; cx: number; cy: number; text: string } => l !== null);
  const labelOffsets = resolveLabelOverlaps(pendingLabels.map((l) => labelBox(l.key, l.cx, l.cy, l.text)));

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
    <div className="architecture-graph">
      {expandedMemberIds.size > 0 && (
        <button type="button" className="arch-collapse-all" onClick={() => setExpandedMemberIds(new Set())}>
          펼친 항목 접기
        </button>
      )}
      <div className="scenario-canvas-wrap">
        <svg width={width} height={height} className="scenario-canvas arch-canvas">
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
            const obstacles = [...boxes.values()].filter((box) => box.id !== connection.from && box.id !== connection.to);
            const cx = (route.fromPort.x + route.toPort.x) / 2;
            const cy = (route.fromPort.y + route.toPort.y) / 2 - 6 + (labelOffsets.get(`c-${index}`) ?? 0);
            return (
              <g key={connection.id} data-edge-from={connection.from} data-edge-to={connection.to}>
                <path
                  d={routedPathAvoiding(route.fromPort, route.toPort, obstacles)}
                  className={`edge arch-edge-${connection.role ?? "sync"}`}
                  markerEnd="url(#arch-arrow)"
                />
                {connection.label && (
                  <g data-detail="context">
                    {connection.role && <title>{ROLE_LABEL[connection.role] ?? connection.role}</title>}
                    <EdgeLabel cx={cx} cy={cy} text={connection.label} />
                  </g>
                )}
              </g>
            );
          })}

          {[...boxes.values()].map((box) => {
            const component = componentById.get(box.id);
            if (!component) return null;
            const cluster = isCluster(component.id);
            return (
              <g key={component.id} data-node-id={component.id}>
                <foreignObject x={box.left} y={box.top} width={BOX_WIDTH} height={BOX_HEIGHT}>
                  <button
                    type="button"
                    className={`trace-entity arch-component${cluster ? " arch-component-cluster" : ""}`}
                    onClick={() => handleNodeClick(component.id)}
                    title={cluster ? "클릭하면 펼쳐집니다" : (component.sublabel ?? component.label)}
                  >
                    <span className="trace-entity-kind" data-detail="context">
                      {presentationBadge(component)}
                      {cluster && <span className="arch-cluster-count">×{clusters.get(component.id)?.length ?? 0}</span>}
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
              <span className={`pt-chip-mini pt-${type}`}>{PT_SHORT[type]}</span> {type}
            </span>
          ),
        )}
      </p>
    </div>
  );
}

type ArchitectureSubtab = "composition" | "structure";

export function ArchitectureView({
  ir,
  viewKey,
  onSelectComponent,
}: {
  ir: ArchitectureIR;
  viewKey: string;
  onSelectComponent?: (componentId: string) => void;
}): React.JSX.Element {
  const [subtab, setSubtab] = useState<ArchitectureSubtab>("composition");

  const nodes: ViewerNode[] = ir.components.map((c) => ({
    id: c.id,
    label: c.label,
    ...(c.sublabel ? { sublabel: c.sublabel } : {}),
  }));

  return (
    <div className="architecture-view">
      <div className="architecture-view-head">
        <h2>{ir.title}</h2>
        <nav className="arch-subtab-switch" role="tablist" aria-label="아키텍처 보기 방식">
          <button type="button" role="tab" aria-selected={subtab === "composition"} onClick={() => setSubtab("composition")}>
            구성 개요
          </button>
          <button type="button" role="tab" aria-selected={subtab === "structure"} onClick={() => setSubtab("structure")}>
            전체 구조
          </button>
        </nav>
      </div>

      {subtab === "composition" ? (
        <ArchitectureComposition ir={ir} onSelectComponent={onSelectComponent} />
      ) : (
        <ViewerShell viewKind="architecture" viewKey={viewKey} nodes={nodes}>
          <ArchitectureGraph ir={ir} onSelectComponent={onSelectComponent} />
        </ViewerShell>
      )}
    </div>
  );
}
