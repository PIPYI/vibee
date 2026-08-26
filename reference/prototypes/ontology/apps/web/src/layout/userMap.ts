import type { ScenarioIR, ScenarioStep, ScenarioTransition, SequenceIR, UserMapIR, WorkflowEdge, WorkflowIR } from "@onto/protocol";

export type UserJourneySource = "analysis" | "legacy-primary" | "legacy-support";

export type UserJourney = {
  ir: ScenarioIR;
  source: UserJourneySource;
  /** 레거시 WorkflowEdge의 sequenceRef를 잃지 않기 위한 transition key → edge 메타데이터. */
  transitionEdges: Map<string, WorkflowEdge>;
};

export function transitionKey(transition: Pick<ScenarioTransition, "fromStepId" | "toStepId">): string {
  return `${transition.fromStepId}\u0000${transition.toStepId}`;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function workflowStep(node: WorkflowIR["nodes"][number]): ScenarioStep {
  return {
    id: node.id,
    label: node.label,
    participantId: node.laneId,
    conceptRefs: node.conceptRefs ?? [],
    evidenceRefs: node.evidenceRefs,
  };
}

function workflowTransition(edge: WorkflowEdge, order: Map<string, number>): ScenarioTransition {
  const fromIndex = order.get(edge.from);
  const toIndex = order.get(edge.to);
  const loop = fromIndex !== undefined && toIndex !== undefined && toIndex <= fromIndex;
  return {
    fromStepId: edge.from,
    toStepId: edge.to,
    ...(edge.label ? { condition: edge.label } : {}),
    ...(loop ? { loop: true } : {}),
    ...(edge.role === "return" ? { kind: "return" as const } : {}),
    evidenceRefs: edge.evidenceRefs,
  };
}

function legacyPrimary(workflow: WorkflowIR): UserJourney | null {
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node] as const));
  const ids = unique(workflow.mainPath).filter((id) => nodeById.has(id));
  if (ids.length === 0) return null;
  const idSet = new Set(ids);
  const order = new Map(ids.map((id, index) => [id, index] as const));
  const edges = workflow.edges.filter((edge) => idSet.has(edge.from) && idSet.has(edge.to));
  const transitions = edges.map((edge) => workflowTransition(edge, order));
  const outgoing = new Set(transitions.filter((item) => !item.loop).map((item) => item.fromStepId));
  const outcomes = ids.filter((id) => !outgoing.has(id));
  const participants = workflow.lanes
    .filter((lane) => ids.some((id) => nodeById.get(id)?.laneId === lane.id))
    .map((lane) => ({ id: lane.id, label: lane.label, layoutHint: lane.kind }));

  return {
    source: "legacy-primary",
    transitionEdges: new Map(edges.map((edge) => [transitionKey({ fromStepId: edge.from, toStepId: edge.to }), edge])),
    ir: {
      id: "legacy:primary-journey",
      name: workflow.title,
      type: "user",
      goal: workflow.title,
      outcome: outcomes.length > 1 ? "완료 후 보상과 후속 기록으로 이어집니다." : undefined,
      participants,
      steps: ids.map((id) => workflowStep(nodeById.get(id)!)),
      transitions,
      entryStepId: ids[0]!,
      outcomeStepIds: outcomes.length > 0 ? outcomes : [ids.at(-1)!],
    },
  };
}

function legacySupport(workflow: WorkflowIR): UserJourney[] {
  const primaryIds = new Set(workflow.mainPath);
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node] as const));
  return workflow.nodes.flatMap((node): UserJourney[] => {
    if (primaryIds.has(node.id)) return [];
    const touching = workflow.edges.filter(
      (edge) => (edge.from === node.id && primaryIds.has(edge.to)) || (edge.to === node.id && primaryIds.has(edge.from)),
    );
    if (touching.length === 0) return [];
    const edge = touching[0]!;
    const otherId = edge.from === node.id ? edge.to : edge.from;
    const other = nodeById.get(otherId);
    if (!other) return [];
    const ids = edge.from === node.id ? [node.id, other.id] : [other.id, node.id];
    const order = new Map(ids.map((id, index) => [id, index] as const));
    const transition = workflowTransition(edge, order);
    const laneIds = new Set([node.laneId, other.laneId]);
    return [{
      source: "legacy-support",
      transitionEdges: new Map([[transitionKey(transition), edge]]),
      ir: {
        id: `legacy:support:${node.id}`,
        name: node.label,
        type: "user",
        goal: edge.label ?? `${node.label} 관련 흐름`,
        participants: workflow.lanes.filter((lane) => laneIds.has(lane.id)).map((lane) => ({
          id: lane.id,
          label: lane.label,
          layoutHint: lane.kind,
        })),
        steps: ids.map((id) => workflowStep(nodeById.get(id)!)),
        transitions: [transition],
        entryStepId: ids[0]!,
        outcomeStepIds: [ids[1]!],
      },
    }];
  });
}

export function buildUserJourneys(userMap: UserMapIR | undefined, workflow: WorkflowIR): UserJourney[] {
  if (userMap?.journeys.length) {
    return userMap.journeys.map((ir) => ({ ir, source: "analysis", transitionEdges: new Map() }));
  }
  const primary = legacyPrimary(workflow);
  return [...(primary ? [primary] : []), ...legacySupport(workflow)];
}

/** entry에서 outcome으로 향하는 가장 긴 단순 경로. 동점이면 transition/step 입력 순서를 유지한다. */
export function primaryJourneyPath(ir: ScenarioIR): string[] {
  const stepIds = new Set(ir.steps.map((step) => step.id));
  const outcomes = new Set(ir.outcomeStepIds);
  const adjacency = new Map<string, string[]>();
  for (const transition of ir.transitions) {
    if (transition.loop || !stepIds.has(transition.fromStepId) || !stepIds.has(transition.toStepId)) continue;
    if (!adjacency.has(transition.fromStepId)) adjacency.set(transition.fromStepId, []);
    adjacency.get(transition.fromStepId)!.push(transition.toStepId);
  }

  let best: string[] = stepIds.has(ir.entryStepId) ? [ir.entryStepId] : [];
  const visit = (id: string, path: string[], seen: Set<string>): void => {
    if (outcomes.has(id) && path.length > best.length) best = [...path];
    for (const next of adjacency.get(id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      visit(next, [...path, next], seen);
      seen.delete(next);
    }
  };
  if (best.length) visit(best[0]!, best, new Set(best));
  return best;
}

function evidenceSet(sequence: SequenceIR): Set<string> {
  return new Set([
    ...sequence.evidenceRefs,
    ...sequence.messages.flatMap((message) => message.evidenceRefs),
  ]);
}

/** 레거시는 명시 sequenceRef, 새 Scenario는 정확히 같은 evidence가 있을 때만 보수적으로 연결한다. */
export function sequenceForTransition(
  journey: UserJourney,
  transition: ScenarioTransition,
  sequences: SequenceIR[],
): SequenceIR | undefined {
  const edge = journey.transitionEdges.get(transitionKey(transition));
  if (edge?.sequenceRef) return sequences.find((sequence) => sequence.id === edge.sequenceRef);
  if (transition.evidenceRefs.length === 0) return undefined;
  const refs = new Set(transition.evidenceRefs);
  return sequences
    .map((sequence) => ({ sequence, shared: [...evidenceSet(sequence)].filter((ref) => refs.has(ref)).length }))
    .filter((candidate) => candidate.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.sequence.id.localeCompare(b.sequence.id))[0]?.sequence;
}
