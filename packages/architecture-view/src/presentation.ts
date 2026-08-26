import type {
  ArchitectureAudience,
  ArchitectureViewBoundary,
  ArchitectureViewComponent,
  ArchitectureViewConnection,
  ArchitectureViewDocument,
  AudiencePresentation,
} from "@vibee/protocol";

type Presentable = { label: string; sublabel?: string; presentation?: AudiencePresentation };

function resolveLabel(entity: { label: string; presentation?: AudiencePresentation }, audience: ArchitectureAudience): string {
  return entity.presentation?.[audience]?.label ?? entity.label;
}

/** Connections have an optional canonical `label`, so their override can add one that never existed. */
function resolveOptionalLabel(
  entity: { label?: string; presentation?: AudiencePresentation },
  audience: ArchitectureAudience,
): string | undefined {
  return entity.presentation?.[audience]?.label ?? entity.label;
}

/**
 * `sublabel: null` in an override means "explicitly clear the canonical
 * sublabel for this audience" (distinct from an override simply not being
 * present, which falls back to the canonical value).
 */
function resolveSublabel(entity: Presentable, audience: ArchitectureAudience): string | undefined {
  const override = entity.presentation?.[audience]?.sublabel;
  if (override === null) return undefined;
  if (override !== undefined) return override;
  return entity.sublabel;
}

/** Default visibility is "show" -- omitting `presentation` entirely must not hide anything. */
export function resolveVisibility(
  entity: { presentation?: AudiencePresentation },
  audience: ArchitectureAudience,
): "show" | "hide" {
  return entity.presentation?.[audience]?.visibility ?? "show";
}

/**
 * Pure projection of canonical `label`/`sublabel` onto one audience profile.
 * Per docs/v2_plan.md §11.3/§14.1, this NEVER touches `id`/`pos`/`size`/
 * `wraps`/`from`/`to`/`semanticRole`/`semanticRefs` -- only the human-facing
 * label text changes. `presentation` itself is left on the returned entities
 * unchanged (rather than stripped) so callers like the renderer can still
 * call `resolveVisibility` against the same data.
 *
 * This does NOT remove hidden elements from `components`/`boundaries`/
 * `connections` -- geometry/routing elsewhere must keep seeing the full
 * canonical graph so shared layout never shifts between audiences. Hiding is
 * a rendering-time decision; see `resolveVisibility` and render.ts.
 */
export function applyAudiencePresentation(
  document: ArchitectureViewDocument,
  audience: ArchitectureAudience,
): ArchitectureViewDocument {
  // `sublabel`/connection `label` are optional under `exactOptionalPropertyTypes`,
  // so an unresolved value must be omitted from the object rather than set to
  // `undefined` -- hence dropping the canonical key first and only adding it
  // back when there is a value.
  const components: ArchitectureViewComponent[] = document.components.map((c) => {
    const { sublabel: _canonicalSublabel, ...rest } = c;
    const label = resolveLabel(c, audience);
    const sublabel = resolveSublabel(c, audience);
    return sublabel !== undefined ? { ...rest, label, sublabel } : { ...rest, label };
  });
  const boundaries: ArchitectureViewBoundary[] = document.boundaries.map((b) => ({
    ...b,
    label: resolveLabel(b, audience),
  }));
  const connections: ArchitectureViewConnection[] = document.connections.map((conn) => {
    const { label: _canonicalLabel, ...rest } = conn;
    const label = resolveOptionalLabel(conn, audience);
    return label !== undefined ? { ...rest, label } : rest;
  });

  return { ...document, components, boundaries, connections };
}
