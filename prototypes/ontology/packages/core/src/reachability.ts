/**
 * ReachabilityIR의 결정론적 투영 (schema2 §6). Impact가 아니라 **authored reachability**다.
 *
 * archify가 스스로 그은 경계를 그대로 따른다 — "call it authored reachability, not impact,
 * blast radius, breakage, or runtime causality." 이 계산이 보장하는 것은 **"인덱싱된 관계를
 * 따라 여기서 저기에 닿는다"**뿐이다. 인덱서가 못 본 관계(동적 디스패치·설정·문자열 키)는
 * 결과에 없고, 있는 관계도 실행 시 인과라는 보장이 없다(I4).
 *
 * Trace(§6.6 R4)와 같은 이유로 **AI가 만들지 않는다.** `buildEvidenceGraph`·`seedsFor`를
 * 그대로 재사용해 새 그래프 엔진을 만들지 않는다(schema2 I15). 방향은 하나만 따라간다는
 * 점에서만 Trace의 BFS와 다르다 — upstream은 incoming만, downstream은 outgoing만 walk한다.
 */
import type {
  EvidenceIndex,
  GroundingStore,
  ReachabilityDirection,
  ReachabilityIR,
  ReachabilityLink,
  ReachabilityNode,
  SemanticMemory,
  ViewAnchor,
} from "@onto/protocol";

import { buildEvidenceGraph, seedsFor, TRACE_NODE_CEILING } from "./trace.js";

export type { ReachabilityDirection, ReachabilityIR, ReachabilityLink, ReachabilityNode } from "@onto/protocol";

export type ReachabilityOptions = {
  hops?: number;
  ceiling?: number;
  memory?: SemanticMemory;
  grounding?: GroundingStore;
};

/** entityKey → 그 entity를 만든 evidence id들. 역 grounding 조회에 쓴다. */
function entityEvidenceIds(index: EvidenceIndex): Map<string, string[]> {
  const byEntity = new Map<string, string[]>();
  for (const evidence of index.evidence) {
    if (evidence.status !== "present" || evidence.graph?.role !== "entity") continue;
    const key = evidence.graph.entity.kind === "file"
      ? `file:${evidence.graph.entity.filePath}`
      : evidence.graph.entity.kind === "symbol"
        ? `symbol:${evidence.graph.entity.symbolId}`
        : evidence.graph.entity.kind === "route"
          ? `route:${evidence.graph.entity.routeKey}`
          : `model:${evidence.graph.entity.modelKey}`;
    const list = byEntity.get(key);
    if (list) list.push(evidence.id);
    else byEntity.set(key, [evidence.id]);
  }
  return byEntity;
}

/** anchor 요청 자체를 사람이 읽을 문자열로. BFS 순서에 좌우되는 임의의 entity가 아니다. */
function anchorLabel(anchor: ViewAnchor): string {
  switch (anchor.kind) {
    case "concept":
      return `concept:${anchor.conceptId}`;
    case "scenario":
      return `scenario:${anchor.scenarioId}`;
    case "symbol":
      return `symbol:${anchor.symbolId}`;
    case "file":
      return `file:${anchor.filePath}`;
    case "intent":
      return `intent:${anchor.intentId}`;
  }
}

function conceptRefsFor(entityKeyValue: string, evidenceByEntity: Map<string, string[]>, memory?: SemanticMemory): string[] {
  if (!memory) return [];
  const evidenceIds = new Set(evidenceByEntity.get(entityKeyValue) ?? []);
  if (evidenceIds.size === 0) return [];
  const refs: string[] = [];
  for (const concept of memory.concepts) {
    if (concept.evidenceRefs.some((ref) => evidenceIds.has(ref))) refs.push(concept.id);
  }
  return refs.sort();
}

/**
 * anchor에서 한 방향으로만 hop 이내를 투영한다.
 *
 * 같은 anchor + 같은 direction + 같은 인덱스는 **항상 바이트 단위로 동일한 결과**를 낸다
 * (Trace의 acceptance 12와 같은 보장 — BFS가 정렬된 인접 목록 위에서 돌고, 노드가
 * entityKey로 식별되며, 평생 한 번만 확장된다).
 */
export function projectReachability(
  index: EvidenceIndex,
  anchor: ViewAnchor,
  direction: ReachabilityDirection,
  options: ReachabilityOptions = {},
): ReachabilityIR {
  const graph = buildEvidenceGraph(index);
  const maxHops = options.hops ?? 3;
  const ceiling = options.ceiling ?? TRACE_NODE_CEILING;
  const adjacency = direction === "downstream" ? graph.outgoing : graph.incoming;
  const evidenceByEntity = entityEvidenceIds(index);

  const hop = new Map<string, number>();
  let frontier: string[] = [];
  for (const seed of seedsFor(index, anchor, options)) {
    if (!graph.nodes.has(seed)) continue;
    hop.set(seed, 0);
    frontier.push(seed);
  }

  let truncatedAtHop: number | undefined;
  for (let distance = 1; distance <= maxHops && frontier.length > 0; distance += 1) {
    const next = new Set<string>();
    for (const key of frontier) {
      for (const edge of adjacency.get(key) ?? []) {
        const neighborKey = direction === "downstream" ? edge.toId : edge.fromId;
        if (!hop.has(neighborKey)) next.add(neighborKey);
      }
    }
    const additions = [...next].sort();
    if (additions.length === 0) break;
    if (hop.size + additions.length > ceiling) {
      truncatedAtHop = distance;
      break;
    }
    for (const key of additions) hop.set(key, distance);
    frontier = additions;
  }

  const nodeKeys = [...hop.keys()].sort((a, b) => {
    const hopDiff = (hop.get(a) ?? 0) - (hop.get(b) ?? 0);
    return hopDiff !== 0 ? hopDiff : a < b ? -1 : a > b ? 1 : 0;
  });

  const nodes: ReachabilityNode[] = nodeKeys.map((key) => {
    const node = graph.nodes.get(key);
    return {
      id: key,
      kind: node?.kind ?? "symbol",
      label: node?.label ?? key,
      hop: hop.get(key) ?? 0,
      ...(node?.filePath !== undefined ? { filePath: node.filePath } : {}),
      ...(node?.symbolId !== undefined ? { symbolId: node.symbolId } : {}),
      conceptRefs: conceptRefsFor(key, evidenceByEntity, options.memory),
    };
  });

  // Trace(§6.6)와 같은 원칙 — 도달한 두 노드 사이의 authored edge는 hop 관계와 무관하게
  // 전부 보여준다. 엣지 자체가 이미 방향을 담고 있으므로(fromId→toId가 실제 코드 방향) 그
  // 방향이 hop 증가와 일치하는지는 별도로 따지지 않는다 — Trace가 nonForward를 배제하지
  // 않고 표시만 하는 것과 같은 이유다.
  const nodeKeySet = new Set(nodeKeys);
  const links: ReachabilityLink[] = graph.edges
    .filter((edge) => nodeKeySet.has(edge.fromId) && nodeKeySet.has(edge.toId))
    .map((edge) => ({ fromId: edge.fromId, toId: edge.toId, kind: edge.kind, evidenceRefs: edge.evidenceRefs }))
    .sort((a, b) => (a.fromId !== b.fromId ? (a.fromId < b.fromId ? -1 : 1) : a.toId < b.toId ? -1 : a.toId > b.toId ? 1 : 0));

  return {
    anchor: anchorLabel(anchor),
    direction,
    nodes,
    links,
    ...(truncatedAtHop !== undefined ? { truncatedAtHop } : {}),
  };
}
