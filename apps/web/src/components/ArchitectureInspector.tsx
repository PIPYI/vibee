import type { ArchitectureAudience, ArchitectureViewDocument, AudiencePresentation } from "@vibee/protocol";

// The kind of SVG node the user clicked, per the `data-component-id` /
// `data-boundary-id` / `data-connection-id` attributes render.ts embeds.
export type SelectedArchitectureEntity = {
  kind: "component" | "boundary" | "connection";
  id: string;
  semanticRefs: string[];
};

type Props = {
  audience: ArchitectureAudience;
  document: ArchitectureViewDocument;
  entity: SelectedArchitectureEntity;
  onViewTechnical: () => void;
};

// Deliberately not imported from @vibee/architecture-view (that package
// pulls in node:fs at module load, see task constraints) -- this mirrors
// the few lines of projection logic in packages/architecture-view/src/
// presentation.ts's resolveLabel/resolveSublabel.
function resolveLabel(entity: { label: string; presentation?: AudiencePresentation }, audience: ArchitectureAudience): string {
  return entity.presentation?.[audience]?.label ?? entity.label;
}

function resolveSublabel(
  entity: { sublabel?: string; presentation?: AudiencePresentation },
  audience: ArchitectureAudience,
): string | undefined {
  const override = entity.presentation?.[audience]?.sublabel;
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

// docs/v2_plan.md 14.7: shown when a component/boundary/connection is
// clicked. Reads straight from the canonical document rather than the
// mounted SVG, so it keeps working even when the selected entity is
// `visibility: "hide"` in the current audience (14.6: inspector selection
// survives even when canvas selection can't be shown).
export function ArchitectureInspector({ audience, document: doc, entity, onViewTechnical }: Props) {
  if (entity.kind === "component") {
    const component = doc.components.find((c) => c.id === entity.id);
    if (!component) return null;

    if (audience === "simple") {
      const label = resolveLabel(component, "simple");
      const sublabel = resolveSublabel(component, "simple");
      return (
        <div className="architecture-inspector">
          <h2>{label}</h2>
          {sublabel && (
            <>
              <h3>역할</h3>
              <p>{sublabel}</p>
            </>
          )}
          <button type="button" onClick={onViewTechnical}>
            기술 구조에서 보기
          </button>
        </div>
      );
    }

    const technicalSublabel = resolveSublabel(component, "technical");
    return (
      <div className="architecture-inspector">
        <h2>{component.label}</h2>
        <p className="inspector-role">{ROLE_LABELS[component.semanticRole] ?? component.semanticRole}</p>
        {technicalSublabel && (
          <>
            <h3>Implementation</h3>
            <p>{technicalSublabel}</p>
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

    if (audience === "simple") {
      return (
        <div className="architecture-inspector">
          <h2>{resolveLabel(boundary, "simple")}</h2>
          <button type="button" onClick={onViewTechnical}>
            기술 구조에서 보기
          </button>
        </div>
      );
    }

    return (
      <div className="architecture-inspector">
        <h2>{boundary.label}</h2>
        <p className="inspector-role">{boundary.kind}</p>
      </div>
    );
  }

  const connection = doc.connections.find((c) => c.id === entity.id);
  if (!connection) return null;

  if (audience === "simple") {
    const label = connection.presentation?.simple?.label ?? connection.label ?? `${connection.from} → ${connection.to}`;
    return (
      <div className="architecture-inspector">
        <h2>{label}</h2>
        <button type="button" onClick={onViewTechnical}>
          기술 구조에서 보기
        </button>
      </div>
    );
  }

  return (
    <div className="architecture-inspector">
      <h2>{connection.label ?? `${connection.from} → ${connection.to}`}</h2>
      <p className="inspector-role">
        {connection.from} → {connection.to}
      </p>
    </div>
  );
}
