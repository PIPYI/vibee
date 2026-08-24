/**
 * Validator ⓪~⑤ — 실패는 **전부** `Diagnostic[]` (implementation_plan §6.3, A3).
 *
 * | 단계 | 검사 | 실패 |
 * |---|---|---|
 * | ⓪ Version | `base*Version`이 head와 일치 | error `version/stale-base` |
 * | ① Schema | ajv. 오류 경로를 고칠 수 있는 위치로 주석 | error |
 * | ② Evidence | 모든 `evidenceRefs[]`가 실재하고 `present`. pendingEvidence 포함 | error |
 * | ③ Grounding | Concept는 `uncertain`이 아닌 한 ref ≥ 1, Claim은 ≥ 1, subject/object 실재 | error |
 * | ④ Stability | identity 점수가 임계값을 넘으면 재사용 제안. churn 경고 | **warning** |
 * | ⑤ 커밋 직전 재확인 | 참조 파일을 **지금 디스크에서** 다시 읽어 대조 (S3) | error |
 *
 * ## ⓪과 ⑤는 다른 것을 막는다
 *
 * ⓪은 **우리 자신의** 동시 쓰기를, ⑤는 **바깥에서** 일어난 파일 변경을 막는다. 둘 다 필요하다.
 * ⑤가 없으면 `evidence.json`의 `fileHashes`(= T0의 사진)와 비교하는 셈이 되어, agent가 탐색하는
 * 수 분 사이에 format-on-save·`git checkout`이 바꿔 놓은 **존재하지 않는 줄 범위에 grounding을
 * 커밋한다.**
 *
 * ## ④가 warning인 이유
 *
 * identity 점수가 높다고 항상 같은 것은 아니다 — 진짜 split이 필요한 경우가 실제로 있고,
 * 그것을 아는 것은 의미를 읽은 쪽이다. **판단은 AI, 측정은 Core** (I1).
 */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  Diagnostic,
  Evidence,
  Outcome,
  SemanticDiffSummary,
  SemanticPatch,
} from "@onto/protocol";
import { eventsPath } from "@onto/protocol/node";

import {
  REUSE_SUGGESTION_THRESHOLD,
  claimCandidates,
  conceptCandidates,
  scenarioCandidates,
} from "./identity.js";
import { applyPatch, evidenceRefSites, referencedEvidenceIds, type PatchResult } from "./patch.js";
import { diagnostic, hasError, validateAgainst } from "./schema.js";
import type { LoadedState, SemanticStore } from "./store.js";
import { mergeProposedSystemFacts } from "./system-facts.js";
import type { AnalyzeTransaction } from "./transaction.js";

export type ValidateInput = {
  head: LoadedState;
  transaction: AnalyzeTransaction;
  patch: SemanticPatch;
  /**
   * 커밋 1이 만든 dirty evidence 개수. ④의 churn 판정 입력이다.
   * 모르면 churn 경고를 내지 않는다 — 근거 없이 경고하지 않는다.
   */
  dirtyEvidenceCount?: number;
};

export type ValidateResult = {
  diagnostics: Diagnostic[];
  /** ⓪~③을 통과했을 때만. 커밋이 이것을 그대로 쓴다 */
  projected?: PatchResult;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * base → head 사이에 무슨 일이 있었는가 (R3).
 *
 * 거절 응답에 이것을 함께 실어야 agent가 **전부 다시 읽지 않고** rebase할 수 있다.
 */
export function semanticDiffSince(head: LoadedState, baseSemanticVersion: number): SemanticDiffSummary {
  const merged: SemanticDiffSummary = {
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
  for (const record of head.versions) {
    if (record.source !== "patch" || record.semanticVersion <= baseSemanticVersion) continue;
    const summary = record.diffSummary;
    if (!summary) continue;
    for (const key of Object.keys(merged) as Array<keyof SemanticDiffSummary>) {
      merged[key] = [...new Set([...merged[key], ...summary[key]])].sort();
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// ⓪ ~ ④
// ---------------------------------------------------------------------------

export function validatePatch(input: ValidateInput): ValidateResult {
  const { head, transaction, patch } = input;
  const diagnostics: Diagnostic[] = [];

  // --- ⓪ Version ------------------------------------------------------------
  const staleAnalysis = patch.baseAnalysisVersion !== head.project.analysisVersion;
  const staleSemantic = patch.baseSemanticVersion !== head.project.semanticVersion;
  const staleTransaction = patch.baseAnalysisVersion !== transaction.baseAnalysisVersion;
  if (staleAnalysis || staleSemantic || staleTransaction) {
    diagnostics.push(
      diagnostic(
        "version/stale-base",
        "error",
        `base 버전이 현재 상태와 다릅니다. ` +
          `patch(analysis ${patch.baseAnalysisVersion}, semantic ${patch.baseSemanticVersion}) ` +
          `vs head(analysis ${head.project.analysisVersion}, semantic ${head.project.semanticVersion})` +
          (staleTransaction
            ? ` · 이 transaction 의 base 는 ${transaction.baseAnalysisVersion} 입니다`
            : ""),
        {
          subject: { path: "/baseSemanticVersion" },
          evidence: {
            patchBaseAnalysisVersion: patch.baseAnalysisVersion,
            patchBaseSemanticVersion: patch.baseSemanticVersion,
            headAnalysisVersion: head.project.analysisVersion,
            headSemanticVersion: head.project.semanticVersion,
            transactionBaseAnalysisVersion: transaction.baseAnalysisVersion,
            // R3 — 전부 다시 읽지 않고 rebase 할 수 있게 한다.
            semanticDiff: semanticDiffSince(head, patch.baseSemanticVersion),
          },
          supportedFixes: [
            "semanticDiff 를 보고 patch 를 rebase 한 뒤 새 base 버전으로 다시 제출한다",
            "get_project_semantic_memory 로 현재 상태를 확인한다",
          ],
        },
      ),
    );
    return { diagnostics };
  }

  // --- ① Schema -------------------------------------------------------------
  diagnostics.push(...validateAgainst("semantic-patch", patch));
  if (hasError(diagnostics)) return { diagnostics };

  // --- ② Evidence -----------------------------------------------------------
  //
  // transaction 의 pendingEvidence 도 여기 포함된다 (S2) — 검증된 제안은 **이 task 안에서**
  // 즉시 grounding 할 수 있어야 self-deadlock 이 생기지 않는다.
  for (const site of evidenceRefSites(patch)) {
    const found = transaction.findEvidence(site.ref);
    if (!found) {
      diagnostics.push(
        diagnostic(
          "evidence/unknown-id",
          "error",
          `${site.path} 가 실재하지 않는 evidence id "${site.ref}" 를 가리킵니다.`,
          {
            subject: { path: site.path, ownerId: site.ownerId, evidenceId: site.ref },
            evidence: { evidenceId: site.ref },
            supportedFixes: [
              "get_evidence 로 실재하는 id 를 확인한다",
              "엔진이 못 본 근거라면 propose_evidence 로 등록을 요청한다",
            ],
          },
        ),
      );
      continue;
    }
    if (found.status !== "present") {
      diagnostics.push(
        diagnostic(
          "evidence/not-present",
          "error",
          `${site.path} 가 더 이상 존재하지 않는 근거("${site.ref}", ${found.status})를 가리킵니다.`,
          {
            subject: { path: site.path, ownerId: site.ownerId, evidenceId: site.ref },
            evidence: {
              evidenceId: site.ref,
              status: found.status,
              ...(found.filePath ? { filePath: found.filePath } : {}),
            },
            supportedFixes: [
              "현재 코드에 남아 있는 근거로 바꾼다",
              "그 의미가 더 이상 참이 아니라면 철회하거나 status 를 바꾼다",
            ],
          },
        ),
      );
    }
  }

  // --- ③ Grounding ----------------------------------------------------------
  const nextSemanticVersion = head.project.semanticVersion + 1;
  const projected = applyPatch(head.memory, head.grounding, patch, nextSemanticVersion);

  const existingConceptIds = new Set(head.memory.concepts.map((item) => item.id));
  const existingClaimIds = new Set(head.memory.claims.map((item) => item.id));
  const existingScenarioIds = new Set(head.memory.canonicalScenarios.map((item) => item.id));

  const duplicate = (kind: string, key: keyof SemanticPatch, items: Array<{ id: string }> | undefined, existing: Set<string>): void => {
    (items ?? []).forEach((item, index) => {
      if (!existing.has(item.id)) return;
      diagnostics.push(
        diagnostic(
          "patch/duplicate-id",
          "error",
          `/${String(key)}/${index} (id: "${item.id}") 는 이미 존재하는 ${kind} 입니다. ` +
            "새로 만드는 것이 아니라 갱신하려는 것이라면 updated* 로 보내세요.",
          {
            subject: { path: `/${String(key)}/${index}`, id: item.id },
            evidence: { id: item.id },
            supportedFixes: [`updated${kind} 로 옮긴다`, "다른 id 를 쓴다"],
          },
        ),
      );
    });
  };
  duplicate("Concepts", "addedConcepts", patch.addedConcepts, existingConceptIds);
  duplicate("Claims", "addedClaims", patch.addedClaims, existingClaimIds);
  duplicate("Scenarios", "addedScenarios", patch.addedScenarios, existingScenarioIds);

  for (const key of ["addedConcepts", "updatedConcepts"] as const) {
    (patch[key] ?? []).forEach((concept, index) => {
      // `uncertain`은 "아직 근거를 못 찾았다"를 정직하게 말하는 상태다. 그것까지 막으면
      // agent 는 근거를 지어내거나 의미를 버리게 된다 (§17).
      if (concept.status === "uncertain" || concept.evidenceRefs.length > 0) return;
      diagnostics.push(
        diagnostic(
          "grounding/concept-ungrounded",
          "error",
          `/${key}/${index} (id: "${concept.id}") 에 evidenceRefs 가 없습니다.`,
          {
            subject: { path: `/${key}/${index}`, conceptId: concept.id },
            evidence: { status: concept.status },
            supportedFixes: [
              "근거가 되는 evidence id 를 붙인다",
              'status 를 "uncertain" 으로 두어 근거가 없다는 것을 정직하게 표시한다',
            ],
          },
        ),
      );
    });
  }

  for (const key of ["addedClaims", "updatedClaims"] as const) {
    (patch[key] ?? []).forEach((claim, index) => {
      if (claim.evidenceRefs.length > 0) return;
      diagnostics.push(
        diagnostic(
          "grounding/claim-ungrounded",
          "error",
          `/${key}/${index} (id: "${claim.id}") 에 evidenceRefs 가 없습니다. Claim 은 근거 없이 설 수 없습니다.`,
          {
            subject: { path: `/${key}/${index}`, claimId: claim.id },
            evidence: {},
            supportedFixes: ["이 관계가 성립하는 근거를 붙인다", "이 Claim 을 빼거나 철회한다"],
          },
        ),
      );
    });
  }

  // **적용 결과**에 대해 검사한다. patch 안의 Claim 만 보면, Concept 를 지우면서 남긴
  // 매달린 Claim 을 놓친다 — 그 상태는 다음 turn 에 조용히 잘못된 의미로 남는다.
  const projectedConceptIds = new Set(projected.memory.concepts.map((item) => item.id));
  for (const claim of projected.memory.claims) {
    const missing: string[] = [];
    if (!projectedConceptIds.has(claim.subjectConceptId)) missing.push(claim.subjectConceptId);
    if ("conceptId" in claim.object && !projectedConceptIds.has(claim.object.conceptId)) {
      missing.push(claim.object.conceptId);
    }
    if (missing.length === 0) continue;
    diagnostics.push(
      diagnostic(
        "grounding/unknown-concept",
        "error",
        `Claim "${claim.id}" 가 존재하지 않는 Concept 를 가리킵니다: ${missing.join(", ")}`,
        {
          subject: { claimId: claim.id },
          evidence: { missingConceptIds: missing, predicate: claim.predicate },
          supportedFixes: [
            "그 Concept 를 이 patch 에서 함께 만든다",
            "이 Claim 도 함께 제거한다",
          ],
        },
      ),
    );
  }

  // 기존 ref 가 `missing` 이 된 항목은 **실패가 아니라 이번 turn 의 할 일**이다 (§45).
  const lost = lostGrounding(head, projected);
  if (lost.conceptIds.length > 0 || lost.claimIds.length > 0) {
    diagnostics.push(
      diagnostic(
        "grounding/lost",
        "warning",
        `근거를 잃은 의미가 있습니다 — Concept ${lost.conceptIds.length}개, Claim ${lost.claimIds.length}개. ` +
          "이번 turn 의 할 일입니다.",
        {
          subject: { conceptIds: lost.conceptIds, claimIds: lost.claimIds },
          evidence: { missingEvidenceIds: lost.evidenceIds },
          supportedFixes: [
            "그 의미가 여전히 참인지 확인하고 새 근거로 바꾼다",
            "더 이상 참이 아니라면 철회한다",
          ],
        },
      ),
    );
  }

  if (hasError(diagnostics)) return { diagnostics };

  // --- ④ Stability — 전부 warning ------------------------------------------
  for (const concept of patch.addedConcepts ?? []) {
    const [best] = conceptCandidates(head.memory, head.grounding, {
      name: concept.name,
      ...(concept.aliases ? { aliases: concept.aliases } : {}),
      evidenceRefs: concept.evidenceRefs,
    });
    if (!best || best.score < REUSE_SUGGESTION_THRESHOLD) continue;
    diagnostics.push(
      diagnostic(
        "identity/reuse-candidate",
        "warning",
        `새 Concept "${concept.name}" 가 기존 "${best.id}" 와 같은 것일 수 있습니다 ` +
          `(점수 ${best.score.toFixed(2)}, ${best.reasons.join(" · ")}). 판단은 당신이 합니다.`,
        {
          subject: { conceptId: concept.id, candidateId: best.id },
          evidence: { score: best.score, reasons: best.reasons },
          supportedFixes: [
            "같은 것이면 addedConcepts 대신 updatedConcepts 로 기존 id 를 갱신한다",
            "정말 다른 의미라면 그대로 두되 이름으로 구별되게 한다",
          ],
        },
      ),
    );
  }

  for (const claim of patch.addedClaims ?? []) {
    const [best] = claimCandidates(head.memory, claim);
    if (!best || best.score < REUSE_SUGGESTION_THRESHOLD) continue;
    diagnostics.push(
      diagnostic(
        "identity/reuse-candidate",
        "warning",
        `새 Claim 이 기존 "${best.id}" 와 같은 관계일 수 있습니다 ` +
          `(점수 ${best.score.toFixed(2)}, ${best.reasons.join(" · ")}).`,
        {
          subject: { claimId: claim.id, candidateId: best.id },
          evidence: { score: best.score, reasons: best.reasons },
          supportedFixes: ["같은 것이면 updatedClaims 로 기존 id 를 갱신한다"],
        },
      ),
    );
  }

  for (const scenario of patch.addedScenarios ?? []) {
    const [best] = scenarioCandidates(head.memory, scenario);
    if (!best || best.score < REUSE_SUGGESTION_THRESHOLD) continue;
    diagnostics.push(
      diagnostic(
        "identity/reuse-candidate",
        "warning",
        `새 Scenario "${scenario.name}" 가 기존 "${best.id}" 와 같을 수 있습니다 ` +
          `(점수 ${best.score.toFixed(2)}, ${best.reasons.join(" · ")}).`,
        {
          subject: { scenarioId: scenario.id, candidateId: best.id },
          evidence: { score: best.score, reasons: best.reasons },
          supportedFixes: ["같은 것이면 updatedScenarios 로 기존 id 를 갱신한다"],
        },
      ),
    );
  }

  const churn = churnWarning(input, projected.summary);
  if (churn) diagnostics.push(churn);

  return { diagnostics, projected };
}

function lostGrounding(
  head: LoadedState,
  projected: PatchResult,
): { conceptIds: string[]; claimIds: string[]; evidenceIds: string[] } {
  const missing = new Set(
    head.evidence.evidence.filter((item) => item.status !== "present").map((item) => item.id),
  );
  const conceptIds: string[] = [];
  const claimIds: string[] = [];
  const evidenceIds = new Set<string>();
  if (missing.size === 0) return { conceptIds, claimIds, evidenceIds: [] };

  for (const concept of projected.memory.concepts) {
    const hits = concept.evidenceRefs.filter((ref) => missing.has(ref));
    if (hits.length === 0) continue;
    conceptIds.push(concept.id);
    for (const ref of hits) evidenceIds.add(ref);
  }
  for (const claim of projected.memory.claims) {
    const hits = claim.evidenceRefs.filter((ref) => missing.has(ref));
    if (hits.length === 0) continue;
    claimIds.push(claim.id);
    for (const ref of hits) evidenceIds.add(ref);
  }
  return { conceptIds: conceptIds.sort(), claimIds: claimIds.sort(), evidenceIds: [...evidenceIds].sort() };
}

/**
 * "Evidence diff가 작은데 변경 비율이 높다" (④).
 *
 * dirty 근거 하나가 여러 의미를 건드리는 것은 정상이므로 **여유를 크게 둔다.** 여기서
 * 잡으려는 것은 "근거는 두어 개 바뀌었는데 memory를 새로 쓰다시피 한" 경우다 (§46 churn).
 */
function churnWarning(input: ValidateInput, summary: SemanticDiffSummary): Diagnostic | null {
  const dirty = input.dirtyEvidenceCount;
  if (dirty === undefined) return null;
  const changed =
    summary.conceptsAdded.length +
    summary.conceptsRemoved.length +
    summary.conceptsMeaningChanged.length +
    summary.claimsAdded.length +
    summary.claimsRemoved.length +
    summary.claimsContradicted.length;
  const budget = Math.max(5, dirty * 3);
  if (changed <= budget) return null;
  return diagnostic(
    "stability/churn",
    "warning",
    `바뀐 근거는 ${dirty}개인데 의미는 ${changed}개가 바뀝니다 (기준 ${budget}). ` +
      "정말 다시 써야 하는지 확인하세요 — 같은 의미가 분석마다 새로 만들어지면 실패입니다.",
    {
      subject: {},
      evidence: { dirtyEvidenceCount: dirty, changedSemanticItems: changed, budget },
      supportedFixes: [
        "get_concept_context 로 재사용 후보를 확인하고 기존 id 를 갱신한다",
        "이번 turn 에 꼭 필요한 변경만 남긴다",
      ],
    },
  );
}

// ---------------------------------------------------------------------------
// ⑤ + 커밋
// ---------------------------------------------------------------------------

class PrecommitError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super("precommit");
  }
}

export type CommitPatchResult = {
  generation: number;
  semanticVersion: number;
  diffSummary: SemanticDiffSummary;
  committedEvidenceIds: string[];
  committedSystemEntityIds: string[];
  committedSystemLinkIds: string[];
  /** patch가 끝내 참조하지 않은 제안. 버리되 **조용히 버리지 않는다** (S2) */
  unusedProposalIds: string[];
};

/**
 * Validator ⓪~⑤를 돌리고 통과하면 **하나의 generation**으로 커밋한다 (§5 T4 · §6.9 커밋 2).
 *
 * ```text
 * pendingEvidence + memory patch + semanticVersion++  →  새 generation  →  atomic HEAD switch
 * ```
 *
 * ⑤와 커밋은 **같은 lock 안에서** 일어난다. 검사와 쓰기 사이에 틈이 있으면 ⑤가 막으려던
 * 바로 그 race 를 다시 여는 것이다.
 */
export async function commitPatch(
  store: SemanticStore,
  input: ValidateInput,
): Promise<Outcome<CommitPatchResult>> {
  const { head, transaction, patch } = input;
  const result = validatePatch(input);
  if (hasError(result.diagnostics) || !result.projected) {
    return { ok: false, diagnostics: result.diagnostics };
  }
  const projected = result.projected;

  const referenced = referencedEvidenceIds(patch);
  for (const id of transaction.systemFactEvidenceRefs()) referenced.add(id);
  const committedEvidence = transaction.pendingEvidence.filter((item) => referenced.has(item.id));
  const unused = transaction.unusedProposals(referenced);

  try {
    const committed = await store.commit(
      "semantic patch",
      "patch",
      (snapshot) => {
        // ⓪ 재확인 — 검증과 쓰기 사이에 다른 커밋이 끼어들었는지. lock 안이라 여기가 마지막이다.
        if (
          snapshot.project.analysisVersion !== head.project.analysisVersion ||
          snapshot.project.semanticVersion !== head.project.semanticVersion
        ) {
          throw new PrecommitError([
            diagnostic(
              "version/stale-base",
              "error",
              "검증과 커밋 사이에 다른 커밋이 끼어들었습니다. 다시 제출하세요.",
              {
                subject: {},
                evidence: {
                  headAnalysisVersion: snapshot.project.analysisVersion,
                  headSemanticVersion: snapshot.project.semanticVersion,
                },
                supportedFixes: ["현재 상태를 다시 읽고 patch 를 rebase 한다"],
              },
            ),
          ]);
        }

        // --- ⑤ 커밋 직전 working-tree 재확인 (S3) ---------------------------
        const changed = changedReferencedFiles(
          transaction.projectPath,
          referenced,
          transaction,
          committedEvidence,
        );
        if (changed.length > 0) {
          throw new PrecommitError([
            diagnostic(
              "evidence/file-changed-during-turn",
              "error",
              `커밋 직전에 참조 파일이 바뀌었습니다: ${changed.join(", ")}. **아무것도 쓰지 않았습니다.**`,
              {
                subject: { changedFiles: changed },
                evidence: { changedFiles: changed },
                supportedFixes: [
                  "재인덱싱 후 새 transaction 에서 다시 제안하고 다시 제출한다",
                  "파일 저장을 멈춘 뒤 다시 시도한다",
                ],
              },
            ),
          ]);
        }

        const evidence = [...snapshot.evidence.evidence];
        const byId = new Map(evidence.map((item) => [item.id, item] as const));
        for (const item of committedEvidence) byId.set(item.id, item);

        snapshot.evidence = {
          ...snapshot.evidence,
          evidence: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        };
        snapshot.systemFacts = mergeProposedSystemFacts(snapshot.systemFacts, {
          entities: transaction.pendingSystemEntities,
          links: transaction.pendingSystemLinks,
        });
        snapshot.memory = projected.memory;
        snapshot.grounding = projected.grounding;
        // 인덱스는 그대로다. 의미만 올라간다.
        snapshot.project.semanticVersion = projected.memory.semanticVersion;
        snapshot.project.semanticReconciledAnalysisVersion = snapshot.project.analysisVersion;
        return snapshot;
      },
      { diffSummary: projected.summary },
    );

    // **transaction 은 열린 채로 남는다.** 같은 turn 안에서 agent 가 더 제안하고 더
    // 제출할 수 있어야 한다 (S2 — 하나의 transaction = 하나의 analysisVersion이지, 하나의
    // patch 가 아니다). 성공을 기록만 해 둔다.
    transaction.committedGenerations.push(committed.generation);
    if (unused.length > 0) logUnusedProposals(transaction.projectPath, transaction.taskId, unused);

    return {
      ok: true,
      value: {
        generation: committed.generation,
        semanticVersion: committed.project.semanticVersion,
        diffSummary: projected.summary,
        committedEvidenceIds: committedEvidence.map((item) => item.id).sort(),
        committedSystemEntityIds: transaction.pendingSystemEntities.map((item) => item.id).sort(),
        committedSystemLinkIds: transaction.pendingSystemLinks.map((item) => item.id).sort(),
        unusedProposalIds: unused.map((item) => item.id).sort(),
      },
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    if (error instanceof PrecommitError) {
      return { ok: false, diagnostics: [...result.diagnostics, ...error.diagnostics] };
    }
    throw error;
  }
}

/**
 * 참조된 evidence 가 사는 파일만 **지금 디스크에서 읽어** 대조한다 (S3 2~3단계).
 *
 * 전체 재스캔이 아니다 — 이 patch 가 실제로 근거로 삼은 파일들만 본다.
 */
function changedReferencedFiles(
  projectPath: string,
  referenced: ReadonlySet<string>,
  transaction: AnalyzeTransaction,
  pending: readonly Evidence[],
): string[] {
  const expected = new Map<string, string>();
  const record = (item: Evidence | undefined): void => {
    if (!item?.filePath) return;
    if (!expected.has(item.filePath)) expected.set(item.filePath, item.fileContentHash);
  };
  for (const id of referenced) record(transaction.findEvidence(id));
  for (const item of pending) record(item);

  const changed: string[] = [];
  for (const [relPath, hash] of expected) {
    let current: string;
    try {
      current = sha256(readFileSync(join(projectPath, relPath), "utf8"));
    } catch {
      changed.push(relPath);
      continue;
    }
    if (current !== hash) changed.push(relPath);
  }
  return changed.sort();
}

/**
 * 쓰이지 않은 제안을 `events.ndjson` 에 남긴다 (S2).
 *
 * **쓰이지 않은 제안은 프롬프트 품질의 신호다** — agent 가 무엇을 근거라고 생각했는지,
 * 그런데 왜 결국 쓰지 않았는지가 다음 프롬프트를 고치는 재료가 된다.
 */
function logUnusedProposals(
  projectPath: string,
  taskId: string,
  unused: Array<{ id: string; kind: string; filePath?: string; summary?: string }>,
): void {
  try {
    const lines = unused
      .map((item) =>
        JSON.stringify({
          at: new Date().toISOString(),
          event: "evidence/proposed-unused",
          taskId,
          ...item,
        }),
      )
      .join("\n");
    appendFileSync(eventsPath(projectPath), `${lines}\n`, "utf8");
  } catch {
    // 로그 실패가 커밋을 되돌리지는 않는다. 커밋은 이미 끝났다.
  }
}
