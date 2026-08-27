import type {
  ArchitectureViewComponent,
  ArchitectureViewComponentType,
  ArchitectureViewDocument,
} from "@vibee/protocol";
import {
  DEFAULT_ARCHITECTURE_VIEW_BOX,
  ROUNDED_CORNER_RADIUS,
  calculateArchitectureLayout,
  labelDisplayWidth,
  LABEL_TEXT_BASELINE,
  MAX_CONNECTION_LABEL_WIDTH,
  roundedPath,
  truncateLabelForDisplay,
  type Rect,
  type Route,
} from "./geometry.js";

export type RenderOptions = {
  /** When set, matching components/boundaries/connections get an `av-selected` class hook. */
  selectedSemanticRef?: string;
};

type TypeMeta = { sigil: string; name: string; nameKo: string };

const TYPE_META: Record<ArchitectureViewComponentType, TypeMeta> = {
  frontend: { sigil: "FE", name: "Frontend", nameKo: "프론트엔드" },
  backend: { sigil: "BE", name: "Backend", nameKo: "백엔드" },
  database: { sigil: "DB", name: "Database", nameKo: "데이터베이스" },
  cloud: { sigil: "CL", name: "Cloud", nameKo: "클라우드" },
  security: { sigil: "SEC", name: "Security", nameKo: "보안" },
  messagebus: { sigil: "MQ", name: "Message bus", nameKo: "메시지 버스" },
  external: { sigil: "EX", name: "External", nameKo: "외부" },
};

const VARIANTS = ["default", "emphasis", "security", "dashed"] as const;
type Variant = (typeof VARIANTS)[number];

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeAttr(text: string): string {
  return escapeXml(text);
}

/**
 * Renders a full ArchitectureView document to a single, self-contained SVG
 * string. Layout is computed exactly once via `calculateArchitectureLayout`
 * -- this function never recomputes routing/ports/labels on its own, so it
 * cannot disagree with `checkGeometry`'s notion of the same document's
 * geometry.
 *
 * Every component/boundary/connection renders its own canonical
 * `label`/`sublabel` directly -- there is no per-audience projection or
 * visibility toggle (see docs/v4_plan.md §4.1); everything in the document
 * always renders.
 *
 * Draw order (fixed, load-bearing):
 *   1. <style> (CSS custom properties + light-mode palette + semantic classes)
 *   2. one <defs> with exactly 4 markers (default/emphasis/security/dashed)
 *   3. boundary frames
 *   4. connection paths
 *   5. components
 *   6. connection labels (kept above paths, arrowheads, and components)
 *   7. legend (only types actually present)
 *   8. title text
 */
export function renderArchitectureViewSvg(doc: ArchitectureViewDocument, options?: RenderOptions): string {
  const selectedSemanticRef = options?.selectedSemanticRef;

  const [vbW, vbH] = doc.viewBox ?? DEFAULT_ARCHITECTURE_VIEW_BOX;
  const layout = calculateArchitectureLayout(doc);
  const { componentRects, routes, labelRects } = layout;

  const usedTypes = [...new Set(doc.components.map((c) => c.type))];

  const style = renderStyle(usedTypes);
  const defs = renderDefs();
  const runtimeBoundaryNumbers = computeRuntimeBoundaryNumbers(doc.boundaries);
  const boundaries = doc.boundaries
    .map((b, i) => renderBoundary(b, componentRects, selectedSemanticRef, runtimeBoundaryNumbers.get(i)))
    .join("\n");
  const renderedConnections = doc.connections.map((conn, i) =>
    renderConnection(conn, i, routes, labelRects, selectedSemanticRef),
  );
  const connectionPaths = renderedConnections.map((connection) => connection.path).join("\n");
  const connectionLabels = renderedConnections.map((connection) => connection.label).filter(Boolean).join("\n");
  const components = doc.components
    .map((c) => renderComponent(c, componentRects.get(c.id)!, selectedSemanticRef))
    .join("\n");
  const legend = renderLegend(usedTypes, vbW, vbH);
  const title = `<text class="av-title" x="24" y="34">${escapeXml(doc.title)}</text>`;

  return [
    `<svg class="av-root" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" width="100%" height="100%">`,
    style,
    defs,
    `<g class="av-boundaries">${boundaries}</g>`,
    `<g class="av-connections">${connectionPaths}</g>`,
    `<g class="av-components">${components}</g>`,
    `<g class="av-connection-labels">${connectionLabels}</g>`,
    legend,
    title,
    `</svg>`,
  ].join("\n");
}

function renderStyle(usedTypes: ArchitectureViewComponentType[]): string {
  const typeVars = usedTypes.map((t) => `--av-accent-${t}: ${accentColor(t)};`).join(" ");

  return `<style>
svg.av-root {
  --av-bg: #f8fafc;
  --av-surface: #ffffff;
  --av-border: #cbd5e1;
  --av-text: #0f172a;
  --av-text-muted: #475569;
  --av-edge: #64748b;
  --av-edge-emphasis: #2563eb;
  --av-edge-hover: #e11d48;
  --av-edge-security: #b45309;
  --av-boundary-border: #94a3b8;
  ${typeVars}
  background: var(--av-bg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
svg.av-root .av-boundary rect { fill: none; stroke: var(--av-boundary-border); stroke-width: 1.5; stroke-dasharray: 6 4; }
svg.av-root .av-boundary text { fill: var(--av-text-muted); font-size: 11px; font-weight: 600; }
svg.av-root .av-boundary.kind-runtime rect { stroke-dasharray: 8 6; stroke-width: 1.5; stroke-opacity: 0.55; }
svg.av-root .av-boundary .av-boundary-badge { fill: var(--av-edge-emphasis); font-weight: 700; letter-spacing: 0.04em; }
svg.av-root .av-connection path.av-connection-path { fill: none; stroke: var(--av-edge); stroke-width: 1.75; }
svg.av-root .av-connection.variant-emphasis path.av-connection-path { stroke: var(--av-edge-emphasis); stroke-width: 2.25; }
svg.av-root .av-connection.variant-security path.av-connection-path { stroke: var(--av-edge-security); stroke-width: 1.75; }
svg.av-root .av-connection.variant-dashed path.av-connection-path { stroke-dasharray: 5 4; }
svg.av-root .av-connection text { fill: var(--av-text-muted); font-size: 11px; paint-order: stroke fill; stroke: rgba(248, 250, 252, 0.72); stroke-width: 2px; stroke-linejoin: round; }
svg.av-root .av-connection-label-short { opacity: 1; transition: opacity 150ms ease; }
svg.av-root .av-connection-label-full { opacity: 0; transition: opacity 150ms ease; }
svg.av-root .av-component rect.av-component-box { fill: var(--av-surface); stroke: var(--av-border); stroke-width: 1.5; }
svg.av-root .av-component--actor rect.av-component-box { stroke-dasharray: 4 3; }
svg.av-root .av-component .av-sigil { font-size: 10px; font-weight: 700; fill: #fff; }
svg.av-root .av-component .av-label { fill: var(--av-text); font-size: 13px; font-weight: 600; }
svg.av-root .av-component .av-sublabel { fill: var(--av-text-muted); font-size: 11px; }
svg.av-root .av-component { transition: transform 150ms ease; transform-box: fill-box; transform-origin: center; }
svg.av-root .av-component.av-hover-active { transform: scale(1.06); }
svg.av-root .av-component.av-hover-active rect.av-component-box { stroke: var(--av-edge-hover); stroke-width: 2.5; }
svg.av-root .av-connection.av-hover-active path.av-connection-path { stroke: var(--av-edge-hover); stroke-width: 2.75; }
svg.av-root .av-connection.av-hover-active text { font-weight: 700; }
svg.av-root .av-connection.av-hover-active .av-connection-label-short { opacity: 0; }
svg.av-root .av-connection.av-hover-active .av-connection-label-full { opacity: 1; }
svg.av-root .av-selected rect.av-component-box, svg.av-root .av-boundary.av-selected rect { stroke: var(--av-edge-emphasis); stroke-width: 2.5; stroke-opacity: 1; }
svg.av-root .av-connection.av-selected path.av-connection-path { stroke: var(--av-edge-emphasis); }
svg.av-root .av-legend text { fill: var(--av-text-muted); font-size: 11px; }
svg.av-root .av-title { fill: var(--av-text); font-size: 16px; font-weight: 700; }
${usedTypes.map((t) => `svg.av-root .av-component--${t} .av-sigil-bg { fill: var(--av-accent-${t}); }`).join("\n")}
${usedTypes.map((t) => `svg.av-root .av-legend-swatch--${t} { fill: var(--av-accent-${t}); }`).join("\n")}
</style>`;
}

function accentColor(type: ArchitectureViewComponentType): string {
  const colors: Record<ArchitectureViewComponentType, string> = {
    frontend: "#0891b2",
    backend: "#7c3aed",
    database: "#059669",
    cloud: "#2563eb",
    security: "#b45309",
    messagebus: "#db2777",
    external: "#64748b",
  };
  return colors[type];
}

function renderDefs(): string {
  const markers = VARIANTS.map((variant) => {
    return `<marker id="av-arrow-${variant}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>`;
  }).join("");
  return `<defs>${markers}</defs>`;
}

function semanticRefsAttr(refs: string[] | undefined): string {
  return refs && refs.length > 0 ? ` data-semantic-refs="${escapeAttr(refs.join(","))}"` : "";
}

function isSelected(refs: string[] | undefined, selectedSemanticRef: string | undefined): boolean {
  return !!selectedSemanticRef && !!refs && refs.includes(selectedSemanticRef);
}

/**
 * Numbers boundaries with `kind === "runtime"` sequentially (1, 2, 3, ...) in
 * their array order. Keyed by index into `boundaries` rather than `id` since
 * `id` is optional on `ArchitectureViewBoundary`.
 */
function computeRuntimeBoundaryNumbers(boundaries: ArchitectureViewDocument["boundaries"]): Map<number, number> {
  const numbers = new Map<number, number>();
  let n = 0;
  boundaries.forEach((b, i) => {
    if (b.kind === "runtime") {
      n += 1;
      numbers.set(i, n);
    }
  });
  return numbers;
}

function renderBoundary(
  boundary: ArchitectureViewDocument["boundaries"][number],
  componentRects: Map<string, Rect>,
  selectedSemanticRef?: string,
  runtimeNumber?: number,
): string {
  const rects = boundary.wraps.map((id) => componentRects.get(id)).filter((r): r is Rect => !!r);
  if (rects.length === 0) return "";
  const pad = boundary.pad ?? 20;
  const minX = Math.min(...rects.map((r) => r.x)) - pad;
  const minY = Math.min(...rects.map((r) => r.y)) - pad;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  const kindClass = boundary.kind === "security-group" ? "kind-security-group" : boundary.kind === "runtime" ? "kind-runtime" : "kind-region";
  const idAttr = boundary.id ? ` data-boundary-id="${escapeAttr(boundary.id)}"` : "";
  const selectedClass = isSelected(boundary.semanticRefs, selectedSemanticRef) ? " av-selected" : "";
  // Runtime boundaries get a small badge before the label so they read as
  // "an actual runtime" at a glance, distinct from a plain grouping region or
  // a security-group. Numbered by order of appearance among runtime
  // boundaries (see docs/v4_plan.md §4.6).
  const badgeText = boundary.kind === "runtime" ? `실행 그룹${runtimeNumber} · ` : "";
  const badgeEl = badgeText ? `<text class="av-boundary-badge" x="${minX + 10}" y="${minY - 8}">${escapeXml(badgeText)}</text>` : "";
  const labelX = badgeText ? minX + 10 + labelDisplayWidth(badgeText, 11) : minX + 10;
  return `<g class="av-boundary ${kindClass}${selectedClass}"${idAttr}${semanticRefsAttr(boundary.semanticRefs)}><rect x="${minX}" y="${minY}" width="${
    maxX - minX
  }" height="${maxY - minY}" rx="10" ry="10"/>${badgeEl}<text x="${labelX}" y="${minY - 8}">${escapeXml(boundary.label)}</text></g>`;
}

function renderConnection(
  conn: ArchitectureViewDocument["connections"][number],
  index: number,
  routes: Map<string, Route>,
  labelRects: Map<string, Rect>,
  selectedSemanticRef?: string,
): { path: string; label: string } {
  const edgeKey = conn.id ?? `connection-${index}`;
  const route = routes.get(edgeKey);
  if (!route || route.points.length < 2) return { path: "", label: "" };
  const variant: Variant = (conn.variant as Variant) ?? "default";
  const d = roundedPath(route.points, ROUNDED_CORNER_RADIUS);
  const fromAttr = escapeAttr(conn.from);
  const toAttr = escapeAttr(conn.to);
  const idAttr = conn.id ? ` data-connection-id="${escapeAttr(conn.id)}"` : "";
  const selectedClass = isSelected(conn.semanticRefs, selectedSemanticRef) ? " av-selected" : "";
  const sharedAttrs = `${idAttr} data-edge-from="${fromAttr}" data-edge-to="${toAttr}"${semanticRefsAttr(conn.semanticRefs)}`;
  // Invisible wide-stroke hit-area path, drawn first so it sits *under* the
  // visible path in paint order but still receives pointer events across a
  // generous width -- the visible stroke is only ~1.75-2.25px, too thin to
  // reliably hover. Purely a hit target: no fill/visible stroke, and it must
  // not carry the arrow marker.
  const hitAreaEl = `<path class="av-connection-hitarea" d="${d}" stroke="transparent" stroke-width="14" fill="none"/>`;
  const pathEl = `<path class="av-connection-path" d="${d}" marker-end="url(#av-arrow-${variant})"/>`;
  let labelEl = "";
  if (conn.label) {
    const labelRect = labelRects.get(`connection-label:${edgeKey}`);
    const position = labelRect
      ? { x: labelRect.x + labelRect.w / 2, y: labelRect.y + LABEL_TEXT_BASELINE }
      : { ...route.points[Math.floor(route.points.length / 2)]!, y: route.points[Math.floor(route.points.length / 2)]!.y - 4 };
    const { display, truncated } = truncateLabelForDisplay(conn.label, MAX_CONNECTION_LABEL_WIDTH);
    if (!truncated) {
      labelEl = `<text x="${position.x}" y="${position.y}" text-anchor="middle">${escapeXml(conn.label)}</text>`;
    } else {
      const shortTextEl = `<text class="av-connection-label-short" x="${position.x}" y="${position.y}" text-anchor="middle">${escapeXml(display)}</text>`;
      const fullTextEl = `<text class="av-connection-label-full" x="${position.x}" y="${position.y}" text-anchor="middle">${escapeXml(conn.label)}</text>`;
      labelEl = shortTextEl + fullTextEl;
    }
  }
  const pathGroup = `<g class="av-connection av-connection-path-layer variant-${variant}${selectedClass}"${sharedAttrs}>${hitAreaEl}${pathEl}</g>`;
  const labelGroup = labelEl
    ? `<g class="av-connection av-connection-label-layer variant-${variant}${selectedClass}"${sharedAttrs}>${labelEl}</g>`
    : "";
  return { path: pathGroup, label: labelGroup };
}

function renderComponent(c: ArchitectureViewComponent, rect: Rect, selectedSemanticRef?: string): string {
  const meta = TYPE_META[c.type];
  const sourcesAttr = c.sources && c.sources.length > 0 ? ` data-sources="${escapeAttr(JSON.stringify(c.sources))}"` : "";
  const isActor = c.semanticRole === "actor";
  const roleClass = isActor ? " av-component--actor" : "";
  const selectedClass = isSelected(c.semanticRefs, selectedSemanticRef) ? " av-selected" : "";
  const sigilSize = 18;
  const sigilX = rect.x + 8;
  const sigilY = rect.y + 8;
  const labelY = rect.y + rect.h / 2 + (c.sublabel ? -2 : 4);
  const sublabelEl = c.sublabel
    ? `<text class="av-sublabel" x="${rect.x + rect.w / 2}" y="${rect.y + rect.h / 2 + 16}" text-anchor="middle">${escapeXml(
        c.sublabel,
      )}</text>`
    : "";
  // Actors get a stadium/pill shape (rx = half height) with a dashed border
  // instead of the rounded-rect solid border ordinary responsibility/state/
  // external nodes use, so "a person/external caller" reads differently from
  // "a thing the system runs" without needing a new icon set.
  const boxRx = isActor ? rect.h / 2 : 10;
  return `<g class="av-component av-component--${c.type}${roleClass}${selectedClass}" data-component-id="${escapeAttr(c.id)}"${sourcesAttr}${semanticRefsAttr(c.semanticRefs)}>
<rect class="av-component-box" x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="${boxRx}" ry="${boxRx}"/>
<rect class="av-sigil-bg" x="${sigilX}" y="${sigilY}" width="${sigilSize}" height="${sigilSize}" rx="4" ry="4"/>
<text class="av-sigil" x="${sigilX + sigilSize / 2}" y="${sigilY + sigilSize / 2 + 3}" text-anchor="middle">${meta.sigil}</text>
<text class="av-label" x="${rect.x + rect.w / 2}" y="${labelY}" text-anchor="middle">${escapeXml(c.label)}</text>
${sublabelEl}
</g>`;
}

function renderLegend(usedTypes: ArchitectureViewComponentType[], vbW: number, vbH: number): string {
  const swatchSize = 10;
  const rowHeight = 18;
  const startY = vbH - usedTypes.length * rowHeight - 12;
  const labels = usedTypes.map((t) => `${TYPE_META[t].name} · ${TYPE_META[t].nameKo}`);
  const maxLabelWidth = labels.reduce((max, label) => Math.max(max, labelDisplayWidth(label, 11)), 0);
  const startX = vbW - (swatchSize + 8 + maxLabelWidth + 16);
  const rows = usedTypes
    .map((t, i) => {
      const y = startY + i * rowHeight;
      return `<rect class="av-legend-swatch--${t}" x="${startX}" y="${y}" width="${swatchSize}" height="${swatchSize}" rx="2" ry="2"/><text x="${
        startX + swatchSize + 8
      }" y="${y + swatchSize}">${escapeXml(labels[i]!)}</text>`;
    })
    .join("");
  return `<g class="av-legend">${rows}</g>`;
}

/**
 * Wraps `renderArchitectureViewSvg` in a self-contained HTML shell: the SVG,
 * and `doc.cards[]` rendered as real HTML (so their text is selectable,
 * unlike SVG <text>).
 */
export function renderArchitectureViewStandaloneHtml(doc: ArchitectureViewDocument): string {
  const svg = renderArchitectureViewSvg(doc);
  const cards = (doc.cards ?? [])
    .map(
      (card) => `<div class="av-card">
  <h3>${escapeXml(card.title)}</h3>
  <ul>${card.items.map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>
</div>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(doc.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: canvas; color: canvastext; }
  .av-diagram { width: 100%; }
  .av-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 24px; }
  .av-card { border: 1px solid #94a3b8; border-radius: 10px; padding: 14px 16px; }
  .av-card h3 { margin: 0 0 8px; font-size: 14px; }
  .av-card ul { margin: 0; padding-left: 18px; font-size: 13px; }
</style>
</head>
<body>
<div class="av-diagram">${svg}</div>
<div class="av-cards">${cards}</div>
</body>
</html>`;
}
