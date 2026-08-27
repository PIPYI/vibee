import type { WikiFeatureState } from "./useWikiFeature.js";

export function WikiPanel(state: WikiFeatureState) {
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
        <label className="form-label">Project 절대 경로</label>
        <input
          type="text"
          placeholder="프로젝트 절대 경로"
          value={state.projectPath}
          onChange={(event) => state.setProjectPath(event.target.value)}
          disabled={state.running}
        />
      </div>

      <button className="primary" disabled={state.busy || state.running || !state.projectPath.trim()} onClick={() => void state.onFindKeywords()}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        키워드 후보 찾기
      </button>

      {state.error && <div className="error-banner">{state.error}</div>}

      {state.running && (
        <div className="loading-pulse-box" style={{ marginTop: 14 }}>
          <div className="loading-spinner" />
          <span>Agent가 키워드를 탐색 중…</span>
        </div>
      )}

      {state.keywords && state.keywords.length === 0 && (
        <div className="empty-state" style={{ padding: "24px 0" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>설명할 만한 키워드를 찾지 못했습니다.</p>
        </div>
      )}

      {state.keywords && state.keywords.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h2>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            발견된 후보
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {state.keywords.map((keyword) => (
              <div
                key={keyword.term}
                style={{
                  background: "#ffffff",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
                title={`${keyword.why}\n\n"${keyword.sample}"`}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <button
                    className="secondary"
                    style={{ padding: "4px 8px", fontSize: 12, fontWeight: 700 }}
                    disabled={state.busy || state.running}
                    onClick={() => void state.onPickKeyword(keyword.term)}
                  >
                    {keyword.term}
                  </button>
                  <span className="chip chip-accent">{keyword.count}회</span>
                </div>
                <p className="why" style={{ margin: "4px 0 0", fontSize: 11.5 }}>
                  {keyword.why}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {state.existingTerms.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h2>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            이미 있는 페이지
          </h2>
          <div className="chip-group">
            {state.existingTerms.map((term, i) => (
              <span key={i} className="chip">
                {term}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
