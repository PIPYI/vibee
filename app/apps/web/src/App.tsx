import { useState } from "react";

import { Sidebar, type FeatureId } from "./components/Sidebar.js";
import { TopBar } from "./components/TopBar.js";
import { ComingSoon } from "./features/ComingSoon.js";
import { ArchitectureMain } from "./features/architecture/ArchitectureMain.js";
import { ArchitecturePanel } from "./features/architecture/ArchitecturePanel.js";
import { useArchitectureFeature } from "./features/architecture/useArchitectureFeature.js";
import { DesignMain } from "./features/design/DesignMain.js";
import { DesignPanel } from "./features/design/DesignPanel.js";
import { useDesignFeature } from "./features/design/useDesignFeature.js";
import { DriftMain } from "./features/drift/DriftMain.js";
import { DriftPanel } from "./features/drift/DriftPanel.js";
import { useDriftFeature } from "./features/drift/useDriftFeature.js";

const FEATURE_LABELS: Record<FeatureId, string> = {
  design: "Design",
  drift: "Drift",
  architecture: "구조·기술부채",
  wiki: "Wiki",
  analysis: "Analysis",
};

export function App() {
  const [feature, setFeature] = useState<FeatureId>("design");
  const design = useDesignFeature();
  const drift = useDriftFeature();
  const architecture = useArchitectureFeature();

  return (
    <div className="shell">
      <Sidebar active={feature} onSelect={setFeature} />
      <TopBar projectPath={design.projectPath} tasks={design.tasks} />
      <div className="body">
        <aside className="panel">
          <h2>{FEATURE_LABELS[feature]}</h2>
          {feature === "design" && <DesignPanel {...design} />}
          {feature === "drift" && <DriftPanel {...drift} />}
          {feature === "architecture" && <ArchitecturePanel {...architecture} />}
          {feature === "wiki" && <ComingSoon label={FEATURE_LABELS[feature]} />}
          {feature === "analysis" && <ComingSoon label={FEATURE_LABELS[feature]} />}
        </aside>
        <main className="main">
          {feature === "design" && <DesignMain {...design} />}
          {feature === "drift" && <DriftMain {...drift} />}
          {feature === "architecture" && <ArchitectureMain {...architecture} />}
        </main>
      </div>
    </div>
  );
}
