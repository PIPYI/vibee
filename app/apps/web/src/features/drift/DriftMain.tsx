import type { DriftFeatureState } from "./useDriftFeature.js";

export function DriftMain(state: DriftFeatureState) {
  if (!state.report) {
    return <p className="empty-state">왼쪽에서 프로젝트 경로를 입력하고 리뷰를 시작하세요.</p>;
  }

  if (state.report.findings.length === 0) {
    return (
      <div>
        <h1>위반 없음</h1>
        <p>{state.report.summary}</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Drift {state.report.findings.length}건</h1>
      <p>{state.report.summary}</p>
      {state.report.findings.map((finding, index) => (
        <div className="question-card" key={index}>
          <strong>
            {finding.criterionId} @ {finding.commit.slice(0, 7)}
          </strong>
          <p className="why">
            {finding.detail} (신뢰도: {finding.confidence})
          </p>
          {finding.files.length > 0 && <p className="why">파일: {finding.files.join(", ")}</p>}
          {finding.resolutionPrompt && (
            <textarea readOnly rows={6} value={finding.resolutionPrompt} onFocus={(event) => event.currentTarget.select()} />
          )}
        </div>
      ))}
    </div>
  );
}
