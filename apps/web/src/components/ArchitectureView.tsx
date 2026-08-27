import { useEffect, useRef, useState } from "react";
import type { ArchitectureAudience, ArchitectureViewDocument } from "@vibee/protocol";
import { ArchitectureAudienceTabs } from "./ArchitectureAudienceTabs.tsx";
import { ArchitectureInspector, type SelectedArchitectureEntity } from "./ArchitectureInspector.tsx";

type Meta = { committedAt: string; gitRevision?: string; taskId: string };

type Props = {
  document: ArchitectureViewDocument;
  svgByAudience: { simple: string; technical: string };
  meta: Meta;
};

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

// The exact attribute/class names render.ts embeds in its SVG output (see
// packages/architecture-view/src/render.ts) -- verified against that file
// directly, not assumed.
const ENTITY_ATTR: Record<SelectedArchitectureEntity["kind"], string> = {
  component: "data-component-id",
  boundary: "data-boundary-id",
  connection: "data-connection-id",
};
const SELECTED_CLASS = "av-selected";

function parseSemanticRefs(el: Element): string[] {
  const raw = el.getAttribute("data-semantic-refs");
  return raw ? raw.split(",") : [];
}

export function ArchitectureView({ document: doc, svgByAudience, meta }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  // audience/selected are local to this component (not lifted to App.tsx):
  // ArchitectureView only ever mounts for phase "viewing", so it naturally
  // unmounts (and these reset) when the app goes back to "idle" for a new
  // analysis, while switching tabs or clicking entities within one viewing
  // session never re-triggers a mount -- exactly the reset semantics
  // docs/v2_plan.md 14.6/18 asks for, with no extra state-lifting needed.
  const [audience, setAudience] = useState<ArchitectureAudience>("simple");
  const [selected, setSelected] = useState<SelectedArchitectureEntity | null>(null);

  const currentSvg = audience === "simple" ? svgByAudience.simple : svgByAudience.technical;

  // Flips data-theme directly on the already-mounted <svg class="av-root">
  // element -- no re-fetch, no re-render of the SVG string itself. This is
  // meant to exercise render.ts's CSS-custom-property theme design (light
  // default + prefers-color-scheme + [data-theme] override) end to end.
  useEffect(() => {
    const root = mountRef.current?.querySelector("svg.av-root");
    if (!root) return;
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme, currentSvg]);

  // Re-applies the selection highlight to whichever DOM node currently
  // carries the selected entity's id -- this must re-run whenever the
  // mounted SVG string changes (audience switch swaps in a whole fresh DOM
  // tree) or the selection itself changes (a new click). If the selected
  // entity is `visibility: "hide"` in this audience, render.ts never emits
  // a matching node here, so the querySelector below simply finds nothing
  // and no highlight is drawn -- the inspector (driven by `selected`
  // independently of the DOM) still shows the entity's info.
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    container.querySelectorAll(`.${SELECTED_CLASS}`).forEach((el) => el.classList.remove(SELECTED_CLASS));
    if (!selected) return;
    const attr = ENTITY_ATTR[selected.kind];
    const match = container.querySelector(`[${attr}="${CSS.escape(selected.id)}"]`);
    match?.classList.add(SELECTED_CLASS);
  }, [selected, currentSvg]);

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
    <div className="architecture-view">
      <header className="architecture-view-header">
        <div>
          <h1>{doc.title}</h1>
          <p className="meta-caption">
            커밋 시각: {new Date(meta.committedAt).toLocaleString("ko-KR")}
            {meta.gitRevision && <> · 리비전 {meta.gitRevision.slice(0, 12)}</>}
          </p>
        </div>
        <button type="button" onClick={() => setTheme(nextTheme(theme))}>
          {themeButtonLabel(theme)}
        </button>
      </header>

      <ArchitectureAudienceTabs audience={audience} onChange={setAudience} />

      {/* svg is a trusted, server-rendered string produced by
          @vibee/architecture-view's own renderer in this same repo (not
          third-party/untrusted input), so dangerouslySetInnerHTML is safe
          here. */}
      <div
        ref={mountRef}
        className="svg-mount"
        onClick={handleMountClick}
        dangerouslySetInnerHTML={{ __html: currentSvg }}
      />

      {selected && (
        <ArchitectureInspector
          audience={audience}
          document={doc}
          entity={selected}
          onViewTechnical={() => setAudience("technical")}
        />
      )}

      {doc.cards && doc.cards.length > 0 && (
        <div className="cards">
          {doc.cards.map((card, i) => (
            <section key={i} className="card">
              <h3>
                {card.dot && <span className="card-dot" style={{ background: card.dot }} />}
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
