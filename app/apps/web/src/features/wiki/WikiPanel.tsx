import type { WikiFeatureState } from "./useWikiFeature.js";

export function WikiPanel(state: WikiFeatureState) {
  return (
    <div>
      <h2>Project</h2>
      <select value={state.agent} onChange={(event) => state.setAgent(event.target.value as "codex" | "claude")} disabled={state.running}>
        {(["codex", "claude"] as const).map((id) => {
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
      <button className="primary" disabled={state.busy || state.running || !state.projectPath.trim()} onClick={() => void state.onFindKeywords()}>
        키워드 후보 찾기
      </button>
      {state.error && <div className="error-banner">{state.error}</div>}
      {state.running && <p className="empty-state">agent가 살펴보는 중…</p>}

      {state.keywords && state.keywords.length === 0 && (
        <p className="empty-state" style={{ marginTop: 24 }}>
          설명할 만한 말이 없었습니다.
        </p>
      )}
      {state.keywords && state.keywords.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>후보</h2>
          <ul className="exchange-list">
            {state.keywords.map((keyword) => (
              <li key={keyword.term} title={`${keyword.why}\n\n"${keyword.sample}"`}>
                <button className="secondary" disabled={state.busy || state.running} onClick={() => void state.onPickKeyword(keyword.term)}>
                  {keyword.term} ({keyword.count}회)
                </button>
                <p className="why">{keyword.why}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {state.existingTerms.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>이미 있는 페이지</h2>
          <p className="why">{state.existingTerms.join(", ")}</p>
        </>
      )}
    </div>
  );
}
