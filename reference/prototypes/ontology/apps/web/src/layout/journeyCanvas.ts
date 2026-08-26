import type { ScenarioIR, ScenarioTransition } from "@onto/protocol";

export type JourneyCanvasNode = {
  stepId: string;
  column: number;
  lane: number;
  primaryIndex?: number;
};

export type JourneyCanvasEdge = {
  id: string;
  fromStepId: string;
  toStepId: string;
  condition?: string;
  kind: "primary" | "branch" | "loop";
  transition?: ScenarioTransition;
};

export type JourneyCanvasLayout = {
  nodes: JourneyCanvasNode[];
  edges: JourneyCanvasEdge[];
  columnCount: number;
  laneCount: number;
};

function pairKey(fromStepId: string, toStepId: string): string {
  return `${fromStepId}\u0000${toStepId}`;
}

/**
 * 대표 경로와 분기·재시도를 하나의 좌표계에 배치한다. 픽셀 좌표는 여기서 만들지 않고,
 * 의미 열(column)과 분기 층(lane)만 결정한다. 실제 선은 렌더된 카드 위치를 실측한다.
 */
export function buildJourneyCanvasLayout(ir: ScenarioIR, primaryPath: string[]): JourneyCanvasLayout {
  const stepIds = new Set(ir.steps.map((step) => step.id));
  const filteredPrimary = primaryPath.filter((id, index) => stepIds.has(id) && primaryPath.indexOf(id) === index);
  const primary = filteredPrimary.length > 0
    ? filteredPrimary
    : stepIds.has(ir.entryStepId) ? [ir.entryStepId] : [];
  const primaryKeys = new Set(primary.slice(0, -1).map((from, index) => pairKey(from, primary[index + 1]!)));
  const columns = new Map(primary.map((id, index) => [id, index] as const));

  const branchPairs = (ir.branches ?? []).flatMap((branch) =>
    branch.paths.map((path) => ({ from: branch.sourceStepId, to: path.nextStepId })),
  );
  const adjacency = [
    ...ir.transitions.map((transition) => ({ from: transition.fromStepId, to: transition.toStepId })),
    ...branchPairs,
  ].filter(({ from, to }) => stepIds.has(from) && stepIds.has(to));

  // 알려진 대표 단계에서 바깥으로 퍼뜨리며 가장 가까운 의미 열을 배정한다.
  for (let pass = 0; pass < ir.steps.length; pass += 1) {
    let changed = false;
    for (const step of ir.steps) {
      if (columns.has(step.id)) continue;
      const incoming = adjacency.find(({ from, to }) => to === step.id && columns.has(from));
      const outgoing = adjacency.find(({ from, to }) => from === step.id && columns.has(to));
      if (incoming) {
        columns.set(step.id, (columns.get(incoming.from) ?? 0) + 1);
        changed = true;
      } else if (outgoing) {
        columns.set(step.id, Math.max(0, (columns.get(outgoing.to) ?? 1) - 1));
        changed = true;
      }
    }
    if (!changed) break;
  }

  let fallbackColumn = Math.max(0, primary.length);
  for (const step of ir.steps) {
    if (!columns.has(step.id)) columns.set(step.id, fallbackColumn++);
  }

  const primarySet = new Set(primary);
  const occupied = new Map<number, Set<number>>();
  const nodes: JourneyCanvasNode[] = primary.map((stepId, primaryIndex) => ({
    stepId,
    column: columns.get(stepId) ?? primaryIndex,
    lane: 0,
    primaryIndex,
  }));

  // 같은 열의 분기 카드만 다른 층으로 내린다. 서로 다른 열은 같은 분기 층을 공유한다.
  for (const step of ir.steps) {
    if (primarySet.has(step.id)) continue;
    const column = columns.get(step.id) ?? 0;
    let lane = 1;
    while (occupied.get(lane)?.has(column)) lane += 1;
    if (!occupied.has(lane)) occupied.set(lane, new Set());
    occupied.get(lane)!.add(column);
    nodes.push({ stepId: step.id, column, lane });
  }

  const edges: JourneyCanvasEdge[] = [];
  const actualPairs = new Set<string>();
  ir.transitions.forEach((transition, index) => {
    if (!stepIds.has(transition.fromStepId) || !stepIds.has(transition.toStepId)) return;
    const key = pairKey(transition.fromStepId, transition.toStepId);
    actualPairs.add(key);
    edges.push({
      id: `transition:${index}:${key}`,
      fromStepId: transition.fromStepId,
      toStepId: transition.toStepId,
      ...(transition.condition ? { condition: transition.condition } : {}),
      kind: transition.loop ? "loop" : primaryKeys.has(key) ? "primary" : "branch",
      transition,
    });
  });

  (ir.branches ?? []).forEach((branch, branchIndex) => {
    branch.paths.forEach((path, pathIndex) => {
      const key = pairKey(branch.sourceStepId, path.nextStepId);
      if (actualPairs.has(key) || !stepIds.has(branch.sourceStepId) || !stepIds.has(path.nextStepId)) return;
      edges.push({
        id: `decision:${branchIndex}:${pathIndex}:${key}`,
        fromStepId: branch.sourceStepId,
        toStepId: path.nextStepId,
        condition: `${branch.conditionLabel} · ${path.label}`,
        kind: "branch",
      });
    });
  });

  const columnCount = Math.max(1, ...nodes.map((node) => node.column + 1));
  const laneCount = Math.max(1, ...nodes.map((node) => node.lane + 1));
  return { nodes, edges, columnCount, laneCount };
}
