/**
 * V4 System Fact Store의 결정론적 기반.
 *
 * 이 단계에서는 기존 Evidence Graph를 `engine + confirmed` fact로 승격한다. Vibee가 만드는
 * `grounded` fact의 원자적 제안·검증은 Phase 2가 담당한다. 두 경로가 같은 ID 규칙과 조회
 * 함수를 써야 다음 단계에서 origin만 다른 동등한 fact가 된다.
 */
import { createHash } from "node:crypto";

import type {
  EntityRef,
  EvidenceIndex,
  ResourceEntityRef,
  SystemEntity,
  SystemFactStore,
  SystemLink,
} from "@onto/protocol";
import { entityKey } from "@onto/protocol";

const SYSTEM_FACT_SCHEMA_VERSION = 4 as const;

function compareId(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** resource namespace만 case-insensitive로 정규화한다. key는 URL path처럼 case-sensitive일 수 있다. */
export function canonicalResourceRef(ref: ResourceEntityRef): ResourceEntityRef {
  const namespace = ref.namespace.trim().toLowerCase().replace(/\s+/gu, "-");
  const key = ref.key.trim().replace(/\s+/gu, "-");
  if (!namespace || !key) throw new TypeError("resource namespace와 key는 비어 있을 수 없습니다");
  if (namespace.includes(":")) throw new TypeError("resource namespace에는 ':'를 쓸 수 없습니다");
  return { kind: "resource", namespace, key };
}

/** label·line number와 무관한 System Entity identity. */
export function systemEntityId(ref: EntityRef): string {
  return entityKey(ref.kind === "resource" ? canonicalResourceRef(ref) : ref);
}

/** 사람이 쓴 공백 차이로 Link ID가 바뀌지 않게 하는 최소 정규화. 의미 어휘는 바꾸지 않는다. */
export function normalizeSystemMechanism(mechanism?: string): string {
  return mechanism?.trim().replace(/\s+/gu, " ") ?? "";
}

/** endpoint·kind·mechanism만으로 만드는 안정적인 System Link identity. */
export function systemLinkId(input: {
  kind: string;
  from: EntityRef;
  to: EntityRef;
  mechanism?: string;
}): string {
  const material = [
    input.kind.trim(),
    systemEntityId(input.from),
    systemEntityId(input.to),
    normalizeSystemMechanism(input.mechanism),
  ].join("\u0000");
  return `system-link:${createHash("sha256").update(material, "utf8").digest("hex").slice(0, 40)}`;
}

export function emptySystemFactStore(analysisVersion = 0): SystemFactStore {
  return {
    schemaVersion: SYSTEM_FACT_SCHEMA_VERSION,
    analysisVersion,
    entities: [],
    links: [],
    diagnostics: [],
  };
}

/**
 * 현재 Evidence Graph를 engine-confirmed System Fact로 투영한다.
 *
 * - present entity만 포함한다.
 * - 양 endpoint가 모두 존재하는 link만 포함한다.
 * - 같은 endpoint/kind의 여러 호출 evidence는 Link 하나에 모은다.
 * - 이전 store의 같은 ID가 있으면 firstSeenVersion을 유지한다.
 */
export function buildEngineSystemFactStore(
  index: EvidenceIndex,
  previous?: SystemFactStore,
): SystemFactStore {
  const previousEntities = new Map(previous?.entities.map((item) => [item.id, item] as const) ?? []);
  const previousLinks = new Map(previous?.links.map((item) => [item.id, item] as const) ?? []);
  const evidenceByEntity = new Map<string, { ref: EntityRef; evidenceRefs: string[] }>();

  for (const evidence of index.evidence) {
    if (evidence.origin !== "engine" || evidence.status !== "present" || evidence.graph?.role !== "entity") continue;
    const ref = evidence.graph.entity.kind === "resource"
      ? canonicalResourceRef(evidence.graph.entity)
      : evidence.graph.entity;
    const id = systemEntityId(ref);
    const current = evidenceByEntity.get(id);
    if (current) current.evidenceRefs.push(evidence.id);
    else evidenceByEntity.set(id, { ref, evidenceRefs: [evidence.id] });
  }

  const entities: SystemEntity[] = [...evidenceByEntity.entries()].map(([id, item]) => {
    const evidenceRefs = uniqueSorted(item.evidenceRefs);
    return {
      id,
      ref: item.ref,
      kind: item.ref.kind,
      origin: "engine",
      certainty: "confirmed",
      evidenceRefs,
      dependsOnEvidenceRefs: evidenceRefs,
      status: "valid",
      firstSeenVersion: previousEntities.get(id)?.firstSeenVersion ?? index.analysisVersion,
      lastValidatedVersion: index.analysisVersion,
    };
  });

  const linkGroups = new Map<
    string,
    { from: EntityRef; to: EntityRef; kind: string; evidenceRefs: string[] }
  >();
  for (const evidence of index.evidence) {
    if (evidence.origin !== "engine" || evidence.status !== "present" || evidence.graph?.role !== "link") continue;
    const from = evidence.graph.from.kind === "resource"
      ? canonicalResourceRef(evidence.graph.from)
      : evidence.graph.from;
    const to = evidence.graph.to.kind === "resource"
      ? canonicalResourceRef(evidence.graph.to)
      : evidence.graph.to;
    if (!evidenceByEntity.has(systemEntityId(from)) || !evidenceByEntity.has(systemEntityId(to))) continue;
    const id = systemLinkId({ kind: evidence.graph.linkKind, from, to });
    const current = linkGroups.get(id);
    if (current) current.evidenceRefs.push(evidence.id);
    else linkGroups.set(id, { from, to, kind: evidence.graph.linkKind, evidenceRefs: [evidence.id] });
  }

  const links: SystemLink[] = [...linkGroups.entries()].map(([id, item]) => {
    const evidenceRefs = uniqueSorted(item.evidenceRefs);
    const fromEvidence = evidenceByEntity.get(systemEntityId(item.from))?.evidenceRefs ?? [];
    const toEvidence = evidenceByEntity.get(systemEntityId(item.to))?.evidenceRefs ?? [];
    return {
      id,
      from: item.from,
      to: item.to,
      kind: item.kind,
      origin: "engine",
      certainty: "confirmed",
      evidenceRefs,
      dependsOnEvidenceRefs: uniqueSorted([...evidenceRefs, ...fromEvidence, ...toEvidence]),
      status: "valid",
      firstSeenVersion: previousLinks.get(id)?.firstSeenVersion ?? index.analysisVersion,
      lastValidatedVersion: index.analysisVersion,
    };
  });

  // Phase 2부터 Vibee-grounded fact도 Core 상태다. Phase 4의 수명 계산이 도입되기 전까지는
  // re-index가 그것을 삭제하지 않고 그대로 carry한다. 검증 없이 confirmed로 올리지는 않는다.
  for (const item of previous?.entities ?? []) {
    if (item.origin === "vibee" && !entities.some((candidate) => candidate.id === item.id)) entities.push(item);
  }
  for (const item of previous?.links ?? []) {
    if (item.origin === "vibee" && !links.some((candidate) => candidate.id === item.id)) links.push(item);
  }

  entities.sort(compareId);
  links.sort(compareId);
  return {
    schemaVersion: SYSTEM_FACT_SCHEMA_VERSION,
    analysisVersion: index.analysisVersion,
    entities,
    links,
    diagnostics: [],
  };
}

function certaintyRank(value: SystemEntity["certainty"]): number {
  return value === "confirmed" ? 3 : value === "grounded" ? 2 : 1;
}

/** pending Vibee fact를 현재 store에 합친다. engine-confirmed fact의 provenance는 낮추지 않는다. */
export function mergeProposedSystemFacts(
  store: SystemFactStore,
  proposed: { entities: readonly SystemEntity[]; links: readonly SystemLink[] },
): SystemFactStore {
  const entities = new Map(store.entities.map((item) => [item.id, item] as const));
  for (const candidate of proposed.entities) {
    const previous = entities.get(candidate.id);
    if (!previous) {
      entities.set(candidate.id, candidate);
      continue;
    }
    const keepPreviousTruth = certaintyRank(previous.certainty) >= certaintyRank(candidate.certainty);
    entities.set(candidate.id, {
      ...(keepPreviousTruth ? previous : candidate),
      evidenceRefs: uniqueSorted([...previous.evidenceRefs, ...candidate.evidenceRefs]),
      dependsOnEvidenceRefs: uniqueSorted([...previous.dependsOnEvidenceRefs, ...candidate.dependsOnEvidenceRefs]),
      firstSeenVersion: Math.min(previous.firstSeenVersion, candidate.firstSeenVersion),
      lastValidatedVersion: Math.max(previous.lastValidatedVersion, candidate.lastValidatedVersion),
    });
  }

  const links = new Map(store.links.map((item) => [item.id, item] as const));
  for (const candidate of proposed.links) {
    const previous = links.get(candidate.id);
    if (!previous) {
      links.set(candidate.id, candidate);
      continue;
    }
    const keepPreviousTruth = certaintyRank(previous.certainty) >= certaintyRank(candidate.certainty);
    links.set(candidate.id, {
      ...(keepPreviousTruth ? previous : candidate),
      evidenceRefs: uniqueSorted([...previous.evidenceRefs, ...candidate.evidenceRefs]),
      dependsOnEvidenceRefs: uniqueSorted([...previous.dependsOnEvidenceRefs, ...candidate.dependsOnEvidenceRefs]),
      firstSeenVersion: Math.min(previous.firstSeenVersion, candidate.firstSeenVersion),
      lastValidatedVersion: Math.max(previous.lastValidatedVersion, candidate.lastValidatedVersion),
    });
  }

  return {
    ...store,
    entities: [...entities.values()].sort(compareId),
    links: [...links.values()].sort(compareId),
  };
}

export function findSystemEntity(store: SystemFactStore, idOrRef: string | EntityRef): SystemEntity | undefined {
  const id = typeof idOrRef === "string" ? idOrRef : systemEntityId(idOrRef);
  return store.entities.find((item) => item.id === id);
}

export function findSystemLink(store: SystemFactStore, id: string): SystemLink | undefined {
  return store.links.find((item) => item.id === id);
}

export function systemLinksForEntity(store: SystemFactStore, idOrRef: string | EntityRef): SystemLink[] {
  const id = typeof idOrRef === "string" ? idOrRef : systemEntityId(idOrRef);
  return store.links
    .filter((item) => systemEntityId(item.from) === id || systemEntityId(item.to) === id)
    .sort(compareId);
}
