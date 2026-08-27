import type {
  ArchitectureAudience,
  ArchitectureViewComponent,
  ArchitectureViewComponentType,
  ArchitectureViewDocument,
} from "@vibee/protocol";
import {
  DEFAULT_ARCHITECTURE_VIEW_BOX,
  ROUNDED_CORNER_RADIUS,
  calculateArchitectureLayout,
  labelDisplayWidth,
  roundedPath,
  type Rect,
} from "./geometry.js";
import { applyAudiencePresentation, resolveVisibility } from "./presentation.js";

export type RenderOptions = {
  audience?: ArchitectureAudience;
  theme?: "light" | "dark";
  /** When set, matching components/boundaries/connections get an `av-selected` class hook. */
  selectedSemanticRef?: string;
};

type TypeMeta = { sigil: string; name: string; simpleSigil: string; simpleName: string };

const TYPE_META: Record<ArchitectureViewComponentType, TypeMeta> = {
  frontend: { sigil: "FE", name: "Frontend", simpleSigil: "화", simpleName: "화면" },
  backend: { sigil: "BE", name: "Backend", simpleSigil: "서", simpleName: "서버" },
  database: { sigil: "DB", name: "Database", simpleSigil: "저", simpleName: "저장소" },
  cloud: { sigil: "CL", name: "Cloud", simpleSigil: "클", simpleName: "클라우드" },
  security: { sigil: "SEC", name: "Security", simpleSigil: "보", simpleName: "보안" },
  messagebus: { sigil: "MQ", name: "Message bus", simpleSigil: "메", simpleName: "메시지 전달" },
  external: { sigil: "EX", name: "External", simpleSigil: "외", simpleName: "외부" },
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
 * `options.audience` (default `"simple"`) selects which
 * `presentation.simple`/`presentation.technical` overrides apply -- see
 * `applyAudiencePresentation`. Geometry is computed over the *projected*
 * document, but projection never touches `pos`/`size`/`wraps`/`from`/`to`,
 * so canonical layout never shifts between audiences; only display label
 * text (and therefore label-collision boxes) can differ. An element whose
 * resolved visibility for that audience is `"hide"` is skipped at draw time
 * only -- it still occupies its canonical position for layout purposes.
 *
 * Draw order (fixed, load-bearing):
 *   1. <style> (CSS custom properties + light/dark theme + semantic classes)
 *   2. one <defs> with exactly 4 markers (default/emphasis/security/dashed)
 *   3. boundary frames
 *   4. connections
 *   5. components
 *   6. legend (only types actually present and visible)
 *   7. title text
 */
export function renderArchitectureViewSvg(doc: ArchitectureViewDocument, options?: RenderOptions): string {
  const audience: ArchitectureAudience = options?.audience ?? "simple";
  const selectedSemanticRef = options?.selectedSemanticRef;
  const projected = applyAudiencePresentation(doc, audience);

  const [vbW, vbH] = projected.viewBox ?? DEFAULT_ARCHITECTURE_VIEW_BOX;
  const layout = calculateArchitectureLayout(projected);
  const { componentRects, routes, labelRects } = layout;

  const visibleComponents = projected.components.filter((c) => resolveVisibility(c, audience) === "show");
  const usedTypes = [...new Set(visibleComponents.map((c) => c.type))];

  const style = renderStyle(usedTypes);
  const defs = renderDefs();
  const boundaries = projected.boundaries
    .map((b) => (resolveVisibility(b, audience) === "hide" ? "" : renderBoundary(b, componentRects, audience, selectedSemanticRef)))
    .join("\n");
  const connections = projected.connections
    .map((conn, i) =>
      resolveVisibility(conn, audience) === "hide" ? "" : renderConnection(conn, i, routes, labelRects, selectedSemanticRef),
    )
    .join("\n");
  const components = visibleComponents
    .map((c) => renderComponent(c, componentRects.get(c.id)!, audience, selectedSemanticRef))
    .join("\n");
  const legend = renderLegend(usedTypes, vbW, vbH, audience);
  const title = `<text class="av-title" x="24" y="34">${escapeXml(projected.title)}</text>`;
  const themeAttr = options?.theme ? ` data-theme="${options.theme}"` : "";

  return [
    `<svg class="av-root" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" width="100%" height="100%"${themeAttr}>`,
    style,
    defs,
    `<g class="av-boundaries">${boundaries}</g>`,
    `<g class="av-connections">${connections}</g>`,
    `<g class="av-components">${components}</g>`,
    legend,
    title,
    `</svg>`,
  ].join("\n");
}

function renderStyle(usedTypes: ArchitectureViewComponentType[]): string {
  const typeVars = usedTypes.map((t) => `--av-accent-${t}: ${accentColor(t)};`).join(" ");
  const typeVarsDark = usedTypes.map((t) => `--av-accent-${t}: ${accentColorDark(t)};`).join(" ");

  return `<style>
svg.av-root {
  --av-bg: #f8fafc;
  --av-surface: #ffffff;
  --av-border: #cbd5e1;
  --av-text: #0f172a;
  --av-text-muted: #475569;
  --av-edge: #64748b;
  --av-edge-emphasis: #2563eb;
  --av-edge-security: #b45309;
  --av-boundary-border: #94a3b8;
  ${typeVars}
  background: var(--av-bg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  svg.av-root:not([data-theme="light"]) {
    --av-bg: #0b1220;
    --av-surface: #111827;
    --av-border: #334155;
    --av-text: #e2e8f0;
    --av-text-muted: #94a3b8;
    --av-edge: #94a3b8;
    --av-edge-emphasis: #60a5fa;
    --av-edge-security: #f59e0b;
    --av-boundary-border: #475569;
    ${typeVarsDark}
  }
}
svg.av-root[data-theme="dark"] {
  --av-bg: #0b1220;
  --av-surface: #111827;
  --av-border: #334155;
  --av-text: #e2e8f0;
  --av-text-muted: #94a3b8;
  --av-edge: #94a3b8;
  --av-edge-emphasis: #60a5fa;
  --av-edge-security: #f59e0b;
  --av-boundary-border: #475569;
  ${typeVarsDark}
}
svg.av-root .av-boundary rect { fill: none; stroke: var(--av-boundary-border); stroke-width: 1.5; stroke-dasharray: 6 4; }
svg.av-root .av-boundary text { fill: var(--av-text-muted); font-size: 11px; font-weight: 600; }
svg.av-root .av-boundary.kind-runtime rect { stroke-dasharray: none; stroke-width: 2; }
svg.av-root .av-boundary .av-boundary-badge { fill: var(--av-edge-emphasis); font-weight: 700; letter-spacing: 0.04em; }
svg.av-root .av-connection path { fill: none; stroke: var(--av-edge); stroke-width: 1.75; }
svg.av-root .av-connection.variant-emphasis path { stroke: var(--av-edge-emphasis); stroke-width: 2.25; }
svg.av-root .av-connection.variant-security path { stroke: var(--av-edge-security); stroke-width: 1.75; }
svg.av-root .av-connection.variant-dashed path { stroke-dasharray: 5 4; }
svg.av-root .av-connection text { fill: var(--av-text-muted); font-size: 11px; }
svg.av-root .av-connection-label-bg { fill: var(--av-bg); opacity: 0.85; }
svg.av-root .av-component rect.av-component-box { fill: var(--av-surface); stroke: var(--av-border); stroke-width: 1.5; }
svg.av-root .av-component--actor rect.av-component-box { stroke-dasharray: 4 3; }
svg.av-root .av-component .av-sigil { font-size: 10px; font-weight: 700; fill: #fff; }
svg.av-root .av-component .av-label { fill: var(--av-text); font-size: 13px; font-weight: 600; }
svg.av-root .av-component .av-sublabel { fill: var(--av-text-muted); font-size: 11px; }
svg.av-root .av-selected rect.av-component-box, svg.av-root .av-boundary.av-selected rect { stroke: var(--av-edge-emphasis); stroke-width: 2.5; }
svg.av-root .av-connection.av-selected path { stroke: var(--av-edge-emphasis); }
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

function accentColorDark(type: ArchitectureViewComponentType): string {
  const colors: Record<ArchitectureViewComponentType, string> = {
    frontend: "#22d3ee",
    backend: "#a78bfa",
    database: "#34d399",
    cloud: "#60a5fa",
    security: "#fbbf24",
    messagebus: "#f472b6",
    external: "#94a3b8",
  };
  return colors[type];
}

function renderDefs(): string {
  const markers = VARIANTS.map((variant) => {
    const strokeVar =
      variant === "emphasis" ? "var(--av-edge-emphasis)" : variant === "security" ? "var(--av-edge-security)" : "var(--av-edge)";
    return `<marker id="av-arrow-${variant}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${strokeVar}"/></marker>`;
  }).join("");
  return `<defs>${markers}</defs>`;
}

function semanticRefsAttr(refs: string[] | undefined): string {
  return refs && refs.length > 0 ? ` data-semantic-refs="${escapeAttr(refs.join(","))}"` : "";
}

function isSelected(refs: string[] | undefined, selectedSemanticRef: string | undefined): boolean {
  return !!selectedSemanticRef && !!refs && refs.includes(selectedSemanticRef);
}

function renderBoundary(
  boundary: ArchitectureViewDocument["boundaries"][number],
  componentRects: Map<string, Rect>,
  audience: ArchitectureAudience,
  selectedSemanticRef?: string,
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
  // Runtime boundaries get a small uppercase badge before the label so they
  // read as "an actual runtime" at a glance, distinct from a plain grouping
  // region or a security-group.
  const runtimeBadge = audience === "simple" ? "실행 환경 · " : "RUNTIME · ";
  const badgeEl =
    boundary.kind === "runtime"
      ? `<text class="av-boundary-badge" x="${minX + 10}" y="${minY - 8}">${runtimeBadge}</text>`
      : "";
  const labelX = boundary.kind === "runtime" ? minX + 10 + labelDisplayWidth(runtimeBadge, 11) : minX + 10;
  return `<g class="av-boundary ${kindClass}${selectedClass}"${idAttr}${semanticRefsAttr(boundary.semanticRefs)}><rect x="${minX}" y="${minY}" width="${
    maxX - minX
  }" height="${maxY - minY}" rx="10" ry="10"/>${badgeEl}<text x="${labelX}" y="${minY - 8}">${escapeXml(boundary.label)}</text></g>`;
}

function renderConnection(
  conn: ArchitectureViewDocument["connections"][number],
  index: number,
  routes: Map<string, { points: { x: number; y: number }[]; strategy: string; crossedComponentIds: string[] }>,
  labelRects: Map<string, Rect>,
  selectedSemanticRef?: string,
): string {
  const edgeKey = conn.id ?? `connection-${index}`;
  const route = routes.get(edgeKey);
  if (!route || route.points.length < 2) return "";
  const variant: Variant = (conn.variant as Variant) ?? "default";
  const d = roundedPath(route.points, ROUNDED_CORNER_RADIUS);
  const fromAttr = escapeAttr(conn.from);
  const toAttr = escapeAttr(conn.to);
  const idAttr = conn.id ? ` data-connection-id="${escapeAttr(conn.id)}"` : "";
  const selectedClass = isSelected(conn.semanticRefs, selectedSemanticRef) ? " av-selected" : "";
  const pathEl = `<path d="${d}" marker-end="url(#av-arrow-${variant})"/>`;
  let labelEl = "";
  if (conn.label) {
    const labelRect = labelRects.get(`connection-label:${edgeKey}`);
    if (labelRect) {
      labelEl = `<rect class="av-connection-label-bg" x="${labelRect.x}" y="${labelRect.y}" width="${labelRect.w}" height="${labelRect.h}" rx="3" ry="3"/><text x="${labelRect.x + labelRect.w / 2}" y="${labelRect.y + labelRect.h / 2 + 4}" text-anchor="middle">${escapeXml(conn.label)}</text>`;
    }
  }
  return `<g class="av-connection variant-${variant}${selectedClass}"${idAttr} data-edge-from="${fromAttr}" data-edge-to="${toAttr}"${semanticRefsAttr(conn.semanticRefs)}>${pathEl}${labelEl}</g>`;
}

function renderComponent(c: ArchitectureViewComponent, rect: Rect, audience: ArchitectureAudience, selectedSemanticRef?: string): string {
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
<text class="av-sigil" x="${sigilX + sigilSize / 2}" y="${sigilY + sigilSize / 2 + 3}" text-anchor="middle">${audience === "simple" ? meta.simpleSigil : meta.sigil}</text>
<text class="av-label" x="${rect.x + rect.w / 2}" y="${labelY}" text-anchor="middle">${escapeXml(c.label)}</text>
${sublabelEl}
</g>`;
}

function renderLegend(usedTypes: ArchitectureViewComponentType[], vbW: number, vbH: number, audience: ArchitectureAudience): string {
  const swatchSize = 10;
  const rowHeight = 18;
  const startY = vbH - usedTypes.length * rowHeight - 12;
  const startX = vbW - 160;
  const rows = usedTypes
    .map((t, i) => {
      const y = startY + i * rowHeight;
      return `<rect class="av-legend-swatch--${t}" x="${startX}" y="${y}" width="${swatchSize}" height="${swatchSize}" rx="2" ry="2"/><text x="${
        startX + swatchSize + 8
      }" y="${y + swatchSize}">${escapeXml(audience === "simple" ? TYPE_META[t].simpleName : TYPE_META[t].name)}</text>`;
    })
    .join("");
  return `<g class="av-legend">${rows}</g>`;
}

/**
 * Wraps `renderArchitectureViewSvg` in a self-contained HTML shell: the SVG,
 * a dark/light theme toggle button that flips `data-theme` on the SVG
 * element, and `doc.cards[]` rendered as real HTML (so their text is
 * selectable, unlike SVG <text>).
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
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: canvas; color: canvastext; }
  .av-toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
  .av-toolbar button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #94a3b8; background: transparent; color: inherit; cursor: pointer; }
  .av-diagram { width: 100%; }
  .av-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 24px; }
  .av-card { border: 1px solid #94a3b8; border-radius: 10px; padding: 14px 16px; }
  .av-card h3 { margin: 0 0 8px; font-size: 14px; }
  .av-card ul { margin: 0; padding-left: 18px; font-size: 13px; }
</style>
</head>
<body>
<div class="av-toolbar"><button id="av-theme-toggle" type="button">Toggle theme</button></div>
<div class="av-diagram">${svg}</div>
<div class="av-cards">${cards}</div>
<script>
(function () {
  var btn = document.getElementById("av-theme-toggle");
  var svgEl = document.querySelector("svg.av-root");
  if (!btn || !svgEl) return;
  btn.addEventListener("click", function () {
    var current = svgEl.getAttribute("data-theme");
    svgEl.setAttribute("data-theme", current === "dark" ? "light" : "dark");
  });
})();
</script>
</body>
</html>`;
}
