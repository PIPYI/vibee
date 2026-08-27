import { useState } from "react";

import { Sidebar, type FeatureId } from "./components/Sidebar.js";
import { TopBar } from "./components/TopBar.js";
import { ResultPanel } from "./components/ResultPanel.js";
import { ArchitectureMain } from "./features/architecture/ArchitectureMain.js";
import { ArchitecturePanel } from "./features/architecture/ArchitecturePanel.js";
import { useArchitectureFeature } from "./features/architecture/useArchitectureFeature.js";
import { SystemMapMain } from "./features/system-map/SystemMapMain.js";
import { SystemMapPanel } from "./features/system-map/SystemMapPanel.js";
import { useSystemMapFeature } from "./features/system-map/useSystemMapFeature.js";
import { DesignMain } from "./features/design/DesignMain.js";
import { DesignPanel } from "./features/design/DesignPanel.js";
import { useDesignFeature } from "./features/design/useDesignFeature.js";
import { DriftMain } from "./features/drift/DriftMain.js";
import { DriftPanel } from "./features/drift/DriftPanel.js";
import { useDriftFeature } from "./features/drift/useDriftFeature.js";
import { WikiMain } from "./features/wiki/WikiMain.js";
import { WikiPanel } from "./features/wiki/WikiPanel.js";
import { useWikiFeature } from "./features/wiki/useWikiFeature.js";

const FEATURE_LABELS: Record<FeatureId, string> = {
  design: "설계하기",
  drift: "설계이탈관리",
  architecture: "구조개선",
  wiki: "위키",
  analysis: "구조파악",
};

export function App() {
  const [feature, setFeature] = useState<FeatureId>("design");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const design = useDesignFeature();
  const drift = useDriftFeature();
  const architecture = useArchitectureFeature();
  const wiki = useWikiFeature();
  const systemMap = useSystemMapFeature();
  const latestResultTask = design.tasks.filter((task) => task.result).at(-1);

  return (
    <div className="shell">
      <Sidebar active={feature} onSelect={setFeature} />
      <TopBar projectPath={design.projectPath} tasks={design.tasks} />
      <div className={`body${panelCollapsed ? " panel-collapsed" : ""}`}>
        <aside className="panel">
          <button
            type="button"
            className="panel-toggle"
            onClick={() => setPanelCollapsed((v) => !v)}
            aria-label={panelCollapsed ? "패널 펼치기" : "패널 접기"}
            title={panelCollapsed ? "패널 펼치기" : "패널 접기"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {panelCollapsed ? <polyline points="9 6 15 12 9 18" /> : <polyline points="15 6 9 12 15 18" />}
            </svg>
          </button>
          {!panelCollapsed && (
            <>
              <h2>{FEATURE_LABELS[feature]}</h2>
              {feature === "design" && <DesignPanel {...design} />}
              {feature === "drift" && <DriftPanel {...drift} />}
              {feature === "architecture" && <ArchitecturePanel {...architecture} />}
              {feature === "wiki" && <WikiPanel {...wiki} />}
              {feature === "analysis" && <SystemMapPanel {...systemMap} />}
            </>
          )}
        </aside>
        <main className="main">
          {design.connectionError && <div className="connection-banner">{design.connectionError}</div>}
          {latestResultTask && <ResultPanel task={latestResultTask} />}
          {feature === "design" && <DesignMain {...design} />}
          {feature === "drift" && <DriftMain {...drift} />}
          {feature === "architecture" && <ArchitectureMain {...architecture} />}
          {feature === "wiki" && <WikiMain {...wiki} />}
          {feature === "analysis" && <SystemMapMain {...systemMap} />}
        </main>
      </div>
    </div>
  );
}
