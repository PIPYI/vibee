/**
 * V4 Phase 2 — Vibee가 제안한 source anchor + System Entity + System Link batch를
 * 결정론적으로 검증한다. 이 모듈은 저장하지 않는다. AnalyzeTransaction이 pending 상태로
 * 들고 있다가 Semantic Patch와 같은 generation에 커밋한다.
 */
import type {
  Diagnostic,
  EntityRef,
  Evidence,
  EvidenceIndex,
  Outcome,
  SystemEntity,
  SystemFactProposal,
  SystemFactProposalResult,
  SystemFactStore,
  SystemLink,
} from "@onto/protocol";

import { validateProposal } from "./propose.js";
import { diagnostic, hasError, validateAgainst } from "./schema.js";
import { canonicalResourceRef, systemEntityId, systemLinkId } from "./system-facts.js";

export type SystemFactProposalContext = {
  projectPath: string;
  index: EvidenceIndex;
  systemFacts: SystemFactStore;
  observedAtVersion: number;
};

export type ValidatedSystemFactBatch = {
  evidence: Evidence[];
  entities: SystemEntity[];
  links: SystemLink[];
  result: SystemFactProposalResult;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function canonicalRef(ref: EntityRef): EntityRef {
  return ref.kind === "resource" ? canonicalResourceRef(ref) : ref;
}

function duplicateLocalIds(
  values: ReadonlyArray<{ localId: string }>,
  base: string,
  diagnostics: Diagnostic[],
): void {
  const seen = new Set<string>();
  values.forEach((item, index) => {
    if (!seen.has(item.localId)) {
      seen.add(item.localId);
      return;
    }
    diagnostics.push(
      diagnostic("system-fact/duplicate-local-id", "error", `${base}/${index}/localId가 중복됩니다: ${item.localId}`, {
        subject: { path: `${base}/${index}/localId`, localId: item.localId },
        evidence: { localId: item.localId },
        supportedFixes: ["batch 안에서 종류별 localId를 유일하게 만든다"],
      }),
    );
  });
}

type AnchorView = { proposalKind: string; evidence: Evidence };

function anchorKinds(anchors: readonly AnchorView[]): Set<string> {
  return new Set(anchors.map((item) => item.proposalKind.trim().toLowerCase().replace(/[\s_-]+/gu, "")));
}

function kindMatches(kinds: ReadonlySet<string>, patterns: readonly RegExp[]): boolean {
  return [...kinds].some((kind) => patterns.some((pattern) => pattern.test(kind)));
}

function looksLikeCall(anchors: readonly AnchorView[]): boolean {
  return anchors.some(({ proposalKind, evidence }) => {
    if (/call|invoke|request|publish|consume|read|write|query|mutation/iu.test(proposalKind)) return true;
    const excerpt = evidence.excerpt ?? "";
    return /(?:\b[a-z_$][\w$]*\s*\.\s*)*[a-z_$][\w$]*\s*\([^)]*/iu.test(excerpt);
  });
}

/**
 * Core는 제품 의미를 판단하지 않고 fact 종류별 최소 source shape만 검사한다.
 * 불충분한 grounded 제안은 batch 실패가 아니라 inferred로 강등한다.
 */
function sourceContractFailure(kind: string, anchors: readonly AnchorView[]): string | undefined {
  const normalized = kind.trim().toLowerCase();
  const kinds = anchorKinds(anchors);
  const hasCall = looksLikeCall(anchors);
  const hasSupport = kindMatches(kinds, [/dependency/u, /import/u, /config/u, /manifest/u, /environment/u, /client/u]);

  if (/external|sdk|http|api-call|remote/iu.test(normalized)) {
    if (!hasCall) return "외부 호출을 보여주는 call expression anchor가 없습니다";
    if (!hasSupport) return "외부 대상을 식별할 dependency/import/config anchor가 없습니다";
    return undefined;
  }
  if (/route|handler/iu.test(normalized)) {
    const hasRoute = kindMatches(kinds, [/route/u, /handler/u, /declaration/u, /entrypoint/u]);
    if (!hasRoute) return "route 선언 또는 handler anchor가 없습니다";
    return undefined;
  }
  if (/queue|publish|consume|event/iu.test(normalized)) {
    if (!hasCall) return "publish/consume 호출 anchor가 없습니다";
    if (!kindMatches(kinds, [/topic/u, /queue/u, /channel/u, /config/u, /call/u])) {
      return "topic/queue/channel 식별 anchor가 없습니다";
    }
    return undefined;
  }
  if (/datastore|database|storage|read|write|query/iu.test(normalized)) {
    if (!hasCall) return "저장소 read/write 호출 anchor가 없습니다";
    if (!kindMatches(kinds, [/client/u, /model/u, /config/u, /dependency/u, /call/u, /query/u])) {
      return "저장소 client/model/config anchor가 없습니다";
    }
    return undefined;
  }
  if (/fallback|failover/iu.test(normalized)) {
    if (!kindMatches(kinds, [/branch/u, /exception/u, /catch/u, /condition/u])) {
      return "예외 또는 조건 분기 anchor가 없습니다";
    }
    if (!hasCall) return "대체 동작을 보여주는 call anchor가 없습니다";
    return undefined;
  }
  if (!hasCall && anchors.length === 0) return "동작을 보여주는 code anchor가 없습니다";
  return undefined;
}

function entitySourceContractFailure(entity: { kind: string; ref: EntityRef }, anchors: readonly AnchorView[]): string | undefined {
  const normalized = entity.kind.trim().toLowerCase();
  const namespace = entity.ref.kind === "resource" ? entity.ref.namespace.trim().toLowerCase() : "";
  const kinds = anchorKinds(anchors);
  if (normalized === "runtime" || namespace === "runtime") {
    if (kindMatches(kinds, [/script/u, /runscript/u, /command/u])) return undefined;
    const signals = [
      kindMatches(kinds, [/manifest/u, /dependency/u]),
      kindMatches(kinds, [/config/u]),
      kindMatches(kinds, [/entrypoint/u, /bootstrap/u]),
    ].filter(Boolean).length;
    return signals >= 2 ? undefined : "runtime에는 manifest/config/entrypoint 중 둘 이상 또는 명시적 실행 script가 필요합니다";
  }
  if (normalized === "route" || namespace === "route") {
    return kindMatches(kinds, [/route/u, /handler/u, /declaration/u]) ? undefined : "route 선언 또는 handler anchor가 없습니다";
  }
  if (normalized === "external" || namespace === "external") {
    return kindMatches(kinds, [/dependency/u, /import/u, /config/u, /client/u]) ? undefined : "외부 대상 identity를 보여주는 dependency/import/config anchor가 없습니다";
  }
  return anchors.length > 0 ? undefined : "entity identity를 뒷받침하는 source anchor가 없습니다";
}

function resolvedEndpoint(
  endpoint: { entityId: string } | { localId: string },
  existing: ReadonlyMap<string, SystemEntity>,
  proposed: ReadonlyMap<string, SystemEntity>,
): SystemEntity | undefined {
  return "entityId" in endpoint ? existing.get(endpoint.entityId) : proposed.get(endpoint.localId);
}

/** batch 전체를 검증한다. 오류가 하나라도 있으면 발급 결과를 전혀 돌려주지 않는다. */
export function validateSystemFactProposal(
  context: SystemFactProposalContext,
  proposal: SystemFactProposal,
): Outcome<ValidatedSystemFactBatch> {
  const diagnostics = validateAgainst("system-fact-proposal", proposal);
  if (hasError(diagnostics)) return { ok: false, diagnostics };

  if (proposal.baseAnalysisVersion !== context.observedAtVersion) {
    diagnostics.push(
      diagnostic("version/stale-base", "error", "System Fact 제안의 baseAnalysisVersion이 현재 transaction과 다릅니다.", {
        subject: { path: "/baseAnalysisVersion" },
        evidence: { proposed: proposal.baseAnalysisVersion, current: context.observedAtVersion },
        supportedFixes: ["현재 transaction의 baseAnalysisVersion으로 다시 제출한다"],
      }),
    );
    return { ok: false, diagnostics };
  }

  duplicateLocalIds(proposal.anchors, "/anchors", diagnostics);
  duplicateLocalIds(proposal.entities, "/entities", diagnostics);
  duplicateLocalIds(proposal.links, "/links", diagnostics);
  if (hasError(diagnostics)) return { ok: false, diagnostics };

  const anchorByLocalId = new Map<string, AnchorView>();
  for (const [index, anchor] of proposal.anchors.entries()) {
    const validated = validateProposal(
      {
        projectPath: context.projectPath,
        index: context.index,
        observedAtVersion: context.observedAtVersion,
      },
      {
        kind: anchor.kind,
        filePath: anchor.filePath,
        location: anchor.location,
        ...(anchor.symbolHint ? { symbolHint: anchor.symbolHint } : {}),
        summary: anchor.summary,
        ...(anchor.normalizationProfile ? { normalizationProfile: anchor.normalizationProfile } : {}),
      },
    );
    diagnostics.push(...validated.diagnostics);
    if (!validated.ok) continue;
    anchorByLocalId.set(anchor.localId, { proposalKind: anchor.kind, evidence: validated.value });
    if (validated.value.graph) {
      diagnostics.push(
        diagnostic("system-fact/anchor-graph-ignored", "warning", `anchors/${index}의 graph hint는 System Fact batch에서 사용하지 않습니다.`, {
          subject: { path: `/anchors/${index}` }, evidence: {}, supportedFixes: ["entity/link는 entities와 links에 선언한다"],
        }),
      );
    }
  }
  if (hasError(diagnostics)) return { ok: false, diagnostics };

  const requireAnchors = (ids: readonly string[], path: string): AnchorView[] => {
    const resolved: AnchorView[] = [];
    ids.forEach((id, index) => {
      const anchor = anchorByLocalId.get(id);
      if (anchor) resolved.push(anchor);
      else diagnostics.push(
        diagnostic("system-fact/unknown-anchor", "error", `${path}/${index}가 없는 anchor localId "${id}"를 가리킵니다.`, {
          subject: { path: `${path}/${index}`, localId: id }, evidence: { localId: id }, supportedFixes: ["anchors[].localId 중 하나를 쓴다"],
        }),
      );
    });
    return resolved;
  };

  const existing = new Map(context.systemFacts.entities.map((item) => [item.id, item] as const));
  const entityByLocalId = new Map<string, SystemEntity>();
  const downgraded = new Set<string>();
  const usedEntityLocalIds = new Set<string>();
  const usedAnchorLocalIds = new Set<string>();

  for (const [index, item] of proposal.entities.entries()) {
    const anchors = requireAnchors(item.anchorLocalIds, `/entities/${index}/anchorLocalIds`);
    item.anchorLocalIds.forEach((id) => usedAnchorLocalIds.add(id));
    const ref = canonicalRef(item.ref);
    const id = systemEntityId(ref);
    const prior = existing.get(id);
    let certainty = item.certainty;
    const contractFailure = certainty === "grounded"
      ? entitySourceContractFailure({ kind: item.kind, ref }, anchors)
      : undefined;
    if (contractFailure) {
      certainty = "inferred";
      downgraded.add(item.localId);
      diagnostics.push(
        diagnostic("system-fact/source-contract-downgraded", "warning", `entity "${item.localId}"를 inferred로 낮췄습니다: ${contractFailure}`, {
          subject: { path: `/entities/${index}`, localId: item.localId }, evidence: { entityId: id }, supportedFixes: ["entity kind의 최소 source contract를 만족하는 anchor를 붙인다"],
        }),
      );
    }
    entityByLocalId.set(item.localId, prior ?? {
      id,
      ref,
      kind: item.kind,
      origin: "vibee",
      certainty,
      evidenceRefs: unique(anchors.map((anchor) => anchor.evidence.id)),
      dependsOnEvidenceRefs: unique(anchors.map((anchor) => anchor.evidence.id)),
      status: certainty === "inferred" ? "needs_review" : "valid",
      firstSeenVersion: context.observedAtVersion,
      lastValidatedVersion: context.observedAtVersion,
    });
  }

  const links: SystemLink[] = [];
  const linkIds: Record<string, string> = {};
  for (const [index, item] of proposal.links.entries()) {
    const direct = requireAnchors(item.anchorLocalIds, `/links/${index}/anchorLocalIds`);
    const dependencies = requireAnchors(item.dependencyAnchorLocalIds ?? [], `/links/${index}/dependencyAnchorLocalIds`);
    [...item.anchorLocalIds, ...(item.dependencyAnchorLocalIds ?? [])].forEach((id) => usedAnchorLocalIds.add(id));
    const from = resolvedEndpoint(item.from, existing, entityByLocalId);
    const to = resolvedEndpoint(item.to, existing, entityByLocalId);
    if (!from || !to) {
      for (const [field, endpoint] of [["from", item.from], ["to", item.to]] as const) {
        if (resolvedEndpoint(endpoint, existing, entityByLocalId)) continue;
        diagnostics.push(
          diagnostic("system-fact/unresolved-endpoint", "error", `links/${index}/${field} endpoint를 해석할 수 없습니다.`, {
            subject: { path: `/links/${index}/${field}`, localId: item.localId }, evidence: { endpoint }, supportedFixes: ["기존 entityId 또는 같은 batch의 entity localId를 쓴다"],
          }),
        );
      }
      continue;
    }
    if ("localId" in item.from) usedEntityLocalIds.add(item.from.localId);
    if ("localId" in item.to) usedEntityLocalIds.add(item.to.localId);

    let certainty = item.certainty;
    const contractFailure = certainty === "grounded" ? sourceContractFailure(item.kind, [...direct, ...dependencies]) : undefined;
    if (contractFailure || from.certainty === "inferred" || to.certainty === "inferred") {
      certainty = "inferred";
      downgraded.add(item.localId);
      diagnostics.push(
        diagnostic("system-fact/source-contract-downgraded", "warning", `link "${item.localId}"를 inferred로 낮췄습니다: ${contractFailure ?? "endpoint가 inferred입니다"}.`, {
          subject: { path: `/links/${index}`, localId: item.localId }, evidence: { kind: item.kind }, supportedFixes: ["fact kind의 최소 source contract를 만족하는 anchor를 붙인다"],
        }),
      );
    }
    const id = systemLinkId({ kind: item.kind, from: from.ref, to: to.ref, ...(item.mechanism ? { mechanism: item.mechanism } : {}) });
    linkIds[item.localId] = id;
    links.push({
      id,
      from: from.ref,
      to: to.ref,
      kind: item.kind,
      ...(item.mechanism ? { mechanism: item.mechanism } : {}),
      origin: "vibee",
      certainty,
      evidenceRefs: unique(direct.map((anchor) => anchor.evidence.id)),
      dependsOnEvidenceRefs: unique([...direct, ...dependencies].map((anchor) => anchor.evidence.id)),
      status: certainty === "inferred" ? "needs_review" : "valid",
      firstSeenVersion: context.observedAtVersion,
      lastValidatedVersion: context.observedAtVersion,
    });
  }
  if (hasError(diagnostics)) return { ok: false, diagnostics };

  const unusedLocalIds = [
    ...proposal.entities.filter((item) => !usedEntityLocalIds.has(item.localId)).map((item) => `entity:${item.localId}`),
    ...proposal.anchors.filter((item) => !usedAnchorLocalIds.has(item.localId)).map((item) => `anchor:${item.localId}`),
  ].sort();
  if (unusedLocalIds.length > 0) {
    diagnostics.push(
      diagnostic("system-fact/unused-proposal", "warning", `사용되지 않은 System Fact 제안이 ${unusedLocalIds.length}개 있습니다.`, {
        subject: { localIds: unusedLocalIds }, evidence: { localIds: unusedLocalIds }, supportedFixes: ["불필요한 제안을 제거하거나 link/anchor 참조에 연결한다"],
      }),
    );
  }

  const entities = [...entityByLocalId.values()];
  const anchorIds = Object.fromEntries([...anchorByLocalId].map(([localId, anchor]) => [localId, anchor.evidence.id]));
  const entityIds = Object.fromEntries([...entityByLocalId].map(([localId, entity]) => [localId, entity.id]));
  return {
    ok: true,
    value: {
      evidence: [...anchorByLocalId.values()].map((item) => item.evidence),
      entities,
      links,
      result: {
        anchorIds,
        entityIds,
        linkIds,
        downgradedFactLocalIds: [...downgraded].sort(),
        unusedLocalIds,
      },
    },
    diagnostics,
  };
}
