/**
 * EvidenceDiff와 SemanticWorkSet (implementation_plan §6.2 T1 · U1 · V3).
 *
 * ## 왜 두 축인가 (V3)
 *
 * `unchanged`와 "위치가 바뀌었다"는 **동시에 성립한다** — 내용은 그대로인데 위쪽에 줄만
 * 늘어난 경우다. 이동하면서 prettier까지 돌면 `cosmetic`이면서 이동한 것이다. 하나의
 * enum으로는 표현되지 않는다.
 *
 * ## 왜 `appeared`가 grounding 없이도 할 일이 되는가 (U1)
 *
 * `appeared` evidence는 정의상 아직 grounding이 없다 — 방금 추가된 코드이기 때문이다.
 * "dirty evidence에 grounding된 것"만 할 일로 삼으면, 기능이 통째로 하나 추가되어도
 * **할 일 목록이 비어 agent가 그 존재조차 모른다.**
 */
import type {
  Evidence,
  EvidenceDiff,
  EvidenceIndex,
  GroundingStore,
  SemanticMemory,
  SemanticWorkSet,
} from "@onto/protocol";
import { isSemanticDirty } from "@onto/protocol";

function sameLocation(a: Evidence, b: Evidence): boolean {
  const left = a.location;
  const right = b.location;
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.startLine === right.startLine && left.endLine === right.endLine;
}

/**
 * 두 인덱스 사이의 EvidenceDiff.
 *
 * `previous`가 없으면 첫 인덱싱이므로 전부 `appeared`다.
 *
 * **`next`에는 "지금 실제로 있는 것"만 들어와야 한다.** `carryMissingEvidence`가 사라진
 * 것을 `missing` 상태로 다시 채워 넣은 인덱스를 여기에 넘기면, 지워진 심볼이 `next`에
 * 존재하게 되어 rawHash 비교에서 **`unchanged`로 분류된다** — 근거가 사라졌는데 아무 일도
 * 없었던 것처럼 보이는, T1이 막으려던 바로 그 조용한 부패다. 순서는 언제나
 * `diffEvidence(before, 지금있는것)` → `carryMissingEvidence(before, 지금있는것)`이다.
 */
export function diffEvidence(
  previous: EvidenceIndex | undefined,
  next: EvidenceIndex,
): EvidenceDiff[] {
  // **이미 missing 이던 것은 이번 전이의 변화가 아니다.** 그것을 매번 다시 missing 으로
  // 내보내면 그 근거에 걸린 의미가 영원히 dirty 로 남아, 포매팅만 바꾼 커밋에서도
  // reconcile 이 절대 따라잡지 못한다 (§6.9 커밋 1).
  const before = new Map(
    (previous?.evidence ?? [])
      .filter((item) => item.status === "present")
      .map((item) => [item.id, item]),
  );
  const diffs: EvidenceDiff[] = [];

  for (const item of next.evidence) {
    const old = before.get(item.id);
    if (!old) {
      diffs.push({ evidenceId: item.id, contentChange: "appeared", relocated: false });
      continue;
    }
    const relocated = !sameLocation(old, item);
    if (old.rawHash === item.rawHash) {
      diffs.push({ evidenceId: item.id, contentChange: "unchanged", relocated });
    } else if (old.normalizedFingerprint === item.normalizedFingerprint) {
      // 바이트는 달라졌지만 정규화 지문이 같다 = 포매팅·따옴표·주석·후행 콤마.
      diffs.push({ evidenceId: item.id, contentChange: "cosmetic", relocated });
    } else {
      diffs.push({ evidenceId: item.id, contentChange: "modified", relocated });
    }
    before.delete(item.id);
  }

  // 남은 것은 새 인덱스에서 주소가 해석되지 않은 것들이다.
  for (const id of [...before.keys()].sort()) {
    diffs.push({ evidenceId: id, contentChange: "missing", relocated: false });
  }

  diffs.sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));
  return diffs;
}

/**
 * 이전 인덱스의 evidence 중 새 인덱스에서 사라진 것들을 `missing`으로 표시해 보존한다.
 *
 * 지워 버리면 "근거를 잃은 의미"를 찾을 수 없다. Grounding이 가리키는 id는 남아 있어야
 * Validator가 `grounding/lost`를 낼 수 있다 (§6.3).
 */
export function carryMissingEvidence(
  previous: EvidenceIndex | undefined,
  next: EvidenceIndex,
): EvidenceIndex {
  if (!previous) return next;
  const present = new Set(next.evidence.map((item) => item.id));
  const missing: Evidence[] = [];
  for (const item of previous.evidence) {
    if (present.has(item.id)) continue;
    missing.push({
      ...item,
      status: "missing",
      missingSinceVersion: next.analysisVersion,
    });
  }
  if (missing.length === 0) return next;
  const evidence = [...next.evidence, ...missing].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { ...next, evidence };
}

/**
 * agent에게 넘길 할 일 (U1).
 *
 * 두 목록은 **뜻이 다르고 지시도 다르다.**
 * - `affected*` — 근거가 바뀌었거나 사라졌으니 여전히 참인지 확인하라
 * - `ungroundedAppearedEvidenceIds` — 여기 새 기능이 있을 수 있으니 살펴보라
 */
export function buildWorkSet(
  diffs: EvidenceDiff[],
  memory: SemanticMemory,
  grounding: GroundingStore,
): SemanticWorkSet {
  const dirtyEvidence = diffs.filter(isSemanticDirty);
  const dirtyIds = new Set(dirtyEvidence.map((diff) => diff.evidenceId));

  const affectedConceptIds = new Set<string>();
  const affectedClaimIds = new Set<string>();
  const affectedScenarioIds = new Set<string>();

  /** 어떤 evidence가 무엇에 grounding되어 있는가. ungrounded 판정에도 쓴다. */
  const groundedEvidence = new Set<string>();

  for (const concept of memory.concepts) {
    for (const ref of concept.evidenceRefs) {
      groundedEvidence.add(ref);
      if (dirtyIds.has(ref)) affectedConceptIds.add(concept.id);
    }
  }
  for (const claim of memory.claims) {
    for (const ref of claim.evidenceRefs) {
      groundedEvidence.add(ref);
      if (dirtyIds.has(ref)) affectedClaimIds.add(claim.id);
    }
  }
  for (const entry of grounding.conceptGroundings) {
    for (const ref of entry.evidenceRefs) {
      groundedEvidence.add(ref);
      if (dirtyIds.has(ref)) affectedConceptIds.add(entry.conceptId);
    }
  }
  for (const entry of grounding.claimGroundings) {
    for (const ref of entry.evidenceRefs) {
      groundedEvidence.add(ref);
      if (dirtyIds.has(ref)) affectedClaimIds.add(entry.claimId);
    }
  }

  // Scenario는 anchor Concept를 통해 간접적으로 영향을 받는다.
  for (const scenario of memory.canonicalScenarios) {
    if (scenario.anchorConceptIds.some((id) => affectedConceptIds.has(id))) {
      affectedScenarioIds.add(scenario.id);
    }
  }

  // `appeared` 인데 어떤 grounding에도 없는 것 = 아직 아무 의미와도 연결되지 않은 새 근거.
  const ungroundedAppearedEvidenceIds = dirtyEvidence
    .filter((diff) => diff.contentChange === "appeared" && !groundedEvidence.has(diff.evidenceId))
    .map((diff) => diff.evidenceId);

  return {
    dirtyEvidence,
    affectedConceptIds: [...affectedConceptIds].sort(),
    affectedClaimIds: [...affectedClaimIds].sort(),
    affectedScenarioIds: [...affectedScenarioIds].sort(),
    ungroundedAppearedEvidenceIds,
  };
}

/** 사람과 eval이 읽을 분포. §7.3의 계기판이다. */
export function summarizeDiff(diffs: EvidenceDiff[]): {
  contentChange: Record<string, number>;
  relocated: number;
  dirty: number;
} {
  const contentChange: Record<string, number> = {
    unchanged: 0,
    cosmetic: 0,
    modified: 0,
    appeared: 0,
    missing: 0,
  };
  let relocated = 0;
  for (const diff of diffs) {
    contentChange[diff.contentChange] = (contentChange[diff.contentChange] ?? 0) + 1;
    if (diff.relocated) relocated += 1;
  }
  return { contentChange, relocated, dirty: diffs.filter(isSemanticDirty).length };
}
