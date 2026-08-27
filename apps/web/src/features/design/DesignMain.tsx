import { Markdown } from "../../Markdown.js";
import type { DesignFeatureState } from "./useDesignFeature.js";

/** 인터뷰가 시작됐지만(§ 대화 기록/대기 질문/진행 중) 아직 설계 초안이 안 나온 동안의 화면. */
function Conversation(state: DesignFeatureState) {
  return (
    <div>
      <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 14 }}>
        대화 기록
      </h2>
      
      {state.exchanges.length > 0 && (
        <ul className="exchange-list">
          {state.exchanges.map((exchange, index) => (
            <li key={index} className="exchange-item">
              {exchange.question && (
                <div className="exchange-q">
                  <span className="exchange-q-badge">질문</span>
                  <span>{exchange.question}</span>
                </div>
              )}
              <div className="exchange-a">
                <span>{exchange.answer}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {state.pending && (
        <div className="question-card highlight">
          <div className="question-card-header">
            <div className="question-card-title">{state.pending.question}</div>
            {state.pending.progress && (
              <span className="chip chip-accent">
                {state.pending.progress.step} / {state.pending.progress.total}
              </span>
            )}
          </div>
          {state.pending.why && <p className="why">{state.pending.why}</p>}
          {state.pending.hints && state.pending.hints.length > 0 && (
            <div className="chip-group">
              <span style={{ fontSize: 11.5, color: "var(--text-muted)", alignSelf: "center" }}>예시:</span>
              {state.pending.hints.map((hint, i) => (
                <span key={i} className="chip">
                  {hint}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {!state.pending && state.running && (
        <div className="loading-pulse-box">
          <div className="loading-spinner" />
          <span>Agent가 응답을 생성하는 중입니다…</span>
        </div>
      )}

      {/* 질문이 없어도 입력창은 항상 열려 있다 */}
      <div className="question-card" style={{ marginTop: state.pending ? 14 : 0 }}>
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label" style={{ color: "var(--text-secondary)" }}>
            {state.pending ? "답변 작성" : "피드백 / 추가 의견"}
          </label>
          <textarea
            rows={3}
            placeholder={state.pending ? "답변을 입력하세요…" : "자유롭게 답하거나, 하고 싶은 말을 쓰세요…"}
            value={state.answer}
            onChange={(event) => state.setAnswer(event.target.value)}
            disabled={state.running}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="primary"
            style={{ width: "auto", minWidth: 100, padding: "8px 18px" }}
            disabled={state.busy || state.running || !state.answer.trim()}
            onClick={() => void state.onSendAnswer()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            보내기
          </button>
        </div>
      </div>
    </div>
  );
}

export function DesignMain(state: DesignFeatureState) {
  if (!state.design) {
    if (state.started) return <Conversation {...state} />;
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        </div>
        <h3 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text)" }}>설계 인터뷰 시작 대기</h3>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5, maxWidth: 400 }}>
          왼쪽 패널에서 프로젝트 절대 경로를 입력하고 인터뷰를 시작하세요.
          <br />
          설계 초안이 나오면 여기에 실시간으로 표시됩니다.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", margin: 0 }}>
          설계 초안
        </h2>
        <span className="chip chip-accent">Draft Ready</span>
      </div>

      <p className="muted" style={{ margin: "0 0 20px" }}>
        읽어 보시고 <strong>틀린 것</strong>이 있으면 아래 입력창에 말씀하세요. 초안은 고쳐 쓰라고 있는 것입니다.
      </p>

      <div style={{ background: "#ffffff", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 24, marginBottom: 24 }}>
        <Markdown source={state.narrative ?? ""} />
      </div>

      {state.gaps.length > 0 && (
        <div className="callout-box callout-warning">
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            아직 정해지지 않은 것 (Gaps)
          </div>
          <ul className="gap-list">
            {state.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginTop: 20, marginBottom: 24 }}>
        <button className="secondary" disabled={state.busy} onClick={() => void state.onExport()} style={{ padding: "10px 18px" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          app_design.md + harness로 내보내기
        </button>
      </div>

      {state.exportResult && (
        <div className="callout-box callout-success" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            내보내기 완료
          </div>
          <p style={{ margin: "4px 0" }}>
            <strong>{state.exportResult.projectPath}</strong>에 작성됨: {state.exportResult.written.join(", ")}
          </p>
          {state.exportResult.skipped.length > 0 && (
            <p className="why" style={{ color: "var(--success-text)", margin: "4px 0" }}>
              이미 사람이 쓴 파일이라 건너뜀: {state.exportResult.skipped.join(", ")}
            </p>
          )}
          {state.exportResult.gitInitialized && (
            <p className="why" style={{ color: "var(--success-text)", margin: "4px 0" }}>
              되돌릴 지점을 위해 git 저장소를 초기화했습니다.
            </p>
          )}
          <p style={{ margin: "6px 0 0", fontStyle: "italic" }}>다음 프롬프트: {state.exportResult.firstPrompt}</p>
        </div>
      )}

      {/* 초안이 나온 뒤에도 대화는 끝나지 않는다 */}
      <hr style={{ margin: "36px 0", border: "none", borderTop: "1px solid var(--border)" }} />
      <Conversation {...state} />
    </div>
  );
}
