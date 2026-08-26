import type { WikiFeatureState } from "./useWikiFeature.js";

export function WikiMain(state: WikiFeatureState) {
  if (!state.page) {
    return <p className="empty-state">왼쪽에서 프로젝트 경로를 입력하고 키워드 후보를 찾은 뒤 하나를 고르세요.</p>;
  }

  return (
    <div>
      <h1>{state.page.term}</h1>
      <p>{state.page.oneLine}</p>
      <div className="narrative">{state.page.inThisProject}</div>
      {state.page.where.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, marginTop: 20 }}>이 프로젝트에서</h2>
          <ul className="gap-list">
            {state.page.where.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
      {state.page.related.length > 0 && <p className="why">함께 보기: {state.page.related.join(" · ")}</p>}
      {state.warnings.length > 0 && (
        <div className="error-banner" style={{ marginTop: 16 }}>
          {state.warnings.join(" / ")}
        </div>
      )}
    </div>
  );
}
