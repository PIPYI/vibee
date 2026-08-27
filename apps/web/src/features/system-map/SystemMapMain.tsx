import { useEffect, useRef, useState } from "react";
import type { SystemMapDocument, SystemMapSource } from "@vci/protocol";
import type { SystemMapFeatureState } from "./useSystemMapFeature.js";

// render.ts(@vci/system-map)가 SVG에 직접 심는 속성/클래스 이름과 정확히 맞춘 것 —
// packages/system-map/src/render.ts를 직접 확인해서 가져왔다.
type SelectedEntity = { kind: "component" | "boundary" | "connection"; id: string; semanticRefs: string[] };
const ENTITY_ATTR: Record<SelectedEntity["kind"], string> = {
  component: "data-component-id",
  boundary: "data-boundary-id",
  connection: "data-connection-id",
};
const SELECTED_CLASS = "av-selected";
const HOVER_CLASS = "av-hover-active";

function parseSemanticRefs(el: Element): string[] {
  const raw = el.getAttribute("data-semantic-refs");
  return raw ? raw.split(",") : [];
}

function connectionSelector(connectionId: string): string {
  return `[data-connection-id="${CSS.escape(connectionId)}"]`;
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

function Inspector({ document: doc, entity }: { document: SystemMapDocument; entity: SelectedEntity }) {
  if (entity.kind === "component") {
    const component = doc.components.find((c) => c.id === entity.id);
    if (!component) return null;
    return (
      <div className="system-map-inspector">
        <h2>{component.label}</h2>
        <p className="system-map-inspector-role">{ROLE_LABELS[component.semanticRole] ?? component.semanticRole}</p>
        {component.sublabel && (
          <>
            <h3>구현</h3>
            <p>{component.sublabel}</p>
          </>
        )}
        {component.sources && component.sources.length > 0 && (
          <>
            <h3>Sources</h3>
            <ul className="system-map-inspector-sources">
              {component.sources.map((source: SystemMapSource, i: number) => (
                <li key={i}>{formatSource(source)}</li>
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
      <div className="system-map-inspector">
        <h2>{boundary.label}</h2>
        <p className="system-map-inspector-role">{boundary.kind}</p>
      </div>
    );
  }

  const connection = doc.connections.find((c) => c.id === entity.id);
  if (!connection) return null;
  return (
    <div className="system-map-inspector">
      <h2>{connection.label ?? `${connection.from} → ${connection.to}`}</h2>
      <p className="system-map-inspector-role">
        {connection.from} → {connection.to}
      </p>
    </div>
  );
}

export function SystemMapMain(state: SystemMapFeatureState) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hoveredConnectionRef = useRef<string | null>(null);
  const [selected, setSelected] = useState<SelectedEntity | null>(null);

  const svg = state.result?.svg ?? "";

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    container.querySelectorAll(`.${SELECTED_CLASS}`).forEach((el) => el.classList.remove(SELECTED_CLASS));
    if (!selected) return;
    const attr = ENTITY_ATTR[selected.kind];
    container.querySelectorAll(`[${attr}="${CSS.escape(selected.id)}"]`).forEach((el) => el.classList.add(SELECTED_CLASS));
  }, [selected, svg]);

  useEffect(() => {
    setSelected(null);
  }, [state.result]);

  if (!state.result) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
        </div>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text)" }}>시스템 맵 대기</h3>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5, maxWidth: 420 }}>
          왼쪽에서 프로젝트 경로를 입력하고 시스템 맵 생성을 시작하세요. AI가 코드를 읽고 실행 중
          아키텍처를 SVG 다이어그램으로 그려줍니다.
        </p>
      </div>
    );
  }

  const { document: doc, meta } = state.result;

  function handleMountClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element;
    const hit = target.closest("[data-component-id],[data-boundary-id],[data-connection-id]");
    if (!hit) return;
    if (hit.hasAttribute("data-component-id")) {
      setSelected({ kind: "component", id: hit.getAttribute("data-component-id")!, semanticRefs: parseSemanticRefs(hit) });
    } else if (hit.hasAttribute("data-boundary-id")) {
      setSelected({ kind: "boundary", id: hit.getAttribute("data-boundary-id")!, semanticRefs: parseSemanticRefs(hit) });
    } else if (hit.hasAttribute("data-connection-id")) {
      setSelected({ kind: "connection", id: hit.getAttribute("data-connection-id")!, semanticRefs: parseSemanticRefs(hit) });
    }
  }

  // 연결선에 마우스를 올리면 그 선과 양 끝 컴포넌트를 같이 강조한다 — render.ts가 이미
  // .av-hover-active용 스타일(선 두께, 라벨 말줄임→전체 텍스트 전환, 컴포넌트 확대)을
  // SVG 자체에 심어 두었으니, 여기서는 클래스만 토글하면 된다.
  function setConnectionHover(connectionId: string, active: boolean) {
    const container = mountRef.current;
    if (!container) return;
    const connectionParts = [...container.querySelectorAll(connectionSelector(connectionId))];
    connectionParts.forEach((part) => part.classList.toggle(HOVER_CLASS, active));

    const connection = connectionParts[0];
    const fromId = connection?.getAttribute("data-edge-from");
    const toId = connection?.getAttribute("data-edge-to");
    if (fromId) container.querySelector(`[data-component-id="${CSS.escape(fromId)}"]`)?.classList.toggle(HOVER_CLASS, active);
    if (toId) container.querySelector(`[data-component-id="${CSS.escape(toId)}"]`)?.classList.toggle(HOVER_CLASS, active);
  }

  function handleMountMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element;
    const connection = target.closest("[data-connection-id]");
    if (!connection) return;
    const connectionId = connection.getAttribute("data-connection-id");
    if (!connectionId || connectionId === hoveredConnectionRef.current) return;
    if (hoveredConnectionRef.current) setConnectionHover(hoveredConnectionRef.current, false);
    setConnectionHover(connectionId, true);
    hoveredConnectionRef.current = connectionId;
  }

  function handleMountMouseOut(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element;
    const connection = target.closest("[data-connection-id]");
    if (!connection) return;
    const relatedTarget = e.relatedTarget as Element | null;
    const connectionId = connection.getAttribute("data-connection-id");
    const relatedConnectionId = relatedTarget?.closest?.("[data-connection-id]")?.getAttribute("data-connection-id");
    if (!connectionId || relatedConnectionId === connectionId || hoveredConnectionRef.current !== connectionId) return;
    setConnectionHover(connectionId, false);
    hoveredConnectionRef.current = null;
  }

  return (
    <div className="system-map-view">
      <div className="system-map-header">
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{doc.title}</h1>
          <p className="meta-caption" style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
            커밋 시각: {new Date(meta.committedAt).toLocaleString("ko-KR")}
            {meta.gitRevision && <> · 리비전 {meta.gitRevision.slice(0, 12)}</>}
          </p>
        </div>
      </div>

      {/* svg는 이 저장소 안의 @vci/system-map 렌더러가 만든 신뢰된 문자열이라
          dangerouslySetInnerHTML이 안전하다 (외부/사용자 입력이 아님). */}
      <div
        ref={mountRef}
        className="system-map-svg-mount"
        onClick={handleMountClick}
        onMouseOver={handleMountMouseOver}
        onMouseOut={handleMountMouseOut}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {selected && <Inspector document={doc} entity={selected} />}

      {doc.cards && doc.cards.length > 0 && (
        <div className="system-map-cards">
          {doc.cards.map((card, i) => (
            <section key={i} className="system-map-card">
              <h3>
                {card.dot && <span className="system-map-card-dot" style={{ background: card.dot }} />}
                {card.title}
              </h3>
              <ul>
                {card.items.map((item, ii) => (
                  <li key={ii}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
