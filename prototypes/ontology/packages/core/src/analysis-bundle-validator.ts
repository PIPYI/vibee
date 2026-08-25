/**
 * `submit_analysis_bundle`의 Validator (V4 Phase 3, I18~I20-v4).
 *
 * `view-validator.ts`와 같은 층위 — schema(ajv) → 참조 무결성 → 구조 검증 순서로 진행하고,
 * 실패는 전부 `Diagnostic[]`로 돌아온다(A3). `AnalysisBundle`은 `SemanticStore`에 커밋되는
 * 대상이므로(schema3 §5.4) 여기를 통과한 것만 generation에 실린다.
 *
 * **traceLinkRefs의 해석** (schema3 §3.2에 명문화됨) — 골격 엣지 자체에는 별도 id가 없다
 * (`TraceLink`는 `(fromId, toId, kind)`로만 식별된다, `trace.ts`). 그래서 그 엣지를 뒷받침하는
 * **link-role Evidence.id**를 안정적인 참조 대상으로 쓴다.
 *
 * **I20은 `ArchitectureConnection`에만 적용된다** (schema3 §3.3, §5.5에 명문화됨) —
 * `WorkflowEdge`에는 애초에 `traceLinkRefs` 필드가 없다. 하나의 워크플로우 전이가 여러 골격
 * hop을 압축할 수 있기 때문이다. `WorkflowEdge`는 자신의 `evidenceRefs`가 present Evidence를
 * 가리키고 비어 있지 않은지로만 검사한다.
 *
 * **SequenceIR의 activation/phase가 재사용하는 `fromStepId`/`toStepId`** — `ScenarioIR`에서는
 * `ScenarioStep.id`를 가리키지만, `SequenceIR`에는 `steps[]`가 없다(`messages[]`가 유일한
 * 순서 있는 단위다). 그래서 여기서는 **`SequenceMessage.id`**를 가리키는 것으로 해석해
 * 참조 무결성을 검사한다 — schema3 문서가 필드명 재사용만 말하고 대상을 규정하지 않은
 * 지점이라 여기서 확정했다.
 */
import type {
  AnalysisBundle,
  ArchitectureIR,
  Diagnostic,
  EvidenceIndex,
  RepositoryTopology,
  SemanticMemory,
  SystemFactStore,
  UserMapIR,
  WorkflowIR,
} from "@onto/protocol";

import { diagnostic, hasError, validateAgainst } from "./schema.js";
import { buildExternalIntegrationCatalog } from "./discovery.js";
import { assessRepositoryCoverage, detectRepositoryTopology } from "./repository-topology.js";
import { validateViewIR } from "./view-validator.js";
import { buildEngineSystemFactStore, certaintyRank, systemEntityId } from "./system-facts.js";

export type AnalysisBundleValidateInput = {
  bundle: unknown;
  evidence: EvidenceIndex;
  memory: SemanticMemory;
  /** V4 System Graph. 생략한 레거시 호출은 Evidence에서 engine-confirmed store를 투영한다. */
  systemFacts?: SystemFactStore;
  /** 있으면 manifest/entrypoint/data asset completeness gate도 수행한다. */
  projectPath?: string;
};

export type AnalysisBundleValidateResult = {
  diagnostics: Diagnostic[];
  bundle?: AnalysisBundle;
  repositoryTopology?: RepositoryTopology;
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function validateAnalysisBundle(input: AnalysisBundleValidateInput): AnalysisBundleValidateResult {
  const diagnostics = validateAgainst("analysis-bundle", input.bundle);
  if (hasError(diagnostics)) return { diagnostics };
  // migration이 호출자의 draft를 바꾸지 않도록 복제한다.
  const bundle = structuredClone(input.bundle as AnalysisBundle);

  // 레거시 generation/test가 빈 store를 넘겨도 현재 engine Evidence를 즉시 투영하고,
  // 기존 Vibee fact는 buildEngineSystemFactStore의 carry 규칙으로 함께 보존한다.
  const systemFacts = buildEngineSystemFactStore(input.evidence, input.systemFacts);
  const presentEvidence = new Map(
    input.evidence.evidence.filter((item) => item.status === "present").map((item) => [item.id, item] as const),
  );
  const allEvidenceIds = new Set(input.evidence.evidence.map((item) => item.id));
  const systemEntityIds = new Set(systemFacts.entities.map((item) => item.id));
  const systemEntitiesById = new Map(systemFacts.entities.map((item) => [item.id, item] as const));
  const systemLinksById = new Map(systemFacts.links.map((item) => [item.id, item] as const));
  const systemLinksByEvidence = new Map<string, string[]>();
  for (const link of systemFacts.links) {
    for (const evidenceId of link.evidenceRefs) {
      const ids = systemLinksByEvidence.get(evidenceId) ?? [];
      ids.push(link.id);
      systemLinksByEvidence.set(evidenceId, ids);
    }
  }
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
      if (systemEntityIds.has(ref)) return;
      diagnostics.push(
        diagnostic(
          "bundle/unknown-entity",
          "error",
          `${base}/${index} 가 현재 System Fact Store에 없는 entity "${ref}" 를 가리킵니다.`,
          {
            subject: { path: `${base}/${index}` },
            supportedFixes: ["GET /api/system-facts 또는 get_evidence로 실재하는 System Entity를 확인한다"],
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
    // V5 A4 — entityRefs가 가리키는 System Entity 중 가장 약한 certainty를 그대로 기록한다.
    // LLM이 certainty를 보냈어도 Core가 실제 System Fact 기준으로 덮어쓴다(장식적 필드가
    // 아니라 Core가 계산하는 값이다).
    const componentEntities = component.entityRefs.map((ref) => systemEntitiesById.get(ref)).filter((item): item is NonNullable<typeof item> => item !== undefined);
    if (componentEntities.length > 0) {
      component.certainty = componentEntities.reduce(
        (worst, entity) => (certaintyRank(entity.certainty) < certaintyRank(worst) ? entity.certainty : worst),
        componentEntities[0]!.certainty,
      );
    }
    checkEvidenceRefs(component.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(component.evidenceRefs, base, "bundle/component-ungrounded");
    checkConceptRefs(component.conceptRefs ?? [], `${base}/conceptRefs`);
    (component.inputs ?? []).forEach((io, i) => checkComponentIO(io, `${base}/inputs/${i}`));
    (component.outputs ?? []).forEach((io, i) => checkComponentIO(io, `${base}/outputs/${i}`));
    if (input.projectPath && !component.layer) {
      diagnostics.push(
        diagnostic("bundle/component-layer-missing", "warning", `${base}/layer 가 없어 레이아웃이 추론에 의존합니다.`, {
          subject: { path: `${base}/layer` },
          supportedFixes: ["actor/interface/service/state/data/external 중 하나를 지정한다"],
        }),
      );
    }
  }

  if (!architecture.viewPlan) {
    if (input.projectPath) {
      diagnostics.push(
        diagnostic("bundle/view-plan-missing", "warning", "/architecture/viewPlan 이 없어 전체 지도의 읽는 순서와 그룹이 불명확합니다.", {
          subject: { path: "/architecture/viewPlan" },
          supportedFixes: ["primaryPath와 groups를 작성한다"],
        }),
      );
    }
  } else {
    architecture.viewPlan.primaryPath.forEach((id, index) => {
      if (!componentIds.has(id)) {
        diagnostics.push(unknownRef("bundle/unknown-component", `/architecture/viewPlan/primaryPath/${index}`, id, "architecture.components[].id 중 하나를 쓴다"));
      }
    });
    const grouped = new Set<string>();
    for (const [index, group] of architecture.viewPlan.groups.entries()) {
      for (const [memberIndex, id] of group.componentIds.entries()) {
        if (!componentIds.has(id)) {
          diagnostics.push(unknownRef("bundle/unknown-component", `/architecture/viewPlan/groups/${index}/componentIds/${memberIndex}`, id, "architecture.components[].id 중 하나를 쓴다"));
        } else if (grouped.has(id)) {
          diagnostics.push(
            diagnostic("bundle/component-in-multiple-view-groups", "error", `component "${id}"가 둘 이상의 viewPlan group에 들어 있습니다.`, {
              subject: { path: `/architecture/viewPlan/groups/${index}/componentIds/${memberIndex}`, id },
              supportedFixes: ["component를 하나의 group에만 둔다"],
            }),
          );
        }
        grouped.add(id);
      }
    }
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

    if (input.projectPath && !connection.role) {
      diagnostics.push(
        diagnostic("bundle/connection-role-missing", "warning", `${base}/role 이 없어 선의 의미를 구분할 수 없습니다.`, {
          subject: { path: `${base}/role` },
          supportedFixes: ["sync/async/data/control 중 하나를 지정한다"],
        }),
      );
    }

    for (const [field, value] of [["from", connection.from], ["to", connection.to]] as const) {
      if (componentIds.has(value)) continue;
      diagnostics.push(unknownRef("bundle/unknown-component", `${base}/${field}`, value, "architecture.components[].id 중 하나를 쓴다"));
    }

    checkEvidenceRefs(connection.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(connection.evidenceRefs, base, "bundle/connection-ungrounded");

    // V3 traceLinkRefs를 같은 evidence를 가진 SystemLink ID로 읽기 migration한다.
    if (connection.systemLinkRefs === undefined && connection.traceLinkRefs !== undefined) {
      connection.systemLinkRefs = uniqueStrings(
        connection.traceLinkRefs.flatMap((evidenceId) => systemLinksByEvidence.get(evidenceId) ?? []),
      );
    }
    const refs = connection.systemLinkRefs ?? [];
    if (refs.length === 0) {
      const legacy = connection.traceLinkRefs !== undefined;
      diagnostics.push(
        diagnostic(
          legacy
            ? "bundle/connection-not-grounded-in-skeleton"
            : "bundle/connection-not-grounded-in-system-graph",
          "error",
          legacy
            ? `${base}/traceLinkRefs가 유효한 Stage 1 link evidence를 가리키지 않습니다 (V3 I20 migration).`
            : `${base}/systemLinkRefs가 비어 있습니다 — 검증된 System Link 없이 연결을 만들 수 없습니다 (I20-v4).`,
          {
            subject: { path: legacy ? `${base}/traceLinkRefs` : `${base}/systemLinkRefs` },
            supportedFixes: [legacy ? "실재하는 link-role Evidence를 쓰거나 V4 systemLinkRefs로 전환한다" : "이 연결이 요약하는 valid/relocated System Link ID를 하나 이상 붙인다"],
          },
        ),
      );
    }
    // V5 A4 — certainty(confirmed/grounded/inferred)와 status(valid/relocated 등)는 서로 다른
    // 축이다. status가 낡았으면(stale/missing/needs_review) 그 Link는 여전히 hard reject한다 —
    // 근거 자체를 신뢰할 수 없기 때문이다. 반면 certainty가 inferred인 것만으로는 더 이상
    // connection을 거부하지 않는다 — "확정(confirmed로 표시)"과 "화면에 나타남"을 분리해,
    // connection.certainty를 "inferred"로 낮춰서 통과시키고 렌더러가 구분해서 보여주게 한다.
    let connectionCertainty: "confirmed" | "grounded" | "inferred" = "confirmed";
    const resolvedLinks = refs.map((ref, i) => {
      const link = systemLinksById.get(ref);
      if (!link) {
        diagnostics.push(
          diagnostic("bundle/unknown-system-link", "error", `${base}/systemLinkRefs/${i}가 없는 System Link "${ref}"를 가리킵니다.`, {
            subject: { path: `${base}/systemLinkRefs/${i}`, systemLinkId: ref }, evidence: { systemLinkId: ref }, supportedFixes: ["현재 generation의 System Link ID를 사용한다"],
          }),
        );
        return undefined;
      }
      if (!(["valid", "relocated"] as const).includes(link.status as "valid" | "relocated")) {
        diagnostics.push(
          diagnostic("bundle/system-link-not-authoritative", "error", `${base}/systemLinkRefs/${i}의 Link는 ${link.status} 상태라 연결에 쓸 수 없습니다.`, {
            subject: { path: `${base}/systemLinkRefs/${i}`, systemLinkId: ref }, evidence: { certainty: link.certainty, status: link.status }, supportedFixes: ["valid|relocated인 Link를 사용한다", "이 관계를 assumptions/unknowns로 분리한다"],
          }),
        );
      } else if (link.certainty === "inferred") {
        connectionCertainty = "inferred";
        diagnostics.push(
          diagnostic("bundle/connection-uses-inferred-link", "warning", `${base}/systemLinkRefs/${i}의 Link는 inferred라 이 연결은 확정이 아니라 추정으로 표시됩니다.`, {
            subject: { path: `${base}/systemLinkRefs/${i}`, systemLinkId: ref }, evidence: { certainty: link.certainty, status: link.status }, supportedFixes: ["connection.certainty가 렌더러에 자동으로 반영된다 — 확정하려면 confirmed|grounded Link로 교체한다"],
          }),
        );
      } else if (link.certainty === "grounded" && connectionCertainty !== "inferred") {
        connectionCertainty = "grounded";
      }
      if (link.evidenceRefs.length === 0 || link.evidenceRefs.some((id) => !presentEvidence.has(id))) {
        diagnostics.push(
          diagnostic("bundle/system-link-evidence-invalid", "error", `${base}/systemLinkRefs/${i}의 Link가 현재 present Evidence로 뒷받침되지 않습니다.`, {
            subject: { path: `${base}/systemLinkRefs/${i}`, systemLinkId: ref }, evidence: { evidenceRefs: link.evidenceRefs }, supportedFixes: ["현재 source anchor로 System Fact를 다시 검증한다"],
          }),
        );
      }
      return link;
    }).filter((item): item is NonNullable<typeof item> => item !== undefined);
    if (resolvedLinks.length > 0) connection.certainty = connectionCertainty;

    for (let i = 1; i < resolvedLinks.length; i += 1) {
      if (systemEntityId(resolvedLinks[i - 1]!.to) === systemEntityId(resolvedLinks[i]!.from)) continue;
      diagnostics.push(
        diagnostic(
          "bundle/system-link-path-discontinuous",
          "error",
          `${base}/systemLinkRefs가 연속된 방향 경로를 이루지 않습니다 (${i - 1} → ${i}).`,
          {
            subject: { path: `${base}/systemLinkRefs/${i}` },
            evidence: { previousTo: systemEntityId(resolvedLinks[i - 1]!.to), nextFrom: systemEntityId(resolvedLinks[i]!.from) },
            supportedFixes: ["from component에서 to component로 이어지는 순서로 Link ID를 배열한다"],
          },
        ),
      );
    }

    if (resolvedLinks.length > 0) {
      const fromComponent = architecture.components.find((item) => item.id === connection.from);
      const toComponent = architecture.components.find((item) => item.id === connection.to);
      const pathStart = systemEntityId(resolvedLinks[0]!.from);
      const pathEnd = systemEntityId(resolvedLinks[resolvedLinks.length - 1]!.to);
      if (fromComponent && !fromComponent.entityRefs.includes(pathStart)) {
        diagnostics.push(
          diagnostic("bundle/system-link-direction-mismatch", "error", `${base}의 System Link 경로 시작점이 from component에 포함되지 않습니다.`, {
            subject: { path: `${base}/from`, componentId: connection.from }, evidence: { pathStart, entityRefs: fromComponent.entityRefs }, supportedFixes: ["connection 방향을 고치거나 올바른 System Link 경로를 사용한다"],
          }),
        );
      }
      if (toComponent && !toComponent.entityRefs.includes(pathEnd)) {
        diagnostics.push(
          diagnostic("bundle/system-link-direction-mismatch", "error", `${base}의 System Link 경로 끝점이 to component에 포함되지 않습니다.`, {
            subject: { path: `${base}/to`, componentId: connection.to }, evidence: { pathEnd, entityRefs: toComponent.entityRefs }, supportedFixes: ["connection 방향을 고치거나 올바른 System Link 경로를 사용한다"],
          }),
        );
      }
    }
  }

  let repositoryTopology: RepositoryTopology | undefined;
  if (input.projectPath) {
    repositoryTopology = assessRepositoryCoverage(detectRepositoryTopology(input.projectPath, input.evidence), architecture);
    const runtimeById = new Map(repositoryTopology.runtimes.map((runtime) => [runtime.id, runtime] as const));
    const storeById = new Map(repositoryTopology.dataStores.map((store) => [store.id, store] as const));
    const routeSurfaceById = new Map(repositoryTopology.routeSurfaces.map((surface) => [surface.id, surface] as const));
    for (const runtimeId of repositoryTopology.coverage.missingRuntimeIds) {
      const runtime = runtimeById.get(runtimeId);
      diagnostics.push(
        diagnostic(
          "bundle/runtime-not-represented",
          "error",
          `탐지된 런타임 "${runtime?.label ?? runtimeId}"의 entrypoint 또는 boundary가 아키텍처에서 빠졌습니다.`,
          {
            subject: { runtimeId, rootPath: runtime?.rootPath ?? "" },
            supportedFixes: ["entrypoint entityRefs를 가진 component를 만들고 이 런타임 전용 boundary에 넣는다"],
          },
        ),
      );
    }
    for (const storeId of repositoryTopology.coverage.missingDataStoreIds) {
      const store = storeById.get(storeId);
      diagnostics.push(
        diagnostic("bundle/data-store-not-represented", "error", `탐지된 로컬 데이터 저장소 "${store?.label ?? storeId}"가 아키텍처에서 빠졌습니다.`, {
          subject: { storeId, rootPath: store?.rootPath ?? "" },
          supportedFixes: ["저장소 파일의 entityRefs/evidenceRefs를 가진 data layer component를 만든다"],
        }),
      );
    }
    for (const surfaceId of repositoryTopology.coverage.missingRouteSurfaceIds) {
      const surface = routeSurfaceById.get(surfaceId);
      diagnostics.push(
        diagnostic(
          "bundle/route-surface-not-represented",
          "error",
          `탐지된 라우트 표면 "${surface?.filePath ?? surfaceId}"(${surface?.routeKeys.join(", ") ?? ""})가 아키텍처에서 빠졌습니다.`,
          {
            subject: { surfaceId, filePath: surface?.filePath ?? "" },
            supportedFixes: ["이 파일의 entityRefs를 가진 component를 만들거나 기존 component의 entityRefs에 포함시킨다"],
          },
        ),
      );
    }
    if (repositoryTopology.coverage.sharedBoundaryRuntimeIds.length > 0) {
      diagnostics.push(
        diagnostic("bundle/runtime-boundary-collapsed", "error", "서로 독립적인 실행 런타임이 하나의 boundary에 합쳐져 있습니다.", {
          subject: { runtimeIds: repositoryTopology.coverage.sharedBoundaryRuntimeIds },
          supportedFixes: ["런타임마다 별도의 boundary를 만든다"],
        }),
      );
    }

    // discovery-gap이면서 실제 호출 흔적(callPaths)까지 있는 후보는 조사 우선순위가 가장 높다.
    // false-positive 비율을 관찰하기 전까지는 warning으로만 알리고 bundle 커밋을 막지 않는다.
    const externalCatalog = buildExternalIntegrationCatalog(input.projectPath, input.evidence, systemFacts);
    const architectureFileRefs = new Set(architecture.components.flatMap((component) => component.entityRefs));
    for (const candidate of externalCatalog) {
      if (candidate.status !== "discovery-gap" || candidate.callPaths.length === 0) continue;
      const represented = [...candidate.importPaths, ...candidate.callPaths].some((path) =>
        architectureFileRefs.has(`file:${path}`),
      );
      if (represented) continue;
      diagnostics.push(
        diagnostic(
          "bundle/external-integration-not-represented",
          "warning",
          `"${candidate.packageName}" import와 실제 사용이 있지만 아키텍처 어느 component에도 나타나지 않습니다.`,
          {
            subject: { packageName: candidate.packageName, callPaths: candidate.callPaths },
            supportedFixes: ["이 패키지를 사용하는 파일의 entityRefs를 가진 component(외부 연동 boundary)를 만든다"],
          },
        ),
      );
    }
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

  // 서로 다른 boundary의 component를 잇는 workflow.edge인데 대응하는 architecture.connection이
  // 없으면 경고한다(V5 C3) — I20-v4가 요구하는 evidence 검증을 우회하지 않도록 hard error가
  // 아니라 warning으로만 알린다. repository-topology.ts의 componentBoundaryIds 패턴을 그대로 쓴다.
  {
    const nodeById = new Map(workflow.nodes.map((node) => [node.id, node] as const));
    const componentsByEntityRef = new Map<string, string[]>();
    for (const component of architecture.components) {
      for (const ref of component.entityRefs) {
        const ids = componentsByEntityRef.get(ref) ?? [];
        ids.push(component.id);
        componentsByEntityRef.set(ref, ids);
      }
    }
    const componentBoundaryIds = new Map<string, Set<string>>();
    for (const component of architecture.components) {
      if (component.boundaryId) componentBoundaryIds.set(component.id, new Set([component.boundaryId]));
    }
    for (const boundary of architecture.boundaries) {
      for (const componentId of boundary.wraps) {
        const ids = componentBoundaryIds.get(componentId) ?? new Set<string>();
        ids.add(boundary.id);
        componentBoundaryIds.set(componentId, ids);
      }
    }
    const connectedComponentPairs = new Set<string>();
    for (const connection of architecture.connections) {
      connectedComponentPairs.add(`${connection.from}::${connection.to}`);
      connectedComponentPairs.add(`${connection.to}::${connection.from}`);
    }
    const componentsForNode = (node: (typeof workflow.nodes)[number]): string[] =>
      [...new Set(node.entityRefs.flatMap((ref) => componentsByEntityRef.get(ref) ?? []))];

    const reportedPairs = new Set<string>();
    for (const edge of workflow.edges) {
      const fromNode = nodeById.get(edge.from);
      const toNode = nodeById.get(edge.to);
      if (!fromNode || !toNode) continue;
      for (const fromComponentId of componentsForNode(fromNode)) {
        for (const toComponentId of componentsForNode(toNode)) {
          if (fromComponentId === toComponentId) continue;
          const fromBoundaries = componentBoundaryIds.get(fromComponentId);
          const toBoundaries = componentBoundaryIds.get(toComponentId);
          if (!fromBoundaries?.size || !toBoundaries?.size) continue;
          if ([...fromBoundaries].some((id) => toBoundaries.has(id))) continue; // 같은 boundary면 대상이 아니다

          const pairKey = `${fromComponentId}::${toComponentId}`;
          const reverseKey = `${toComponentId}::${fromComponentId}`;
          if (connectedComponentPairs.has(pairKey) || connectedComponentPairs.has(reverseKey)) continue;
          if (reportedPairs.has(pairKey) || reportedPairs.has(reverseKey)) continue;
          reportedPairs.add(pairKey);
          diagnostics.push(
            diagnostic(
              "bundle/cross-boundary-edge-not-promoted",
              "warning",
              `workflow.edge "${edge.id}"가 서로 다른 boundary의 component(${fromComponentId} → ${toComponentId})를 ` +
                "잇지만, 대응하는 architecture.connection이 없습니다.",
              {
                subject: { edgeId: edge.id, from: fromComponentId, to: toComponentId },
                supportedFixes: ["두 component 사이의 architecture.connection을 systemLinkRefs와 함께 추가한다"],
              },
            ),
          );
        }
      }
    }
  }

  const workflowEdgePairs = new Set(workflow.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
  workflow.mainPath.slice(0, -1).forEach((from, index) => {
    const to = workflow.mainPath[index + 1]!;
    if (workflowEdgePairs.has(`${from}\u0000${to}`)) return;
    diagnostics.push(
      diagnostic(
        "bundle/disconnected-main-path",
        "error",
        `/workflow/mainPath/${index}의 "${from}" 다음 "${to}"로 이어지는 edge가 없습니다.`,
        {
          subject: { path: `/workflow/mainPath/${index}`, from, to },
          supportedFixes: ["실제 edge가 있는 순서로 mainPath를 고치거나 빠진 edge를 근거와 함께 추가한다"],
        },
      ),
    );
  });

  // ---------------------------------------------------------------------------
  // User map — 서로 다른 Canonical Scenario를 한 그래프에 합치지 않는다.
  // 레거시 bundle에는 없을 수 있어 선택 필드로 두되, 있으면 Scenario validator를 전부 적용한다.
  // ---------------------------------------------------------------------------
  const userMap: UserMapIR | undefined = bundle.userMap;
  if (userMap) {
    const activeScenarioIds = new Set(
      input.memory.canonicalScenarios.filter((scenario) => scenario.status === "active").map((scenario) => scenario.id),
    );
    const journeyIds = new Set<string>();

    userMap.journeys.forEach((journey, index) => {
      const base = `/userMap/journeys/${index} (id: "${journey.id}")`;
      if (journeyIds.has(journey.id)) diagnostics.push(duplicateId(base, journey.id));
      journeyIds.add(journey.id);

      if (!activeScenarioIds.has(journey.id)) {
        diagnostics.push(
          diagnostic(
            "bundle/unknown-user-journey",
            "error",
            `${base} 가 active Canonical Scenario를 가리키지 않습니다.`,
            {
              subject: { path: base, scenarioId: journey.id },
              supportedFixes: ["get_project_semantic_memory의 active canonicalScenarios[].id를 그대로 쓴다"],
            },
          ),
        );
      }

      const result = validateViewIR({ viewKind: "scenario", ir: journey, memory: input.memory, evidence: input.evidence });
      diagnostics.push(
        ...result.diagnostics.map((item) => ({
          ...item,
          message: `${base}: ${item.message}`,
          ...(item.subject
            ? { subject: { ...item.subject, ...(item.subject.path ? { path: `${base}${String(item.subject.path)}` } : {}) } }
            : {}),
        })),
      );
    });

    for (const scenarioId of activeScenarioIds) {
      if (journeyIds.has(scenarioId)) continue;
      diagnostics.push(
        diagnostic(
          "bundle/missing-user-journey",
          "error",
          `active Canonical Scenario "${scenarioId}" 가 userMap.journeys에서 빠졌습니다.`,
          {
            subject: { path: "/userMap/journeys", scenarioId },
            supportedFixes: ["각 active Canonical Scenario마다 별도의 journey를 만든다"],
          },
        ),
      );
    }
  } else if (input.memory.canonicalScenarios.some((scenario) => scenario.status === "active")) {
    diagnostics.push(
      diagnostic(
        "bundle/missing-user-map",
        "error",
        "active Canonical Scenario가 있지만 userMap이 없습니다.",
        {
          subject: { path: "/userMap" },
          supportedFixes: ["active Canonical Scenario마다 독립된 journey를 만들어 userMap에 넣는다"],
        },
      ),
    );
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

    // SequenceIR에는 ScenarioIR의 steps[]가 없다 — activation/phase가 재사용하는
    // ScenarioActivation/ScenarioPhase의 fromStepId/toStepId는 여기서 **SequenceMessage.id**를
    // 가리키는 것으로 해석한다(messages가 SequenceIR의 유일한 순서 있는 단위다). schema3
    // §3.5는 이 필드명 재사용을 명시했지만 SequenceIR 맥락에서의 대상은 규정하지 않았다 —
    // 이 해석을 여기서 확정한다.
    for (const [aIndex, activation] of (sequence.activations ?? []).entries()) {
      const aBase = `${base}/activations/${aIndex}`;
      checkEvidenceRefs(activation.evidenceRefs, `${aBase}/evidenceRefs`);
      if (!participantIds.has(activation.participantId)) {
        diagnostics.push(
          unknownRef("bundle/unknown-participant", `${aBase}/participantId`, activation.participantId, "participants[].id 중 하나를 쓴다"),
        );
      }
      for (const [field, value] of [
        ["fromStepId", activation.fromStepId],
        ["toStepId", activation.toStepId],
      ] as const) {
        if (messageIds.has(value)) continue;
        diagnostics.push(
          unknownRef("bundle/unknown-message", `${aBase}/${field}`, value, "messages[].id 중 하나를 쓴다"),
        );
      }
    }

    const phaseIds = new Set<string>();
    for (const [phIndex, phase] of (sequence.phases ?? []).entries()) {
      const phBase = `${base}/phases/${phIndex} (id: "${phase.id}")`;
      if (phaseIds.has(phase.id)) diagnostics.push(duplicateId(phBase, phase.id));
      phaseIds.add(phase.id);
      checkEvidenceRefs(phase.evidenceRefs, `${phBase}/evidenceRefs`);
      for (const [field, value] of [
        ["fromStepId", phase.fromStepId],
        ["toStepId", phase.toStepId],
      ] as const) {
        if (messageIds.has(value)) continue;
        diagnostics.push(
          unknownRef("bundle/unknown-message", `${phBase}/${field}`, value, "messages[].id 중 하나를 쓴다"),
        );
      }
    }

    checkEvidenceRefs(sequence.evidenceRefs, `${base}/evidenceRefs`);
    requireGrounded(sequence.evidenceRefs, base, "bundle/sequence-ungrounded");
  }

  if (hasError(diagnostics)) return { diagnostics, ...(repositoryTopology ? { repositoryTopology } : {}) };
  return { diagnostics, bundle, ...(repositoryTopology ? { repositoryTopology } : {}) };
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
