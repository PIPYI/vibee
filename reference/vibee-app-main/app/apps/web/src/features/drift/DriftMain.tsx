import { useState } from "react";
import { verifyKey, type DriftFeatureState } from "./useDriftFeature.js";

const CONFIDENCE_LABEL: Record<string, string> = { high: "높음", low: "낮음" };

function PromptBox({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="prompt-container">
      <div className="prompt-header">
        <span>RESOLUTION PROMPT</span>
        <button type="button" className="btn-copy" onClick={() => void handleCopy()}>
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              복사됨
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              프롬프트 복사
            </>
          )}
        </button>
      </div>
      <textarea readOnly rows={6} className="prompt-content" value={prompt} />
    </div>
  );
}

export function DriftMain(state: DriftFeatureState) {
  if (!state.reviewInfo) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text)" }}>Drift 리뷰 대기</h3>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5, maxWidth: 420 }}>
          왼쪽에서 프로젝트 경로를 입력하고 리뷰를 시작하세요.
        </p>
      </div>
    );
  }

  if (state.openFindings.length === 0) {
    if (state.running) {
      return (
        <div className="loading-pulse-box">
          <div className="loading-spinner" />
          <span>Agent가 커밋과 아키텍처 기준을 확인하는 중입니다…</span>
        </div>
      );
    }
    return (
      <div className="callout-box callout-success" style={{ marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          위반 없음 (Clean)
        </div>
        {state.report && <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>{state.report.summary}</p>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
          Drift 위반
          <span className="chip chip-danger" style={{ fontSize: 13, padding: "2px 10px" }}>
            {state.openFindings.length}건
          </span>
        </h1>
      </div>

      {state.report && <p style={{ color: "var(--text-secondary)", margin: "0 0 12px" }}>{state.report.summary}</p>}

      <div className="callout-box" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", margin: "14px 0 24px" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          무엇이 맞는지는 이 앱이 정하지 않습니다. 옆에 띄워 둔 <strong>{state.agent === "claude" ? "Claude Code" : "Codex"}</strong>에 프롬프트를
          붙여넣으면, 코드가 틀렸는지 결정이 낡았는지 판단해서 직접 고칩니다.
        </p>
      </div>

      {state.openFindings.map((finding, index) => {
        const verified = state.verifyResults[verifyKey(finding.commit, finding.criterionId)];
        const prompt = verified?.nextPrompt ?? finding.resolutionPrompt;

        return (
          <div className="question-card" key={index}>
            <div className="question-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 14.5 }}>{finding.criterionId}</span>
                <span className="chip" style={{ fontFamily: "var(--font-mono)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" />
                    <line x1="1.05" y1="12" x2="7" y2="12" />
                    <line x1="17.01" y1="12" x2="22.96" y2="12" />
                  </svg>
                  {finding.commit.slice(0, 7)}
                </span>
              </div>
              <span className={`chip ${finding.confidence === "high" ? "chip-danger" : "chip-warning"}`}>
                신뢰도: {CONFIDENCE_LABEL[finding.confidence] ?? finding.confidence}
              </span>
            </div>

            <p style={{ margin: "8px 0", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {finding.detail}
            </p>

            {finding.files.length > 0 && (
              <div className="chip-group" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)", alignSelf: "center" }}>관련 파일:</span>
                {finding.files.map((file, fileIdx) => (
                  <span key={fileIdx} className="chip" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    {file}
                  </span>
                ))}
              </div>
            )}

            {prompt && <PromptBox prompt={prompt} />}

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <button className="secondary" disabled={state.busy || state.running} onClick={() => void state.onVerifyFix(finding)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                피드백 받기{verified ? ` (${verified.attempt + 1}번째 시도)` : ""}
              </button>
            </div>

            {verified && (
              <div className="callout-box callout-warning" style={{ marginTop: 12, padding: "10px 14px", fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: "var(--danger-text)" }}>
                  {verified.checkedCommit.slice(0, 7)} 커밋 확인 ({verified.attempt}번째 시도) — 아직 위반: {verified.result.detail}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
