import { useState } from "react";

import { Sidebar, type FeatureId } from "./components/Sidebar.js";
import { TopBar } from "./components/TopBar.js";
import { ComingSoon } from "./features/ComingSoon.js";
import { DesignMain } from "./features/design/DesignMain.js";
import { DesignPanel } from "./features/design/DesignPanel.js";
import { useDesignFeature } from "./features/design/useDesignFeature.js";

const FEATURE_LABELS: Record<FeatureId, string> = {
  design: "Design",
  drift: "Drift",
  architecture: "구조·기술부채",
  wiki: "Wiki",
  analysis: "Analysis",
};

export function App() {
  const [feature, setFeature] = useState<FeatureId>("design");
  // 지금은 Design만 실제로 연결돼 있다 — 다른 기능이 이식되면 각자의 훅으로 교체한다.
  const design = useDesignFeature();

  return (
    <div className="shell">
      <Sidebar active={feature} onSelect={setFeature} />
      <TopBar projectPath={design.projectPath} tasks={design.tasks} />
      <div className="body">
        <aside className="panel">
          <h2>{FEATURE_LABELS[feature]}</h2>
          {feature === "design" ? <DesignPanel {...design} /> : <ComingSoon label={FEATURE_LABELS[feature]} />}
        </aside>
        <main className="main">{feature === "design" ? <DesignMain {...design} /> : null}</main>
      </div>
    </div>
  );
}
