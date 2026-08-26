import type { DesignFeatureState } from "./useDesignFeature.js";

export function DesignMain(state: DesignFeatureState) {
  if (!state.design) {
    return (
      <p className="empty-state">
        왼쪽에서 프로젝트 경로를 입력하고 인터뷰를 시작하세요. 설계 초안이 나오면 여기에 표시됩니다.
      </p>
    );
  }

  return (
    <div>
      <h1>{state.design.title}</h1>
      {state.gaps.length > 0 && (
        <ul className="gap-list">
          {state.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      )}

      <div className="narrative">{state.narrative}</div>

      <div style={{ marginTop: 24 }}>
        <button className="secondary" disabled={state.busy} onClick={() => void state.onExport()}>
          app_design.md + harness로 내보내기
        </button>
      </div>

      {state.exportResult && (
        <div className="question-card" style={{ marginTop: 16 }}>
          <p>
            <strong>{state.exportResult.projectPath}</strong>에 작성됨: {state.exportResult.written.join(", ")}
          </p>
          {state.exportResult.skipped.length > 0 && (
            <p className="why">이미 사람이 쓴 파일이라 건너뜀: {state.exportResult.skipped.join(", ")}</p>
          )}
          {state.exportResult.gitInitialized && <p className="why">되돌릴 지점을 위해 git 저장소를 초기화했습니다.</p>}
          <p>다음 프롬프트: {state.exportResult.firstPrompt}</p>
        </div>
      )}
    </div>
  );
}
