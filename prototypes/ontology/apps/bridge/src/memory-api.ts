/**
 * `/internal/*` 가 돌려주는 payload를 만든다.
 *
 * MCP server 는 상태를 갖지 않고 전부 여기에 위임한다 (B1). **lazy / degraded mode**(C5) —
 * 아직 분석하지 않은 프로젝트에서도 실패가 아니라 `next_step` 이 담긴 payload 를 돌려준다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SemanticStore, type LoadedState } from "@onto/core";
import type { Evidence } from "@onto/protocol";

export type Unavailable = { error: "memory_unavailable"; reason: string; next_step: string };

export function loadState(projectPath: string | null): LoadedState | Unavailable {
  if (!projectPath) {
    return {
      error: "memory_unavailable",
      reason: "no_project",
      next_step: "앱에서 프로젝트를 먼저 선택하세요.",
    };
  }
  const store = new SemanticStore(projectPath);
  if (!store.isInitialized()) {
    return {
      error: "memory_unavailable",
      reason: "not_indexed",
      next_step: "앱에서 분석을 먼저 실행하세요 (Analyze).",
    };
  }
  try {
    return store.load();
  } catch (error) {
    return {
      error: "memory_unavailable",
      reason: "load_failed",
      next_step: `저장된 상태를 읽지 못했습니다: ${String(error)}`,
    };
  }
}

export function isUnavailable(value: LoadedState | Unavailable): value is Unavailable {
  return "error" in value;
}

/**
 * digest — 전체 대신 **무엇이 있는지**만 (B6).
 *
 * 전체 Semantic Memory 를 매 turn 실어 보내면 agent 가 자기가 방금 쓴 것을 다시 받아 문맥에
 * 쌓는다. 정말 필요한 경우는 다른 곳에서 시작한 세션을 이어받을 때뿐이다.
 */
export function memoryDigest(state: LoadedState): Record<string, unknown> {
  const { project, memory, evidence } = state;
  const groundingCount = new Map<string, number>();
  for (const concept of memory.concepts) {
    groundingCount.set(concept.id, concept.evidenceRefs.length);
  }
  const topConcepts = [...memory.concepts]
    .sort((a, b) => (groundingCount.get(b.id) ?? 0) - (groundingCount.get(a.id) ?? 0))
    .slice(0, 25)
    .map((concept) => ({
      id: concept.id,
      name: concept.name,
      status: concept.status,
      evidenceCount: concept.evidenceRefs.length,
    }));

  const evidenceByKind: Record<string, number> = {};
  for (const item of evidence.evidence) {
    if (item.status !== "present") continue;
    evidenceByKind[item.kind] = (evidenceByKind[item.kind] ?? 0) + 1;
  }

  return {
    generation: state.generation,
    analysisVersion: project.analysisVersion,
    semanticVersion: project.semanticVersion,
    semanticReconciledAnalysisVersion: project.semanticReconciledAnalysisVersion,
    // 코드가 앞서 갔는데 의미가 따라가지 못했는지 (V1). agent 가 알아야 한다.
    reconcileCurrent: project.semanticReconciledAnalysisVersion >= project.analysisVersion,
    counts: {
      concepts: memory.concepts.length,
      claims: memory.claims.length,
      canonicalScenarios: memory.canonicalScenarios.length,
      evidence: evidence.evidence.filter((item) => item.status === "present").length,
    },
    evidenceByKind,
    topConcepts,
    canonicalScenarios: memory.canonicalScenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      type: scenario.type,
    })),
  };
}

export type EvidenceQuery = {
  ids?: string[];
  filePath?: string;
  kind?: string;
  symbolId?: string;
  includeSource?: boolean;
  limit?: number;
};

/** evidence 레코드. `includeSource` 를 켜면 그 범위의 실제 소스를 함께 준다. */
export function queryEvidence(
  state: LoadedState,
  projectPath: string,
  query: EvidenceQuery,
): Record<string, unknown> {
  const limit = Math.min(query.limit ?? 50, 200);
  let matched = state.evidence.evidence;

  if (query.ids && query.ids.length > 0) {
    const wanted = new Set(query.ids);
    matched = matched.filter((item) => wanted.has(item.id));
  }
  if (query.filePath) matched = matched.filter((item) => item.filePath === query.filePath);
  if (query.kind) matched = matched.filter((item) => item.kind === query.kind);
  if (query.symbolId) matched = matched.filter((item) => item.symbolId === query.symbolId);

  const total = matched.length;
  const page = matched.slice(0, limit);

  return {
    total,
    returned: page.length,
    // 조용히 자르지 않는다. 몇 개 중 몇 개인지 말한다.
    truncated: total > page.length,
    evidence: page.map((item) => describeEvidence(item, projectPath, query.includeSource === true)),
  };
}

function describeEvidence(
  evidence: Evidence,
  projectPath: string,
  includeSource: boolean,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: evidence.id,
    kind: evidence.kind,
    origin: evidence.origin,
    status: evidence.status,
    ...(evidence.filePath ? { filePath: evidence.filePath } : {}),
    ...(evidence.symbolId ? { symbolId: evidence.symbolId } : {}),
    ...(evidence.location ? { location: evidence.location } : {}),
    ...(evidence.summary ? { summary: evidence.summary } : {}),
    ...(evidence.graph ? { graph: evidence.graph } : {}),
  };

  if (!includeSource || !evidence.filePath || !evidence.location) return base;
  try {
    const text = readFileSync(join(projectPath, evidence.filePath), "utf8");
    const lines = text.split(/\r?\n/u);
    const start = Math.max(0, evidence.location.startLine - 1);
    const end = Math.min(lines.length, evidence.location.endLine ?? evidence.location.startLine);
    base["source"] = lines.slice(start, end).join("\n");
  } catch (error) {
    base["sourceError"] = String(error);
  }
  return base;
}

/** Concept + 연결된 Claim + grounding 요약 + **재사용 후보** (§15). */
export function conceptContext(
  state: LoadedState,
  selector: { conceptId?: string; name?: string },
): Record<string, unknown> {
  const { memory, grounding } = state;
  const concept =
    memory.concepts.find((item) => item.id === selector.conceptId) ??
    memory.concepts.find((item) => item.name === selector.name) ??
    memory.concepts.find(
      (item) => selector.name !== undefined && item.aliases?.includes(selector.name),
    );

  if (!concept) {
    // 못 찾았다고 실패하지 않는다. 무엇으로 찾았는지와 **비슷한 후보**를 준다.
    const needle = (selector.name ?? selector.conceptId ?? "").toLowerCase();
    const candidates = memory.concepts
      .filter((item) => item.name.toLowerCase().includes(needle))
      .slice(0, 10)
      .map((item) => ({ id: item.id, name: item.name }));
    return { found: false, query: selector, candidates };
  }

  const outgoing = memory.claims.filter((claim) => claim.subjectConceptId === concept.id);
  const incoming = memory.claims.filter(
    (claim) => "conceptId" in claim.object && claim.object.conceptId === concept.id,
  );
  const groundingEntry = grounding.conceptGroundings.find((item) => item.conceptId === concept.id);

  return {
    found: true,
    concept,
    claims: {
      outgoing: outgoing.map(summarizeClaim),
      incoming: incoming.map(summarizeClaim),
    },
    grounding: {
      evidenceRefs: groundingEntry?.evidenceRefs ?? concept.evidenceRefs,
      ...(groundingEntry?.confidence !== undefined ? { confidence: groundingEntry.confidence } : {}),
    },
    /**
     * 재사용을 검토할 기존 Concept (§15).
     *
     * Core 가 후보를 찾아 주되 **강제하지 않는다** — 판단은 AI, 측정은 Core (I1).
     * 완전한 IdentityResolver 는 M4 에서 붙는다. 여기서는 이름 유사도만 본다.
     */
    reuseCandidates: memory.concepts
      .filter((item) => item.id !== concept.id && sharesToken(item.name, concept.name))
      .slice(0, 10)
      .map((item) => ({ id: item.id, name: item.name })),
  };
}

function summarizeClaim(claim: {
  id: string;
  subjectConceptId: string;
  predicate: string;
  object: { conceptId: string } | { value: string };
  status: string;
}): Record<string, unknown> {
  return {
    id: claim.id,
    subjectConceptId: claim.subjectConceptId,
    predicate: claim.predicate,
    object: claim.object,
    status: claim.status,
  };
}

function sharesToken(a: string, b: string): boolean {
  const left = new Set(a.toLowerCase().split(/[\s_-]+/u).filter(Boolean));
  return b
    .toLowerCase()
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .some((token) => left.has(token));
}

/** predicate 는 자유 문장이므로 정확 일치가 아니라 부분 일치로 찾는다 (I3). */
export function searchClaims(
  state: LoadedState,
  query: { q: string; conceptId?: string; limit?: number },
): Record<string, unknown> {
  const limit = Math.min(query.limit ?? 20, 100);
  const needle = query.q.toLowerCase();
  let matched = state.memory.claims.filter(
    (claim) =>
      claim.predicate.toLowerCase().includes(needle) ||
      (claim.description ?? "").toLowerCase().includes(needle),
  );
  if (query.conceptId) {
    matched = matched.filter(
      (claim) =>
        claim.subjectConceptId === query.conceptId ||
        ("conceptId" in claim.object && claim.object.conceptId === query.conceptId),
    );
  }
  return {
    total: matched.length,
    truncated: matched.length > limit,
    claims: matched.slice(0, limit).map(summarizeClaim),
  };
}

/** anchor 에서 N hop 이내의 Concept·Claim·Evidence 를 **bounded** 하게 (§43). */
export function scenarioContext(
  state: LoadedState,
  query: { anchor: string; hops?: number },
): Record<string, unknown> {
  const hops = Math.min(query.hops ?? 2, 4);
  const { memory } = state;

  const start =
    memory.concepts.find((item) => item.id === query.anchor) ??
    memory.concepts.find((item) => item.name === query.anchor);
  if (!start) return { found: false, anchor: query.anchor };

  const reached = new Map<string, number>([[start.id, 0]]);
  let frontier = [start.id];
  const usedClaims: string[] = [];

  for (let distance = 1; distance <= hops && frontier.length > 0; distance += 1) {
    const next = new Set<string>();
    for (const conceptId of frontier) {
      for (const claim of memory.claims) {
        const subject = claim.subjectConceptId;
        const object = "conceptId" in claim.object ? claim.object.conceptId : undefined;
        if (subject === conceptId && object && !reached.has(object)) next.add(object);
        if (object === conceptId && !reached.has(subject)) next.add(subject);
        if (subject === conceptId || object === conceptId) usedClaims.push(claim.id);
      }
    }
    for (const id of [...next].sort()) reached.set(id, distance);
    frontier = [...next].sort();
  }

  const conceptIds = [...reached.keys()];
  const claimIds = [...new Set(usedClaims)].sort();
  const evidenceRefs = new Set<string>();
  for (const concept of memory.concepts) {
    if (reached.has(concept.id)) for (const ref of concept.evidenceRefs) evidenceRefs.add(ref);
  }

  return {
    found: true,
    anchor: { id: start.id, name: start.name },
    hops,
    concepts: memory.concepts
      .filter((item) => reached.has(item.id))
      .map((item) => ({ id: item.id, name: item.name, hop: reached.get(item.id) })),
    claims: memory.claims.filter((item) => claimIds.includes(item.id)).map(summarizeClaim),
    evidenceRefs: [...evidenceRefs].sort(),
    counts: { concepts: conceptIds.length, claims: claimIds.length, evidence: evidenceRefs.size },
  };
}
