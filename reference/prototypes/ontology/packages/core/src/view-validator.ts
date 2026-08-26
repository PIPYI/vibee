/**
 * `submit_view_ir`의 Validator (implementation_plan §6.6~§6.8, §22, §28~§33, I9).
 *
 * Trace는 Core가 결정론적으로 투영하므로 이 파일의 대상이 아니다 (§6.6 R4) — 여기는
 * **AI가 만드는** Overview/Scenario IR만 검사한다. I9("AI output은 Evidence validation
 * 없이 저장되지 않는다")가 적용되는 자리다.
 *
 * `submit_semantic_patch`의 Validator ⓪~⑤와 다른 점: View는 `SemanticStore`에 커밋되지
 * 않는다(§6.4 — cache일 뿐이고 source of truth가 아니다). 그래서 여기는 `AnalyzeTransaction`도
 * `store.commit`도 모르는 **순수 함수**다. 실패는 전부 `Diagnostic[]`로, patch Validator와
 * 같은 모양이다 (A3).
 *
 * | 층 | 성격 | 실패 |
 * |---|---|---|
 * | schema | ajv, 개수 제한 없음 (§6.7) | error |
 * | 참조 무결성 | conceptRefs/claimRefs/scenarioRefs/evidenceRefs가 실재하고 present | error (I9) |
 * | Scenario 구조 | entry/outcome 실재, step evidenceRef ≥ 1(acceptance 15), 전부 도달 가능, loop엔 condition | error |
 * | loop-unrolled | 같은 conceptRefs·비슷한 label의 step 쌍 | **warning** |
 * | soft budget | `viewBudget.ts` 초과 | **warning**, 제출은 성공한다 (§6.7) |
 *
 * renderer safety ceiling(뷰어가 안 멎게 접는 것)은 여기 없다 — 그것은 M7 렌더러의
 * 책임이다(§6.7: "IR을 거절하지 않는다").
 */
import type {
  Diagnostic,
  EvidenceIndex,
  OverviewIR,
  ScenarioIR,
  SemanticMemory,
} from "@onto/protocol";

import { VIEW_BUDGET } from "./viewBudget.js";
import { diagnostic, hasError, validateAgainst } from "./schema.js";

export type ViewValidateInput =
  | { viewKind: "overview"; ir: unknown; memory: SemanticMemory }
  | { viewKind: "scenario"; ir: unknown; memory: SemanticMemory; evidence: EvidenceIndex };

export type ViewValidateResult =
  | { diagnostics: Diagnostic[]; viewKind: "overview"; ir?: OverviewIR }
  | { diagnostics: Diagnostic[]; viewKind: "scenario"; ir?: ScenarioIR };

export function validateViewIR(input: ViewValidateInput): ViewValidateResult {
  if (input.viewKind === "overview") {
    return validateOverview(input.ir, input.memory);
  }
  return validateScenario(input.ir, input.memory, input.evidence);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function validateOverview(rawIr: unknown, memory: SemanticMemory): ViewValidateResult {
  const diagnostics = validateAgainst("overview-ir", rawIr);
  if (hasError(diagnostics)) return { diagnostics, viewKind: "overview" };
  const ir = rawIr as OverviewIR;

  const conceptIds = new Set(memory.concepts.map((item) => item.id));
  const scenarioIds = new Set(memory.canonicalScenarios.map((item) => item.id));
  const itemIds = new Set<string>();

  ir.areas.forEach((area, areaIndex) => {
    area.items.forEach((item, itemIndex) => {
      const base = `/areas/${areaIndex} (id: "${area.id}") /items/${itemIndex} (id: "${item.id}")`;
      if (itemIds.has(item.id)) {
        diagnostics.push(
          diagnostic("view/duplicate-id", "error", `${base} 의 id가 다른 item과 겹칩니다.`, {
            subject: { path: base, id: item.id },
            supportedFixes: ["item마다 고유한 id를 쓴다"],
          }),
        );
      }
      itemIds.add(item.id);

      for (const ref of item.conceptRefs ?? []) {
        if (conceptIds.has(ref)) continue;
        diagnostics.push(
          unknownRef("view/unknown-concept", `${base} /conceptRefs`, ref, "conceptRefs", [
            "get_project_semantic_memory로 실재하는 Concept id를 확인한다",
          ]),
        );
      }
      for (const ref of item.scenarioRefs ?? []) {
        if (scenarioIds.has(ref)) continue;
        diagnostics.push(
          unknownRef("view/unknown-scenario", `${base} /scenarioRefs`, ref, "scenarioRefs", [
            "get_project_semantic_memory로 실재하는 Scenario id를 확인한다",
          ]),
        );
      }
    });
  });

  (ir.importantConnections ?? []).forEach((connection, index) => {
    const base = `/importantConnections/${index}`;
    for (const [field, value] of [["from", connection.from], ["to", connection.to]] as const) {
      if (itemIds.has(value)) continue;
      diagnostics.push(
        diagnostic(
          "view/unknown-item",
          "error",
          `${base}/${field}가 이 Overview 안의 item을 가리키지 않습니다: "${value}".`,
          {
            subject: { path: `${base}/${field}`, itemId: value },
            supportedFixes: ["areas[].items[].id 중 하나를 쓴다"],
          },
        ),
      );
    }
  });

  if (hasError(diagnostics)) return { diagnostics, viewKind: "overview" };

  diagnostics.push(...overviewBudgetWarnings(ir));
  return { diagnostics, viewKind: "overview", ir };
}

function overviewBudgetWarnings(ir: OverviewIR): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  const budget = VIEW_BUDGET.overview;
  if (ir.areas.length > budget.maxAreas) {
    warnings.push(
      diagnostic(
        "view/over-budget",
        "warning",
        `Area가 ${ir.areas.length}개입니다 (권장 ${budget.maxAreas}개 이하). 제출은 성공했습니다.`,
        {
          subject: {},
          evidence: { count: ir.areas.length, budget: budget.maxAreas },
          supportedFixes: ["덜 중요한 Area를 합치거나 하위 View로 옮기는 것을 고려한다"],
        },
      ),
    );
  }
  for (const area of ir.areas) {
    if (area.items.length <= budget.maxItemsPerArea) continue;
    warnings.push(
      diagnostic(
        "view/over-budget",
        "warning",
        `Area "${area.id}"의 item이 ${area.items.length}개입니다 (권장 ${budget.maxItemsPerArea}개 이하).`,
        {
          subject: { areaId: area.id },
          evidence: { count: area.items.length, budget: budget.maxItemsPerArea },
          supportedFixes: ["덜 중요한 item을 생략하거나 하위 Area로 나누는 것을 고려한다"],
        },
      ),
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

function validateScenario(rawIr: unknown, memory: SemanticMemory, evidence: EvidenceIndex): ViewValidateResult {
  const diagnostics = validateAgainst("scenario-ir", rawIr);
  if (hasError(diagnostics)) return { diagnostics, viewKind: "scenario" };
  const ir = rawIr as ScenarioIR;

  const conceptIds = new Set(memory.concepts.map((item) => item.id));
  const claimIds = new Set(memory.claims.map((item) => item.id));
  const presentEvidence = new Map(
    evidence.evidence.filter((item) => item.status === "present").map((item) => [item.id, item] as const),
  );
  const allEvidenceIds = new Set(evidence.evidence.map((item) => item.id));

  const checkEvidenceRefs = (refs: readonly string[], base: string): void => {
    refs.forEach((ref, index) => {
      const path = `${base}/${index}`;
      if (!allEvidenceIds.has(ref)) {
        diagnostics.push(
          diagnostic("evidence/unknown-id", "error", `${path} 가 실재하지 않는 evidence id "${ref}" 를 가리킵니다.`, {
            subject: { path, evidenceId: ref },
            supportedFixes: ["get_evidence로 실재하는 id를 확인한다"],
          }),
        );
        return;
      }
      if (!presentEvidence.has(ref)) {
        diagnostics.push(
          diagnostic(
            "evidence/not-present",
            "error",
            `${path} 가 더 이상 존재하지 않는 근거("${ref}")를 가리킵니다.`,
            {
              subject: { path, evidenceId: ref },
              supportedFixes: ["현재 코드에 남아 있는 근거로 바꾼다"],
            },
          ),
        );
      }
    });
  };

  checkEvidenceRefs(ir.evidenceRefs ?? [], "/evidenceRefs");

  const participantIds = new Set<string>();
  ir.participants.forEach((participant, index) => {
    const base = `/participants/${index} (id: "${participant.id}")`;
    if (participantIds.has(participant.id)) {
      diagnostics.push(duplicateId("view/duplicate-id", base, participant.id));
    }
    participantIds.add(participant.id);
    checkConceptRefs(participant.conceptRefs ?? [], `${base}/conceptRefs`, conceptIds, diagnostics);
  });

  const stepIds = new Set<string>();
  ir.steps.forEach((step, index) => {
    const base = `/steps/${index} (id: "${step.id}")`;
    if (stepIds.has(step.id)) diagnostics.push(duplicateId("view/duplicate-id", base, step.id));
    stepIds.add(step.id);

    if (step.evidenceRefs.length === 0) {
      diagnostics.push(
        diagnostic("scenario/step-ungrounded", "error", `${base} 에 evidenceRefs 가 없습니다.`, {
          subject: { path: base, stepId: step.id },
          supportedFixes: ["이 step의 근거가 되는 evidence id를 붙인다"],
        }),
      );
    }
    checkEvidenceRefs(step.evidenceRefs, `${base}/evidenceRefs`);
    checkConceptRefs(step.conceptRefs, `${base}/conceptRefs`, conceptIds, diagnostics);
    checkClaimRefs(step.claimRefs ?? [], `${base}/claimRefs`, claimIds, diagnostics);

    if (step.participantId && !participantIds.has(step.participantId)) {
      diagnostics.push(
        diagnostic(
          "scenario/unknown-participant",
          "error",
          `${base}/participantId 가 실재하지 않는 participant "${step.participantId}" 를 가리킵니다.`,
          { subject: { path: `${base}/participantId` }, supportedFixes: ["participants[].id 중 하나를 쓴다"] },
        ),
      );
    }
  });

  if (!stepIds.has(ir.entryStepId)) {
    diagnostics.push(
      diagnostic(
        "scenario/unknown-entry",
        "error",
        `entryStepId "${ir.entryStepId}" 가 steps 안에 없습니다.`,
        { subject: { path: "/entryStepId" }, supportedFixes: ["steps[].id 중 하나를 entryStepId로 쓴다"] },
      ),
    );
  }
  if (ir.outcomeStepIds.length === 0) {
    diagnostics.push(
      diagnostic("scenario/no-outcome", "error", "outcomeStepIds 가 비어 있습니다 — 종료 지점이 하나 이상 필요합니다.", {
        subject: { path: "/outcomeStepIds" },
        supportedFixes: ["흐름이 끝나는 step id를 하나 이상 넣는다"],
      }),
    );
  }
  ir.outcomeStepIds.forEach((id, index) => {
    if (stepIds.has(id)) return;
    diagnostics.push(
      diagnostic("scenario/unknown-step", "error", `/outcomeStepIds/${index} 가 steps 안에 없는 "${id}" 를 가리킵니다.`, {
        subject: { path: `/outcomeStepIds/${index}` },
        supportedFixes: ["steps[].id 중 하나를 쓴다"],
      }),
    );
  });

  // 순서상 도달 가능성을 지금부터 계산한다 — step 참조가 전부 실재해야 그래프를 지을 수 있다.
  const graph = new Map<string, string[]>();
  const addEdge = (from: string, to: string): void => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from)!.push(to);
  };

  ir.transitions.forEach((transition, index) => {
    const base = `/transitions/${index}`;
    checkEvidenceRefs(transition.evidenceRefs, `${base}/evidenceRefs`);
    let endpointsOk = true;
    if (!stepIds.has(transition.fromStepId)) {
      diagnostics.push(unknownStep(base, "fromStepId", transition.fromStepId));
      endpointsOk = false;
    }
    if (!stepIds.has(transition.toStepId)) {
      diagnostics.push(unknownStep(base, "toStepId", transition.toStepId));
      endpointsOk = false;
    }
    if (endpointsOk) addEdge(transition.fromStepId, transition.toStepId);

    // back edge는 합법이다. 단 condition을 반드시 갖는다 (§6.8).
    if (transition.loop && !transition.condition?.trim()) {
      diagnostics.push(
        diagnostic(
          "scenario/loop-without-condition",
          "error",
          `${base} 는 loop:true인데 condition이 없습니다. back edge는 합법이지만 condition은 필수입니다.`,
          {
            subject: { path: base },
            supportedFixes: ["이 back edge가 도는 조건을 condition에 적는다"],
          },
        ),
      );
    }
  });

  (ir.branches ?? []).forEach((branch, index) => {
    const base = `/branches/${index}`;
    checkEvidenceRefs(branch.evidenceRefs, `${base}/evidenceRefs`);
    checkConceptRefs(branch.conceptRefs ?? [], `${base}/conceptRefs`, conceptIds, diagnostics);
    checkClaimRefs(branch.claimRefs ?? [], `${base}/claimRefs`, claimIds, diagnostics);
    if (!stepIds.has(branch.sourceStepId)) {
      diagnostics.push(unknownStep(base, "sourceStepId", branch.sourceStepId));
    }
    branch.paths.forEach((path, pathIndex) => {
      if (!stepIds.has(path.nextStepId)) {
        diagnostics.push(unknownStep(`${base}/paths/${pathIndex}`, "nextStepId", path.nextStepId));
        return;
      }
      if (stepIds.has(branch.sourceStepId)) addEdge(branch.sourceStepId, path.nextStepId);
    });
  });

  (ir.stateChanges ?? []).forEach((change, index) => {
    const base = `/stateChanges/${index}`;
    checkEvidenceRefs(change.evidenceRefs, `${base}/evidenceRefs`);
    if (!conceptIds.has(change.subjectConceptId)) {
      diagnostics.push(
        diagnostic(
          "view/unknown-concept",
          "error",
          `${base}/subjectConceptId 가 실재하지 않는 Concept "${change.subjectConceptId}" 를 가리킵니다.`,
          { subject: { path: `${base}/subjectConceptId` }, supportedFixes: ["실재하는 Concept id를 쓴다"] },
        ),
      );
    }
    if (!stepIds.has(change.causedByStepId)) {
      diagnostics.push(unknownStep(base, "causedByStepId", change.causedByStepId));
    }
  });

  // schema2 §5 — activations/phases는 그래프 엣지가 아니라 주석 층이다. 도달 가능성 계산에
  // 넣지 않는다 — step 순서에 관여하지 않고, step id를 참조할 뿐이다.
  (ir.activations ?? []).forEach((activation, index) => {
    const base = `/activations/${index}`;
    checkEvidenceRefs(activation.evidenceRefs, `${base}/evidenceRefs`);
    if (!participantIds.has(activation.participantId)) {
      diagnostics.push(
        diagnostic(
          "scenario/unknown-participant",
          "error",
          `${base}/participantId 가 실재하지 않는 participant "${activation.participantId}" 를 가리킵니다.`,
          { subject: { path: `${base}/participantId` }, supportedFixes: ["participants[].id 중 하나를 쓴다"] },
        ),
      );
    }
    if (!stepIds.has(activation.fromStepId)) diagnostics.push(unknownStep(base, "fromStepId", activation.fromStepId));
    if (!stepIds.has(activation.toStepId)) diagnostics.push(unknownStep(base, "toStepId", activation.toStepId));
  });

  const phaseIds = new Set<string>();
  (ir.phases ?? []).forEach((phase, index) => {
    const base = `/phases/${index} (id: "${phase.id}")`;
    if (phaseIds.has(phase.id)) diagnostics.push(duplicateId("view/duplicate-id", base, phase.id));
    phaseIds.add(phase.id);
    checkEvidenceRefs(phase.evidenceRefs, `${base}/evidenceRefs`);
    if (!stepIds.has(phase.fromStepId)) diagnostics.push(unknownStep(base, "fromStepId", phase.fromStepId));
    if (!stepIds.has(phase.toStepId)) diagnostics.push(unknownStep(base, "toStepId", phase.toStepId));
  });

  if (hasError(diagnostics)) return { diagnostics, viewKind: "scenario" };

  // --- 도달 가능성 (acceptance 15) -------------------------------------------
  if (stepIds.has(ir.entryStepId)) {
    const reached = new Set<string>([ir.entryStepId]);
    const queue = [ir.entryStepId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of graph.get(current) ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    for (const step of ir.steps) {
      if (reached.has(step.id)) continue;
      diagnostics.push(
        diagnostic(
          "scenario/unreachable-step",
          "error",
          `step "${step.id}" 가 entryStepId("${ir.entryStepId}")에서 도달할 수 없습니다.`,
          {
            subject: { stepId: step.id },
            supportedFixes: [
              "이 step으로 가는 transition/branch path를 추가한다",
              "이 흐름에 속하지 않는다면 step을 뺀다",
            ],
          },
        ),
      );
    }
  }

  if (hasError(diagnostics)) return { diagnostics, viewKind: "scenario" };

  diagnostics.push(...loopUnrolledWarnings(ir));
  diagnostics.push(...scenarioBudgetWarnings(ir));
  return { diagnostics, viewKind: "scenario", ir };
}

/**
 * 같은 conceptRefs·비슷한 label의 step 쌍 = 루프를 펼친 것일 가능성 (§6.8).
 *
 * **warning일 뿐이다** — 정말 다른 반복이라 다르게 표현해야 하는 경우도 있으므로 강제하지
 * 않는다. label은 공백 압축 + 소문자화로만 비교한다(§6 I3와 같은 이유로 vocabulary를 두지 않는다).
 */
function loopUnrolledWarnings(ir: ScenarioIR): Diagnostic[] {
  const normalize = (label: string): string => label.trim().toLowerCase().replace(/\s+/gu, " ");
  const conceptSetKey = (refs: string[]): string => [...refs].sort().join(",");

  const warnings: Diagnostic[] = [];
  const seen: Array<{ id: string; label: string; concepts: string }> = [];
  for (const step of ir.steps) {
    if (step.conceptRefs.length === 0) continue;
    const concepts = conceptSetKey(step.conceptRefs);
    const label = normalize(step.label);
    const duplicate = seen.find((item) => item.concepts === concepts && item.label === label);
    if (duplicate) {
      warnings.push(
        diagnostic(
          "scenario/loop-unrolled",
          "warning",
          `step "${duplicate.id}"와 "${step.id}"가 같은 concept·label을 반복합니다 — 루프를 펼친 것일 수 있습니다.`,
          {
            subject: { stepIds: [duplicate.id, step.id] },
            supportedFixes: ["하나의 step으로 합치고 condition을 가진 back edge를 추가하라"],
          },
        ),
      );
    }
    seen.push({ id: step.id, label, concepts });
  }
  return warnings;
}

function scenarioBudgetWarnings(ir: ScenarioIR): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  const budget = VIEW_BUDGET.scenario;
  if (ir.participants.length > budget.maxParticipants) {
    warnings.push(
      diagnostic(
        "view/over-budget",
        "warning",
        `participants가 ${ir.participants.length}명입니다 (권장 ${budget.maxParticipants}명 이하). 제출은 성공했습니다.`,
        {
          subject: {},
          evidence: { count: ir.participants.length, budget: budget.maxParticipants },
          supportedFixes: ["부수적인 참여자를 생략하거나 다른 Scenario로 나누는 것을 고려한다"],
        },
      ),
    );
  }
  if (ir.steps.length > budget.maxSteps) {
    warnings.push(
      diagnostic(
        "view/over-budget",
        "warning",
        `steps가 ${ir.steps.length}개입니다 (권장 ${budget.maxSteps}개 이하).`,
        {
          subject: {},
          evidence: { count: ir.steps.length, budget: budget.maxSteps },
          supportedFixes: ["여러 step을 하나로 압축하거나 다른 Scenario로 나누는 것을 고려한다"],
        },
      ),
    );
  }
  const activationCount = ir.activations?.length ?? 0;
  if (activationCount > budget.maxActivations) {
    warnings.push(
      diagnostic(
        "view/over-budget",
        "warning",
        `activations가 ${activationCount}개입니다 (권장 ${budget.maxActivations}개 이하).`,
        {
          subject: {},
          evidence: { count: activationCount, budget: budget.maxActivations },
          supportedFixes: ["짧거나 덜 중요한 activation을 생략하는 것을 고려한다"],
        },
      ),
    );
  }
  const phaseCount = ir.phases?.length ?? 0;
  if (phaseCount > budget.maxPhases) {
    warnings.push(
      diagnostic(
        "view/over-budget",
        "warning",
        `phases가 ${phaseCount}개입니다 (권장 ${budget.maxPhases}개 이하).`,
        {
          subject: {},
          evidence: { count: phaseCount, budget: budget.maxPhases },
          supportedFixes: ["인접한 국면을 합치는 것을 고려한다"],
        },
      ),
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------

function checkConceptRefs(refs: string[], base: string, conceptIds: Set<string>, diagnostics: Diagnostic[]): void {
  refs.forEach((ref, index) => {
    if (conceptIds.has(ref)) return;
    diagnostics.push(unknownRef("view/unknown-concept", base, ref, "conceptRefs", ["실재하는 Concept id를 쓴다"], index));
  });
}

function checkClaimRefs(refs: string[], base: string, claimIds: Set<string>, diagnostics: Diagnostic[]): void {
  refs.forEach((ref, index) => {
    if (claimIds.has(ref)) return;
    diagnostics.push(unknownRef("view/unknown-claim", base, ref, "claimRefs", ["실재하는 Claim id를 쓴다"], index));
  });
}

function unknownRef(
  code: string,
  base: string,
  ref: string,
  fieldLabel: string,
  supportedFixes: string[],
  index?: number,
): Diagnostic {
  const path = index === undefined ? base : `${base}/${index}`;
  return diagnostic(code, "error", `${path} 가 실재하지 않는 id "${ref}" 를 가리킵니다.`, {
    subject: { path, [fieldLabel]: ref },
    supportedFixes,
  });
}

function duplicateId(code: string, base: string, id: string): Diagnostic {
  return diagnostic(code, "error", `${base} 의 id가 다른 항목과 겹칩니다.`, {
    subject: { path: base, id },
    supportedFixes: ["고유한 id를 쓴다"],
  });
}

function unknownStep(base: string, field: string, stepId: string): Diagnostic {
  return diagnostic(
    "scenario/unknown-step",
    "error",
    `${base}/${field} 가 steps 안에 없는 "${stepId}" 를 가리킵니다.`,
    { subject: { path: `${base}/${field}` }, supportedFixes: ["steps[].id 중 하나를 쓴다"] },
  );
}
