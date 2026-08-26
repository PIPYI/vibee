export type FeatureId = "design" | "drift" | "architecture" | "wiki" | "analysis";

const FEATURES: Array<{ id: FeatureId; icon: string; label: string; available: boolean }> = [
  { id: "design", icon: "📝", label: "Design", available: true },
  { id: "drift", icon: "🔀", label: "Drift", available: true },
  { id: "architecture", icon: "🏗️", label: "구조", available: true },
  { id: "wiki", icon: "📚", label: "Wiki", available: false },
  { id: "analysis", icon: "🗺️", label: "Analysis", available: false },
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
      {FEATURES.map((feature) => (
        <button
          key={feature.id}
          className={`rail-item${feature.id === active ? " active" : ""}`}
          disabled={!feature.available}
          title={feature.available ? feature.label : `${feature.label} — 준비 중`}
          onClick={() => onSelect(feature.id)}
        >
          <span className="icon">{feature.icon}</span>
          <span>{feature.label}</span>
        </button>
      ))}
      <div className="rail-spacer" />
    </nav>
  );
}
