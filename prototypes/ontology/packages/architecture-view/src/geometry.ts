/**
 * v7 §5.2(a) — Archify `geometry.mjs`의 축소판 네이티브 재구현.
 *
 * archify급 automatic port-spread/포트 계약은 렌더러가 정적 SVG인 1단계에서는 투자 대비
 * 이득이 낮다고 판단해 2단계(인터랙션 추가 시점)로 미뤘다(v7/README.md §4a). 여기서는
 * viewBox 이탈, 컴포넌트 겹침, 참조 무결성, 컴포넌트 bounding box와의 기본 교차만 본다.
 */
import type { ArchitectureViewDocument } from "@onto/protocol";

import { diagnostic, type Diagnostic } from "./diagnostic.js";

const DEFAULT_VIEW_BOX: [number, number] = [1200, 800];

type Rect = { x: number; y: number; width: number; height: number };

function rectOf(pos: [number, number], size: [number, number]): Rect {
  return { x: pos[0], y: pos[1], width: size[0], height: size[1] };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** 두 rect가 겹치는 영역의 넓이. 완전 포함/근접 겹침을 사소한 오차와 구분하는 데 쓴다. */
function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, width) * Math.max(0, height);
}

/** 선분 pq가 rect와 교차하는가 (Liang–Barsky 축소판 — 완전 포함/미스만 구분해도 충분하다). */
function segmentIntersectsRect(p: [number, number], q: [number, number], rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const edges: Array<[number, number]> = [
    [-dx, p[0] - rect.x],
    [dx, rect.x + rect.width - p[0]],
    [-dy, p[1] - rect.y],
    [dy, rect.y + rect.height - p[1]],
  ];
  for (const [denom, numer] of edges) {
    if (denom === 0) {
      if (numer < 0) return false;
      continue;
    }
    const t = numer / denom;
    if (denom < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t0 < t1;
}

function center(rect: Rect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

export function checkGeometry(doc: ArchitectureViewDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const [viewWidth, viewHeight] = doc.viewBox ?? DEFAULT_VIEW_BOX;
  const componentById = new Map(doc.components.map((component) => [component.id, component] as const));

  for (const component of doc.components) {
    const [x, y] = component.pos;
    const [width, height] = component.size;
    if (width <= 0 || height <= 0) {
      diagnostics.push(
        diagnostic("architecture-view/invalid-size", "error", `컴포넌트 "${component.id}"의 size가 0 이하입니다.`, {
          subject: { componentId: component.id },
          evidence: { size: component.size },
          supportedFixes: ["size를 양수 [width, height]로 고친다"],
        }),
      );
      continue;
    }
    if (x < 0 || y < 0 || x + width > viewWidth || y + height > viewHeight) {
      diagnostics.push(
        diagnostic(
          "architecture-view/out-of-bounds",
          "error",
          `컴포넌트 "${component.id}"가 viewBox(${viewWidth}x${viewHeight}) 밖으로 나갑니다.`,
          {
            subject: { componentId: component.id },
            evidence: { pos: component.pos, size: component.size, viewBox: [viewWidth, viewHeight] },
            supportedFixes: ["pos/size를 viewBox 안으로 옮기거나 viewBox를 늘린다"],
          },
        ),
      );
    }
  }

  for (let i = 0; i < doc.components.length; i += 1) {
    for (let j = i + 1; j < doc.components.length; j += 1) {
      const a = doc.components[i]!;
      const b = doc.components[j]!;
      const rectA = rectOf(a.pos, a.size);
      const rectB = rectOf(b.pos, b.size);
      if (!overlaps(rectA, rectB)) continue;
      const area = overlapArea(rectA, rectB);
      const smaller = Math.min(rectA.width * rectA.height, rectB.width * rectB.height);
      if (smaller > 0 && area / smaller < 0.02) continue; // 경계선 근처의 사소한 겹침은 무시한다
      diagnostics.push(
        diagnostic("architecture-view/overlap", "error", `컴포넌트 "${a.id}"와 "${b.id}"가 겹칩니다.`, {
          subject: { componentIds: [a.id, b.id] },
          evidence: { posA: a.pos, sizeA: a.size, posB: b.pos, sizeB: b.size },
          supportedFixes: ["둘 중 하나의 pos를 옮겨 겹치지 않게 한다"],
        }),
      );
    }
  }

  for (const boundary of doc.boundaries) {
    for (const memberId of boundary.wraps) {
      if (componentById.has(memberId)) continue;
      diagnostics.push(
        diagnostic(
          "architecture-view/dangling-boundary-ref",
          "error",
          `boundary "${boundary.id ?? boundary.label}"가 존재하지 않는 컴포넌트 "${memberId}"를 감쌉니다.`,
          { subject: { boundaryId: boundary.id ?? boundary.label, componentId: memberId }, supportedFixes: ["wraps에서 제거하거나 실재하는 component id로 고친다"] },
        ),
      );
    }
  }

  for (const connection of doc.connections) {
    for (const [role, id] of [["from", connection.from] as const, ["to", connection.to] as const]) {
      if (componentById.has(id)) continue;
      diagnostics.push(
        diagnostic(
          "architecture-view/dangling-connection-ref",
          "error",
          `connection의 "${role}"이 존재하지 않는 컴포넌트 "${id}"를 가리킵니다.`,
          { subject: { connectionId: connection.id, [role]: id }, supportedFixes: ["실재하는 component id로 고친다"] },
        ),
      );
    }
  }

  const validConnections = doc.connections.filter((c) => componentById.has(c.from) && componentById.has(c.to));
  for (const connection of validConnections) {
    const from = componentById.get(connection.from)!;
    const to = componentById.get(connection.to)!;
    const p = center(rectOf(from.pos, from.size));
    const q = center(rectOf(to.pos, to.size));
    for (const other of doc.components) {
      if (other.id === connection.from || other.id === connection.to) continue;
      if (segmentIntersectsRect(p, q, rectOf(other.pos, other.size))) {
        diagnostics.push(
          diagnostic(
            "architecture-view/edge-crossing",
            "warning",
            `connection "${connection.from}->${connection.to}"이 무관한 컴포넌트 "${other.id}"를 가로지릅니다.`,
            {
              subject: { connectionId: connection.id ?? `${connection.from}->${connection.to}`, throughComponentId: other.id },
              supportedFixes: ["좌표를 조정하거나 경유 컴포넌트를 우회하도록 배치를 바꾼다"],
            },
          ),
        );
      }
    }
  }

  return diagnostics;
}
