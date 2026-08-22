/**
 * Semantic Patch 적용 (§16 · §45 / implementation_plan §6.3 · §6.4).
 *
 * **전체 재생성 금지 — Semantic Patch만** (I8). 코드가 조금 바뀌었다고 Semantic Memory를
 * 통째로 다시 만들면 §46이 실패로 규정한 churn이 그대로 일어난다.
 *
 * ## 버전을 찍는 것은 Core다
 *
 * `createdAtVersion` / `updatedAtVersion`은 agent가 보내오더라도 여기서 덮어쓴다.
 * 의미는 AI가, 측정은 Core가 한다 (I1). agent가 버전을 지어내면 §14의 history가 거짓말을
 * 하게 되는데, 그것은 나중에 되돌릴 때 조용히 틀린 것을 고른다는 뜻이다.
 */
import type {
  CanonicalScenarioEntry,
  GroundingStore,
  SemanticClaim,
  SemanticConcept,
  SemanticDiffSummary,
  SemanticMemory,
  SemanticPatch,
} from "@onto/protocol";

export type PatchResult = {
  memory: SemanticMemory;
  grounding: GroundingStore;
  summary: SemanticDiffSummary;
};

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * patch를 적용한 결과를 만든다. **입력을 바꾸지 않는다** — Validator ③이 커밋 전에
 * "적용하면 어떤 상태가 되는가"를 미리 보고 판단해야 하기 때문이다.
 */
export function applyPatch(
  memory: SemanticMemory,
  grounding: GroundingStore,
  patch: SemanticPatch,
  semanticVersion: number,
): PatchResult {
  const concepts = new Map(memory.concepts.map((item) => [item.id, item]));
  const claims = new Map(memory.claims.map((item) => [item.id, item]));
  const scenarios = new Map(memory.canonicalScenarios.map((item) => [item.id, item]));

  const summary: SemanticDiffSummary = {
    conceptsAdded: [],
    conceptsRemoved: [],
    conceptsMeaningChanged: [],
    claimsAdded: [],
    claimsRemoved: [],
    claimsContradicted: [],
    groundingChanged: [],
    scenariosAdded: [],
    scenariosRemoved: [],
  };

  for (const concept of patch.addedConcepts ?? []) {
    const stamped: SemanticConcept = {
      ...concept,
      createdAtVersion: semanticVersion,
      updatedAtVersion: semanticVersion,
    };
    concepts.set(stamped.id, stamped);
    summary.conceptsAdded.push(stamped.id);
  }

  for (const concept of patch.updatedConcepts ?? []) {
    const previous = concepts.get(concept.id);
    const stamped: SemanticConcept = {
      ...concept,
      createdAtVersion: previous?.createdAtVersion ?? semanticVersion,
      updatedAtVersion: semanticVersion,
    };
    concepts.set(stamped.id, stamped);
    // 이름이나 설명이 바뀐 것만 "의미가 바뀌었다"고 부른다. grounding 변경은 아래에서 센다.
    if (
      previous &&
      (previous.name !== stamped.name || (previous.description ?? "") !== (stamped.description ?? ""))
    ) {
      summary.conceptsMeaningChanged.push(stamped.id);
    }
  }

  for (const id of patch.removedConceptIds ?? []) {
    if (concepts.delete(id)) summary.conceptsRemoved.push(id);
  }

  for (const claim of patch.addedClaims ?? []) {
    const stamped: SemanticClaim = {
      ...claim,
      createdAtVersion: semanticVersion,
      updatedAtVersion: semanticVersion,
    };
    claims.set(stamped.id, stamped);
    summary.claimsAdded.push(stamped.id);
    if (stamped.status === "contradicted") summary.claimsContradicted.push(stamped.id);
  }

  for (const claim of patch.updatedClaims ?? []) {
    const previous = claims.get(claim.id);
    const stamped: SemanticClaim = {
      ...claim,
      createdAtVersion: previous?.createdAtVersion ?? semanticVersion,
      updatedAtVersion: semanticVersion,
    };
    claims.set(stamped.id, stamped);
    // §47 — "Claim contradicted"는 삭제가 아니라 기존 Claim의 **갱신**이다.
    if (stamped.status === "contradicted" && previous?.status !== "contradicted") {
      summary.claimsContradicted.push(stamped.id);
    }
  }

  for (const id of patch.removedClaimIds ?? []) {
    if (claims.delete(id)) summary.claimsRemoved.push(id);
  }

  for (const scenario of patch.addedScenarios ?? []) {
    const stamped: CanonicalScenarioEntry = {
      ...scenario,
      createdAtVersion: semanticVersion,
      updatedAtVersion: semanticVersion,
    };
    scenarios.set(stamped.id, stamped);
    summary.scenariosAdded.push(stamped.id);
  }

  for (const scenario of patch.updatedScenarios ?? []) {
    const previous = scenarios.get(scenario.id);
    scenarios.set(scenario.id, {
      ...scenario,
      createdAtVersion: previous?.createdAtVersion ?? semanticVersion,
      updatedAtVersion: semanticVersion,
    });
  }

  for (const id of patch.removedScenarioIds ?? []) {
    if (scenarios.delete(id)) summary.scenariosRemoved.push(id);
  }

  // --- Grounding (§12) ------------------------------------------------------
  //
  // Concept/Claim 이 들고 있는 `evidenceRefs` 와 `grounding.json` 은 **같은 것을 두 곳에
  // 적어 둔 것이 아니다** — 전자는 그 의미가 서 있는 근거고, 후자는 조회·감사를 위한 색인이다.
  // 다만 둘이 어긋나면 어느 쪽을 믿을지 알 수 없어지므로, patch 가 건드린 것은 여기서 맞춘다.
  const conceptGroundings = new Map(
    grounding.conceptGroundings.map((entry) => [entry.conceptId, { ...entry }]),
  );
  const claimGroundings = new Map(
    grounding.claimGroundings.map((entry) => [entry.claimId, { ...entry }]),
  );

  const touchedConcepts = [...(patch.addedConcepts ?? []), ...(patch.updatedConcepts ?? [])];
  for (const concept of touchedConcepts) {
    const previous = conceptGroundings.get(concept.id);
    const next = {
      conceptId: concept.id,
      evidenceRefs: [...concept.evidenceRefs],
      ...(concept.confidence !== undefined ? { confidence: concept.confidence } : {}),
    };
    conceptGroundings.set(concept.id, next);
    if (!previous || previous.evidenceRefs.join("|") !== next.evidenceRefs.join("|")) {
      summary.groundingChanged.push(concept.id);
    }
  }

  const touchedClaims = [...(patch.addedClaims ?? []), ...(patch.updatedClaims ?? [])];
  for (const claim of touchedClaims) {
    const previous = claimGroundings.get(claim.id);
    const next = {
      claimId: claim.id,
      evidenceRefs: [...claim.evidenceRefs],
      ...(claim.confidence !== undefined ? { confidence: claim.confidence } : {}),
    };
    claimGroundings.set(claim.id, next);
    if (!previous || previous.evidenceRefs.join("|") !== next.evidenceRefs.join("|")) {
      summary.groundingChanged.push(claim.id);
    }
  }

  for (const update of patch.groundingUpdates ?? []) {
    if (update.target === "concept") {
      conceptGroundings.set(update.conceptId, {
        conceptId: update.conceptId,
        evidenceRefs: [...update.evidenceRefs],
        ...(update.confidence !== undefined ? { confidence: update.confidence } : {}),
      });
      const concept = concepts.get(update.conceptId);
      if (concept) concepts.set(concept.id, { ...concept, evidenceRefs: [...update.evidenceRefs] });
      summary.groundingChanged.push(update.conceptId);
    } else {
      claimGroundings.set(update.claimId, {
        claimId: update.claimId,
        evidenceRefs: [...update.evidenceRefs],
        ...(update.confidence !== undefined ? { confidence: update.confidence } : {}),
      });
      const claim = claims.get(update.claimId);
      if (claim) claims.set(claim.id, { ...claim, evidenceRefs: [...update.evidenceRefs] });
      summary.groundingChanged.push(update.claimId);
    }
  }

  for (const id of patch.removedConceptIds ?? []) conceptGroundings.delete(id);
  for (const id of patch.removedClaimIds ?? []) claimGroundings.delete(id);

  const byId = <T extends { id: string }>(values: Iterable<T>): T[] =>
    [...values].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    memory: {
      semanticVersion,
      concepts: byId(concepts.values()),
      claims: byId(claims.values()),
      canonicalScenarios: byId(scenarios.values()),
    },
    grounding: {
      conceptGroundings: [...conceptGroundings.values()].sort((a, b) =>
        a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0,
      ),
      claimGroundings: [...claimGroundings.values()].sort((a, b) =>
        a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0,
      ),
    },
    summary: {
      conceptsAdded: sorted(summary.conceptsAdded),
      conceptsRemoved: sorted(summary.conceptsRemoved),
      conceptsMeaningChanged: sorted(summary.conceptsMeaningChanged),
      claimsAdded: sorted(summary.claimsAdded),
      claimsRemoved: sorted(summary.claimsRemoved),
      claimsContradicted: sorted(summary.claimsContradicted),
      groundingChanged: sorted(summary.groundingChanged),
      scenariosAdded: sorted(summary.scenariosAdded),
      scenariosRemoved: sorted(summary.scenariosRemoved),
    },
  };
}

/** patch가 참조하는 모든 evidence id. ②·⑤와 "쓰이지 않은 제안" 판정이 함께 쓴다. */
export function referencedEvidenceIds(patch: SemanticPatch): Set<string> {
  const refs = new Set<string>();
  const add = (values: readonly string[] | undefined): void => {
    for (const value of values ?? []) refs.add(value);
  };
  for (const concept of [...(patch.addedConcepts ?? []), ...(patch.updatedConcepts ?? [])]) {
    add(concept.evidenceRefs);
  }
  for (const claim of [...(patch.addedClaims ?? []), ...(patch.updatedClaims ?? [])]) {
    add(claim.evidenceRefs);
  }
  for (const update of patch.groundingUpdates ?? []) add(update.evidenceRefs);
  return refs;
}

/** patch 안에서 각 evidenceRef가 어디에 쓰였는가. 진단 메시지의 위치를 만든다 (A3). */
export function evidenceRefSites(patch: SemanticPatch): Array<{
  ref: string;
  path: string;
  ownerId: string;
}> {
  const sites: Array<{ ref: string; path: string; ownerId: string }> = [];
  const walk = (
    key: keyof SemanticPatch,
    items: Array<{ id: string; evidenceRefs: string[] }> | undefined,
  ): void => {
    (items ?? []).forEach((item, index) => {
      item.evidenceRefs.forEach((ref, refIndex) => {
        sites.push({
          ref,
          path: `/${String(key)}/${index} (id: "${item.id}") /evidenceRefs/${refIndex}`,
          ownerId: item.id,
        });
      });
    });
  };
  walk("addedConcepts", patch.addedConcepts);
  walk("updatedConcepts", patch.updatedConcepts);
  walk("addedClaims", patch.addedClaims);
  walk("updatedClaims", patch.updatedClaims);
  (patch.groundingUpdates ?? []).forEach((update, index) => {
    const ownerId = update.target === "concept" ? update.conceptId : update.claimId;
    update.evidenceRefs.forEach((ref, refIndex) => {
      sites.push({
        ref,
        path: `/groundingUpdates/${index} (id: "${ownerId}") /evidenceRefs/${refIndex}`,
        ownerId,
      });
    });
  });
  return sites;
}
