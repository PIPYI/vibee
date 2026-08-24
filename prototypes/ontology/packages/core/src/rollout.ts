import type {
  AnalysisBundle,
  IncrementalAnalysisPlan,
  RolloutCoverage,
  SystemFactStore,
  SystemIntelligenceV4Mode,
  TaskState,
  V4RolloutReport,
} from "@onto/protocol";
import { entityKey } from "@onto/protocol";

function journeyCoverage(bundle: AnalysisBundle): Pick<RolloutCoverage, "journeySteps" | "journeyBranches" | "journeyLoops"> {
  const journeys = bundle.userMap?.journeys ?? [];
  return {
    journeySteps: journeys.reduce((sum, journey) => sum + journey.steps.length, 0),
    journeyBranches: journeys.reduce((sum, journey) => sum + (journey.branches?.length ?? 0), 0),
    journeyLoops: journeys.reduce((sum, journey) => sum + journey.transitions.filter((item) => item.loop).length, 0),
  };
}

function validFact(status: string): boolean {
  return status === "valid" || status === "relocated";
}

function externalEntityKeys(facts: SystemFactStore, legacyOnly: boolean): Set<string> {
  return new Set(facts.entities
    .filter((item) => validFact(item.status))
    .filter((item) => !legacyOnly || item.origin === "engine")
    .filter((item) => item.kind === "external" || (item.ref.kind === "resource" && item.ref.namespace === "external"))
    .map((item) => entityKey(item.ref)));
}

function coveredExternalIntegrations(bundle: AnalysisBundle, keys: ReadonlySet<string>): number {
  return new Set(bundle.architecture.components.flatMap((component) => component.entityRefs.filter((ref) => keys.has(ref)))).size;
}

function v4Coverage(bundle: AnalysisBundle, facts: SystemFactStore): RolloutCoverage & { ungroundedConnections: number } {
  const links = new Map(facts.links.map((item) => [item.id, item]));
  const connectionGrounded = (refs: readonly string[]): boolean => refs.length > 0 && refs.every((ref) => {
    const link = links.get(ref);
    return Boolean(link && validFact(link.status) && link.certainty !== "inferred");
  });
  const acceptedFacts = facts.entities.filter((item) => validFact(item.status) && item.certainty !== "inferred").length
    + facts.links.filter((item) => validFact(item.status) && item.certainty !== "inferred").length;
  const journey = journeyCoverage(bundle);
  return {
    systemFacts: acceptedFacts,
    architectureConnections: bundle.architecture.connections.length,
    externalIntegrations: coveredExternalIntegrations(bundle, externalEntityKeys(facts, false)),
    ...journey,
    ungroundedConnections: bundle.architecture.connections.filter((item) => !connectionGrounded(item.systemLinkRefs ?? [])).length,
  };
}

/** 동일 Bundle을 V3 Trace-link 진입 규칙으로 읽는 provider-0 shadow 기준선. */
function v3Projection(bundle: AnalysisBundle, facts: SystemFactStore): RolloutCoverage {
  const engineLinkIds = new Set(facts.links.filter((item) => item.origin === "engine" && validFact(item.status)).map((item) => item.id));
  const connections = bundle.architecture.connections.filter((item) =>
    (item.traceLinkRefs?.length ?? 0) > 0 || (item.systemLinkRefs?.some((id) => engineLinkIds.has(id)) ?? false));
  return {
    systemFacts: facts.entities.filter((item) => item.origin === "engine" && validFact(item.status)).length
      + facts.links.filter((item) => item.origin === "engine" && validFact(item.status)).length,
    architectureConnections: connections.length,
    externalIntegrations: coveredExternalIntegrations(bundle, externalEntityKeys(facts, true)),
    ...journeyCoverage(bundle),
  };
}

function subtract(current: RolloutCoverage, baseline: RolloutCoverage): RolloutCoverage {
  return {
    systemFacts: current.systemFacts - baseline.systemFacts,
    architectureConnections: current.architectureConnections - baseline.architectureConnections,
    externalIntegrations: current.externalIntegrations - baseline.externalIntegrations,
    journeySteps: current.journeySteps - baseline.journeySteps,
    journeyBranches: current.journeyBranches - baseline.journeyBranches,
    journeyLoops: current.journeyLoops - baseline.journeyLoops,
  };
}

export function buildV4RolloutReport(input: {
  task: TaskState;
  plan: IncrementalAnalysisPlan;
  featureMode: SystemIntelligenceV4Mode;
  generation: number;
  analysisVersion: number;
  semanticVersion: number;
  facts: SystemFactStore;
  bundle: AnalysisBundle;
  endedAt?: string;
}): V4RolloutReport {
  const v4 = v4Coverage(input.bundle, input.facts);
  const baseline = input.featureMode === "shadow" ? v3Projection(input.bundle, input.facts) : undefined;
  const reviewFacts = [...input.facts.entities, ...input.facts.links]
    .filter((item) => item.status === "needs_review" || item.status === "stale" || item.status === "missing").length;
  const blockers: string[] = [];
  if (v4.ungroundedConnections > 0) blockers.push(`근거가 승인되지 않은 connection ${v4.ungroundedConnections}개`);
  if (baseline && v4.externalIntegrations < baseline.externalIntegrations) blockers.push("V3 투영보다 외부 연동 coverage가 낮음");
  if (baseline && (
    v4.journeySteps < baseline.journeySteps ||
    v4.journeyBranches < baseline.journeyBranches ||
    v4.journeyLoops < baseline.journeyLoops
  )) blockers.push("V3 투영보다 사용자 여정 coverage가 낮음");
  const providerTurns = new Set((input.task.stageSessions ?? []).map((item) => `${item.stage}:${item.sessionId}`)).size
    || (input.task.stageUsages?.length ?? 0);
  const ended = Date.parse(input.endedAt ?? new Date().toISOString());
  return {
    schemaVersion: 1,
    taskId: input.task.taskId,
    projectPath: input.task.projectPath,
    at: new Date(ended).toISOString(),
    featureMode: input.featureMode,
    analysisMode: input.plan.mode,
    analysisReason: input.plan.reason,
    analysisVersion: input.analysisVersion,
    semanticVersion: input.semanticVersion,
    generation: input.generation,
    providerTurns,
    ...(input.task.tokenUsage !== undefined ? { tokenUsage: input.task.tokenUsage } : {}),
    durationMs: Math.max(0, ended - Date.parse(input.task.startedAt)),
    reusableFacts: input.plan.previousSystemDigest.reusableEntityIds.length + input.plan.previousSystemDigest.reusableLinkIds.length,
    reanalyzedFacts: input.plan.impact.systemEntityIds.length + input.plan.impact.systemLinkIds.length,
    reviewFacts,
    v4,
    ...(baseline ? { v3Projection: baseline, deltas: subtract(v4, baseline) } : {}),
    transitionReady: blockers.length === 0,
    transitionBlockers: blockers,
  };
}
