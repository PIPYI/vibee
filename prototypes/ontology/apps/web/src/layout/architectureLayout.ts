/**
 * ArchitectureView의 결정론적 layout (schema3 §3.2).
 *
 * `ArchitectureIR`에는 좌표가 없다(A7 재확인) — component는 자기 `id`와 `connections`만
 * 갖고, 화면에 놓일 위치는 렌더러가 여기서 계산한다. `scenarioLayout.ts`와 같은 태도로,
 * connections를 따라 rank(왼쪽→오른쪽 층)를 매기고 같은 rank 안에서는 id로 정렬해
 * 결정론을 지킨다 — 같은 IR을 두 번 넣으면 항상 같은 좌표가 나온다.
 */
import type { ArchitectureIR } from "@onto/protocol";

export type ArchitecturePosition = { componentId: string; rank: number; index: number };

export type ArchitectureLayout = {
  positions: Map<string, ArchitecturePosition>;
  maxRank: number;
  /** rank별 component 개수. 세로 폭 계산에 쓴다 */
  rowsByRank: Map<number, number>;
};

export function computeArchitectureLayout(ir: ArchitectureIR): ArchitectureLayout {
  const ids = ir.components.map((c) => c.id).sort();
  const idSet = new Set(ids);

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  for (const connection of ir.connections) {
    if (!idSet.has(connection.from) || !idSet.has(connection.to) || connection.from === connection.to) continue;
    outgoing.get(connection.from)!.push(connection.to);
    indegree.set(connection.to, (indegree.get(connection.to) ?? 0) + 1);
  }

  // rank 0 = 아무 연결도 안 받는 component(진입점 후보). 전부 연결을 받는다면(cycle 등)
  // 전체를 rank 0에서 시작한다 — 방어적일 뿐 흔한 경우가 아니다.
  const roots = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const rank = new Map<string, number>();
  for (const id of roots.length > 0 ? roots : ids) rank.set(id, 0);

  // 작은 그래프(soft budget 수준)이므로 노드 수만큼 반복하는 완화로 충분하다 — scenarioLayout과 같은 방식.
  for (let round = 0; round < ids.length; round += 1) {
    for (const [from, tos] of outgoing) {
      const fromRank = rank.get(from);
      if (fromRank === undefined) continue;
      for (const to of tos) {
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

  const positions = new Map<string, ArchitecturePosition>();
  const rowsByRank = new Map<number, number>();
  for (const [r, list] of byRank) {
    list.sort();
    rowsByRank.set(r, list.length);
    list.forEach((id, index) => positions.set(id, { componentId: id, rank: r, index }));
  }

  return { positions, maxRank: Math.max(maxRank, 0), rowsByRank };
}
