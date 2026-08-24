import type { ArchitectureComponent, ArchitectureIR, ArchitectureLayer } from "@onto/protocol";

export const RELATIONSHIP_LAYER_ORDER: ArchitectureLayer[] = ["actor", "interface", "service", "state", "data", "external"];

export const RELATIONSHIP_LAYER_LABEL: Record<ArchitectureLayer, string> = {
  actor: "사용자 · 시작점",
  interface: "화면 · 인터페이스",
  service: "기능 · 서비스",
  state: "상태",
  data: "데이터",
  external: "외부 시스템",
};

export type RelationshipLane = {
  id: string;
  label: string;
  kind?: string;
  componentsByLayer: Map<ArchitectureLayer, ArchitectureComponent[]>;
};

function inferredLayer(component: ArchitectureComponent): ArchitectureLayer {
  if (component.layer) return component.layer;
  switch (component.presentationType) {
    case "external": return "actor";
    case "frontend": return "interface";
    case "backend":
    case "security":
    case "queue":
    case "job": return "service";
    case "database": return "data";
    case "cloud": return "external";
    default: return "service";
  }
}

/**
 * 관계 상세는 boundary를 겹치는 사각형으로 그리지 않는다. 각 컴포넌트를 정확히 한
 * 런타임 행에 배정하고, 의미 layer를 고정 열로 사용한다. 잘못 중첩된 레거시 boundary도
 * 첫 번째 명시적 소유권만 택하므로 레이아웃을 깨뜨릴 수 없다.
 */
export function computeRelationshipLanes(ir: ArchitectureIR): { lanes: RelationshipLane[]; layers: ArchitectureLayer[] } {
  const boundaryById = new Map(ir.boundaries.map((boundary) => [boundary.id, boundary]));
  const wrappedBy = new Map<string, string>();
  for (const boundary of ir.boundaries) {
    for (const componentId of boundary.wraps) {
      if (!wrappedBy.has(componentId)) wrappedBy.set(componentId, boundary.id);
    }
  }

  const ownerOf = (component: ArchitectureComponent): string | null => {
    if (component.boundaryId && boundaryById.has(component.boundaryId)) return component.boundaryId;
    return wrappedBy.get(component.id) ?? null;
  };

  const laneIds: Array<string | null> = ir.boundaries
    .filter((boundary) => ir.components.some((component) => ownerOf(component) === boundary.id))
    .map((boundary) => boundary.id);
  if (ir.components.some((component) => ownerOf(component) === null)) laneIds.push(null);

  const lanes = laneIds.map((laneId): RelationshipLane => {
    const boundary = laneId ? boundaryById.get(laneId) : undefined;
    const members = ir.components.filter((component) => ownerOf(component) === laneId);
    const componentsByLayer = new Map<ArchitectureLayer, ArchitectureComponent[]>();
    for (const layer of RELATIONSHIP_LAYER_ORDER) componentsByLayer.set(layer, []);
    for (const component of members) componentsByLayer.get(inferredLayer(component))!.push(component);
    return {
      id: laneId ?? "__unowned__",
      label: boundary?.label ?? "공통 · 외부",
      ...(boundary?.kind ? { kind: boundary.kind } : {}),
      componentsByLayer,
    };
  });

  const usedLayers = new Set<ArchitectureLayer>();
  for (const component of ir.components) usedLayers.add(inferredLayer(component));
  const layers = RELATIONSHIP_LAYER_ORDER.filter((layer) => usedLayers.has(layer));
  return { lanes, layers: layers.length > 0 ? layers : ["service"] };
}

/** AI가 저작한 primaryPath는 노드를 숨기는 근거가 아니라, 첫 읽기에서 보일 엣지를 고르는 근거다. */
export function primaryConnectionIds(ir: ArchitectureIR): Set<string> {
  const path = ir.viewPlan?.primaryPath ?? [];
  if (path.length < 2) return new Set();
  const pairs = new Set(path.slice(0, -1).map((from, index) => `${from}\u0000${path[index + 1]}`));
  return new Set(ir.connections.filter((connection) => pairs.has(`${connection.from}\u0000${connection.to}`)).map((connection) => connection.id));
}
