import { verifyKey, type DriftFeatureState } from "./useDriftFeature.js";

const CONFIDENCE_LABEL: Record<string, string> = { high: "높음", low: "낮음" };

export function DriftMain(state: DriftFeatureState) {
  // reviewInfo는 "리뷰 시작"의 동기 응답에서 바로 채워진다 — turn이 아직 안 끝나서
  // report가 없어도, 이걸로 "이 프로젝트에 대해 최소 한 번은 확인해봤다"를 안다.
  if (!state.reviewInfo) {
    return <p className="empty-state">왼쪽에서 프로젝트 경로를 입력하고 리뷰를 시작하세요.</p>;
  }

  // 화면은 이번 리뷰가 새로 찾은 것(state.report.findings)이 아니라 아직 해결 확인이 안 된
  // 전체 목록(openFindings)을 기준으로 그린다 — 새 리뷰가 diff만 보고 "새로 어긴 건 없다"고
  // 답해도, 안 고쳐진 옛날 finding은 "피드백 받기"로 명시적으로 해결됨이 확인되기 전까지
  // 계속 남아 있어야 한다.
  if (state.openFindings.length === 0) {
    // "리뷰 시작"의 동기 응답은 turn이 끝나기 전에 온다 — 그때 openFindings가 비어 있는 건
    // "여지껏 알려진 열린 게 없다"는 것뿐, "이번 turn이 확인해보니 없다"가 아니다. turn이
    // 아직 도는 중이면 "위반 없음"이라고 성급하게 말하지 않는다.
    if (state.running) {
      return <p className="empty-state">agent가 확인하는 중입니다…</p>;
    }
    return (
      <div>
        <h1>위반 없음</h1>
        {state.report && <p>{state.report.summary}</p>}
      </div>
    );
  }

  return (
    <div>
      <h1>Drift {state.openFindings.length}건</h1>
      {state.report && <p>{state.report.summary}</p>}
      {/* 무엇이 맞는지는 이 앱이 정하지 않는다 — 판단과 수정은 사용자의 coding agent 몫이다. */}
      <p className="muted">
        무엇이 맞는지는 이 앱이 정하지 않습니다. 옆에 띄워 둔 {state.agent === "claude" ? "Claude Code" : "Codex"}에 프롬프트를
        붙여넣으면, 코드가 틀렸는지 결정이 낡았는지 판단해서 직접 고칩니다.
      </p>
      {state.openFindings.map((finding, index) => {
        const verified = state.verifyResults[verifyKey(finding.commit, finding.criterionId)];

        // 재시도 중이면 지난번 실패를 반영해 새로 만든 프롬프트를 보여준다 — 첫 시도와
        // 똑같은 문장을 또 주면 agent가 뭘 놓쳤는지 모른 채 반복만 하게 된다.
        const prompt = verified?.nextPrompt ?? finding.resolutionPrompt;

        return (
          <div className="question-card" key={index}>
            <strong>
              {finding.criterionId} @ {finding.commit.slice(0, 7)}
            </strong>
            <p className="why">
              {finding.detail} (신뢰도: {CONFIDENCE_LABEL[finding.confidence] ?? finding.confidence})
            </p>
            {finding.files.length > 0 && <p className="why">파일: {finding.files.join(", ")}</p>}
            {prompt && (
              <>
                <textarea readOnly rows={6} value={prompt} />
                <button className="secondary" onClick={() => void navigator.clipboard.writeText(prompt ?? "")}>
                  프롬프트 복사
                </button>
              </>
            )}
            {/* 옆에 띄운 agent로 고친 뒤 커밋 하나를 새로 만들었다는 전제로, 그 커밋 하나만
                이 기준 하나에 대해 다시 본다 — 전체 리뷰를 다시 돌리지 않는다. 몇 번째
                시도인지는 보여주되, 몇 번 만에 끝내라고 강제하지는 않는다 — 판단은
                사용자 몫이다. "해결됨"이 오면 이 finding은 openFindings에서 바로 빠지므로
                따로 "완료" 상태를 그릴 필요가 없다. */}
            <div style={{ marginTop: 8 }}>
              <button className="secondary" disabled={state.busy || state.running} onClick={() => void state.onVerifyFix(finding)}>
                피드백 받기{verified ? ` (${verified.attempt + 1}번째 시도)` : ""}
              </button>
            </div>
            {verified && (
              <p className="why" style={{ color: "var(--danger)" }}>
                {verified.checkedCommit.slice(0, 7)} 커밋 확인 ({verified.attempt}번째 시도) — 아직 위반: {verified.result.detail}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
