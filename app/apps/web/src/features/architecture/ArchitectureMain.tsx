import type { ArchitectureFeatureState } from "./useArchitectureFeature.js";

const CATEGORY_LABEL: Record<string, string> = {
  "oversized-module": "파일 비대화",
  "duplicated-logic": "의미 중복",
  "stale-temporary-workaround": "방치된 임시 조치",
};

export function ArchitectureMain(state: ArchitectureFeatureState) {
  if (!state.report) {
    return <p className="empty-state">왼쪽에서 프로젝트 경로를 입력하고 구조 점검을 시작하세요.</p>;
  }

  return (
    <div>
      <h1>기술부채 {state.report.findings.length}건</h1>
      <p>{state.report.summary}</p>
      {state.report.findings.length === 0 && <p>근거가 있는 항목을 찾지 못했습니다.</p>}
      {state.report.findings.map((finding, index) => (
        <div className="question-card" key={index}>
          <strong>
            {finding.title} ({CATEGORY_LABEL[finding.category] ?? finding.category}, {finding.severity})
          </strong>
          <p className="why">{finding.explanation}</p>
          <p className="why">영향: {finding.impact}</p>
          <p className="why">파일: {finding.files.join(", ")}</p>
          {finding.designIds.length > 0 && <p className="why">설계 단위: {finding.designIds.join(", ")}</p>}
          {finding.resolutionPrompt && (
            <textarea readOnly rows={6} value={finding.resolutionPrompt} onFocus={(event) => event.currentTarget.select()} />
          )}
        </div>
      ))}
      {state.report.limitations.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 20 }}>분석 한계</h2>
          <ul className="gap-list">
            {state.report.limitations.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
