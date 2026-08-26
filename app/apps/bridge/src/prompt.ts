/**
 * turn 프롬프트. 기능별 prompt builder(interview/review/wiki/architecture/analyze/assembly)는
 * 각 기능을 이식하는 단계에서 이 파일에 추가한다. 지금은 세션 목록이 공통으로 쓰는
 * `describeSession`만 둔다 — 기능이 없으니 매칭할 것도 아직 없다.
 */

/**
 * 인터뷰 프롬프트 (docs/requirements_flow.md §4).
 *
 * 검증하려는 가설은 "agent가 구조화된 질문을 던지고 turn을 끝낸다 → 사용자가 답한다 →
 * 다음 turn이 문맥을 이어받는다"이다. 그래서 **한 turn에 질문 하나**를 강하게 지시한다.
 *
 * 첫 turn과 이후 turn의 지시가 다르지 않다. agent는 매번 `get_app_context`로 지금까지의
 * 문답을 확인하고 다음 할 일을 스스로 판단한다.
 */
export function buildInterviewPrompt(answer: string | null): string {
  return [
    "You are interviewing a NON-PROGRAMMER to design the app they want to build.",
    "You are inside the Vibe Coding Project Intelligence app; the UI is a browser panel.",
    "",
    answer === null
      ? "The interview is starting now."
      : `The user just said:\n---\n${answer}\n---`,
    "",
    "Do this, in order:",
    "1. Call `get_app_context` (server: vci-app) and read `interview` — the questions you",
    "   already asked and the answers you already have. Never repeat a question.",
    "2. Decide what single thing you still need to know most.",
    "3. Call `ask_user` (server: vci-app) with exactly ONE question, then END YOUR TURN.",
    "   Do not call ask_user twice. Do not wait for a reply — the tool returns immediately",
    "   and the answer will reach you on the next turn.",
    "",
    "How to ask (the user cannot answer technical questions):",
    "- Ask about purpose, never about technology. Not 'do you want login?' but",
    "  'who should be able to see this?'.",
    "- Do not drill into sub-features. If they say they want accounts, do NOT then ask about",
    "  sign-up, deletion and password reset one by one — fill those in yourself later.",
    "- `why` explains why you are asking. `hints` are EXAMPLES, not choices.",
    "- Set `progress` so the user can see the interview is bounded.",
    "",
    "When you have enough for a first draft (roughly 4 questions is enough — do not aim for",
    "completeness, the user will correct the draft), skip ask_user and instead call",
    "`save_design` once, then end your turn. Do not call show_result — the app renders the",
    "explanation, the design document and the agent harness from save_design's data.",
    "",
    "Filling in save_design:",
    "- ACTOR and REQ come from what the user said. SURFACE you derive from the REQs.",
    "- FLOW steps are ORDERED. Read the user's scenario sentences and lay out what happens",
    "  first, next, last. A flow with one step means you did not decompose it.",
    "- ENTITY relations and states are almost never stated outright — derive them. If photos",
    "  live inside an album, that is a relation. If a post can be draft or published, those",
    "  are states.",
    "- DEC is what makes this design reusable later. Record what the user ruled out, what they",
    "  postponed, and every default you chose for them, each with a `why`.",
    "- Mark source: \"ai\" on anything the user did not say. The app shows those to the user",
    "  as \"things I decided for you\", so being honest here is what lets them correct you.",
    "",
    "If the user is correcting an existing draft, apply their change and call save_design again",
    "with the WHOLE document — it replaces, not merges. You wrote that draft earlier in this",
    "conversation, so write it out from what you already have. Only if you cannot see it here",
    "— you resumed a session someone else started — call get_app_context with",
    "`includeDesign: true` to fetch it. It is large; do not pull it every turn.",
  ].join("\n");
}

/**
 * 세션 미리보기를 사람이 읽을 이름으로 바꾼다.
 *
 * provider가 주는 미리보기는 "첫 사용자 메시지"인데, 우리가 보낸 첫 메시지는 각 기능의
 * 프롬프트 래퍼다. 그대로 보여주면 세션 목록에서 어떤 대화였는지 구분할 수 없다.
 * 각 기능을 이식할 때 이 함수에 `if (text.startsWith(...))` 분기를 추가한다.
 */
export function describeSession(preview: string): string {
  const text = preview.trim();
  if (!text) return "(빈 대화)";
  if (text.startsWith("You are interviewing a NON-PROGRAMMER")) return "요구사항 인터뷰";
  if (text.startsWith("You are checking a code change")) return "드리프트 리뷰";
  if (text.startsWith("You are doing a focused structure check")) return "아키텍처·기술부채";
  // 아직 매칭할 기능별 프롬프트가 없다 — 원문이 곧 가장 좋은 설명이다.
  return text.replace(/\s+/g, " ").slice(0, 80);
}

/**
 * 아키텍처·기술부채 구조 점검 프롬프트.
 *
 * 전체 코드를 문맥에 던지는 대신 코드가 준비한 세 목록을 먼저 준다. agent는 목록에서 의미를
 * 판단하고 필요한 파일만 읽어 확인한다. 결합도·순환 의존 같은 범용 리뷰로 넓어지지 않게
 * 확정한 세 범주만 열어 둔다 (`docs/product_flow_decisions.md` 질문 5).
 *
 * 이 프롬프트는 짧게 유지한다 — 예전에 규칙 하나를 8줄로 풀어 쓰자 약한 모델(Codex
 * gpt-5.6-luna, low)이 `report_architecture`를 아예 호출하지 않고 turn을 끝내는 회귀가
 * 실측으로 확인됐다. 프롬프트 길이 자체가 회귀 위험이다.
 */
export function buildArchitecturePrompt(): string {
  return [
    "You are doing a focused structure check of an EXISTING codebase for a NON-PROGRAMMER.",
    "You are inside the Vibe Coding Project Intelligence app. Write the report in Korean.",
    "",
    "Do this, in order:",
    "1. Call `get_architecture_context` (server: vci-app). Code has already scanned the",
    "   project and prepared file sizes/design mappings, function signatures and temporary",
    "   markers with git age.",
    "2. Judge only the three categories below. Use Read/Grep/Glob to open the relevant candidate",
    "   files and confirm meaning before reporting a finding.",
    "3. Call `report_architecture` (server: vci-app) exactly ONCE, then end your turn.",
    "",
    "The ONLY allowed categories:",
    "- `oversized-module`: a file has accumulated multiple distinct project responsibilities.",
    "  Size alone is NOT a finding. Cite `designIds` when `designRefs` has REQ/ENTITY entries;",
    "  if `designRefs` is empty, judge purely from reading the file and leave `designIds` empty.",
    "- `duplicated-logic`: functions with different text/signatures actually perform the same",
    "  project behavior, so changing one can leave the others inconsistent.",
    "- `stale-temporary-workaround`: a TODO/temporary workaround has remained while later commits",
    "  built on it, making removal materially harder. A marker alone is NOT a finding.",
    "",
    "Rules:",
    "- Do NOT report coupling, cohesion, dependency cycles, layer violations, style, naming,",
    "  formatting, generic best practices or raw line-count thresholds.",
    "- Every finding must cite real project-relative files you opened plus concrete evidence from",
    "  the supplied lists. Use designIds only when the supplied context contains those ids.",
    "- Explain what becomes harder for this app's user in plain language.",
    "- An empty findings array is valid when there is no evidence of material technical debt.",
    "- Put scan truncation, missing design data, unsupported languages or unverified candidates in",
    "  `limitations`; do not turn uncertainty into a finding.",
    "",
    "Do NOT change any file. Suggestions are bounded refactoring actions for the user's connected",
    "coding agent to perform later, not work to perform in this turn.",
  ].join("\n");
}

/**
 * 리뷰 프롬프트 (docs/vibe_coding_assistant_design.md §3.3).
 *
 * diff를 bridge가 만들어 넘기므로 agent에게 셸이나 쓰기 권한이 필요 없다. 판단 기준은
 * 범용 베스트프랙티스가 아니라 이 프로젝트가 인터뷰에서 정한 DEC/RULE 하나뿐이다.
 */
export function buildReviewPrompt(): string {
  return [
    "You are checking a code change against decisions this project already made.",
    "You are inside the Vibe Coding Project Intelligence app.",
    "",
    "Do this, in order:",
    "1. Call `get_review_context` (server: vci-app). It returns `commits` (oldest first,",
    "   each with its own diff) and `criteria` — the decisions and rules recorded for this",
    "   project.",
    "2. Go through the commits in order. For each one, check every criterion against that",
    "   commit's diff. Work criterion by criterion, not file by file.",
    "3. Call `report_drift` (server: vci-app) ONCE for all of them, then end your turn.",
    "",
    "What counts as a finding:",
    "- ONLY a criterion from `criteria` that a commit actually breaks. Quote its id and the",
    "  sha of the commit it broke in.",
    "- Judge each commit by its OWN diff. A later commit does not inherit a violation from an",
    "  earlier one, and an earlier one is not excused by a later fix.",
    "- Not bugs. Not style. Not missing tests. Not things you would have done differently.",
    "  Those may be real, but they are not what this check is for, and reporting them here",
    "  makes the result useless.",
    "- If the commits are unrelated to every criterion, that is the normal case. Report zero",
    "  findings. You must still call `report_drift` with an empty `findings` array — silence",
    "  and 'checked, nothing broken' must be distinguishable.",
    "- Use confidence \"low\" when you are inferring rather than seeing it in the diff.",
    "- A commit whose diff is marked `truncated: true` was cut for size. Do not read that as",
    "  'nothing else is there'; say so in the summary if it mattered.",
    "",
    "Do NOT change any file. You are not fixing anything; you are reporting. The user's own",
    "agent will do the fixing, with a prompt this app hands them.",
  ].join("\n");
}

/**
 * finding 하나를 해소할 프롬프트. **LLM을 쓰지 않는다** — criterion 원문을 그대로 채워
 * 넣는 순수 템플릿이다. 이 프롬프트를 받는 것은 이 앱이 아니라 사용자가 옆에 띄운
 * 자기 Codex/Claude Code다 — 코드를 고치는 것도, 결정이 낡았다고 판단하는 것도 그쪽이 한다.
 */
export function renderResolutionPrompt(
  finding: { commit: string; files: string[]; detail: string },
  criterion: { id: string; text: string; why?: string },
): string {
  const files = finding.files.length > 0 ? finding.files.join(", ") : "the relevant code";
  const lines = [`Commit ${finding.commit} conflicts with a decision this project already made.`, "", `${criterion.id}: ${criterion.text}`];
  if (criterion.why) lines.push(`Why this was decided: ${criterion.why}`);
  lines.push("", `What was found: ${finding.detail}`);
  if (finding.files.length > 0) lines.push(`Files: ${files}`);
  lines.push(
    "",
    "Judge which of these is true, then act on it yourself — do not just report back:",
    `1. The code is wrong. Fix ${files} so it follows ${criterion.id}.`,
    `2. The decision is outdated. Edit ONLY the "${criterion.id}" entry in`,
    "   .project-intel/design.json to match what the code now does. You are allowed to edit",
    "   this file — it is this project's own recorded decisions, not generated output. Change",
    "   just that one entry's text (and why, if it changed). Do not touch any other DEC, RULE,",
    "   or the file's structure.",
  );
  return lines.join("\n");
}
