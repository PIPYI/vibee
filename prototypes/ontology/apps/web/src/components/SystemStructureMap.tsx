/** AI가 저작한 시스템 구조 지도를 ViewerShell과 근거 패널 안에서 보여 준다. */
import { useEffect, useMemo, useRef, useState } from "react";

import type { ArchitectureViewDocument, ArchitectureViewSource } from "@onto/protocol";

import { ViewerShell } from "./ViewerShell.js";

type SelectedSources = { label: string; sources: ArchitectureViewSource[] };

function parseSources(value: string | null): ArchitectureViewSource[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ArchitectureViewSource =>
        typeof item === "object" && item !== null && "path" in item && typeof item.path === "string",
    );
  } catch {
    return [];
  }
}

function sourceLocation(source: ArchitectureViewSource): string {
  if (!source.line) return source.path;
  return `${source.path}:${source.line}${source.endLine && source.endLine !== source.line ? `-${source.endLine}` : ""}`;
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function SystemStructureMap({
  svg,
  document,
  highlightedSourcePaths = new Set<string>(),
}: {
  svg: string;
  document?: ArchitectureViewDocument | null;
  /** 선택한 여정의 evidence가 가리킨 파일. SVG의 sources[]와 경로 단위로 맞춘다. */
  highlightedSourcePaths?: ReadonlySet<string>;
}): React.JSX.Element {
  const [selectedSources, setSelectedSources] = useState<SelectedSources | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const nodes = useMemo(
    () => (document?.components ?? []).map((component) => ({ id: component.id, label: component.label, ...(component.sublabel ? { sublabel: component.sublabel } : {}) })),
    [document],
  );
  const viewKey = useMemo(
    () => document
      ? `${document.title}:${document.components.map((component) => component.id).join(",")}`
      : svg,
    [document, svg],
  );

  const selectSources = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest("[data-sources]") : null;
    if (!target) return;
    const sources = parseSources(target.getAttribute("data-sources"));
    if (sources.length === 0) return;
    const label = target.getAttribute("data-component-id") ?? target.getAttribute("data-connection-id") ?? "선택한 요소";
    setSelectedSources({ label, sources });
  };

  // ArchitectureViewDocument에는 evidence ID가 아니라 sources(path/line)가 있다. 따라서
  // 여정 evidence를 파일 경로로 해석한 뒤, 이 경계에서만 path prefix를 비교한다.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>("[data-sources]").forEach((element) => {
      const matched = [...highlightedSourcePaths].some((path) =>
        parseSources(element.getAttribute("data-sources")).some((source) => pathsOverlap(source.path, path)),
      );
      if (matched) element.setAttribute("data-source-match", "true");
      else element.removeAttribute("data-source-match");
    });
  }, [svg, highlightedSourcePaths]);

  return (
    <div ref={rootRef} className="system-structure-map" onClick={selectSources}>
      <ViewerShell viewKind="system" viewKey={viewKey} nodes={nodes}>
        {/* 서버가 결정론적으로 만든 SVG 문자열이다 — 사용자 입력이 아니다. */}
        <div className="system-structure-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      </ViewerShell>

      {(document?.cards?.length ?? 0) > 0 && (
        <section className="system-structure-cards" aria-label="구조 지도 핵심 결론">
          {document!.cards!.map((card, index) => (
            <article key={`${card.title}-${index}`} className="system-structure-card">
              <h4>{card.dot && <i style={{ backgroundColor: card.dot }} />} {card.title}</h4>
              <ul>{card.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
            </article>
          ))}
        </section>
      )}

      {selectedSources && (
        <aside className="system-structure-sources" aria-label={`${selectedSources.label} 근거`}>
          <div>
            <p className="detail-eyebrow">근거</p>
            <h4>{selectedSources.label}</h4>
          </div>
          <button type="button" className="close-button" onClick={() => setSelectedSources(null)} aria-label="근거 패널 닫기">×</button>
          <ul>
            {selectedSources.sources.map((source, index) => (
              <li key={`${source.path}:${source.line ?? 0}:${index}`}>
                <code>{sourceLocation(source)}</code>{source.label ? ` · ${source.label}` : ""}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
