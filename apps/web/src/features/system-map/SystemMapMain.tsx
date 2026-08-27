import { useEffect, useRef, useState } from "react";
import type { AudiencePresentation, SystemMapDocument, SystemMapSource } from "@vci/protocol";
import type { SystemMapFeatureState } from "./useSystemMapFeature.js";

type ThemeChoice = "system" | "light" | "dark";

function nextTheme(current: ThemeChoice): ThemeChoice {
  if (current === "system") return "light";
  if (current === "light") return "dark";
  return "system";
}

function themeButtonLabel(choice: ThemeChoice): string {
  if (choice === "system") return "테마: 시스템 기본값";
  if (choice === "light") return "테마: 라이트 모드";
  return "테마: 다크 모드";
}

// render.ts(@vci/system-map)가 SVG에 직접 심는 속성/클래스 이름과 정확히 맞춘 것 —
// packages/system-map/src/render.ts를 직접 확인해서 가져왔다.
type SelectedEntity = { kind: "component" | "boundary" | "connection"; id: string; semanticRefs: string[] };
const ENTITY_ATTR: Record<SelectedEntity["kind"], string> = {
  component: "data-component-id",
  boundary: "data-boundary-id",
  connection: "data-connection-id",
};
const SELECTED_CLASS = "av-selected";

function parseSemanticRefs(el: Element): string[] {
  const raw = el.getAttribute("data-semantic-refs");
  return raw ? raw.split(",") : [];
}

function resolveSimpleLabel(entity: { label: string; presentation?: AudiencePresentation }): string {
  return entity.presentation?.simple?.label ?? entity.label;
}

function resolveSimpleSublabel(entity: { sublabel?: string; presentation?: AudiencePresentation }): string | undefined {
  const override = entity.presentation?.simple?.sublabel;
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

function Inspector({ document: doc, entity }: { document: SystemMapDocument; entity: SelectedEntity }) {
  if (entity.kind === "component") {
    const component = doc.components.find((c) => c.id === entity.id);
    if (!component) return null;
    const label = resolveSimpleLabel(component);
    const sublabel = resolveSimpleSublabel(component);
    return (
      <div className="system-map-inspector">
        <h2>{label}</h2>
        <p className="system-map-inspector-role">{ROLE_LABELS[component.semanticRole] ?? component.semanticRole}</p>
        {sublabel && (
          <>
            <h3>역할</h3>
            <p>{sublabel}</p>
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
        <h2>{resolveSimpleLabel(boundary)}</h2>
        <p className="system-map-inspector-role">{boundary.kind}</p>
      </div>
    );
  }

  const connection = doc.connections.find((c) => c.id === entity.id);
  if (!connection) return null;
  const label = connection.presentation?.simple?.label ?? connection.label ?? `${connection.from} → ${connection.to}`;
  return (
    <div className="system-map-inspector">
      <h2>{label}</h2>
      <p className="system-map-inspector-role">
        {connection.from} → {connection.to}
      </p>
    </div>
  );
}

export function SystemMapMain(state: SystemMapFeatureState) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [selected, setSelected] = useState<SelectedEntity | null>(null);

  const svg = state.result?.svg ?? "";

  // theme 선택을 이미 마운트된 <svg class="av-root">에 직접 반영한다 — SVG 문자열을
  // 다시 만들지 않는다(render.ts가 CSS 커스텀 프로퍼티로 라이트/다크를 이미 지원한다).
  useEffect(() => {
    const root = mountRef.current?.querySelector("svg.av-root");
    if (!root) return;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme, svg]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    container.querySelectorAll(`.${SELECTED_CLASS}`).forEach((el) => el.classList.remove(SELECTED_CLASS));
    if (!selected) return;
    const attr = ENTITY_ATTR[selected.kind];
    const match = container.querySelector(`[${attr}="${CSS.escape(selected.id)}"]`);
    match?.classList.add(SELECTED_CLASS);
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
        <button type="button" onClick={() => setTheme(nextTheme(theme))}>
          {themeButtonLabel(theme)}
        </button>
      </div>

      {/* svg는 이 저장소 안의 @vci/system-map 렌더러가 만든 신뢰된 문자열이라
          dangerouslySetInnerHTML이 안전하다 (외부/사용자 입력이 아님). */}
      <div ref={mountRef} className="system-map-svg-mount" onClick={handleMountClick} dangerouslySetInnerHTML={{ __html: svg }} />

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
