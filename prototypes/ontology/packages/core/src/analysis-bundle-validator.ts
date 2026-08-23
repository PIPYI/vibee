/**
 * `submit_analysis_bundle`의 Validator (schema3 §5.2 Stage 3~4, §6.2, I18~I20).
 *
 * `view-validator.ts`와 같은 층위 — schema(ajv) → 참조 무결성 → 구조 검증 순서로 진행하고,
 * 실패는 전부 `Diagnostic[]`로 돌아온다(A3). `AnalysisBundle`은 `SemanticStore`에 커밋되는
 * 대상이므로(schema3 §5.4) 여기를 통과한 것만 generation에 실린다.
 *
 * **traceLinkRefs의 해석** — schema3 §3.2는 `ArchitectureConnection.traceLinkRefs`를
 * "Stage 1 골격 엣지 롤업"이라고만 적었고, 골격 엣지 자체에는 별도 id가 없다(`TraceLink`는
 * `(fromId, toId, kind)`로만 식별된다, `trace.ts`). 그래서 여기서는 그 엣지를 뒷받침하는
 * **link-role Evidence.id**를 안정적인 참조 대상으로 쓴다. 이것은 schema3 문서에 명시되지
 * 않은 설계 판단이다 — Stage 3 프롬프트(§9, 후속 세션)가 실제로 이 규약대로 traceLinkRefs를
 * 채우는지 그때 다시 맞춰봐야 한다.
 *
 * **I20의 WorkflowEdge 적용** — I20 문장은 "ArchitectureConnection/WorkflowEdge는 반드시
 * Stage 1 골격 엣지(traceLinkRefs)로 뒷받침되어야 한다"고 하지만, §3.3의 `WorkflowEdge` 타입
 * 자체에는 `traceLinkRefs` 필드가 없다(schema3 원문의 불일치로 보인다). 그래서 WorkflowEdge는
 * 자신의 `evidenceRefs`가 present Evidence를 가리키고 비어 있지 않은지로만 검사한다 —
 * `traceLinkRefs` 부분집합 검사는 필드가 있는 `ArchitectureConnection`에만 적용한다.
 */
import type {
  AnalysisBundle,
  ArchitectureIR,
  Diagnostic,
  EvidenceIndex,
  SemanticMemory,
  WorkflowIR,
} from "@onto/protocol";

import { diagnostic, hasError, validateAgainst } from "./schema.js";
import { buildEvidenceGraph } from "./trace.js";

export type AnalysisBundleValidateInput = {
  bundle: unknown;
  evidence: EvidenceIndex;
  memory: SemanticMemory;
};

export type AnalysisBundleValidateResult = {
  diagnostics: Diagnostic[];
  bundle?: AnalysisBundle;
};

export function validateAnalysisBundle(input: AnalysisBundleValidateInput): AnalysisBundleValidateResult {
  const diagnostics = validateAgainst("analysis-bundle", input.bundle);
  if (hasError(diagnostics)) return { diagnostics };
  const bundle = input.bundle as AnalysisBundle;

  const graph = buildEvidenceGraph(input.evidence);
  const presentEvidence = new Map(
    input.evidence.evidence.filter((item) => item.status === "present").map((item) => [item.id, item] as const),
  );
  const allEvidenceIds = new Set(input.evidence.evidence.map((item) => item.id));
  // I20 — 골격 링크의 안정적 참조는 그것을 뒷받침하는 link-role evidence id뿐이다 (파일 상단 주석 참고).
  const linkEvidenceIds = new Set(
    input.evidence.evidence
      .filter((item) => item.status === "present" && item.graph?.role === "link")
      .map((item) => item.id),
  );
  const conceptIds = new Set(input.memory.concepts.map((item) => item.id));

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
            { subject: { path, evidenceId: ref }, supportedFixes: ["현재 코드에 남아 있는 근거로 바꾼다"] },
          ),
        );
      }
    });
  };

  /** I9 — 근거 없는 설명·연결이 패널에 뜨는 것을 스키마가 아니라 여기서 막는다. */
  const requireGrounded = (refs: readonly string[], base: string, code: string): void => {
    if (refs.length > 0) return;
    diagnostics.push(
      diagnostic(code, "error", `${base}/evidenceRefs 가 비어 있습니다 — 근거 없는 항목은 저장할 수 없습니다 (I9).`, {
        subject: { path: `${base}/evidenceRefs` },
        supportedFixes: ["이 항목의 근거가 되는 evidence id를 하나 이상 붙인다"],
      }),
    );
  };

  const checkConceptRefs = (refs: readonly string[], base: string): void => {
    refs.forEach((ref, index) => {
      if (conceptIds.has(ref)) return;
      diagnostics.push(
        diagnostic(
          "view/unknown-concept",
          "error",
          `${base}/${index} 가 실재하지 않는 Concept "${ref}" 를 가리킵니다.`,
          {
            subject: { path: `${base}/${index}` },
            supportedFixes: ["get_project_semantic_memory로 실재하는 Concept id를 확인한다"],
          },
        ),
      );
    });
  };

  const checkEntityRefs = (refs: readonly string[], base: string): void => {
    refs.forEach((ref, index) => {
      if (graph.nodes.has(ref)) return;
      diagnostics.push(
        diagnostic(
          "bundle/unknown-entity",
          "error",
          `${base}/${index} 가 Stage 1 골격에 없는 entity "${ref}" 를 가리킵니다.`,
          {
            subject: { path: `${base}/${index}` },
            supportedFixes: ["get_impact_context/get_evidence로 실재하는 골격 노드를 확인한다"],
          },
        ),
      );
    });
  };

  const checkComponentIO = (io: { evidenceRefs: string[] }, base: string): void => {
    checkEvidenceRefs(io.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(io.evidenceRefs, base, "bundle/io-ungrounded");
  };

  // ---------------------------------------------------------------------------
  // Architecture
  // ---------------------------------------------------------------------------
  const architecture: ArchitectureIR = bundle.architecture;
  const componentIds = new Set<string>();
  for (const [index, component] of architecture.components.entries()) {
    const base = `/architecture/components/${index} (id: "${component.id}")`;
    if (componentIds.has(component.id)) diagnostics.push(duplicateId(base, component.id));
    componentIds.add(component.id);

    checkEntityRefs(component.entityRefs, `${base}/entityRefs`);
    checkEvidenceRefs(component.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(component.evidenceRefs, base, "bundle/component-ungrounded");
    checkConceptRefs(component.conceptRefs ?? [], `${base}/conceptRefs`);
    (component.inputs ?? []).forEach((io, i) => checkComponentIO(io, `${base}/inputs/${i}`));
    (component.outputs ?? []).forEach((io, i) => checkComponentIO(io, `${base}/outputs/${i}`));
  }

  const boundaryIds = new Set<string>();
  for (const [index, boundary] of architecture.boundaries.entries()) {
    const base = `/architecture/boundaries/${index} (id: "${boundary.id}")`;
    if (boundaryIds.has(boundary.id)) diagnostics.push(duplicateId(base, boundary.id));
    boundaryIds.add(boundary.id);
    boundary.wraps.forEach((id, i) => {
      if (componentIds.has(id)) return;
      diagnostics.push(unknownRef("bundle/unknown-component", `${base}/wraps/${i}`, id, "architecture.components[].id 중 하나를 쓴다"));
    });
  }
  for (const [index, component] of architecture.components.entries()) {
    if (!component.boundaryId || boundaryIds.has(component.boundaryId)) continue;
    const base = `/architecture/components/${index} (id: "${component.id}")/boundaryId`;
    diagnostics.push(unknownRef("bundle/unknown-boundary", base, component.boundaryId, "architecture.boundaries[].id 중 하나를 쓴다"));
  }

  const connectionIds = new Set<string>();
  for (const [index, connection] of architecture.connections.entries()) {
    const base = `/architecture/connections/${index} (id: "${connection.id}")`;
    if (connectionIds.has(connection.id)) diagnostics.push(duplicateId(base, connection.id));
    connectionIds.add(connection.id);

    for (const [field, value] of [["from", connection.from], ["to", connection.to]] as const) {
      if (componentIds.has(value)) continue;
      diagnostics.push(unknownRef("bundle/unknown-component", `${base}/${field}`, value, "architecture.components[].id 중 하나를 쓴다"));
    }

    checkEvidenceRefs(connection.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(connection.evidenceRefs, base, "bundle/connection-ungrounded");

    if (connection.traceLinkRefs.length === 0) {
      diagnostics.push(
        diagnostic(
          "bundle/connection-not-grounded-in-skeleton",
          "error",
          `${base}/traceLinkRefs 가 비어 있습니다 — Stage 1 골격 엣지 없이 연결을 만들 수 없습니다 (I20).`,
          {
            subject: { path: `${base}/traceLinkRefs` },
            supportedFixes: ["이 연결이 요약하는 골격 링크의 evidence id를 하나 이상 붙인다"],
          },
        ),
      );
    }
    connection.traceLinkRefs.forEach((ref, i) => {
      if (linkEvidenceIds.has(ref)) return;
      diagnostics.push(
        diagnostic(
          "bundle/connection-not-grounded-in-skeleton",
          "error",
          `${base}/traceLinkRefs/${i} 가 Stage 1 골격의 link evidence가 아닌 "${ref}" 를 가리킵니다 (I20).`,
          {
            subject: { path: `${base}/traceLinkRefs/${i}`, evidenceId: ref },
            supportedFixes: ["get_impact_context/get_evidence로 실재하는 골격 링크 evidence id를 확인한다"],
          },
        ),
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Workflow
  // ---------------------------------------------------------------------------
  const workflow: WorkflowIR = bundle.workflow;
  const laneIds = new Set<string>();
  for (const [index, lane] of workflow.lanes.entries()) {
    const base = `/workflow/lanes/${index} (id: "${lane.id}")`;
    if (laneIds.has(lane.id)) diagnostics.push(duplicateId(base, lane.id));
    laneIds.add(lane.id);
  }

  const nodeIds = new Set<string>();
  for (const [index, node] of workflow.nodes.entries()) {
    const base = `/workflow/nodes/${index} (id: "${node.id}")`;
    if (nodeIds.has(node.id)) diagnostics.push(duplicateId(base, node.id));
    nodeIds.add(node.id);

    if (!laneIds.has(node.laneId)) {
      diagnostics.push(unknownRef("bundle/unknown-lane", `${base}/laneId`, node.laneId, "workflow.lanes[].id 중 하나를 쓴다"));
    }
    checkEntityRefs(node.entityRefs, `${base}/entityRefs`);
    checkEvidenceRefs(node.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(node.evidenceRefs, base, "bundle/node-ungrounded");
    checkConceptRefs(node.conceptRefs ?? [], `${base}/conceptRefs`);
    (node.inputs ?? []).forEach((io, i) => checkComponentIO(io, `${base}/inputs/${i}`));
    (node.outputs ?? []).forEach((io, i) => checkComponentIO(io, `${base}/outputs/${i}`));
  }

  workflow.mainPath.forEach((id, index) => {
    if (nodeIds.has(id)) return;
    diagnostics.push(unknownRef("bundle/unknown-node", `/workflow/mainPath/${index}`, id, "workflow.nodes[].id 중 하나를 쓴다"));
  });

  const sequenceById = new Map(bundle.sequences.map((sequence) => [sequence.id, sequence] as const));
  const edgeIds = new Set<string>();
  /** edge.id → edge.sequenceRef. §3.4 1엣지-1시퀀스 역참조 일관성 검사에 쓴다. */
  const edgeSequenceRefs = new Map<string, string>();
  for (const [index, edge] of workflow.edges.entries()) {
    const base = `/workflow/edges/${index} (id: "${edge.id}")`;
    if (edgeIds.has(edge.id)) diagnostics.push(duplicateId(base, edge.id));
    edgeIds.add(edge.id);

    for (const [field, value] of [["from", edge.from], ["to", edge.to]] as const) {
      if (nodeIds.has(value)) continue;
      diagnostics.push(unknownRef("bundle/unknown-node", `${base}/${field}`, value, "workflow.nodes[].id 중 하나를 쓴다"));
    }

    checkEvidenceRefs(edge.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(edge.evidenceRefs, base, "bundle/edge-ungrounded");

    if (edge.sequenceRef) {
      edgeSequenceRefs.set(edge.id, edge.sequenceRef);
      if (!sequenceById.has(edge.sequenceRef)) {
        diagnostics.push(
          unknownRef("bundle/unknown-sequence", `${base}/sequenceRef`, edge.sequenceRef, "sequences[].id 중 하나를 쓴다"),
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sequences
  // ---------------------------------------------------------------------------
  const sequenceIds = new Set<string>();
  for (const [index, sequence] of bundle.sequences.entries()) {
    const base = `/sequences/${index} (id: "${sequence.id}")`;
    if (sequenceIds.has(sequence.id)) diagnostics.push(duplicateId(base, sequence.id));
    sequenceIds.add(sequence.id);

    if (!edgeIds.has(sequence.triggeredByEdgeId)) {
      diagnostics.push(
        unknownRef(
          "bundle/unknown-edge",
          `${base}/triggeredByEdgeId`,
          sequence.triggeredByEdgeId,
          "workflow.edges[].id 중 하나를 쓴다",
        ),
      );
    } else {
      const edgeRef = edgeSequenceRefs.get(sequence.triggeredByEdgeId);
      if (edgeRef !== sequence.id) {
        diagnostics.push(
          diagnostic(
            "bundle/sequence-edge-mismatch",
            "error",
            `${base}/triggeredByEdgeId 가 가리키는 edge "${sequence.triggeredByEdgeId}" 의 sequenceRef 는 ` +
              `${edgeRef ? `"${edgeRef}"` : "없음"}입니다 — 서로 맞아야 합니다 (1엣지-1시퀀스, schema3 §3.4).`,
            {
              subject: { path: `${base}/triggeredByEdgeId` },
              supportedFixes: [`workflow.edges[].sequenceRef 를 "${sequence.id}" 로 맞추거나 triggeredByEdgeId 를 고친다`],
            },
          ),
        );
      }
    }

    const participantIds = new Set<string>();
    for (const [pIndex, participant] of sequence.participants.entries()) {
      const pBase = `${base}/participants/${pIndex} (id: "${participant.id}")`;
      if (participantIds.has(participant.id)) diagnostics.push(duplicateId(pBase, participant.id));
      participantIds.add(participant.id);
      checkConceptRefs(participant.conceptRefs ?? [], `${pBase}/conceptRefs`);
    }

    const messageIds = new Set<string>();
    for (const [mIndex, message] of sequence.messages.entries()) {
      const mBase = `${base}/messages/${mIndex} (id: "${message.id}")`;
      if (messageIds.has(message.id)) diagnostics.push(duplicateId(mBase, message.id));
      messageIds.add(message.id);
      for (const [field, value] of [
        ["fromParticipantId", message.fromParticipantId],
        ["toParticipantId", message.toParticipantId],
      ] as const) {
        if (participantIds.has(value)) continue;
        diagnostics.push(
          unknownRef("bundle/unknown-participant", `${mBase}/${field}`, value, "participants[].id 중 하나를 쓴다"),
        );
      }
      checkEvidenceRefs(message.evidenceRefs, `${mBase}/evidenceRefs`);
      requireGrounded(message.evidenceRefs, mBase, "bundle/message-ungrounded");
    }

    for (const [aIndex, activation] of (sequence.activations ?? []).entries()) {
      const aBase = `${base}/activations/${aIndex}`;
      checkEvidenceRefs(activation.evidenceRefs, `${aBase}/evidenceRefs`);
      if (!participantIds.has(activation.participantId)) {
        diagnostics.push(
          unknownRef("bundle/unknown-participant", `${aBase}/participantId`, activation.participantId, "participants[].id 중 하나를 쓴다"),
        );
      }
    }

    const phaseIds = new Set<string>();
    for (const [phIndex, phase] of (sequence.phases ?? []).entries()) {
      const phBase = `${base}/phases/${phIndex} (id: "${phase.id}")`;
      if (phaseIds.has(phase.id)) diagnostics.push(duplicateId(phBase, phase.id));
      phaseIds.add(phase.id);
      checkEvidenceRefs(phase.evidenceRefs, `${phBase}/evidenceRefs`);
    }

    checkEvidenceRefs(sequence.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(sequence.evidenceRefs, base, "bundle/sequence-ungrounded");
  }

  if (hasError(diagnostics)) return { diagnostics };
  return { diagnostics, bundle };
}

function duplicateId(base: string, id: string): Diagnostic {
  return diagnostic("bundle/duplicate-id", "error", `${base} 의 id가 다른 항목과 겹칩니다.`, {
    subject: { path: base, id },
    supportedFixes: ["고유한 id를 쓴다"],
  });
}

function unknownRef(code: string, path: string, value: string, fix: string): Diagnostic {
  return diagnostic(code, "error", `${path} 가 실재하지 않는 "${value}" 를 가리킵니다.`, {
    subject: { path, ref: value },
    supportedFixes: [fix],
  });
}
