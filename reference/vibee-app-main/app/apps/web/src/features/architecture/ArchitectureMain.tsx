import { useState } from "react";
import type { ArchitectureFeatureState } from "./useArchitectureFeature.js";

const CATEGORY_LABEL: Record<string, string> = {
  "oversized-module": "파일 비대화",
  "duplicated-logic": "의미 중복",
  "stale-temporary-workaround": "방치된 임시 조치",
};

const SEVERITY_LABEL: Record<string, string> = { high: "높음", medium: "중간", low: "낮음" };

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

export function ArchitectureMain(state: ArchitectureFeatureState) {
  if (!state.report) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text)" }}>구조 점검 대기</h3>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5, maxWidth: 420 }}>
          왼쪽에서 프로젝트 경로를 입력하고 구조 점검을 시작하세요.
        </p>
      </div>
    );
  }

  const severityChipClass = (severity: string) => {
    if (severity === "high") return "chip-danger";
    if (severity === "medium") return "chip-warning";
    return "chip-accent";
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
          기술부채 진단
          <span className="chip chip-warning" style={{ fontSize: 13, padding: "2px 10px" }}>
            {state.report.findings.length}건
          </span>
        </h1>
      </div>

      <p style={{ color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.6 }}>{state.report.summary}</p>

      {state.report.findings.length === 0 && (
        <div className="callout-box callout-success">
          <div style={{ fontWeight: 600 }}>근거가 있는 구조적 기술부채 항목을 찾지 못했습니다. (Clean)</div>
        </div>
      )}

      {state.report.findings.map((finding, index) => (
        <div className="question-card" key={index}>
          <div className="question-card-header">
            <div className="question-card-title">{finding.title}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <span className="chip">{CATEGORY_LABEL[finding.category] ?? finding.category}</span>
              <span className={`chip ${severityChipClass(finding.severity)}`}>
                심각도: {SEVERITY_LABEL[finding.severity] ?? finding.severity}
              </span>
            </div>
          </div>

          <p style={{ fontSize: 13.5, color: "var(--text)", margin: "8px 0 6px", lineHeight: 1.5 }}>
            {finding.explanation}
          </p>

          <div style={{ background: "var(--bg-subtle)", padding: "10px 14px", borderRadius: "var(--radius-md)", margin: "10px 0", fontSize: 12.5, display: "flex", flexDirection: "column", gap: 4 }}>
            <div><strong style={{ color: "var(--text-secondary)" }}>영향:</strong> {finding.impact}</div>
            <div><strong style={{ color: "var(--text-secondary)" }}>다음 행동:</strong> {finding.suggestion}</div>
          </div>

          {finding.designIds.length > 0 && (
            <div className="chip-group" style={{ margin: "6px 0" }}>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", alignSelf: "center" }}>설계 단위:</span>
              {finding.designIds.map((id, idIdx) => (
                <span key={idIdx} className="chip chip-accent">
                  {id}
                </span>
              ))}
            </div>
          )}

          {finding.files.length > 0 && (
            <div className="chip-group" style={{ margin: "6px 0 12px" }}>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", alignSelf: "center" }}>대상 파일:</span>
              {finding.files.map((file, fileIdx) => (
                <span key={fileIdx} className="chip" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  {file}
                </span>
              ))}
            </div>
          )}

          {finding.evidence.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>확인된 근거 (Evidence)</div>
              <ul className="gap-list" style={{ margin: 0 }}>
                {finding.evidence.map((evidence, evidenceIndex) => (
                  <li key={evidenceIndex}>{evidence}</li>
                ))}
              </ul>
            </div>
          )}

          {finding.resolutionPrompt && <PromptBox prompt={finding.resolutionPrompt} />}
        </div>
      ))}

      {state.report.limitations.length > 0 && (
        <div className="callout-box" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", marginTop: 28 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", margin: "0 0 8px" }}>
            분석 한계 및 고려사항
          </h2>
          <ul className="gap-list" style={{ margin: 0, color: "var(--text-secondary)" }}>
            {state.report.limitations.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
