/**
 * IdentityResolver — 후보를 찾아 주되 **강제하지 않는다** (§15 / implementation_plan §6.3).
 *
 * **판단은 AI, 측정은 Core** (I1). 여기서 나오는 점수는 Validator ④에서 *warning*이 되지
 * error가 되지 않는다 — 진짜 split이 필요한 경우가 실제로 있고, 그것을 아는 것은 의미를
 * 읽은 쪽이지 문자열을 센 쪽이 아니다.
 *
 * ```text
 * Concept 후보:  exact name/alias · 정규화 이름 · grounding overlap(Jaccard) · 이전 버전 id
 * Claim  후보:   (subjectConceptId, normalize(predicate), objectKey)          ← §6.4
 * Scenario 후보: name · anchorConceptIds overlap                              ← §6.4
 * ```
 *
 * ## Claim identity를 일부러 약하게 두는 것 (§6.4)
 *
 * `normalizePredicate`는 **소문자화 + 공백 압축뿐이다.** 동의어 사전이나 관계 vocabulary를
 * 넣는 순간 I3("Global Relation Vocabulary 없음")를 어긴다. predicate가 자유 문자열이므로
 * Claim identity는 Concept identity보다 불안정할 것이고, 그것 자체가 §54 Q4다 — eval이 둘을
 * **따로** 측정한다.
 */
import type {
  CanonicalScenarioEntry,
  GroundingStore,
  SemanticClaim,
  SemanticConcept,
  SemanticMemory,
} from "@onto/protocol";

/** ④가 "재사용을 검토하라"고 말하기 시작하는 점수. */
export const REUSE_SUGGESTION_THRESHOLD = 0.6;

export type IdentityCandidate = {
  id: string;
  /** 0~1. 1은 "같은 것이라고 볼 근거가 확실하다" */
  score: number;
  /** 왜 후보인가. agent가 읽고 판단한다 */
  reasons: string[];
};

/** 이름 비교용 정규화. 대소문자·공백·구두점만 지운다 — 의미 매핑은 하지 않는다. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_\-·]+/gu, " ")
    .replace(/["'`(),.:;!?]/gu, "")
    .trim();
}

/** §6.4 — **소문자화 + 공백 압축뿐이다.** 그 이상을 하면 I3를 어긴다. */
export function normalizePredicate(predicate: string): string {
  return predicate.toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Claim의 object를 key로. Concept 참조와 값은 서로 다른 것이다. */
export function objectKeyOf(object: SemanticClaim["object"]): string {
  return "conceptId" in object ? `concept:${object.conceptId}` : `value:${normalizeName(object.value)}`;
}

/** §6.4의 Claim key. 이것이 같으면 같은 Claim으로 본다. */
export function claimKeyOf(claim: {
  subjectConceptId: string;
  predicate: string;
  object: SemanticClaim["object"];
}): string {
  return [claim.subjectConceptId, normalizePredicate(claim.predicate), objectKeyOf(claim.object)].join(
    "|",
  );
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** 점수 내림차순, 동점이면 id 오름차순. **스캔 순서가 결과에 영향을 주지 않는다.** */
function rank(candidates: IdentityCandidate[], limit: number): IdentityCandidate[] {
  return candidates
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}

export type ConceptDraft = {
  id?: string;
  name: string;
  aliases?: string[];
  evidenceRefs?: string[];
};

/**
 * 재사용을 검토할 기존 Concept.
 *
 * grounding overlap을 넣는 것이 중요하다 — 이름을 다르게 붙였어도 **같은 근거 위에 서 있는**
 * 것은 같은 의미일 가능성이 높고, 이름만 보면 그것을 놓친다.
 */
export function conceptCandidates(
  memory: SemanticMemory,
  grounding: GroundingStore,
  draft: ConceptDraft,
  limit = 5,
): IdentityCandidate[] {
  const wantedNames = new Set(
    [draft.name, ...(draft.aliases ?? [])].map(normalizeName).filter(Boolean),
  );
  const draftRefs = draft.evidenceRefs ?? [];
  const groundingByConcept = new Map(
    grounding.conceptGroundings.map((entry) => [entry.conceptId, entry.evidenceRefs]),
  );

  const candidates: IdentityCandidate[] = [];
  for (const concept of memory.concepts) {
    if (draft.id !== undefined && concept.id === draft.id) {
      // 이전 버전의 자기 자신. 가장 강한 후보다 — 갱신이지 새로 만들 일이 아니다.
      candidates.push({ id: concept.id, score: 1, reasons: ["same-id"] });
      continue;
    }

    const reasons: string[] = [];
    let score = 0;

    const names = [concept.name, ...(concept.aliases ?? [])];
    if (names.some((name) => wantedNames.has(name.toLowerCase().trim()))) {
      score = Math.max(score, 1);
      reasons.push("exact-name");
    } else if (names.some((name) => wantedNames.has(normalizeName(name)))) {
      score = Math.max(score, 0.9);
      reasons.push("normalized-name");
    }

    const refs = groundingByConcept.get(concept.id) ?? concept.evidenceRefs;
    const overlap = jaccard(refs, draftRefs);
    if (overlap > 0) {
      score = Math.max(score, 0.8 * overlap);
      reasons.push(`grounding-overlap:${overlap.toFixed(2)}`);
    }

    if (score > 0) candidates.push({ id: concept.id, score, reasons });
  }
  return rank(candidates, limit);
}

export type ClaimDraft = {
  id?: string;
  subjectConceptId: string;
  predicate: string;
  object: SemanticClaim["object"];
};

/**
 * 같은 key를 가진 기존 Claim.
 *
 * key가 정확히 같으면 1.0이고, subject와 object가 같은데 predicate만 다르면 0.7이다 —
 * 후자는 "같은 관계를 다르게 말한 것"일 수도, "정말 다른 주장"일 수도 있어서 **판단을
 * 넘긴다.**
 */
export function claimCandidates(
  memory: SemanticMemory,
  draft: ClaimDraft,
  limit = 5,
): IdentityCandidate[] {
  const wantedKey = claimKeyOf(draft);
  const wantedObject = objectKeyOf(draft.object);

  const candidates: IdentityCandidate[] = [];
  for (const claim of memory.claims) {
    if (draft.id !== undefined && claim.id === draft.id) {
      candidates.push({ id: claim.id, score: 1, reasons: ["same-id"] });
      continue;
    }
    if (claimKeyOf(claim) === wantedKey) {
      candidates.push({ id: claim.id, score: 1, reasons: ["same-claim-key"] });
      continue;
    }
    if (claim.subjectConceptId === draft.subjectConceptId && objectKeyOf(claim.object) === wantedObject) {
      candidates.push({
        id: claim.id,
        score: 0.7,
        reasons: ["same-subject-object", `existing-predicate:${claim.predicate}`],
      });
    }
  }
  return rank(candidates, limit);
}

export type ScenarioDraft = {
  id?: string;
  name: string;
  anchorConceptIds?: string[];
};

export function scenarioCandidates(
  memory: SemanticMemory,
  draft: ScenarioDraft,
  limit = 5,
): IdentityCandidate[] {
  const wantedName = normalizeName(draft.name);
  const anchors = draft.anchorConceptIds ?? [];

  const candidates: IdentityCandidate[] = [];
  for (const scenario of memory.canonicalScenarios) {
    if (draft.id !== undefined && scenario.id === draft.id) {
      candidates.push({ id: scenario.id, score: 1, reasons: ["same-id"] });
      continue;
    }
    const reasons: string[] = [];
    let score = 0;
    if (normalizeName(scenario.name) === wantedName) {
      score = Math.max(score, 1);
      reasons.push("same-name");
    }
    const overlap = jaccard(scenario.anchorConceptIds, anchors);
    if (overlap > 0) {
      score = Math.max(score, 0.8 * overlap);
      reasons.push(`anchor-overlap:${overlap.toFixed(2)}`);
    }
    if (score > 0) candidates.push({ id: scenario.id, score, reasons });
  }
  return rank(candidates, limit);
}

/** `get_concept_context`가 돌려주는 재사용 후보의 사람용 요약. */
export function describeCandidate(
  candidate: IdentityCandidate,
  lookup: (id: string) => SemanticConcept | SemanticClaim | CanonicalScenarioEntry | undefined,
): Record<string, unknown> {
  const found = lookup(candidate.id);
  const label =
    found && "name" in found ? found.name : found && "predicate" in found ? found.predicate : undefined;
  return {
    id: candidate.id,
    score: Number(candidate.score.toFixed(3)),
    reasons: candidate.reasons,
    ...(label ? { label } : {}),
  };
}
