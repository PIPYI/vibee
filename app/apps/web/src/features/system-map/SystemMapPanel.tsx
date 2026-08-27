import type { SystemMapFeatureState } from "./useSystemMapFeature.js";

export function SystemMapPanel(state: SystemMapFeatureState) {
  return (
    <div>
      <h2>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
        설정
      </h2>

      <div className="form-group">
        <label className="form-label">Coding Agent</label>
        <select value={state.agent} onChange={(event) => state.setAgent(event.target.value as "codex" | "claude")} disabled={state.running}>
          {(["codex", "claude"] as const).map((id) => {
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
          {state.models.length === 0 && <option value="">모델 불러오는 중…</option>}
          {state.models.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
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
        <label className="form-label">Project 절대 경로</label>
        <input
          type="text"
          placeholder="시스템 맵을 그릴 프로젝트 경로"
          value={state.projectPath}
          onChange={(event) => state.setProjectPath(event.target.value)}
          disabled={state.running}
        />
      </div>

      <button className="primary" disabled={state.busy || state.running || !state.projectPath.trim()} onClick={() => void state.onStart()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
        </svg>
        시스템 맵 생성 시작
      </button>

      {state.error && <div className="error-banner">{state.error}</div>}

      {state.running && (
        <div className="loading-pulse-box" style={{ marginTop: 14 }}>
          <div className="loading-spinner" />
          <span>Agent가 코드를 읽고 다이어그램을 그리는 중…</span>
        </div>
      )}
    </div>
  );
}
