import type { IncrementalAnalysisPlan, SystemFactStore, V4RolloutReport } from "@onto/protocol";

const MODE_LABEL = { full: "전체 분석", incremental: "변경 부분 분석", "fast-path": "기존 분석 재사용" } as const;
function signed(value: number): string { return value >= 0 ? `+${value}` : String(value); }

export function V4AnalysisSummary({
  plan,
  facts,
  report,
  analyzing = false,
}: {
  plan?: IncrementalAnalysisPlan | null;
  facts?: SystemFactStore | null;
  report?: V4RolloutReport | null;
  analyzing?: boolean;
}): React.JSX.Element | null {
  if (!plan && !facts && !report) return null;
  const allFacts = facts ? [...facts.entities, ...facts.links] : [];
  const review = allFacts.filter((item) => item.status === "needs_review" || item.status === "stale" || item.status === "missing").length;
  const restored = allFacts.filter((item) => item.origin === "vibee" && item.certainty === "grounded" && (item.status === "valid" || item.status === "relocated")).length;
  const reusable = report?.reusableFacts ?? (plan ? plan.previousSystemDigest.reusableEntityIds.length + plan.previousSystemDigest.reusableLinkIds.length : undefined);
  const reanalyzed = report?.reanalyzedFacts ?? (plan ? plan.impact.systemEntityIds.length + plan.impact.systemLinkIds.length : undefined);
  return (
    <section className={`v4-analysis-summary${analyzing ? " v4-analysis-summary-live" : ""}`} aria-label="V4 분석 설명">
      <div className="v4-analysis-summary-head">
        <div>
          <p className="detail-eyebrow">System Intelligence V4</p>
          <h3>{plan ? MODE_LABEL[plan.mode] : "검증된 시스템 구조"}</h3>
        </div>
        {report && <span className={`v4-rollout-mode v4-rollout-${report.featureMode}`}>{report.featureMode}</span>}
      </div>
      {plan && <p className="v4-analysis-reason">{plan.reason}</p>}
      <div className="v4-analysis-metrics">
        {reusable !== undefined && <span><b>{reusable}</b><small>재사용 fact</small></span>}
        {reanalyzed !== undefined && <span><b>{reanalyzed}</b><small>재분석 fact</small></span>}
        {facts && <span><b>{restored}</b><small>코드 근거로 복원</small></span>}
        {(facts || report) && <span className={review > 0 || (report?.reviewFacts ?? 0) > 0 ? "v4-metric-warn" : undefined}><b>{report?.reviewFacts ?? review}</b><small>확인 필요</small></span>}
        {report && <span><b>{report.providerTurns}</b><small>provider turn</small></span>}
        {report?.tokenUsage !== undefined && <span><b>{report.tokenUsage >= 1_000 ? `${(report.tokenUsage / 1_000).toFixed(1)}k` : report.tokenUsage}</b><small>총 token</small></span>}
      </div>
      {plan?.fullDiscovery && <p className="v4-full-reason"><strong>전체 탐색 선택:</strong> {plan.impact.reasons.join(" · ") || plan.reason}</p>}
      {plan?.fullAssembly && <p className="v4-full-reason"><strong>전체 지도 조립 선택:</strong> {plan.impact.reasons.join(" · ") || plan.reason}</p>}
      {report?.v3Projection && (
        <p className="v4-shadow-result">동일 snapshot V3 투영 대비 외부 연동 <b>{signed(report.deltas?.externalIntegrations ?? 0)}</b> · 구조 연결 <b>{signed(report.deltas?.architectureConnections ?? 0)}</b></p>
      )}
      {report && !report.transitionReady && <p className="v4-full-reason"><strong>전환 점검:</strong> {report.transitionBlockers.join(" · ")}</p>}
    </section>
  );
}
