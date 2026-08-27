import type { DriftFeatureState } from "./useDriftFeature.js";

export function DriftPanel(state: DriftFeatureState) {
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
        <label className="form-label">프로젝트 경로</label>
        <input
          type="text"
          placeholder={state.pathExample}
          value={state.projectPath}
          onChange={(event) => state.setProjectPath(event.target.value)}
          disabled={state.running}
        />
      </div>

      <button className="primary" disabled={state.busy || state.running || !state.projectPath.trim()} onClick={() => void state.onStartReview()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        리뷰 시작
      </button>

      {state.error && <div className="error-banner">{state.error}</div>}

      {state.reviewInfo && (
        <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg-muted)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--text-secondary)" }}>
          <div>커밋 <strong>{state.reviewInfo.commitCount}</strong>개 · 기준 <strong>{state.reviewInfo.criteriaCount}</strong>개</div>
          {state.reviewInfo.skipped > 0 && <div style={{ marginTop: 4, color: "var(--warning-text)" }}>{state.reviewInfo.skipped}개는 다음 리뷰로 이월</div>}
        </div>
      )}

      {state.running && (
        <div className="loading-pulse-box" style={{ marginTop: 14 }}>
          <div className="loading-spinner" />
          <span>Agent가 검토 중…</span>
        </div>
      )}
    </div>
  );
}
