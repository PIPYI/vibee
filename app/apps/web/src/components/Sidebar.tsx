import type { ReactNode } from "react";

export type FeatureId = "design" | "drift" | "architecture" | "wiki" | "analysis";

const ICONS: Record<FeatureId, ReactNode> = {
  design: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  drift: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  ),
  architecture: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  wiki: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  analysis: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
};

const FEATURES: Array<{ id: FeatureId; label: string; available: boolean }> = [
  { id: "design", label: "설계하기", available: true },
  { id: "drift", label: "설계이탈관리", available: true },
  { id: "architecture", label: "구조개선", available: true },
  { id: "wiki", label: "위키", available: true },
  { id: "analysis", label: "구조파악", available: true },
];

export function Sidebar({
  active,
  onSelect,
}: {
  active: FeatureId;
  onSelect: (feature: FeatureId) => void;
}) {
  return (
    <nav className="rail">
      <div className="rail-brand" title="Vibe Coding Intelligence">
        VCI
      </div>
      {FEATURES.map((feature) => (
        <button
          key={feature.id}
          className={`rail-item${feature.id === active ? " active" : ""}`}
          disabled={!feature.available}
          title={feature.available ? feature.label : `${feature.label} — 준비 중`}
          onClick={() => onSelect(feature.id)}
        >
          <span className="icon">{ICONS[feature.id]}</span>
          <span>{feature.label}</span>
        </button>
      ))}
      <div className="rail-spacer" />
    </nav>
  );
}
