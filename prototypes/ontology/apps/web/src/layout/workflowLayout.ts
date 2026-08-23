/**
 * WorkflowView의 결정론적 layout (schema3 §3.3) — `scenarioLayout.ts`와 같은 태도다.
 *
 * lane(swimlane)은 IR이 이미 순서를 준다(`lanes[]`). rank(왼쪽→오른쪽)는 DAG가 아닐 수
 * 있는 그래프에서 DFS로 구조적 back edge를 먼저 걷어낸 뒤 그 나머지에서 계산한다 —
 * `WorkflowEdge`에는 Scenario의 `loop`처럼 명시적으로 표시하는 필드가 없으므로 구조적
 * 판정(DFS)만으로 back edge를 정한다.
 */
import type { WorkflowIR } from "@onto/protocol";

export type WorkflowPosition = { nodeId: string; rank: number; laneIndex: number };

export type WorkflowLayout = {
  positions: Map<string, WorkflowPosition>;
  /** `"from->to"` 키. 이 edge는 side-rail 회귀 호로 그린다 */
  backEdgeKeys: Set<string>;
  lanes: string[];
  maxRank: number;
};

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function computeWorkflowLayout(ir: WorkflowIR): WorkflowLayout {
  const nodeIds = ir.nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);

  const adjacency = new Map<string, string[]>();
  for (const edge of ir.edges) {
    if (!nodeIdSet.has(edge.from) || !nodeIdSet.has(edge.to)) continue; // 방어적 — Core가 이미 grounding을 검사한다
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
  }

  // --- DFS로 구조적 back edge를 찾는다 ---------------------------------------------------
  const backEdgeKeys = new Set<string>();
  const NOT_VISITED = 0;
  const IN_STACK = 1;
  const DONE = 2;
  const dfsState = new Map<string, 0 | 1 | 2>();

  const dfs = (node: string): void => {
    dfsState.set(node, IN_STACK);
    for (const next of adjacency.get(node) ?? []) {
      const nextState = dfsState.get(next) ?? NOT_VISITED;
      if (nextState === NOT_VISITED) dfs(next);
      else if (nextState === IN_STACK) backEdgeKeys.add(edgeKey(node, next));
    }
    dfsState.set(node, DONE);
  };

  // mainPath[0]을 entry로 우선한다 — 그것이 없으면 들어오는 edge가 없는 node, 그마저 없으면 첫 node.
  const incoming = new Set(ir.edges.map((edge) => edge.to));
  const entry = ir.mainPath[0] ?? nodeIds.find((id) => !incoming.has(id)) ?? nodeIds[0];
  if (entry) dfs(entry);
  for (const id of nodeIds) if (!dfsState.has(id)) dfs(id);

  // --- rank — back edge를 뺀 그래프에서 entry로부터의 최장 경로 -----------------------------
  const rank = new Map<string, number>();
  if (entry) rank.set(entry, 0);
  for (let round = 0; round < nodeIds.length; round += 1) {
    for (const [from, tos] of adjacency) {
      const fromRank = rank.get(from);
      if (fromRank === undefined) continue;
      for (const to of tos) {
        if (backEdgeKeys.has(edgeKey(from, to))) continue;
        const candidate = fromRank + 1;
        if (candidate > (rank.get(to) ?? -1)) rank.set(to, candidate);
      }
    }
  }
  let maxRank = 0;
  for (const value of rank.values()) maxRank = Math.max(maxRank, value);
  for (const id of nodeIds) if (!rank.has(id)) rank.set(id, maxRank + 1);
  maxRank = Math.max(maxRank, ...[...rank.values()]);

  // --- lane — IR의 lanes[] 순서 그대로 -----------------------------------------------------
  const lanes = ir.lanes.map((lane) => lane.id);
  const laneIndexOf = new Map(lanes.map((id, index) => [id, index]));

  const positions = new Map<string, WorkflowPosition>();
  for (const node of ir.nodes) {
    positions.set(node.id, {
      nodeId: node.id,
      rank: rank.get(node.id) ?? 0,
      laneIndex: laneIndexOf.get(node.laneId) ?? Math.max(0, lanes.length - 1),
    });
  }

  return { positions, backEdgeKeys, lanes, maxRank: Math.max(maxRank, 0) };
}
