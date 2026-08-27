import type { ArchitectureAudience } from "@vibee/protocol";

type Props = {
  audience: ArchitectureAudience;
  onChange: (audience: ArchitectureAudience) => void;
};

// docs/v2_plan.md 14.6: a two-tab control that swaps which pre-rendered
// audience profile of the *same* committed document is shown. Switching
// tabs must never trigger a new analysis/fetch -- see ArchitectureView.tsx,
// which just swaps which already-fetched SVG string is mounted.
export function ArchitectureAudienceTabs({ audience, onChange }: Props) {
  return (
    <div className="audience-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={audience === "simple"}
        className={`audience-tab${audience === "simple" ? " audience-tab--active" : ""}`}
        onClick={() => onChange("simple")}
      >
        쉬운 보기
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={audience === "technical"}
        className={`audience-tab${audience === "technical" ? " audience-tab--active" : ""}`}
        onClick={() => onChange("technical")}
      >
        기술 구조
      </button>
    </div>
  );
}
