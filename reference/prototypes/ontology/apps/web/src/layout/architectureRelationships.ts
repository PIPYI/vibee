import type {
  ArchitectureComponent,
  ArchitectureIR,
  ArchitectureLayer,
  RepositoryTopology,
  SequenceIR,
} from "@onto/protocol";

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

export type BackendReplacementSeam = {
  componentId: string;
  connectionIds: string[];
  dataStoreLabels: string[];
  reason: string;
};

export type ArchitectureSequenceMatch = {
  sequence: SequenceIR;
  /** Architecture connection과 Sequence message가 공유하는 정확한 Stage 1 evidence id. */
  sharedEvidenceRefs: string[];
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

/** Vibee가 구성한 primaryPath는 노드를 숨기는 근거가 아니라, 첫 읽기에서 보일 엣지를 고르는 근거다. */
export function primaryConnectionIds(ir: ArchitectureIR): Set<string> {
  const path = ir.viewPlan?.primaryPath ?? [];
  if (path.length < 2) return new Set();
  const pairs = new Set(path.slice(0, -1).map((from, index) => `${from}\u0000${path[index + 1]}`));
  return new Set(ir.connections.filter((connection) => pairs.has(`${connection.from}\u0000${connection.to}`)).map((connection) => connection.id));
}

/**
 * 로컬 JSON/fixture/memory 같은 데이터 컴포넌트와 나머지 앱 사이의 연결을 "백엔드
 * 교체 후보"로 표시한다. RepositoryTopology의 entityRef 교집합을 최우선으로 쓰며,
 * topology가 없는 레거시 번들에서만 이름/경로의 명시적 local-data 단서를 폴백으로 쓴다.
 * 이는 현재 백엔드가 있다는 주장이 아니라, API/DB로 치환할 때 유지할 호출 경계다.
 */
export function backendReplacementSeams(
  ir: ArchitectureIR,
  topology?: RepositoryTopology,
): Map<string, BackendReplacementSeam> {
  const result = new Map<string, BackendReplacementSeam>();
  const stores = topology?.dataStores ?? [];

  for (const component of ir.components) {
    if (component.layer !== "data" && component.presentationType !== "database") continue;
    const entityRefs = new Set(component.entityRefs);
    const matchedStores = stores.filter((store) => store.entityRefs.some((ref) => entityRefs.has(ref)));
    const searchable = [component.label, component.sublabel ?? "", ...component.entityRefs].join(" ").toLowerCase();
    const hasExplicitLocalSignal = /(^|[\s/:._-])(local|mock|fixture|seed|memory|json)([\s/:._-]|$)|로컬|메모리/.test(searchable);
    if (matchedStores.length === 0 && !hasExplicitLocalSignal) continue;

    const connectionIds = ir.connections
      .filter((connection) => connection.role === "data" && (connection.from === component.id || connection.to === component.id))
      .map((connection) => connection.id);
    if (connectionIds.length === 0) continue;

    const dataStoreLabels = matchedStores.map((store) => store.label);
    result.set(component.id, {
      componentId: component.id,
      connectionIds,
      dataStoreLabels,
      reason: dataStoreLabels.length > 0
        ? `${dataStoreLabels.join(" · ")}을(를) 직접 사용하는 경계`
        : "로컬 데이터 파일 또는 메모리 저장소를 직접 사용하는 경계",
    });
  }
  return result;
}

/**
 * Architecture edge와 Sequence를 라벨 유사도로 추측하지 않는다. 동기/제어 edge의
 * connection evidence와 Sequence message evidence가 정확히 겹치고, 참가자·메시지가 각각 2개
 * 이상인 경우만 연결한다. 따라서 클릭 시 추가 AI 호출이나 코드 재분석이 필요 없다.
 */
export function matchArchitectureSequences(
  ir: ArchitectureIR,
  sequences: SequenceIR[],
): Map<string, ArchitectureSequenceMatch> {
  const result = new Map<string, ArchitectureSequenceMatch>();
  const candidates = sequences
    .filter((sequence) => sequence.participants.length >= 2 && sequence.messages.length >= 2)
    .map((sequence) => ({
      sequence,
      messageEvidence: new Set(sequence.messages.flatMap((message) => message.evidenceRefs)),
    }));

  for (const connection of ir.connections) {
    if (connection.role !== "sync" && connection.role !== "control" && connection.role !== undefined) continue;
    let best: ArchitectureSequenceMatch | undefined;
    for (const candidate of candidates) {
      const sharedEvidenceRefs = [...new Set(
        [...(connection.traceLinkRefs ?? []), ...connection.evidenceRefs]
          .filter((ref) => candidate.messageEvidence.has(ref)),
      )].sort();
      if (sharedEvidenceRefs.length === 0) continue;
      if (!best || sharedEvidenceRefs.length > best.sharedEvidenceRefs.length) {
        best = { sequence: candidate.sequence, sharedEvidenceRefs };
      }
    }
    if (best) result.set(connection.id, best);
  }
  return result;
}
