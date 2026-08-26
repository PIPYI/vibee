import { Markdown } from "../../Markdown.js";
import type { DesignFeatureState } from "./useDesignFeature.js";

/** 인터뷰가 시작됐지만(§ 대화 기록/대기 질문/진행 중) 아직 설계 초안이 안 나온 동안의 화면. */
function Conversation(state: DesignFeatureState) {
  return (
    <div>
      <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "var(--text-muted)" }}>대화</h2>
      <ul className="exchange-list">
        {state.exchanges.map((exchange, index) => (
          <li key={index}>
            {exchange.question && <div className="q">Q. {exchange.question}</div>}
            <div>{exchange.answer}</div>
          </li>
        ))}
      </ul>

      {state.pending && (
        <div className="question-card">
          <strong>{state.pending.question}</strong>
          {state.pending.why && <p className="why">{state.pending.why}</p>}
          {state.pending.hints && state.pending.hints.length > 0 && (
            <p className="why">예) {state.pending.hints.join(" / ")}</p>
          )}
          {state.pending.progress && (
            <p className="why">
              {state.pending.progress.total}개 중 {state.pending.progress.step}번째
            </p>
          )}
        </div>
      )}

      {!state.pending && state.running && <p className="empty-state">agent가 응답하는 중…</p>}

      {/* 질문이 없어도 입력창은 항상 열려 있다 — 초안을 보고 "이건 아닌데"라고 먼저
          말을 거는 것도 답변이다 (docs/requirements_flow.md §4.10 3단계). */}
      <div className="question-card" style={{ marginTop: state.pending ? 12 : 0 }}>
        <textarea
          rows={3}
          placeholder={state.pending ? "답변을 입력하세요" : "자유롭게 답하거나, 하고 싶은 말을 쓰세요"}
          value={state.answer}
          onChange={(event) => state.setAnswer(event.target.value)}
          disabled={state.running}
        />
        <button
          className="primary"
          disabled={state.busy || state.running || !state.answer.trim()}
          onClick={() => void state.onSendAnswer()}
        >
          보내기
        </button>
      </div>
    </div>
  );
}

export function DesignMain(state: DesignFeatureState) {
  if (!state.design) {
    if (state.started) return <Conversation {...state} />;
    return (
      <p className="empty-state">
        왼쪽에서 프로젝트 경로를 입력하고 인터뷰를 시작하세요. 설계 초안이 나오면 여기에 표시됩니다.
      </p>
    );
  }

  return (
    <div>
      {/* [2] 정리. 여기서 초안을 읽고 고친 뒤에만 [3][4](내보내기)로 넘어간다 —
          그래서 고치라는 안내가 초안 바로 아래, 대화 입력창 바로 위에 있다. */}
      <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "var(--text-muted)" }}>설계 초안</h2>
      <p className="muted">
        읽어 보시고 <strong>틀린 것</strong>이 있으면 아래 입력창에 말씀하세요. 초안은 고쳐 쓰라고 있는 것입니다.
      </p>

      <Markdown source={state.narrative ?? ""} />

      {state.gaps.length > 0 && (
        <div>
          <h3>아직 정해지지 않은 것</h3>
          {/* 막지 않는다 — 경고만 하고 내보내기를 허용한다. 정해지지 않은 채 넘어간 것은
              DEC으로 남아 나중에 근거가 된다 (docs/requirements_flow.md §4.10). */}
          <ul className="gap-list">
            {state.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

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

      {/* 초안이 나온 뒤에도 대화는 끝나지 않는다 — "이건 아닌데"라고 계속 고칠 수 있다
          (docs/requirements_flow.md §4.10 3단계). 그래서 설계 화면 아래에 이어 붙인다. */}
      <hr style={{ margin: "32px 0", border: "none", borderTop: "1px solid var(--border)" }} />
      <Conversation {...state} />
    </div>
  );
}
