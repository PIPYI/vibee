import type { ArchitectureViewDocument, ArchitectureViewSource, RuntimeSemanticDocument } from "@vibee/protocol";

function sourceKey(source: ArchitectureViewSource): string {
  return `${source.path}:${source.line ?? ""}:${source.endLine ?? ""}:${source.label ?? ""}`;
}

/** Copies canonical Stage 1 evidence onto visual components before persistence. */
export function inheritSemanticSources(
  document: ArchitectureViewDocument,
  semanticDocument: RuntimeSemanticDocument,
): ArchitectureViewDocument {
  const entitiesByRole = {
    actor: semanticDocument.actors,
    responsibility: semanticDocument.responsibilities,
    state: semanticDocument.states,
    external: semanticDocument.externals,
  } as const;

  return {
    ...document,
    components: document.components.map((component) => {
      const inherited = component.semanticRefs.flatMap(
        (ref) => entitiesByRole[component.semanticRole].find((entity) => entity.id === ref)?.sources ?? [],
      );
      const sources = new Map<string, ArchitectureViewSource>();
      for (const source of [...(component.sources ?? []), ...inherited]) sources.set(sourceKey(source), source);
      return sources.size > 0 ? { ...component, sources: [...sources.values()].slice(0, 3) } : component;
    }),
  };
}
