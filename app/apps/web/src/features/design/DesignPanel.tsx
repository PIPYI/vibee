import type { DesignFeatureState } from "./useDesignFeature.js";

export function DesignPanel(state: DesignFeatureState) {
  const { started } = state;

  return (
    <div>
      <h2>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        설정
      </h2>

      <div className="form-group">
        <label className="form-label">Coding Agent</label>
        <select
          value={state.agent}
          onChange={(event) => state.setAgent(event.target.value as "codex" | "claude")}
          disabled={state.running}
        >
          {(["claude", "codex"] as const).map((id) => {
            const readiness = state.agents.find((item) => item.agent === id);
            return (
              <option key={id} value={id} disabled={readiness ? !readiness.installed : false}>
                {id === "claude" ? "Claude Code" : "Codex"}
                {readiness && !readiness.installed ? " (설치 안 됨)" : ""}
              </option>
            );
          })}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Model</label>
        <select value={state.model} onChange={(event) => state.onModelChange(event.target.value)} disabled={state.running}>
          {state.models.length === 0 && (
            <option value="">{state.modelsLoading ? "모델 불러오는 중…" : "사용 가능한 모델 없음"}</option>
          )}
          {state.models.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {state.modelError && <div className="error-banner">모델 목록 오류: {state.modelError}</div>}
      </div>

      {(() => {
        const efforts = state.models.find((item) => item.id === state.model)?.efforts ?? [];
        if (efforts.length === 0) return null;
        return (
          <div className="form-group">
            <label className="form-label">Reasoning Effort</label>
            <select value={state.effort} onChange={(event) => state.setEffort(event.target.value)} disabled={state.running}>
              {efforts.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id}
                </option>
              ))}
            </select>
          </div>
        );
      })()}

      <div className="form-group">
        <label className="form-label">프로젝트 경로</label>
        <input
          type="text"
          placeholder={state.pathExample}
          value={state.projectPath}
          onChange={(event) => state.setProjectPath(event.target.value)}
          disabled={state.running}
        />
      </div>

      {!started && (
        <button
          className="primary"
          disabled={state.busy || state.running || !state.projectPath.trim() || !state.model}
          onClick={() => void state.onStart()}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          인터뷰 시작
        </button>
      )}

      {state.error && <div className="error-banner">{state.error}</div>}
    </div>
  );
}
