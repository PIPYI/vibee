import type {
  AnalysisBundle,
  DiscoveryGap,
  EvidenceDiff,
  EvidenceIndex,
  GroundingStore,
  IncrementalAnalysisPlan,
  PreviousSystemDigest,
  SemanticMemory,
  SystemEntity,
  SystemFactStatus,
  SystemFactStore,
  SystemImpactSet,
  SystemLink,
} from "@onto/protocol";
import { isSemanticDirty } from "@onto/protocol";

import { buildEngineSystemFactStore } from "./system-facts.js";

type Fact = SystemEntity | SystemLink;

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

function currentStatus(
  fact: Fact,
  evidence: EvidenceIndex,
  diffs: ReadonlyMap<string, EvidenceDiff>,
): SystemFactStatus {
  const byId = new Map(evidence.evidence.map((item) => [item.id, item] as const));
  const direct = new Set(fact.evidenceRefs);
  const dependencies = new Set(fact.dependsOnEvidenceRefs);
  const missingDirectCount = [...direct].filter((id) => byId.get(id)?.status !== "present").length;
  if (direct.size > 0 && missingDirectCount === direct.size) return "missing";
  if (missingDirectCount > 0) return "stale";
  const missingDependency = [...dependencies].some((id) => byId.get(id)?.status !== "present");
  if (missingDependency) return "stale";

  const relevantDiffs = [...dependencies].map((id) => diffs.get(id)).filter(Boolean) as EvidenceDiff[];
  if (relevantDiffs.some((item) => item.contentChange === "modified" || item.contentChange === "appeared")) {
    return "needs_review";
  }
  const relocated = relevantDiffs.filter((item) => item.relocated);
  if (
    relocated.some((item) => {
      const source = byId.get(item.evidenceId);
      return source?.relocationConfidence === "degraded";
    })
  ) {
    return "needs_review";
  }
  if (fact.certainty === "inferred") return "needs_review";
  // needs_review는 Vibee가 같은 fact를 source contract와 함께 다시 제안해야만 해제된다.
  if (fact.status === "needs_review" && relevantDiffs.length === 0) return "needs_review";
  if (relocated.length > 0) return "relocated";
  return "valid";
}

function stampFact<T extends Fact>(fact: T, status: SystemFactStatus, version: number): T {
  return {
    ...fact,
    status,
    ...(status === "valid" || status === "relocated" ? { lastValidatedVersion: version } : {}),
  };
}

/**
 * 재인덱싱 뒤 engine fact와 Vibee fact를 하나의 수명 규칙으로 합친다.
 * 사라진 engine fact도 즉시 삭제하지 않고 missing/stale 영수증으로 남겨 Impact closure가 찾게 한다.
 */
export function reconcileSystemFactStore(input: {
  previous: SystemFactStore;
  evidence: EvidenceIndex;
  diffs: readonly EvidenceDiff[];
}): SystemFactStore {
  const currentEngine = buildEngineSystemFactStore(input.evidence, input.previous);
  const diffById = new Map(input.diffs.map((item) => [item.evidenceId, item] as const));
  const currentEntities = new Map(currentEngine.entities.map((item) => [item.id, item] as const));
  const currentLinks = new Map(currentEngine.links.map((item) => [item.id, item] as const));

  for (const previous of input.previous.entities) {
    const current = currentEntities.get(previous.id);
    if (current?.origin === "engine") continue;
    currentEntities.set(
      previous.id,
      stampFact(previous, currentStatus(previous, input.evidence, diffById), input.evidence.analysisVersion),
    );
  }
  for (const previous of input.previous.links) {
    const current = currentLinks.get(previous.id);
    if (current?.origin === "engine") continue;
    currentLinks.set(
      previous.id,
      stampFact(previous, currentStatus(previous, input.evidence, diffById), input.evidence.analysisVersion),
    );
  }

  const compare = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);
  const diagnostics = [...input.previous.diagnostics].filter(
    (item) => item.code !== "system-facts/migration-required" && item.code !== "system-facts/lifecycle",
  );
  const changed = [...currentEntities.values(), ...currentLinks.values()].filter(
    (item) => item.status !== "valid",
  );
  if (changed.length > 0) {
    diagnostics.push({
      code: "system-facts/lifecycle",
      severity: "warning",
      message: `${changed.length}개 System Fact가 증분 수명 상태를 가집니다.`,
      subject: { analysisVersion: input.evidence.analysisVersion },
      evidence: {
        statuses: Object.fromEntries(
          ["relocated", "needs_review", "stale", "missing"].map((status) => [
            status,
            changed.filter((item) => item.status === status).length,
          ]),
        ),
      },
      supportedFixes: ["needs_review/stale/missing fact만 영향 범위 안에서 재검토한다"],
    });
  }
  return {
    schemaVersion: 4,
    analysisVersion: input.evidence.analysisVersion,
    entities: [...currentEntities.values()].sort(compare),
    links: [...currentLinks.values()].sort(compare),
    diagnostics,
  };
}

function refsIntersect(values: readonly string[] | undefined, ids: ReadonlySet<string>): boolean {
  return (values ?? []).some((value) => ids.has(value));
}

function scenarioEvidenceRefs(journey: NonNullable<AnalysisBundle["userMap"]>["journeys"][number]): string[] {
  return sorted([
    ...(journey.evidenceRefs ?? []),
    ...journey.steps.flatMap((item) => item.evidenceRefs),
    ...journey.transitions.flatMap((item) => item.evidenceRefs),
    ...(journey.branches ?? []).flatMap((item) => item.evidenceRefs),
    ...(journey.stateChanges ?? []).flatMap((item) => item.evidenceRefs),
    ...(journey.activations ?? []).flatMap((item) => item.evidenceRefs),
    ...(journey.phases ?? []).flatMap((item) => item.evidenceRefs),
  ]);
}

/** dirty Evidence → System Fact → Semantic Memory → Bundle의 결정론적 closure. */
export function buildSystemImpactSet(input: {
  diffs: readonly EvidenceDiff[];
  facts: SystemFactStore;
  memory: SemanticMemory;
  grounding: GroundingStore;
  bundle: AnalysisBundle | null;
  discoveryGaps?: readonly DiscoveryGap[];
  firstAnalysis?: boolean;
}): SystemImpactSet {
  const evidenceIds = new Set(input.diffs.filter(isSemanticDirty).map((item) => item.evidenceId));
  for (const gap of input.discoveryGaps ?? []) {
    for (const ref of gap.evidenceRefs) evidenceIds.add(ref);
  }
  const entityIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const fact of input.facts.entities) {
    if (
      refsIntersect(fact.dependsOnEvidenceRefs, evidenceIds) ||
      (!["valid", "relocated"].includes(fact.status) && fact.lastValidatedVersion < input.facts.analysisVersion)
    ) {
      entityIds.add(fact.id);
      for (const ref of fact.dependsOnEvidenceRefs) evidenceIds.add(ref);
    }
  }
  for (const fact of input.facts.links) {
    if (
      refsIntersect(fact.dependsOnEvidenceRefs, evidenceIds) ||
      (!["valid", "relocated"].includes(fact.status) && fact.lastValidatedVersion < input.facts.analysisVersion)
    ) {
      linkIds.add(fact.id);
      for (const ref of fact.dependsOnEvidenceRefs) evidenceIds.add(ref);
    }
  }

  const conceptIds = new Set<string>();
  const claimIds = new Set<string>();
  for (const concept of input.memory.concepts) if (refsIntersect(concept.evidenceRefs, evidenceIds)) conceptIds.add(concept.id);
  for (const claim of input.memory.claims) if (refsIntersect(claim.evidenceRefs, evidenceIds)) claimIds.add(claim.id);
  for (const item of input.grounding.conceptGroundings) if (refsIntersect(item.evidenceRefs, evidenceIds)) conceptIds.add(item.conceptId);
  for (const item of input.grounding.claimGroundings) if (refsIntersect(item.evidenceRefs, evidenceIds)) claimIds.add(item.claimId);
  const scenarioIds = new Set(
    input.memory.canonicalScenarios
      .filter((item) => item.anchorConceptIds.some((id) => conceptIds.has(id)))
      .map((item) => item.id),
  );

  const architectureComponentIds = new Set<string>();
  const architectureConnectionIds = new Set<string>();
  const workflowNodeIds = new Set<string>();
  const workflowEdgeIds = new Set<string>();
  const sequenceIds = new Set<string>();
  const bundle = input.bundle;
  if (bundle) {
    const factEntityById = new Map(input.facts.entities.map((item) => [item.id, item] as const));
    const factLinkById = new Map(input.facts.links.map((item) => [item.id, item] as const));
    for (const item of bundle.architecture.components) {
      for (const ref of item.entityRefs) {
        const fact = factEntityById.get(ref);
        if (fact && !["valid", "relocated"].includes(fact.status)) entityIds.add(ref);
      }
      if (refsIntersect(item.entityRefs, entityIds) || refsIntersect(item.evidenceRefs, evidenceIds) || refsIntersect(item.conceptRefs, conceptIds)) {
        architectureComponentIds.add(item.id);
      }
    }
    for (const item of bundle.architecture.connections) {
      for (const ref of item.systemLinkRefs ?? []) {
        const fact = factLinkById.get(ref);
        if (fact && !["valid", "relocated"].includes(fact.status)) linkIds.add(ref);
      }
      if (refsIntersect(item.systemLinkRefs, linkIds) || refsIntersect(item.evidenceRefs, evidenceIds)) {
        architectureConnectionIds.add(item.id);
        architectureComponentIds.add(item.from);
        architectureComponentIds.add(item.to);
      }
    }
    for (const item of bundle.workflow.nodes) {
      if (refsIntersect(item.entityRefs, entityIds) || refsIntersect(item.evidenceRefs, evidenceIds) || refsIntersect(item.conceptRefs, conceptIds)) {
        workflowNodeIds.add(item.id);
      }
    }
    for (const item of bundle.workflow.edges) {
      if (refsIntersect(item.evidenceRefs, evidenceIds) || workflowNodeIds.has(item.from) || workflowNodeIds.has(item.to)) {
        workflowEdgeIds.add(item.id);
        workflowNodeIds.add(item.from);
        workflowNodeIds.add(item.to);
        if (item.sequenceRef) sequenceIds.add(item.sequenceRef);
      }
    }
    for (const item of bundle.sequences) {
      const refs = [...item.evidenceRefs, ...item.messages.flatMap((message) => message.evidenceRefs)];
      if (refsIntersect(refs, evidenceIds) || workflowEdgeIds.has(item.triggeredByEdgeId)) sequenceIds.add(item.id);
    }
    for (const journey of bundle.userMap?.journeys ?? []) {
      if (scenarioIds.has(journey.id) || refsIntersect(scenarioEvidenceRefs(journey), evidenceIds)) scenarioIds.add(journey.id);
    }
  }

  const discoveryRoots = sorted((input.discoveryGaps ?? []).map((item) => item.id));
  const reasons: string[] = [];
  const requiresFullDiscovery = Boolean(input.firstAnalysis);
  const totalBundleItems = bundle
    ? bundle.architecture.components.length + bundle.architecture.connections.length + bundle.workflow.nodes.length + bundle.workflow.edges.length
    : 0;
  const impactedBundleItems = architectureComponentIds.size + architectureConnectionIds.size + workflowNodeIds.size + workflowEdgeIds.size;
  // 작은 프로젝트는 대부분이 한 Link에 연결되어 있어 비율만 보면 매번 full이 된다.
  // 20개 이상인 큰 Bundle에서 closure가 60%를 넘을 때만 안전한 부분 경계를 잃었다고 본다.
  const requiresFullAssembly = !bundle || (totalBundleItems >= 20 && impactedBundleItems / totalBundleItems > 0.6);
  if (requiresFullDiscovery) reasons.push("first-v4-analysis");
  if (!bundle) reasons.push("analysis-bundle-missing");
  else if (requiresFullAssembly) reasons.push("impact-closure-exceeds-60-percent");
  if (discoveryRoots.length > 0) reasons.push("open-world-discovery-gap");
  if ([...input.facts.links, ...input.facts.entities].some((item) => item.status === "missing")) reasons.push("system-fact-source-missing");

  return {
    evidenceIds: sorted(evidenceIds),
    systemEntityIds: sorted(entityIds),
    systemLinkIds: sorted(linkIds),
    conceptIds: sorted(conceptIds),
    claimIds: sorted(claimIds),
    scenarioIds: sorted(scenarioIds),
    architectureComponentIds: sorted(architectureComponentIds),
    architectureConnectionIds: sorted(architectureConnectionIds),
    workflowNodeIds: sorted(workflowNodeIds),
    workflowEdgeIds: sorted(workflowEdgeIds),
    sequenceIds: sorted(sequenceIds),
    discoveryRoots,
    requiresFullDiscovery,
    requiresFullAssembly,
    reasons: sorted(reasons),
  };
}

export function previousSystemDigest(facts: SystemFactStore, impact: SystemImpactSet): PreviousSystemDigest {
  const reusable = (item: Fact): boolean =>
    (item.status === "valid" || item.status === "relocated") && item.certainty !== "inferred";
  return {
    analysisVersion: facts.analysisVersion,
    entityCount: facts.entities.length,
    linkCount: facts.links.length,
    reusableEntityIds: facts.entities.filter(reusable).map((item) => item.id).sort(),
    reusableLinkIds: facts.links.filter(reusable).map((item) => item.id).sort(),
    reviewEntityIds: facts.entities.filter((item) => !reusable(item)).map((item) => item.id).sort(),
    reviewLinkIds: facts.links.filter((item) => !reusable(item)).map((item) => item.id).sort(),
    impact,
  };
}

/** Semantic patch가 검토를 마쳤다는 영수증. status 자체는 Assembly가 참조를 제거할 때까지 보존한다. */
export function acknowledgeSystemFactReview(
  facts: SystemFactStore,
  impact: SystemImpactSet,
  analysisVersion = facts.analysisVersion,
): SystemFactStore {
  const entityIds = new Set(impact.systemEntityIds);
  const linkIds = new Set(impact.systemLinkIds);
  return {
    ...facts,
    entities: facts.entities.map((item) =>
      entityIds.has(item.id) ? { ...item, lastValidatedVersion: analysisVersion } : item,
    ),
    links: facts.links.map((item) =>
      linkIds.has(item.id) ? { ...item, lastValidatedVersion: analysisVersion } : item,
    ),
  };
}

export function isSystemImpactEmpty(impact: SystemImpactSet): boolean {
  return (
    impact.systemEntityIds.length === 0 &&
    impact.systemLinkIds.length === 0 &&
    impact.conceptIds.length === 0 &&
    impact.claimIds.length === 0 &&
    impact.scenarioIds.length === 0 &&
    impact.architectureComponentIds.length === 0 &&
    impact.architectureConnectionIds.length === 0 &&
    impact.workflowNodeIds.length === 0 &&
    impact.workflowEdgeIds.length === 0 &&
    impact.sequenceIds.length === 0 &&
    impact.discoveryRoots.length === 0
  );
}

export function buildIncrementalAnalysisPlan(input: {
  facts: SystemFactStore;
  impact: SystemImpactSet;
  discoveryGaps: readonly DiscoveryGap[];
  integrationCatalog: IncrementalAnalysisPlan["integrationCatalog"];
  firstAnalysis: boolean;
  forceFull?: boolean;
}): IncrementalAnalysisPlan {
  const semanticTurnRequired =
    input.firstAnalysis ||
    Boolean(input.forceFull) ||
    input.discoveryGaps.length > 0 ||
    input.impact.systemEntityIds.length > 0 ||
    input.impact.systemLinkIds.length > 0 ||
    input.impact.conceptIds.length > 0 ||
    input.impact.claimIds.length > 0 ||
    input.impact.scenarioIds.length > 0 ||
    input.impact.requiresFullAssembly;
  const assemblyTargets =
    input.impact.architectureComponentIds.length +
    input.impact.architectureConnectionIds.length +
    input.impact.workflowNodeIds.length +
    input.impact.workflowEdgeIds.length +
    input.impact.sequenceIds.length;
  const fullDiscovery = input.firstAnalysis || Boolean(input.forceFull) || input.impact.requiresFullDiscovery;
  const fullAssembly = input.firstAnalysis || Boolean(input.forceFull) || input.impact.requiresFullAssembly;
  const assemblyTurnRequired = fullAssembly || assemblyTargets > 0 || (semanticTurnRequired && input.firstAnalysis);
  const mode = !semanticTurnRequired && !assemblyTurnRequired
    ? "fast-path"
    : fullDiscovery || fullAssembly
      ? "full"
      : "incremental";
  const reason = mode === "fast-path"
    ? "구조·의미·지도에 닿는 변경이 없어 기존 generation을 재사용합니다."
    : fullDiscovery
      ? `전체 discovery: ${sorted([...input.impact.reasons, input.firstAnalysis ? "first-analysis" : "", input.forceFull ? "user-requested-full-analysis" : ""].filter(Boolean)).join(", ")}`
      : `영향 범위만 재검토: ${assemblyTargets}개 Bundle 조각, ${input.discoveryGaps.length}개 discovery root`;
  return {
    mode,
    semanticTurnRequired,
    assemblyTurnRequired,
    fullDiscovery,
    fullAssembly,
    reason,
    impact: input.impact,
    previousSystemDigest: previousSystemDigest(input.facts, input.impact),
    discoveryGaps: [...input.discoveryGaps],
    integrationCatalog: [...input.integrationCatalog],
  };
}
