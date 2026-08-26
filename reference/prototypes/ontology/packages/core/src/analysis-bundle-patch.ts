import type {
  AnalysisBundle,
  AnalysisBundlePatchOperation,
  Diagnostic,
  SystemImpactSet,
} from "@onto/protocol";

import { diagnostic, hasError } from "./schema.js";

type CollectionRule = {
  prefix: readonly [string, string];
  ids: ReadonlySet<string>;
};

function decodePath(path: string): string[] {
  return path.split("/").slice(1).map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

function itemId(bundle: AnalysisBundle, root: string, collection: string, segment: string): string | undefined {
  const index = Number(segment);
  if (!Number.isInteger(index) || index < 0) return undefined;
  if (root === "architecture" && collection === "components") return bundle.architecture.components[index]?.id;
  if (root === "architecture" && collection === "connections") return bundle.architecture.connections[index]?.id;
  if (root === "workflow" && collection === "nodes") return bundle.workflow.nodes[index]?.id;
  if (root === "workflow" && collection === "edges") return bundle.workflow.edges[index]?.id;
  if (root === "userMap" && collection === "journeys") return bundle.userMap?.journeys[index]?.id;
  if (root === "sequences") return bundle.sequences[index]?.id;
  return undefined;
}

function proposedId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = (value as Record<string, unknown>)["id"];
  return typeof id === "string" ? id : undefined;
}

function proposedRefs(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const output = new Set<string>();
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if ((key.endsWith("Refs") || key === "entityRefs" || key === "systemLinkRefs") && Array.isArray(item)) {
        for (const ref of item) if (typeof ref === "string") output.add(ref);
      } else walk(item);
    }
  };
  walk(value);
  return [...output];
}

function impactRefs(impact: SystemImpactSet): Set<string> {
  return new Set([
    ...impact.evidenceIds,
    ...impact.systemEntityIds,
    ...impact.systemLinkIds,
    ...impact.conceptIds,
    ...impact.claimIds,
    ...impact.scenarioIds,
    ...impact.workflowEdgeIds,
  ]);
}

/** Phase 5 — RFC6902 부분집합을 section/ID ImpactSet 밖으로 못 나가게 한다. */
export function validateAnalysisBundlePatchScope(
  bundle: AnalysisBundle,
  operations: readonly AnalysisBundlePatchOperation[],
  impact: SystemImpactSet,
): Diagnostic[] {
  const rules: CollectionRule[] = [
    { prefix: ["architecture", "components"], ids: new Set(impact.architectureComponentIds) },
    { prefix: ["architecture", "connections"], ids: new Set(impact.architectureConnectionIds) },
    { prefix: ["workflow", "nodes"], ids: new Set(impact.workflowNodeIds) },
    { prefix: ["workflow", "edges"], ids: new Set(impact.workflowEdgeIds) },
    { prefix: ["userMap", "journeys"], ids: new Set(impact.scenarioIds) },
    { prefix: ["sequences", ""], ids: new Set(impact.sequenceIds) },
  ];
  const allowedRefs = impactRefs(impact);
  const diagnostics: Diagnostic[] = [];
  operations.forEach((operation, operationIndex) => {
    const segments = decodePath(operation.path);
    if (!operation.path.startsWith("/") || segments.some((item) => ["__proto__", "prototype", "constructor"].includes(item))) {
      diagnostics.push(diagnostic("bundle-patch/unsafe-path", "error", `안전하지 않은 patch 경로입니다: ${operation.path}`, {
        subject: { path: `/operations/${operationIndex}/path` },
      }));
      return;
    }
    if (impact.requiresFullAssembly) return;
    const rule = rules.find((candidate) =>
      candidate.prefix[0] === segments[0] && (candidate.prefix[1] === "" || candidate.prefix[1] === segments[1]),
    );
    const itemSegment = rule?.prefix[1] === "" ? segments[1] : segments[2];
    if (!rule || itemSegment === undefined) {
      diagnostics.push(diagnostic(
        "bundle-patch/section-outside-impact",
        "error",
        `증분 patch가 전체 section을 수정하려 합니다: ${operation.path}`,
        {
          subject: { path: `/operations/${operationIndex}/path`, patchPath: operation.path },
          supportedFixes: ["ImpactSet에 포함된 component/connection/node/edge/journey/sequence ID만 수정한다"],
        },
      ));
      return;
    }
    const existingId = itemSegment === "-"
      ? undefined
      : itemId(bundle, segments[0]!, rule.prefix[1], itemSegment);
    const candidateId = existingId ?? proposedId(operation.value);
    if (candidateId && rule.ids.has(candidateId)) return;
    // 새 항목은 새 ID라 ImpactSet에 없을 수 있다. 대신 제안 값이 영향 근거와 직접 닿아야 한다.
    if (!existingId && proposedRefs(operation.value).some((ref) => allowedRefs.has(ref))) return;
    diagnostics.push(diagnostic(
      "bundle-patch/id-outside-impact",
      "error",
      `${candidateId ?? operation.path}는 현재 SystemImpactSet의 수정 허용 범위 밖입니다.`,
      {
        subject: { path: `/operations/${operationIndex}`, patchPath: operation.path, id: candidateId },
        evidence: { allowedIds: [...rule.ids].slice(0, 50) },
        supportedFixes: ["get_incremental_analysis_context의 impact ID에 해당하는 조각만 수정한다"],
      },
    ));
  });
  return diagnostics;
}

export function applyAnalysisBundlePatch(
  bundle: AnalysisBundle,
  operations: readonly AnalysisBundlePatchOperation[],
  impact?: SystemImpactSet,
): { bundle?: AnalysisBundle; diagnostics: Diagnostic[] } {
  const diagnostics = impact ? validateAnalysisBundlePatchScope(bundle, operations, impact) : [];
  if (hasError(diagnostics)) return { diagnostics };
  const root = structuredClone(bundle) as unknown as Record<string, unknown>;
  try {
    for (const operation of operations) {
      const segments = decodePath(operation.path);
      if (!operation.path.startsWith("/") || segments.length < 2 || !["architecture", "workflow", "userMap", "sequences"].includes(segments[0]!)) {
        throw new Error(`허용되지 않는 Bundle patch 경로입니다: ${operation.path}`);
      }
      let parent: unknown = root;
      for (const segment of segments.slice(0, -1)) {
        if (parent === null || typeof parent !== "object") throw new Error(`존재하지 않는 patch 경로입니다: ${operation.path}`);
        parent = Array.isArray(parent) ? parent[Number(segment)] : (parent as Record<string, unknown>)[segment];
      }
      const key = segments.at(-1)!;
      if (Array.isArray(parent)) {
        const index = key === "-" ? parent.length : Number(key);
        if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`잘못된 배열 경로입니다: ${operation.path}`);
        if (operation.op === "add") parent.splice(index, 0, operation.value);
        else if (operation.op === "remove") {
          if (index >= parent.length) throw new Error(`제거할 항목이 없습니다: ${operation.path}`);
          parent.splice(index, 1);
        } else {
          if (index >= parent.length) throw new Error(`교체할 항목이 없습니다: ${operation.path}`);
          parent[index] = operation.value;
        }
      } else if (parent && typeof parent === "object") {
        const record = parent as Record<string, unknown>;
        if (operation.op === "remove") delete record[key];
        else record[key] = operation.value;
      } else throw new Error(`존재하지 않는 patch 경로입니다: ${operation.path}`);
    }
    return { bundle: root as unknown as AnalysisBundle, diagnostics };
  } catch (error) {
    return {
      diagnostics: [
        ...diagnostics,
        diagnostic("bundle-patch/invalid-operation", "error", error instanceof Error ? error.message : String(error)),
      ],
    };
  }
}
