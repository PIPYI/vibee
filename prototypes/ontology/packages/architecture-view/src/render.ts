/**
 * ArchitectureViewDocument를 정적 SVG로 렌더한다.
 *
 * 좌표는 저작 문서가 소유하지만, 포트·경로·라벨은 geometry.ts가 계산한다. 독립 HTML 렌더러는
 * 아직 제품에서 호출하지 않으며, 향후 "HTML로 내보내기" 액션을 위한 유지 경로다.
 */
import type { ArchitectureViewComponentType, ArchitectureViewDocument } from "@onto/protocol";

import {
  DEFAULT_ARCHITECTURE_VIEW_BOX,
  calculateArchitectureLayout,
  roundedPath,
  shortenRouteEnd,
  type Rect,
} from "./geometry.js";

const TYPE_SIGIL: Record<ArchitectureViewComponentType, string> = {
  frontend: "UI",
  backend: "API",
  database: "DB",
  cloud: "☁",
  security: "⌁",
  messagebus: "↔",
  external: "↗",
};

const TYPE_LABEL: Record<ArchitectureViewComponentType, string> = {
  frontend: "프론트엔드",
  backend: "서비스",
  database: "데이터",
  cloud: "클라우드",
  security: "보안",
  messagebus: "메시지",
  external: "외부",
};

type BoundaryLayout = { boundary: ArchitectureViewDocument["boundaries"][number]; rect: Rect };

const SVG_STYLE = `
:root {
  --av-canvas: #f8fafc;
  --av-grid: #d9e2ee;
  --av-text: #0f172a;
  --av-muted: #526276;
  --av-panel: #ffffff;
  --av-border: #b8c5d5;
  --av-edge: #475569;
  --av-edge-emphasis: #2563eb;
  --av-edge-security: #dc2626;
  --av-type-frontend-fill: #e0f2fe;
  --av-type-frontend-stroke: #0284c7;
  --av-type-backend-fill: #dcfce7;
  --av-type-backend-stroke: #16a34a;
  --av-type-database-fill: #fef3c7;
  --av-type-database-stroke: #d97706;
  --av-type-cloud-fill: #ede9fe;
  --av-type-cloud-stroke: #7c3aed;
  --av-type-security-fill: #fee2e2;
  --av-type-security-stroke: #dc2626;
  --av-type-messagebus-fill: #ffedd5;
  --av-type-messagebus-stroke: #ea580c;
  --av-type-external-fill: #f1f5f9;
  --av-type-external-stroke: #64748b;
}
@media (prefers-color-scheme: dark) {
  :root {
    --av-canvas: #0b1220;
    --av-grid: #1e293b;
    --av-text: #e2e8f0;
    --av-muted: #94a3b8;
    --av-panel: #111c2c;
    --av-border: #405169;
    --av-edge: #94a3b8;
    --av-edge-emphasis: #60a5fa;
    --av-edge-security: #fb7185;
    --av-type-frontend-fill: #08384b;
    --av-type-frontend-stroke: #22d3ee;
    --av-type-backend-fill: #064e3b;
    --av-type-backend-stroke: #34d399;
    --av-type-database-fill: #4c3513;
    --av-type-database-stroke: #fbbf24;
    --av-type-cloud-fill: #342060;
    --av-type-cloud-stroke: #a78bfa;
    --av-type-security-fill: #5a1627;
    --av-type-security-stroke: #fb7185;
    --av-type-messagebus-fill: #5a2a0a;
    --av-type-messagebus-stroke: #fb923c;
    --av-type-external-fill: #1e293b;
    --av-type-external-stroke: #94a3b8;
  }
}
[data-theme="dark"] .av-root, .av-root[data-theme="dark"] {
  --av-canvas: #0b1220;
  --av-grid: #1e293b;
  --av-text: #e2e8f0;
  --av-muted: #94a3b8;
  --av-panel: #111c2c;
  --av-border: #405169;
  --av-edge: #94a3b8;
  --av-edge-emphasis: #60a5fa;
  --av-edge-security: #fb7185;
}
.av-background { fill: var(--av-canvas); }
.av-grid-line { fill: none; stroke: var(--av-grid); stroke-width: 1; }
.av-title { fill: var(--av-text); font-size: 19px; font-weight: 700; letter-spacing: -0.02em; }
.av-boundary-box { fill: none; stroke: var(--av-border); stroke-width: 1.4; stroke-dasharray: 7 5; }
.av-boundary--runtime .av-boundary-box { stroke-dasharray: 8 4; }
.av-boundary--external .av-boundary-box { stroke-dasharray: 3 5; }
.av-boundary--security .av-boundary-box { stroke: var(--av-edge-security); stroke-dasharray: 5 3; }
.av-boundary-label { fill: var(--av-muted); font-size: 11px; font-weight: 650; letter-spacing: 0.02em; }
.av-connection { pointer-events: visibleStroke; }
.av-connection-path { fill: none; stroke: var(--av-edge); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.av-connection--emphasis .av-connection-path { stroke: var(--av-edge-emphasis); stroke-width: 2.4; }
.av-connection--security .av-connection-path { stroke: var(--av-edge-security); stroke-width: 2.2; }
.av-connection--dashed .av-connection-path { stroke-dasharray: 6 4; }
.av-marker--default { fill: var(--av-edge); }
.av-marker--emphasis { fill: var(--av-edge-emphasis); }
.av-marker--security { fill: var(--av-edge-security); }
.av-marker--dashed { fill: var(--av-edge); }
.av-component { cursor: pointer; }
.av-component-box { fill: var(--av-panel); stroke: var(--av-border); stroke-width: 1.55; }
.av-component--frontend .av-component-box { fill: var(--av-type-frontend-fill); stroke: var(--av-type-frontend-stroke); }
.av-component--backend .av-component-box { fill: var(--av-type-backend-fill); stroke: var(--av-type-backend-stroke); }
.av-component--database .av-component-box { fill: var(--av-type-database-fill); stroke: var(--av-type-database-stroke); }
.av-component--cloud .av-component-box { fill: var(--av-type-cloud-fill); stroke: var(--av-type-cloud-stroke); }
.av-component--security .av-component-box { fill: var(--av-type-security-fill); stroke: var(--av-type-security-stroke); }
.av-component--messagebus .av-component-box { fill: var(--av-type-messagebus-fill); stroke: var(--av-type-messagebus-stroke); }
.av-component--external .av-component-box { fill: var(--av-type-external-fill); stroke: var(--av-type-external-stroke); }
.av-component-sigil { fill: var(--av-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; font-weight: 800; letter-spacing: 0.06em; }
.av-component-label { fill: var(--av-text); font-size: 14px; font-weight: 700; }
.av-component-sublabel { fill: var(--av-muted); font-size: 10.5px; }
.av-connection-label-mask { fill: var(--av-canvas); opacity: 0.96; }
.av-connection-label { fill: var(--av-text); font-size: 10.5px; font-weight: 600; }
.av-legend-panel { fill: var(--av-panel); fill-opacity: 0.94; stroke: var(--av-border); stroke-width: 1; }
.av-legend-title { fill: var(--av-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; }
.av-legend-label { fill: var(--av-muted); font-size: 10px; }
.av-legend-swatch { stroke-width: 1.2; }
.av-component--frontend .av-legend-swatch { fill: var(--av-type-frontend-fill); stroke: var(--av-type-frontend-stroke); }
.av-component--backend .av-legend-swatch { fill: var(--av-type-backend-fill); stroke: var(--av-type-backend-stroke); }
.av-component--database .av-legend-swatch { fill: var(--av-type-database-fill); stroke: var(--av-type-database-stroke); }
.av-component--cloud .av-legend-swatch { fill: var(--av-type-cloud-fill); stroke: var(--av-type-cloud-stroke); }
.av-component--security .av-legend-swatch { fill: var(--av-type-security-fill); stroke: var(--av-type-security-stroke); }
.av-component--messagebus .av-legend-swatch { fill: var(--av-type-messagebus-fill); stroke: var(--av-type-messagebus-stroke); }
.av-component--external .av-legend-swatch { fill: var(--av-type-external-fill); stroke: var(--av-type-external-stroke); }
`;

function escapeXml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function typeClass(type: ArchitectureViewComponentType): string {
  return `av-component--${type}`;
}

function variantClass(variant: ArchitectureViewDocument["connections"][number]["variant"]): string {
  return `av-connection--${variant ?? "default"}`;
}

function boundaryClass(kind: string): string {
  const normalized = kind.toLocaleLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `av-boundary--${normalized || "default"}`;
}

function sourcesAttribute(sources: unknown): string {
  return escapeXml(JSON.stringify(sources));
}

function boundaryLayouts(doc: ArchitectureViewDocument, componentById: Map<string, ArchitectureViewDocument["components"][number]>): BoundaryLayout[] {
  const layouts: BoundaryLayout[] = [];
  for (const boundary of doc.boundaries) {
    const members = boundary.wraps
      .map((id) => componentById.get(id))
      .filter((component): component is ArchitectureViewDocument["components"][number] => Boolean(component));
    if (members.length === 0) continue;
    const pad = boundary.pad ?? 16;
    const minX = Math.min(...members.map((component) => component.pos[0])) - pad;
    const minY = Math.min(...members.map((component) => component.pos[1])) - pad;
    const maxX = Math.max(...members.map((component) => component.pos[0] + component.size[0])) + pad;
    const maxY = Math.max(...members.map((component) => component.pos[1] + component.size[1])) + pad;
    layouts.push({ boundary, rect: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } });
  }
  return layouts;
}

function renderBoundaryFrame(layout: BoundaryLayout): string {
  const { boundary, rect } = layout;
  return [
    `<g class="av-boundary ${boundaryClass(boundary.kind)}" data-boundary-id="${escapeXml(boundary.id ?? boundary.label)}">`,
    `<rect class="av-boundary-box" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="15" />`,
    "</g>",
  ].join("");
}

function renderBoundaryLabel(layout: BoundaryLayout): string {
  const { boundary, rect } = layout;
  const y = rect.y - 8 < 16 ? rect.y + 17 : rect.y - 8;
  return `<text class="av-boundary-label" x="${rect.x + 10}" y="${y}">${escapeXml(boundary.label)}</text>`;
}

function renderComponent(component: ArchitectureViewDocument["components"][number]): string {
  const [x, y] = component.pos;
  const [width, height] = component.size;
  const hasSublabel = Boolean(component.sublabel);
  const labelY = y + (hasSublabel ? height / 2 - 4 : height / 2 + 5);
  const sourceData = sourcesAttribute(component.sources ?? []);
  const parts = [
    `<g class="av-component ${typeClass(component.type)}" data-component-id="${escapeXml(component.id)}" data-node-id="${escapeXml(component.id)}" data-sources="${sourceData}">`,
    `<rect class="av-component-box" x="${x}" y="${y}" width="${width}" height="${height}" rx="10" />`,
    `<text class="av-component-sigil" x="${x + 12}" y="${y + 16}">${TYPE_SIGIL[component.type]}</text>`,
    `<text class="av-component-label" x="${x + width / 2}" y="${labelY}" text-anchor="middle">${escapeXml(component.label)}</text>`,
  ];
  if (component.sublabel) {
    parts.push(`<text class="av-component-sublabel" x="${x + width / 2}" y="${y + height / 2 + 15}" text-anchor="middle">${escapeXml(component.sublabel)}</text>`);
  }
  parts.push("</g>");
  return parts.join("");
}

function renderConnection(
  doc: ArchitectureViewDocument,
  route: ReturnType<typeof calculateArchitectureLayout>["routes"][number],
  componentById: Map<string, ArchitectureViewDocument["components"][number]>,
): string {
  const connection = doc.connections[route.connectionIndex];
  const from = componentById.get(route.from);
  const to = componentById.get(route.to);
  if (!connection || !from || !to) return "";
  const sources = [...(from.sources ?? []), ...(to.sources ?? [])];
  const variant = connection.variant ?? "default";
  return [
    `<g class="av-connection ${variantClass(variant)}" data-connection-id="${escapeXml(route.connectionId)}" data-edge-from="${escapeXml(route.from)}" data-edge-to="${escapeXml(route.to)}" data-sources="${sourcesAttribute(sources)}">`,
    `<path class="edge av-connection-path" d="${roundedPath(shortenRouteEnd(route.points, 9), 8)}" marker-end="url(#av-arrow-${variant})" />`,
    "</g>",
  ].join("");
}

function renderConnectionLabel(
  label: ReturnType<typeof calculateArchitectureLayout>["labels"][number],
  doc: ArchitectureViewDocument,
): string {
  const connection = doc.connections[label.connectionIndex];
  if (!connection) return "";
  return [
    `<g class="av-connection-label-group ${variantClass(connection.variant)}" data-connection-id="${escapeXml(label.connectionId)}">`,
    `<rect class="av-connection-label-mask" x="${label.rect.x}" y="${label.rect.y}" width="${label.rect.width}" height="${label.rect.height}" rx="4" />`,
    `<text class="av-connection-label" x="${label.x}" y="${label.y + 3.7}" text-anchor="middle">${escapeXml(label.text)}</text>`,
    "</g>",
  ].join("");
}

function renderDefs(): string {
  const variants = ["default", "emphasis", "security", "dashed"];
  const markers = variants
    .map((variant) => `<marker id="av-arrow-${variant}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path class="av-marker av-marker--${variant}" d="M0,0 L10,5 L0,10 z" /></marker>`)
    .join("");
  return `<defs><pattern id="av-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path class="av-grid-line" d="M 28 0 L 0 0 0 28" /></pattern>${markers}</defs>`;
}

function renderLegend(doc: ArchitectureViewDocument, width: number, height: number): string {
  const types = [...new Set(doc.components.map((component) => component.type))];
  if (types.length === 0) return "";
  const itemWidth = 126;
  const legendWidth = Math.min(width - 36, 28 + types.length * itemWidth);
  const x = 18;
  const y = height - 44;
  const items = types.map((type, index) => {
    const itemX = x + 16 + index * itemWidth;
    return `<g class="av-legend-item ${typeClass(type)}"><rect class="av-legend-swatch" x="${itemX}" y="${y + 22}" width="10" height="10" rx="3" /><text class="av-legend-label" x="${itemX + 16}" y="${y + 31}">${TYPE_LABEL[type]}</text></g>`;
  }).join("");
  return `<g class="av-legend"><rect class="av-legend-panel" x="${x}" y="${y}" width="${legendWidth}" height="36" rx="8" /><text class="av-legend-title" x="${x + 16}" y="${y + 13}">COMPONENT TYPES</text>${items}</g>`;
}

function renderCards(cards: NonNullable<ArchitectureViewDocument["cards"]>): string {
  if (cards.length === 0) return "";
  return cards
    .map((card) => {
      const items = card.items.map((item) => `<li>${escapeXml(item)}</li>`).join("");
      return `<div class="av-card"><h3>${card.dot ? `<span class="av-dot" style="background:${escapeXml(card.dot)}"></span>` : ""}${escapeXml(card.title)}</h3><ul>${items}</ul></div>`;
    })
    .join("\n");
}

/** SVG 문자열 하나. `apps/web`이 ViewerShell 안에서 마운트한다. */
export function renderArchitectureViewSvg(doc: ArchitectureViewDocument): string {
  const [width, height] = doc.viewBox ?? DEFAULT_ARCHITECTURE_VIEW_BOX;
  const componentById = new Map(doc.components.map((component) => [component.id, component] as const));
  const layout = calculateArchitectureLayout(doc);
  const boundaries = boundaryLayouts(doc, componentById);

  const body = [
    `<style>${SVG_STYLE}</style>`,
    renderDefs(),
    `<rect class="av-background" x="0" y="0" width="${width}" height="${height}" />`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#av-grid)" />`,
    `<text class="av-title" x="28" y="36">${escapeXml(doc.title)}</text>`,
    ...boundaries.map(renderBoundaryFrame),
    ...layout.routes.map((route) => renderConnection(doc, route, componentById)),
    ...doc.components.map(renderComponent),
    ...layout.labels.map((label) => renderConnectionLabel(label, doc)),
    ...boundaries.map(renderBoundaryLabel),
    renderLegend(doc, width, height),
  ].join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="av-root" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif" role="img" aria-label="${escapeXml(doc.title)}">`,
    `<title>${escapeXml(doc.title)}</title>`,
    body,
    "</svg>",
  ].join("\n");
}

/** 공유 가능한 독립 산출물 — 제품 UI가 아니라 향후 "HTML로 내보내기" 액션 전용이다. */
export function renderArchitectureViewStandaloneHtml(doc: ArchitectureViewDocument): string {
  const svg = renderArchitectureViewSvg(doc);
  const cards = renderCards(doc.cards ?? []);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeXml(doc.title)}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f1f5f9; color: #0f172a; }
  .av-shell { max-width: 1280px; margin: 0 auto; padding: 24px; }
  .av-svg-wrap { overflow: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; }
  .av-cards { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 16px; }
  .av-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; min-width: 220px; }
  .av-card h3 { margin: 0 0 8px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
  .av-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
  .av-card ul { margin: 0; padding-left: 18px; font-size: 13px; }
</style>
</head>
<body>
<div class="av-shell">
  <h1>${escapeXml(doc.title)}</h1>
  <div class="av-svg-wrap">${svg}</div>
  <div class="av-cards">${cards}</div>
</div>
</body>
</html>`;
}
