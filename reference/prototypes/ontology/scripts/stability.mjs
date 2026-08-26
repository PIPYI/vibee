/**
 * §46 False Semantic Churn — 같은 store를 두 번(v1 → v2) 분석했을 때 identity가 얼마나
 * 안정적인가. `implementation_plan.md` §7.3의 정의를 그대로 따른다.
 *
 * v1/v2는 **같은 SemanticStore의 서로 다른 generation**이어야 한다 — 독립된 두 분석에서는
 * id 공간 자체가 다시 시작되므로 "같은 id로 남았는가"라는 질문 자체가 성립하지 않는다.
 */

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) if (setB.has(item)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** v1의 id 중 v2에서도 같은 id로 남은 비율. v1이 비어 있으면(측정 불가) null. */
function identityPreservation(beforeMap, afterMap) {
  if (beforeMap.size === 0) return null;
  let preserved = 0;
  for (const id of beforeMap.keys()) if (afterMap.has(id)) preserved += 1;
  return preserved / beforeMap.size;
}

const OVERLAP_THRESHOLD = 0.5;

/**
 * id가 사라진 것과 새로 생긴 것 사이의 grounding overlap(Jaccard)으로 name-only churn ·
 * unnecessary split · unnecessary merge를 추정한다.
 *
 * IdentityResolver 자신이 재사용 후보를 찾을 때 쓰는 것과 같은 방식(§6.3 "grounding
 * overlap(Jaccard)")이다 — 새 판정 기준을 발명하지 않고 이미 검증된 것을 재사용한다.
 *
 * - 사라진 하나가 새로 생긴 **하나**와 강하게 겹치면 → name-only churn (같은 의미, 새 id)
 * - 사라진 하나가 새로 생긴 **여럿**과 겹치면 → unnecessary split
 * - 사라진 **여럿**이 새로 생긴 하나와 겹치면 → unnecessary merge
 */
function churnAnalysis(beforeMap, afterMap) {
  const disappeared = [...beforeMap.keys()].filter((id) => !afterMap.has(id));
  const appeared = [...afterMap.keys()].filter((id) => !beforeMap.has(id));

  const overlapOf = (oldId, newId) => jaccard(beforeMap.get(oldId).evidenceRefs, afterMap.get(newId).evidenceRefs);

  let nameOnlyChurn = 0;
  let unnecessarySplit = 0;
  const mergeTargetCounts = new Map();

  for (const oldId of disappeared) {
    const matches = appeared.filter((newId) => overlapOf(oldId, newId) >= OVERLAP_THRESHOLD);
    if (matches.length === 1) nameOnlyChurn += 1;
    if (matches.length > 1) unnecessarySplit += 1;
    for (const newId of matches) mergeTargetCounts.set(newId, (mergeTargetCounts.get(newId) ?? 0) + 1);
  }
  const unnecessaryMerge = [...mergeTargetCounts.values()].filter((count) => count > 1).length;

  return {
    disappeared: disappeared.length,
    appeared: appeared.length,
    nameOnlyChurn,
    unnecessarySplit,
    unnecessaryMerge,
  };
}

/**
 * `before`/`after`는 `SemanticStore#load()`의 `LoadedState` — 같은 프로젝트의 서로 다른
 * generation이어야 한다 (v1, v2).
 */
export function computeStabilityMetrics(before, after) {
  const beforeConcepts = new Map(before.memory.concepts.map((item) => [item.id, item]));
  const afterConcepts = new Map(after.memory.concepts.map((item) => [item.id, item]));
  const beforeClaims = new Map(before.memory.claims.map((item) => [item.id, item]));
  const afterClaims = new Map(after.memory.claims.map((item) => [item.id, item]));
  const beforeScenarios = new Map(before.memory.canonicalScenarios.map((item) => [item.id, item]));
  const afterScenarios = new Map(after.memory.canonicalScenarios.map((item) => [item.id, item]));

  return {
    conceptIdentityPreservation: identityPreservation(beforeConcepts, afterConcepts),
    claimIdentityPreservation: identityPreservation(beforeClaims, afterClaims),
    canonicalScenarioIdentityPreservation: identityPreservation(beforeScenarios, afterScenarios),
    concepts: churnAnalysis(beforeConcepts, afterConcepts),
  };
}

/**
 * §7.3 — Grounding coverage(origin별) · Agent evidence relocation 비율.
 *
 * `evidenceIndex`는 `SemanticStore#load()`의 `state.evidence` — `relocationConfidence`는
 * agent evidence에 영속되는 필드라(§6.5 S1) HTTP 없이 디스크에서 바로 읽을 수 있다.
 */
export function computeEvidenceOriginStats(evidenceIndex) {
  const present = evidenceIndex.evidence.filter((item) => item.status === "present");
  const byOrigin = { engine: 0, agent: 0 };
  for (const item of present) byOrigin[item.origin] += 1;

  // relocation은 **재인덱싱을 한 번이라도 거친** agent evidence에만 의미가 있다 — 방금
  // propose_evidence로 등록되어 아직 한 번도 carryAgentEvidence를 통과하지 않은 것은
  // relocationConfidence가 없다. 그것을 "exact"로 잘못 세면 첫 커밋에서만 relocation이
  // 100% exact처럼 보이는 착시가 생긴다.
  const agentItems = evidenceIndex.evidence.filter((item) => item.origin === "agent");
  const relocation = { exact: 0, degraded: 0, missing: 0, notYetRelocated: 0 };
  for (const item of agentItems) {
    if (item.status === "missing") relocation.missing += 1;
    else if (item.relocationConfidence === "exact") relocation.exact += 1;
    else if (item.relocationConfidence === "degraded") relocation.degraded += 1;
    else relocation.notYetRelocated += 1;
  }

  return { byOrigin, totalPresent: present.length, agentRelocation: relocation };
}
