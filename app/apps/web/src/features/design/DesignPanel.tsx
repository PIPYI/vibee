import type { DesignFeatureState } from "./useDesignFeature.js";

export function DesignPanel(state: DesignFeatureState) {
  const { started } = state;

  return (
    <div>
      <h2>Project</h2>
      <select
        value={state.agent}
        onChange={(event) => state.setAgent(event.target.value as "codex" | "claude")}
        disabled={state.running}
      >
        {(["claude", "codex"] as const).map((id) => {
          const readiness = state.agents.find((item) => item.agent === id);
          return (
            <option key={id} value={id} disabled={readiness ? !readiness.installed : false}>
              {id}
              {readiness && !readiness.installed ? " (설치 안 됨)" : ""}
            </option>
          );
        })}
      </select>
      <select value={state.model} onChange={(event) => state.onModelChange(event.target.value)} disabled={state.running}>
        {state.models.length === 0 && <option value="">모델 불러오는 중…</option>}
        {state.models.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      {(() => {
        const efforts = state.models.find((item) => item.id === state.model)?.efforts ?? [];
        if (efforts.length === 0) return null;
        return (
          <select value={state.effort} onChange={(event) => state.setEffort(event.target.value)} disabled={state.running}>
            {efforts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.id}
              </option>
            ))}
          </select>
        );
      })()}
      <input
        type="text"
        placeholder="프로젝트 절대 경로"
        value={state.projectPath}
        onChange={(event) => state.setProjectPath(event.target.value)}
        disabled={state.running}
      />

      {!started && (
        <button
          className="primary"
          disabled={state.busy || state.running || !state.projectPath.trim()}
          onClick={() => void state.onStart()}
        >
          인터뷰 시작
        </button>
      )}

      {state.error && <div className="error-banner">{state.error}</div>}
    </div>
  );
}
