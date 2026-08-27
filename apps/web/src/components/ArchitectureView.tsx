import { useEffect, useRef, useState } from "react";
import type { ArchitectureViewDocument } from "@vibee/protocol";
import { ArchitectureInspector, type SelectedArchitectureEntity } from "./ArchitectureInspector.tsx";

type Meta = { committedAt: string; gitRevision?: string; taskId: string };

type Props = {
  document: ArchitectureViewDocument;
  svg: string;
  meta: Meta;
};

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

export function ArchitectureView({ document: doc, svg, meta }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hoveredConnectionRef = useRef<string | null>(null);
  // selected is local to this component (not lifted to App.tsx):
  // ArchitectureView only ever mounts for phase "viewing", so it naturally
  // unmounts (and this resets) when the app goes back to "idle" for a new
  // analysis, while clicking entities within one viewing session never
  // re-triggers a mount -- exactly the reset semantics we need.
  const [selected, setSelected] = useState<SelectedArchitectureEntity | null>(null);

  // Re-applies the selection highlight to whichever DOM node currently
  // carries the selected entity's id -- this must re-run whenever the
  // mounted SVG string changes or the selection itself changes (a new click).
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    container.querySelectorAll(`.${SELECTED_CLASS}`).forEach((el) => el.classList.remove(SELECTED_CLASS));
    if (!selected) return;
    const attr = ENTITY_ATTR[selected.kind];
    const match = container.querySelector(`[${attr}="${CSS.escape(selected.id)}"]`);
    match?.classList.add(SELECTED_CLASS);
  }, [selected, svg]);

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

  function handleMountMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element;
    const connection = target.closest("[data-connection-id]");
    if (!connection) return;

    const connectionId = connection.getAttribute("data-connection-id");
    if (!connectionId || connectionId === hoveredConnectionRef.current) return;

    // Clear previous hover
    if (hoveredConnectionRef.current) {
      const prevConnection = mountRef.current?.querySelector(
        `[data-connection-id="${CSS.escape(hoveredConnectionRef.current)}"]`
      );
      if (prevConnection) {
        prevConnection.classList.remove("av-hover-active");
        const fromId = prevConnection.getAttribute("data-edge-from");
        const toId = prevConnection.getAttribute("data-edge-to");
        if (fromId) {
          mountRef.current?.querySelector(`[data-component-id="${CSS.escape(fromId)}"]`)?.classList.remove("av-hover-active");
        }
        if (toId) {
          mountRef.current?.querySelector(`[data-component-id="${CSS.escape(toId)}"]`)?.classList.remove("av-hover-active");
        }
      }
    }

    // Apply new hover
    connection.classList.add("av-hover-active");
    const fromId = connection.getAttribute("data-edge-from");
    const toId = connection.getAttribute("data-edge-to");
    if (fromId) {
      mountRef.current?.querySelector(`[data-component-id="${CSS.escape(fromId)}"]`)?.classList.add("av-hover-active");
    }
    if (toId) {
      mountRef.current?.querySelector(`[data-component-id="${CSS.escape(toId)}"]`)?.classList.add("av-hover-active");
    }

    hoveredConnectionRef.current = connectionId;
  }

  function handleMountMouseOut(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as Element;
    const connection = target.closest("[data-connection-id]");
    if (!connection || connection !== target.closest("[data-connection-id]")) return;

    // Check if we're leaving the connection entirely
    const relatedTarget = e.relatedTarget as Element | null;
    const connectionElement = mountRef.current?.querySelector(
      `[data-connection-id="${CSS.escape(hoveredConnectionRef.current || "")}"]`
    );

    if (!relatedTarget || !connectionElement?.contains(relatedTarget)) {
      if (hoveredConnectionRef.current) {
        const prevConnection = mountRef.current?.querySelector(
          `[data-connection-id="${CSS.escape(hoveredConnectionRef.current)}"]`
        );
        if (prevConnection) {
          prevConnection.classList.remove("av-hover-active");
          const fromId = prevConnection.getAttribute("data-edge-from");
          const toId = prevConnection.getAttribute("data-edge-to");
          if (fromId) {
            mountRef.current?.querySelector(`[data-component-id="${CSS.escape(fromId)}"]`)?.classList.remove("av-hover-active");
          }
          if (toId) {
            mountRef.current?.querySelector(`[data-component-id="${CSS.escape(toId)}"]`)?.classList.remove("av-hover-active");
          }
        }
        hoveredConnectionRef.current = null;
      }
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
      </header>

      {/* svg is a trusted, server-rendered string produced by
          @vibee/architecture-view's own renderer in this same repo (not
          third-party/untrusted input), so dangerouslySetInnerHTML is safe
          here. */}
      <div
        ref={mountRef}
        className="svg-mount"
        onClick={handleMountClick}
        onMouseOver={handleMountMouseOver}
        onMouseOut={handleMountMouseOut}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {selected && (
        <ArchitectureInspector
          document={doc}
          entity={selected}
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
