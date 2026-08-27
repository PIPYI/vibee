import type { ArchitectureViewDocument } from "@vibee/protocol";

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

// docs/v2_plan.md 14.7: shown when a component/boundary/connection is
// clicked. Reads straight from the canonical document rather than the
// mounted SVG, so it keeps working even when the selected entity is
// not currently visible.
export function ArchitectureInspector({ document: doc, entity }: Props) {
  if (entity.kind === "component") {
    const component = doc.components.find((c) => c.id === entity.id);
    if (!component) return null;

    return (
      <div className="architecture-inspector">
        <h2>{component.label}</h2>
        <p className="inspector-role">{ROLE_LABELS[component.semanticRole] ?? component.semanticRole}</p>
        {component.sublabel && (
          <>
            <h3>Implementation</h3>
            <p>{component.sublabel}</p>
          </>
        )}
        {component.sources && component.sources.length > 0 && (
          <>
            <h3>Sources</h3>
            <ul className="inspector-sources">
              {component.sources.map((source, i) => (
                <li key={i}>
                  <code>{formatSource(source)}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (entity.kind === "boundary") {
    const boundary = doc.boundaries.find((b) => b.id === entity.id);
    if (!boundary) return null;

    return (
      <div className="architecture-inspector">
        <h2>{boundary.label}</h2>
        <p className="inspector-role">{boundary.kind}</p>
      </div>
    );
  }

  const connection = doc.connections.find((c) => c.id === entity.id);
  if (!connection) return null;

  return (
    <div className="architecture-inspector">
      <h2>{connection.label ?? `${connection.from} → ${connection.to}`}</h2>
      <p className="inspector-role">
        {connection.from} → {connection.to}
      </p>
    </div>
  );
}
