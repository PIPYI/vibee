/**
 * v7 §5.3 — Archify `render-architecture.mjs`의 "손으로 SVG 문자열 생성, 런타임 의존성 0" 패턴의
 * 네이티브 재구현(코드 포팅이 아니다). 저작된 pos/size를 그대로 쓴다 — 자동 포트 분산은 하지
 * 않는다(geometry.ts의 축소된 체크와 정합, v7/README.md §4a).
 */
import type { ArchitectureViewDocument } from "@onto/protocol";

const DEFAULT_VIEW_BOX: [number, number] = [1200, 800];

const TYPE_COLORS: Record<string, { fill: string; stroke: string }> = {
  frontend: { fill: "#e0f2fe", stroke: "#0284c7" },
  backend: { fill: "#dcfce7", stroke: "#16a34a" },
  database: { fill: "#fef3c7", stroke: "#d97706" },
  cloud: { fill: "#ede9fe", stroke: "#7c3aed" },
  security: { fill: "#fee2e2", stroke: "#dc2626" },
  messagebus: { fill: "#ffedd5", stroke: "#ea580c" },
  external: { fill: "#f1f5f9", stroke: "#64748b" },
};

const VARIANT_STROKE: Record<string, string> = {
  default: "#475569",
  emphasis: "#1d4ed8",
  security: "#dc2626",
  dashed: "#475569",
};

function escapeXml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function center(pos: [number, number], size: [number, number]): [number, number] {
  return [pos[0] + size[0] / 2, pos[1] + size[1] / 2];
}

function renderComponent(component: ArchitectureViewDocument["components"][number]): string {
  const [x, y] = component.pos;
  const [width, height] = component.size;
  const colors = TYPE_COLORS[component.type] ?? TYPE_COLORS["external"]!;
  const labelY = y + (component.sublabel ? height / 2 - 6 : height / 2 + 5);
  const parts = [
    `<g data-component-id="${escapeXml(component.id)}">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1.5" />`,
    `<text x="${x + width / 2}" y="${labelY}" text-anchor="middle" font-size="14" font-weight="600" fill="#0f172a">${escapeXml(component.label)}</text>`,
  ];
  if (component.sublabel) {
    parts.push(
      `<text x="${x + width / 2}" y="${y + height / 2 + 12}" text-anchor="middle" font-size="11" fill="#334155">${escapeXml(component.sublabel)}</text>`,
    );
  }
  parts.push("</g>");
  return parts.join("");
}

function renderBoundary(boundary: ArchitectureViewDocument["boundaries"][number], componentById: Map<string, ArchitectureViewDocument["components"][number]>): string {
  const members = boundary.wraps.map((id) => componentById.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (members.length === 0) return "";
  const pad = boundary.pad ?? 16;
  const minX = Math.min(...members.map((m) => m.pos[0])) - pad;
  const minY = Math.min(...members.map((m) => m.pos[1])) - pad;
  const maxX = Math.max(...members.map((m) => m.pos[0] + m.size[0])) + pad;
  const maxY = Math.max(...members.map((m) => m.pos[1] + m.size[1])) + pad;
  return [
    `<g data-boundary-id="${escapeXml(boundary.id ?? boundary.label)}">`,
    `<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" rx="14" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="6 4" />`,
    `<text x="${minX + 10}" y="${minY - 8 < 12 ? minY + 16 : minY - 8}" font-size="12" font-weight="600" fill="#64748b">${escapeXml(boundary.label)}</text>`,
    "</g>",
  ].join("");
}

function renderConnection(
  connection: ArchitectureViewDocument["connections"][number],
  componentById: Map<string, ArchitectureViewDocument["components"][number]>,
  index: number,
): string {
  const from = componentById.get(connection.from);
  const to = componentById.get(connection.to);
  if (!from || !to) return "";
  const [x1, y1] = center(from.pos, from.size);
  const [x2, y2] = center(to.pos, to.size);
  const stroke = VARIANT_STROKE[connection.variant ?? "default"] ?? VARIANT_STROKE["default"];
  const dash = connection.variant === "dashed" ? ` stroke-dasharray="5 4"` : "";
  const markerId = `arrow-${index}`;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const parts = [
    `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`,
    `<path d="M0,0 L10,5 L0,10 z" fill="${stroke}" /></marker></defs>`,
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.75"${dash} marker-end="url(#${markerId})" />`,
  ];
  if (connection.label) {
    parts.push(
      `<rect x="${midX - connection.label.length * 3.2 - 4}" y="${midY - 10}" width="${connection.label.length * 6.4 + 8}" height="16" fill="#ffffff" opacity="0.9" />`,
      `<text x="${midX}" y="${midY + 3}" text-anchor="middle" font-size="11" fill="#1e293b">${escapeXml(connection.label)}</text>`,
    );
  }
  return parts.join("");
}

function renderCards(cards: NonNullable<ArchitectureViewDocument["cards"]>, viewBox: [number, number]): string {
  if (cards.length === 0) return "";
  return cards
    .map((card, i) => {
      const items = card.items.map((item) => `<li>${escapeXml(item)}</li>`).join("");
      return `<div class="av-card"><h3>${card.dot ? `<span class="av-dot" style="background:${escapeXml(card.dot)}"></span>` : ""}${escapeXml(card.title)}</h3><ul>${items}</ul></div>`;
    })
    .join("\n");
}

/** SVG 문자열 하나. `apps/web`이 `dangerouslySetInnerHTML`로 기존 pan/zoom chrome 안에 마운트한다. */
export function renderArchitectureViewSvg(doc: ArchitectureViewDocument): string {
  const [width, height] = doc.viewBox ?? DEFAULT_VIEW_BOX;
  const componentById = new Map(doc.components.map((component) => [component.id, component] as const));

  const body = [
    ...doc.boundaries.map((boundary) => renderBoundary(boundary, componentById)),
    ...doc.connections.map((connection, index) => renderConnection(connection, componentById, index)),
    ...doc.components.map((component) => renderComponent(component)),
  ].join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif" role="img" aria-label="${escapeXml(doc.title)}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#f8fafc" />`,
    body,
    "</svg>",
  ].join("\n");
}

/** 공유 가능한 독립 산출물 — "HTML로 내보내기" 액션 전용(v7/README.md §5.3 phasing 1단계). */
export function renderArchitectureViewStandaloneHtml(doc: ArchitectureViewDocument): string {
  const svg = renderArchitectureViewSvg(doc);
  const cards = renderCards(doc.cards ?? [], doc.viewBox ?? DEFAULT_VIEW_BOX);
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
