/**
 * ArchitectureView의 결정론적 layout (schema3 §3.2, v2 §6).
 *
 * `ArchitectureIR`에는 좌표가 없다(A7 재확인) — component는 자기 `id`와 `connections`만
 * 갖고, 화면에 놓일 위치는 렌더러가 여기서 계산한다.
 *
 * v2: rank(계층) 배정은 `workflowLayout.ts`와 같은 방식으로 DFS back-edge 제거 뒤
 * 계산한다(순환 그래프 방어). rank 안에서의 순서는 id 정렬 대신 barycenter
 * heuristic(인접 컴포넌트의 평균 위치)으로 정해 불필요한 엣지 교차를 줄인다 —
 * 몇 스윕을 거쳐도 동점이면 항상 id로 tie-break하므로 결정론은 유지된다.
 */
import type { ArchitectureIR } from "@onto/protocol";

export type ArchitecturePosition = { componentId: string; rank: number; index: number };

export type ArchitectureLayout = {
  positions: Map<string, ArchitecturePosition>;
  maxRank: number;
  /** rank별 component 개수. 세로 폭 계산에 쓴다 */
  rowsByRank: Map<number, number>;
  /** DFS로 판정한 구조적 back edge(순환). `"from->to"` 키 */
  backEdgeKeys: Set<string>;
};

const BARYCENTER_SWEEPS = 4;

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function computeArchitectureLayout(ir: ArchitectureIR): ArchitectureLayout {
  const ids = ir.components.map((c) => c.id).sort();
  const idSet = new Set(ids);

  const outgoing = new Map<string, string[]>();
  for (const id of ids) outgoing.set(id, []);
  for (const connection of ir.connections) {
    if (!idSet.has(connection.from) || !idSet.has(connection.to) || connection.from === connection.to) continue;
    outgoing.get(connection.from)!.push(connection.to);
  }
  // id 순으로 순회해야 어떤 엣지가 back-edge로 판정되는지 항상 같다(결정론).
  for (const tos of outgoing.values()) tos.sort();

  // --- DFS로 구조적 back edge(순환)를 찾는다 — workflowLayout.ts와 같은 방식 ------------------
  const backEdgeKeys = new Set<string>();
  const NOT_VISITED = 0;
  const IN_STACK = 1;
  const DONE = 2;
  const dfsState = new Map<string, 0 | 1 | 2>();
  const dfs = (node: string): void => {
    dfsState.set(node, IN_STACK);
    for (const next of outgoing.get(node) ?? []) {
      const nextState = dfsState.get(next) ?? NOT_VISITED;
      if (nextState === NOT_VISITED) dfs(next);
      else if (nextState === IN_STACK) backEdgeKeys.add(edgeKey(node, next));
    }
    dfsState.set(node, DONE);
  };
  for (const id of ids) if (!dfsState.has(id)) dfs(id);

  // --- rank: back edge를 뺀 그래프에서 root(indegree 0)로부터의 최장 경로 --------------------
  const indegree = new Map<string, number>();
  for (const id of ids) indegree.set(id, 0);
  for (const [from, tos] of outgoing) {
    for (const to of tos) {
      if (backEdgeKeys.has(edgeKey(from, to))) continue;
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }
  }
  const roots = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const rank = new Map<string, number>();
  for (const id of roots.length > 0 ? roots : ids) rank.set(id, 0);

  // 작은 그래프(soft budget 수준)이므로 노드 수만큼 반복하는 완화로 충분하다.
  for (let round = 0; round < ids.length; round += 1) {
    for (const [from, tos] of outgoing) {
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
  for (const id of ids) if (!rank.has(id)) rank.set(id, maxRank + 1);
  maxRank = Math.max(maxRank, ...[...rank.values()]);

  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const r = rank.get(id)!;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r)!.push(id);
  }
  for (const list of byRank.values()) list.sort();

  // --- barycenter 정렬: 순환 아닌 이웃(양방향)의 평균 rank-내 위치로 정렬, 몇 스윕 반복 -------
  const neighbors = new Map<string, string[]>();
  for (const id of ids) neighbors.set(id, []);
  for (const [from, tos] of outgoing) {
    for (const to of tos) {
      if (from === to || backEdgeKeys.has(edgeKey(from, to))) continue;
      neighbors.get(from)!.push(to);
      neighbors.get(to)!.push(from);
    }
  }

  const orderIndex = new Map<string, number>();
  const rebuildIndex = (): void => {
    orderIndex.clear();
    for (const list of byRank.values()) list.forEach((id, i) => orderIndex.set(id, i));
  };
  rebuildIndex();

  // rank를 왼쪽→오른쪽, 다음 스윕은 오른쪽→왼쪽으로 번갈아 훑는다. 한 rank를 옮기자마자
  // 인덱스를 다시 세워야(스윕 안에서도) 다음 rank가 "이미 옮겨진" 이웃을 보고 정하는데,
  // 그렇게 안 하면 인접한 두 rank가 서로의 스윕 전 스냅샷만 보고 동시에 뒤집었다 되돌리기를
  // 반복해 수렴하지 않는다(두 rank가 서로 X자로 꼬인 가장 단순한 경우에서 직접 확인함).
  const rankKeysAscending = [...byRank.keys()].sort((a, b) => a - b);
  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep += 1) {
    const order = sweep % 2 === 0 ? rankKeysAscending : [...rankKeysAscending].reverse();
    for (const r of order) {
      const list = byRank.get(r)!;
      const scored = list.map((id) => {
        const positionsOfNeighbors = (neighbors.get(id) ?? [])
          .map((n) => orderIndex.get(n))
          .filter((v): v is number => v !== undefined);
        const score =
          positionsOfNeighbors.length > 0
            ? positionsOfNeighbors.reduce((a, b) => a + b, 0) / positionsOfNeighbors.length
            : (orderIndex.get(id) ?? 0);
        return { id, score };
      });
      scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      byRank.set(r, scored.map((s) => s.id));
      rebuildIndex();
    }
  }

  const positions = new Map<string, ArchitecturePosition>();
  const rowsByRank = new Map<number, number>();
  for (const [r, list] of byRank) {
    rowsByRank.set(r, list.length);
    list.forEach((id, index) => positions.set(id, { componentId: id, rank: r, index }));
  }

  return { positions, maxRank: Math.max(maxRank, 0), rowsByRank, backEdgeKeys };
}
