import type {
  ArchitectureViewDocument,
  ArchitectureViewSource,
  AudiencePresentation,
} from "@vibee/protocol";

// The kind of SVG node the user clicked, per the `data-component-id` /
// `data-boundary-id` / `data-connection-id` attributes render.ts embeds.
export type SelectedArchitectureEntity = {
  kind: "component" | "boundary" | "connection";
  id: string;
  semanticRefs: string[];
};

type Props = {
  document: ArchitectureViewDocument;
  entity: SelectedArchitectureEntity;
};

// Deliberately not imported from @vibee/architecture-view (that package
// pulls in node:fs at module load, see task constraints) -- this mirrors
// the few lines of projection logic in packages/architecture-view/src/
// presentation.ts's simple-view label projection.
function resolveSimpleLabel(entity: { label: string; presentation?: AudiencePresentation }): string {
  return entity.presentation?.simple?.label ?? entity.label;
}

function resolveSimpleSublabel(entity: { sublabel?: string; presentation?: AudiencePresentation }): string | undefined {
  const override = entity.presentation?.simple?.sublabel;
  if (override === null) return undefined;
  if (override !== undefined) return override;
  return entity.sublabel;
}

const ROLE_LABELS: Record<string, string> = {
  actor: "행위자",
  responsibility: "책임",
  state: "상태",
  external: "외부 의존성",
};

function formatSource(source: { path: string; line?: number; endLine?: number }): string {
  if (source.line === undefined) return source.path;
  if (source.endLine === undefined || source.endLine === source.line) return `${source.path}:${source.line}`;
  return `${source.path}:${source.line}-${source.endLine}`;
}

function Sources({ sources }: { sources: ArchitectureViewSource[] | undefined }) {
  if (!sources || sources.length === 0) return null;
  return (
    <>
      <h3>Sources</h3>
      <ul className="inspector-sources">
        {sources.map((source, i) => (
          <li key={i}>
            <code>{formatSource(source)}</code>
          </li>
        ))}
      </ul>
    </>
  );
}

// docs/v2_plan.md 14.7: shown when a component/boundary/connection is
// clicked. Reads straight from the canonical document rather than the
// mounted SVG, and merges source/endpoint details into the simple view.
export function ArchitectureInspector({ document: doc, entity }: Props) {
  if (entity.kind === "component") {
    const component = doc.components.find((c) => c.id === entity.id);
    if (!component) return null;

    const label = resolveSimpleLabel(component);
    const sublabel = resolveSimpleSublabel(component);
    return (
      <div className="architecture-inspector">
        <h2>{label}</h2>
        <p className="inspector-role">{ROLE_LABELS[component.semanticRole] ?? component.semanticRole}</p>
        {sublabel && (
          <>
            <h3>역할</h3>
            <p>{sublabel}</p>
          </>
        )}
        <Sources sources={component.sources} />
      </div>
    );
  }

  if (entity.kind === "boundary") {
    const boundary = doc.boundaries.find((b) => b.id === entity.id);
    if (!boundary) return null;

    return (
      <div className="architecture-inspector">
        <h2>{resolveSimpleLabel(boundary)}</h2>
        <p className="inspector-role">{boundary.kind}</p>
      </div>
    );
  }

  const connection = doc.connections.find((c) => c.id === entity.id);
  if (!connection) return null;

  const label = connection.presentation?.simple?.label ?? connection.label ?? `${connection.from} → ${connection.to}`;
  return (
    <div className="architecture-inspector">
      <h2>{label}</h2>
      <p className="inspector-role">
        {connection.from} → {connection.to}
      </p>
    </div>
  );
}
