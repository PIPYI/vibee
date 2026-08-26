/**
 * Viewer Shell (schema2 §2) — IR·Validator·Core를 건드리지 않고 Scenario/Trace SVG 캔버스
 * 위에 얹는 상호작용 층.
 *
 * **I14**: 여기서 만드는 상태(focus·pan·zoom)는 IR에도 store에도 쓰지 않는다. URL hash와
 * 브라우저 메모리에만 산다.
 * **I15**: 그래프 질의를 새로 하지 않는다. focus 이웃 강조는 DOM에 이미 그려진
 * `data-node-id` / `data-edge-from` / `data-edge-to`를 그대로 읽을 뿐이다 — 1-hop 강조이지
 * reachability나 최단경로가 아니다.
 * **I16**: 색은 종류가 아니라 focus 상태(dim/match/selected)에서만 온다.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { readHashParams, writeHashParams } from "../layout/deepLink.js";

const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const ZOOM_STEP = 0.25;
const MAP_THRESHOLD = 0.85;
const FULL_THRESHOLD = 1.75;

export type ViewerNode = { id: string; label: string; sublabel?: string };

type Box = { id: string; x: number; y: number; width: number; height: number };

function naturalSize(svg: SVGSVGElement): { width: number; height: number } {
  const width = Number.parseFloat(svg.getAttribute("width") ?? "0");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "0");
  return { width: width || 1, height: height || 1 };
}

function depthOf(scale: number): "map" | "read" | "full" {
  if (scale < MAP_THRESHOLD) return "map";
  if (scale < FULL_THRESHOLD) return "read";
  return "full";
}

export function ViewerShell({
  viewKind,
  viewKey,
  nodes,
  freshness,
  freshnessNote,
  children,
}: {
  /** 딥링크 `view` 파라미터 값. 예: "scenario" | "trace" */
  viewKind: string;
  /** 지금 그려진 IR의 정체성. 바뀌면 focus·pan·radar를 리셋한다 */
  viewKey: string;
  nodes: ViewerNode[];
  freshness?: "current" | "needs_review";
  freshnessNote?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const [finderQuery, setFinderQuery] = useState("");
  const [radarOpen, setRadarOpen] = useState(false);
  const [radarBoxes, setRadarBoxes] = useState<Box[]>([]);
  const drag = useRef<{ startX: number; startY: number; panX: number; panY: number; moved: boolean } | null>(null);
  const restoredKeyRef = useRef<string | null>(null);

  const fitToContent = useCallback(() => {
    const container = canvasRef.current;
    const svg = container?.querySelector("svg");
    if (!container || !svg) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const size = naturalSize(svg);
    const padding = 32;
    const nextScale = Math.max(
      MIN_SCALE,
      Math.min(1, (container.clientWidth - padding * 2) / size.width, (container.clientHeight - padding * 2) / size.height),
    );
    setScale(nextScale);
    setPan({
      x: (container.clientWidth - size.width * nextScale) / 2,
      y: (container.clientHeight - size.height * nextScale) / 2,
    });
  }, []);

  // 뷰가 바뀌면(다른 시나리오/다른 anchor) 상호작용 상태를 리셋한다.
  useEffect(() => {
    setFocusId(null);
    setRadarOpen(false);
    setFinderOpen(false);
    setFinderQuery("");
    const frame = requestAnimationFrame(fitToContent);
    return () => cancelAnimationFrame(frame);
  }, [viewKey, fitToContent]);

  // 딥링크 복원: `#view=<kind>&focus=<id>` — 이 뷰가 이미 화면에 그려진 뒤 한 번만.
  useEffect(() => {
    if (restoredKeyRef.current === viewKey) return;
    restoredKeyRef.current = viewKey;
    const params = readHashParams();
    if (params.view !== viewKind) return;
    const target = params.focus;
    if (target && nodes.some((n) => n.id === target)) {
      setFocusId(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, viewKind]);

  const applyFocusToDom = useCallback((id: string | null) => {
    const root = canvasRef.current;
    if (!root) return;
    const nodeEls = root.querySelectorAll("[data-node-id]");
    const edgeEls = root.querySelectorAll("[data-edge-from]");
    if (!id) {
      nodeEls.forEach((el) => el.removeAttribute("data-focus-state"));
      edgeEls.forEach((el) => el.removeAttribute("data-focus-state"));
      return;
    }
    const neighbors = new Set<string>([id]);
    edgeEls.forEach((el) => {
      const from = el.getAttribute("data-edge-from");
      const to = el.getAttribute("data-edge-to");
      const match = from === id || to === id;
      el.setAttribute("data-focus-state", match ? "match" : "dim");
      if (match) {
        if (from) neighbors.add(from);
        if (to) neighbors.add(to);
      }
    });
    nodeEls.forEach((el) => {
      const nodeId = el.getAttribute("data-node-id");
      el.setAttribute("data-focus-state", nodeId === id ? "selected" : neighbors.has(nodeId ?? "") ? "match" : "dim");
    });
  }, []);

  useLayoutEffect(() => {
    applyFocusToDom(focusId);
  }, [focusId, applyFocusToDom, viewKey]);

  const setFocus = useCallback(
    (id: string | null) => {
      setFocusId((prev) => (prev === id ? null : id));
      writeHashParams({ view: viewKind, focus: id ?? undefined });
    },
    [viewKind],
  );

  const zoomTo = useCallback((nextScale: number, anchor?: { clientX: number; clientY: number }) => {
    const container = canvasRef.current;
    if (!container) return;
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    setScale((prevScale) => {
      const rect = container.getBoundingClientRect();
      const cx = anchor ? anchor.clientX - rect.left : rect.width / 2;
      const cy = anchor ? anchor.clientY - rect.top : rect.height / 2;
      setPan((prevPan) => {
        const contentX = (cx - prevPan.x) / prevScale;
        const contentY = (cy - prevPan.y) / prevScale;
        return { x: cx - contentX * clamped, y: cy - contentY * clamped };
      });
      return clamped;
    });
  }, []);

  const reset = useCallback(() => {
    fitToContent();
  }, [fitToContent]);

  const centerOnNode = useCallback(
    (id: string, targetScale?: number) => {
      const container = canvasRef.current;
      if (!container) return;
      const el = container.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
      if (!el || !(el instanceof SVGGraphicsElement)) return;
      const box = el.getBBox();
      const rect = container.getBoundingClientRect();
      const nextScale = Math.max(scale, targetScale ?? 1.1);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      setScale(nextScale);
      setPan({ x: rect.width / 2 - cx * nextScale, y: rect.height / 2 - cy * nextScale });
    },
    [scale],
  );

  const collectRadarBoxes = useCallback((): Box[] => {
    const root = canvasRef.current;
    if (!root) return [];
    const boxes: Box[] = [];
    root.querySelectorAll("[data-node-id]").forEach((el) => {
      if (!(el instanceof SVGGraphicsElement)) return;
      const id = el.getAttribute("data-node-id");
      if (!id) return;
      try {
        const b = el.getBBox();
        boxes.push({ id, x: b.x, y: b.y, width: Math.max(2, b.width), height: Math.max(2, b.height) });
      } catch {
        // getBBox는 아직 attach되지 않은 요소에서 던질 수 있다 — 조용히 건너뛴다
      }
    });
    return boxes;
  }, []);

  useEffect(() => {
    if (!radarOpen) return;
    setRadarBoxes(collectRadarBoxes());
  }, [radarOpen, viewKey, collectRadarBoxes]);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (drag.current?.moved) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-node-id]");
      if (target) {
        const id = target.getAttribute("data-node-id");
        if (id) setFocus(id);
        return;
      }
      if (focusId) setFocus(null);
    },
    [focusId, setFocus],
  );

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, .viewer-toolbar, .viewer-radar")) return;
    drag.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y, moved: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.startX;
    const dy = event.clientY - drag.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setPan({ x: drag.current.panX + dx, y: drag.current.panY + dy });
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      // 클릭 핸들러가 이번 pointerup 직후 곧바로 실행되므로, 이번 tick 안에서만 moved를 유지한다
      const moved = drag.current.moved;
      if (moved) setTimeout(() => { drag.current = null; }, 0);
      else drag.current = null;
    }
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -ZOOM_STEP / 2 : ZOOM_STEP / 2;
      zoomTo(scale + delta, { clientX: event.clientX, clientY: event.clientY });
    },
    [scale, zoomTo],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        if (finderOpen) { setFinderOpen(false); return; }
        if (radarOpen) { setRadarOpen(false); return; }
        if (focusId) setFocus(null);
        return;
      }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomTo(scale + ZOOM_STEP); }
      else if (event.key === "-") { event.preventDefault(); zoomTo(scale - ZOOM_STEP); }
      else if (event.key === "0") { event.preventDefault(); reset(); }
      else if (event.key === "/") { event.preventDefault(); setFinderOpen(true); }
    },
    [focusId, scale, zoomTo, reset, setFocus, finderOpen, radarOpen],
  );

  const handleRadarClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const svg = event.currentTarget;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const local = point.matrixTransform(matrix.inverse());
      const container = canvasRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setPan({ x: rect.width / 2 - local.x * scale, y: rect.height / 2 - local.y * scale });
    },
    [scale],
  );

  const filteredNodes =
    finderQuery.trim().length === 0
      ? nodes.slice(0, 30)
      : nodes.filter((n) => (n.label + " " + n.id).toLowerCase().includes(finderQuery.trim().toLowerCase())).slice(0, 30);

  const depth = depthOf(scale);
  const svgForRadar = canvasRef.current?.querySelector("svg");
  const radarNatural = svgForRadar ? naturalSize(svgForRadar) : { width: 1, height: 1 };
  const container = canvasRef.current;
  const viewportRect = container
    ? {
        x: Math.max(0, -pan.x / scale),
        y: Math.max(0, -pan.y / scale),
        width: Math.min(radarNatural.width, container.clientWidth / scale),
        height: Math.min(radarNatural.height, container.clientHeight / scale),
      }
    : { x: 0, y: 0, width: radarNatural.width, height: radarNatural.height };

  return (
    <div className="viewer-shell" data-depth={depth}>
      <div className="viewer-toolbar">
        <button type="button" onClick={() => setFinderOpen((v) => !v)} title="노드 찾기 (/)">
          🔍 찾기
        </button>
        <button type="button" onClick={() => setRadarOpen((v) => !v)} title="전체 지도">
          🗺 지도
        </button>
        <span className="viewer-toolbar-gap" />
        <button type="button" onClick={() => zoomTo(scale - ZOOM_STEP)} disabled={scale <= MIN_SCALE} title="축소 (-)">
          −
        </button>
        <button type="button" className="viewer-zoom-reset" onClick={reset} title="화면에 맞춤 (0)">
          {Math.round(scale * 100)}%
        </button>
        <button type="button" onClick={() => zoomTo(scale + ZOOM_STEP)} disabled={scale >= MAX_SCALE} title="확대 (+)">
          +
        </button>
      </div>

      {freshness === "needs_review" && (
        <p className="freshness-banner">
          코드가 바뀌었지만 이 화면은 아직 최신이 아닙니다{freshnessNote ? ` — ${freshnessNote}` : ""}. 여전히 읽을 수
          있습니다.
        </p>
      )}

      {finderOpen && (
        <div className="viewer-finder">
          <input
            type="text"
            autoFocus
            placeholder="label 또는 id로 찾기"
            value={finderQuery}
            onChange={(e) => setFinderQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setFinderOpen(false);
              const first = filteredNodes[0];
              if (e.key === "Enter" && first) {
                setFocus(first.id);
                centerOnNode(first.id);
                setFinderOpen(false);
              }
            }}
          />
          <ul className="viewer-finder-results">
            {filteredNodes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    setFocus(n.id);
                    centerOnNode(n.id);
                    setFinderOpen(false);
                  }}
                >
                  <strong>{n.label}</strong>
                  {n.sublabel && <span className="dim"> · {n.sublabel}</span>}
                </button>
              </li>
            ))}
            {filteredNodes.length === 0 && <li className="dim">일치하는 노드가 없습니다</li>}
          </ul>
        </div>
      )}

      {radarOpen && (
        <div className="viewer-radar">
          <svg
            viewBox={`0 0 ${radarNatural.width} ${radarNatural.height}`}
            onClick={handleRadarClick}
            role="img"
            aria-label="전체 지도"
          >
            {radarBoxes.map((box) => (
              <rect
                key={box.id}
                className="radar-node"
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                data-selected={box.id === focusId ? "true" : undefined}
              />
            ))}
            <rect
              className="radar-viewport"
              x={viewportRect.x}
              y={viewportRect.y}
              width={viewportRect.width}
              height={viewportRect.height}
            />
          </svg>
        </div>
      )}

      <div
        className="viewer-canvas"
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label="다이어그램 캔버스. 화살표 키 대신 검색과 클릭으로 탐색합니다"
        onClick={handleCanvasClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        data-panning={drag.current ? "true" : undefined}
      >
        <div className="viewer-pan" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
