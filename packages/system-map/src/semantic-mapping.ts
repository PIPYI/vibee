import type {
  SystemMapSemanticRole,
  SystemMapDocument,
  Diagnostic,
  RuntimeSemanticDocument,
} from "@vci/protocol";

function idsForRole(semanticDoc: RuntimeSemanticDocument, role: SystemMapSemanticRole): Set<string> {
  switch (role) {
    case "actor":
      return new Set(semanticDoc.actors.map((a) => a.id));
    case "responsibility":
      return new Set(semanticDoc.responsibilities.map((r) => r.id));
    case "state":
      return new Set(semanticDoc.states.map((s) => s.id));
    case "external":
      return new Set(semanticDoc.externals.map((e) => e.id));
  }
}

/**
 * ArchitectureView-level checks that a canonical document's `semanticRole`/
 * `semanticRefs` actually trace back into a committed RuntimeSemanticDocument
 * (docs/v2_plan.md §10.1). Schema/geometry validation alone can't catch this
 * -- it needs both documents at once -- so it's a separate function that
 * `validator.ts` runs only when a semantic document is supplied.
 */
export function checkSemanticMapping(
  doc: SystemMapDocument,
  semanticDoc: RuntimeSemanticDocument,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const runtimeBoundaryIds = new Set(
    doc.boundaries.filter((b) => b.kind === "runtime").flatMap((b) => b.wraps),
  );

  for (const component of doc.components) {
    const validIds = idsForRole(semanticDoc, component.semanticRole);
    for (const ref of component.semanticRefs) {
      if (!validIds.has(ref)) {
        diagnostics.push({
          code: "UNKNOWN_SEMANTIC_REF",
          severity: "error",
          message: `Component "${component.id}" (semanticRole=${component.semanticRole}) references unknown semantic id "${ref}".`,
          subject: component.id,
          evidence: { semanticRole: component.semanticRole, ref },
          supportedFixes: [
            `fix "${component.id}".semanticRefs to reference an existing ${component.semanticRole} id in the semantic document`,
          ],
        });
      }
    }

    if (component.semanticRole === "actor" && runtimeBoundaryIds.has(component.id)) {
      diagnostics.push({
        code: "ACTOR_WRAPPED_BY_RUNTIME",
        severity: "error",
        message: `Component "${component.id}" is an actor but is wrapped by a runtime boundary; actors must be placed outside runtime boundaries.`,
        subject: component.id,
        supportedFixes: [`move "${component.id}" out of every kind="runtime" boundary's wraps[]`],
      });
    }
  }

  const runtimeIds = new Set(semanticDoc.runtimes.map((r) => r.id));
  for (const boundary of doc.boundaries) {
    if (boundary.kind !== "runtime") continue;
    const refs = boundary.semanticRefs ?? [];
    if (refs.length === 0 || !refs.every((ref) => runtimeIds.has(ref))) {
      diagnostics.push({
        code: "UNKNOWN_SEMANTIC_REF",
        severity: "error",
        message: `Runtime boundary "${boundary.label}" must have semanticRefs pointing at a real runtime id.`,
        subject: boundary.id ?? boundary.label,
        evidence: { semanticRefs: refs },
        supportedFixes: [`set "${boundary.label}".semanticRefs to the id of the runtime it represents`],
      });
    }
  }

  const interactionIds = new Set(semanticDoc.interactions.map((i) => i.id));
  doc.connections.forEach((conn, i) => {
    if (!conn.semanticRefs) return;
    const edgeKey = conn.id ?? `connection-${i}`;
    for (const ref of conn.semanticRefs) {
      if (!interactionIds.has(ref)) {
        diagnostics.push({
          code: "UNKNOWN_SEMANTIC_REF",
          severity: "error",
          message: `Connection "${edgeKey}" references unknown interaction id "${ref}".`,
          subject: edgeKey,
          evidence: { ref },
          supportedFixes: [`fix "${edgeKey}".semanticRefs to reference an existing interaction id`],
        });
      }
    }
  });

  return diagnostics;
}
