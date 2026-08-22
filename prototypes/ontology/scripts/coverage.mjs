/**
 * §7.2 fixture-specific semantic coverage — S6의 세 층.
 *
 *   structural — hard.   subject/object concept 쌍이 존재하고 mustGroundIn evidence에 grounding
 *   smoke      — warning. predicate에 meaningKeywords가 나타나는가 (증명이 아니라 스모크다)
 *   semantic   — 자동 판정하지 않는다. 사람 리뷰 큐에 올릴 항목만 모은다
 *
 * acceptance 5는 **structural만** 게이트다 — 볼륨(개수)이 아니라 이 fixture에서 사람이
 * 미리 정한 것이 실제로 grounding되어 있는지를 본다 (R7).
 */

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/gu, " ");
}

/**
 * "path#name" → 그 주소를 가리키는 evidence id **들**. mustGroundIn은 사람이 읽는
 * 주소이지 하나의 id가 아니다 — 같은 주소에 엔진 symbol evidence와 함께, agent가
 * `propose_evidence`로 등록한 더 정밀한 policy/state evidence가 여러 개 걸릴 수 있다
 * (R2, §6.5). agent가 원시 심볼 대신 그 중 더 정확한 것에 grounding해도 "그 위치에
 * grounding했다"는 사실은 같다 — 여러 후보 중 **하나만** concept/claim에 걸려 있으면
 * 된다.
 */
function resolveEvidenceIds(ref, evidenceList) {
  const hashIndex = ref.lastIndexOf("#");
  if (hashIndex === -1) return [];
  const filePath = ref.slice(0, hashIndex);
  const name = ref.slice(hashIndex + 1);

  const bySymbol = evidenceList.filter(
    (item) => item.symbolId === ref || (item.filePath === filePath && item.symbolId === name),
  );
  const byEntityLabel = evidenceList.filter(
    (item) => item.filePath === filePath && item.graph?.role === "entity" && item.graph.label === name,
  );
  return [...new Set([...bySymbol, ...byEntityLabel].map((item) => item.id))];
}

function findConceptByAcceptableNames(concepts, acceptableNames) {
  const wanted = new Set(acceptableNames.map(normalizeName));
  return concepts.find((concept) => {
    if (wanted.has(normalizeName(concept.name))) return true;
    return (concept.aliases ?? []).some((alias) => wanted.has(normalizeName(alias)));
  });
}

/**
 * @param {import("@onto/core").LoadedState} state
 * @param {object} expectations fixtures/fixture-app/expectations.json 의 내용
 */
export function checkCoverage(state, expectations) {
  const evidenceList = state.evidence.evidence;
  const concepts = state.memory.concepts;
  const claims = state.memory.claims;
  const scenarios = state.memory.canonicalScenarios;

  const hardFailures = [];
  const warnings = [];
  const semanticQueue = [];
  /** key → 실제로 찾은 concept. requiredClaims/requiredScenarios가 재사용한다 */
  const resolvedConcepts = new Map();

  for (const required of expectations.requiredConcepts ?? []) {
    const concept = findConceptByAcceptableNames(concepts, required.acceptableNames);
    if (!concept) {
      hardFailures.push(
        `concept 없음 — "${required.key}" (${required.acceptableNames.join(" / ")} 중 하나를 기대했다)`,
      );
      continue;
    }
    resolvedConcepts.set(required.key, concept);

    for (const ref of required.mustGroundIn ?? []) {
      const candidateIds = resolveEvidenceIds(ref, evidenceList);
      if (candidateIds.length === 0) {
        hardFailures.push(`expectations.json 오류 — "${ref}"에 해당하는 evidence를 이 인덱스에서 찾지 못했다`);
        continue;
      }
      if (!candidateIds.some((id) => concept.evidenceRefs.includes(id))) {
        hardFailures.push(`concept "${required.key}"(${concept.name})가 "${ref}"에 grounding되어 있지 않다`);
      }
    }
  }

  for (const forbidden of expectations.forbiddenConcepts ?? []) {
    const wanted = normalizeName(forbidden);
    const promoted = concepts.find(
      (concept) =>
        normalizeName(concept.name) === wanted || (concept.aliases ?? []).some((alias) => normalizeName(alias) === wanted),
    );
    if (promoted) {
      hardFailures.push(`금지된 concept가 승격되었다 — "${forbidden}" (§29 abstraction level)`);
    }
  }

  for (const required of expectations.requiredClaims ?? []) {
    const subject = resolvedConcepts.get(required.subjectKey);
    const object = required.objectKey ? resolvedConcepts.get(required.objectKey) : undefined;
    if (!subject || (required.objectKey && !object)) {
      hardFailures.push(`claim "${required.key}" — subject/object concept가 먼저 존재해야 한다`);
      continue;
    }

    // subject/object 사이의 관계를 표현하는 claim이 **여럿**일 수 있다 — 그 중 하나만
    // mustGroundIn 전부에 grounding되어 있으면 된다. 첫 번째 것만 보면, 같은 관계를 다른
    // predicate로 두 번 말한 것 중 grounding이 약한 쪽을 집어 거짓으로 떨어뜨릴 수 있다.
    const relationClaims = claims.filter(
      (item) =>
        item.subjectConceptId === subject.id &&
        (!object || ("conceptId" in item.object && item.object.conceptId === object.id)),
    );
    if (relationClaims.length === 0) {
      hardFailures.push(
        `claim "${required.key}" 없음 — "${subject.name}" → ${object ? `"${object.name}"` : "(값)"} 관계를 기대했다`,
      );
      continue;
    }

    const refIdSets = [];
    let refError = false;
    for (const ref of required.mustGroundIn ?? []) {
      const candidateIds = resolveEvidenceIds(ref, evidenceList);
      if (candidateIds.length === 0) {
        hardFailures.push(`expectations.json 오류 — "${ref}"에 해당하는 evidence를 이 인덱스에서 찾지 못했다`);
        refError = true;
        continue;
      }
      refIdSets.push(candidateIds);
    }
    if (refError) continue;

    const claim = relationClaims.find((item) => refIdSets.every((ids) => ids.some((id) => item.evidenceRefs.includes(id))));
    if (!claim) {
      hardFailures.push(
        `claim "${required.key}" — 관계는 있지만(${relationClaims.length}개) 어느 것도 mustGroundIn(${(required.mustGroundIn ?? []).join(", ")})에 grounding되어 있지 않다`,
      );
      continue;
    }

    // smoke — warning일 뿐이다. 없다고 게이트를 막지 않는다.
    const keywords = required.meaningKeywords ?? [];
    if (keywords.length > 0 && !keywords.some((word) => claim.predicate.includes(word))) {
      warnings.push(
        `claim "${required.key}"의 predicate("${claim.predicate}")에 기대 키워드(${keywords.join(", ")})가 보이지 않는다 — 확인 필요`,
      );
    }

    // semantic — 자동 판정하지 않는다. 사람 리뷰 큐에만 올린다.
    const reviewed = (expectations.reviewedPredicates ?? []).find((entry) => entry.claimKey === required.key);
    if (!reviewed || reviewed.predicate !== claim.predicate) {
      semanticQueue.push({ claimKey: required.key, predicate: claim.predicate });
    }
  }

  // ScenarioIR(View)은 M6 범위다. 여기서는 CanonicalScenarioEntry.anchorConceptIds만 본다
  // (§6.4의 "얇은 index") — step 단위 커버리지는 M6가 View Planner를 붙인 뒤에나 잴 수 있다.
  for (const required of expectations.requiredScenarios ?? []) {
    const wantedConceptIds = (required.mustIncludeConceptKeys ?? [])
      .map((key) => resolvedConcepts.get(key)?.id)
      .filter(Boolean);
    const scenario = scenarios.find((item) => wantedConceptIds.every((id) => item.anchorConceptIds.includes(id)));
    if (!scenario) {
      hardFailures.push(
        `scenario "${required.key}" 없음 — anchor에 ${required.mustIncludeConceptKeys.join(", ")}를 모두 포함해야 한다`,
      );
    }
  }

  return { structuralPass: hardFailures.length === 0, hardFailures, warnings, semanticQueue };
}
