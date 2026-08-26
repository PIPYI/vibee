import { useEffect, useRef, useState } from "react";
import type { ArchitectureViewDocument } from "@vibee/protocol";

type Meta = { committedAt: string; gitRevision?: string; taskId: string };

type Props = {
  document: ArchitectureViewDocument;
  svg: string;
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

export function ArchitectureView({ document: doc, svg, meta }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<ThemeChoice>("system");

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
  }, [theme, svg]);

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

      {/* svg is a trusted, server-rendered string produced by
          @vibee/architecture-view's own renderer in this same repo (not
          third-party/untrusted input), so dangerouslySetInnerHTML is safe
          here. */}
      <div ref={mountRef} className="svg-mount" dangerouslySetInnerHTML={{ __html: svg }} />

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
