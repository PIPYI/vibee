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
  if (text.startsWith("You are looking at the conversations")) return "위키 키워드";
  if (text.startsWith("You are explaining one word")) return "위키";
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
 * 위키 후보 키워드 프롬프트.
 *
 * **판단을 시키는 turn이다.** 빈도로 뽑으려다 실패해서 여기로 왔다 — 가장 자주 나오는 말이
 * 가장 익숙한 말이라 정반대의 것이 뽑혔다. 그래서 기준을 "많이 나온 말"이 아니라
 * "이 사람이 못 알아들었을 말"로 준다.
 */
export function buildWikiKeywordsPrompt(): string {
  return [
    "You are looking at the conversations a NON-PROGRAMMER had while building their app with",
    "an AI agent. Your job is to find the words that probably went past them.",
    "You are inside the Vibe Coding Project Intelligence app.",
    "",
    "Do this, in order:",
    "1. Call `get_wiki_transcript` (server: vci-app).",
    "2. Pick the words worth offering to explain.",
    "3. Call `save_wiki_keywords` (server: vci-app) once, then end your turn.",
    "",
    "What to pick:",
    "- Words this person would NOT be able to define, but that matter to their app. Terms of",
    "  art: `JWT`, `migration`, `index`, `상태관리`, `정규화`, `캐시`. Korean and English both",
    "  — the word as it appears in their conversation.",
    "- Prefer words the AGENT used while explaining what it did. That is where jargon enters.",
    "- Frequency is NOT the criterion. A word said once can be the one they are stuck on, and",
    "  the most frequent words are always the most ordinary ones.",
    "",
    "What NOT to pick:",
    "- Ordinary words: `wait`, `getting`, `answer`, `file`, `code`.",
    "- Words from the app's own subject matter that any speaker knows: if the app is about",
    "  lending things to neighbours, `borrow` and `cash` are not jargon.",
    "- The scaffolding of this tool itself — `App`, `turn`, `context`, `Panel`, `MCP` — unless",
    "  the user asked about it themselves.",
    "- Names of their own files, functions and variables. Those are locations, not concepts.",
    "",
    "For each one give `why` — one short line on why this person might be stuck on it, WRITTEN",
    "IN THE LANGUAGE THEY SPEAK in the transcript, since they read it — and `sample`, a",
    "sentence from the conversation where it appears, quoted as-is. Do not count",
    "occurrences; the app does that. Twelve or fewer is plenty; an empty list is a fine answer",
    "if the conversation had no jargon in it.",
  ].join("\n");
}

/**
 * 위키 프롬프트. **순수 학습용이다** — 평가하지 않는다. "이건 위험합니다", "X가 낫습니다"는
 * 이 기능이 하는 일이 아니다. 그건 Drift의 몫이고, 섞이면 둘 다 못 쓰게 된다.
 */
export function buildWikiPrompt(term: string): string {
  return [
    `You are explaining one word to the NON-PROGRAMMER who is building this app: "${term}".`,
    "You are inside the Vibe Coding Project Intelligence app.",
    "",
    "Do this, in order:",
    "1. Call `get_wiki_context` (server: vci-app). It returns where this word came up in",
    "   their conversations, and the recorded design of the app.",
    "2. Read the project's own code to find where this actually lives. You have Read, Grep and",
    "   Glob. Look — do not guess from the word alone.",
    "3. Call `save_wiki` (server: vci-app) once, then end your turn.",
    "",
    "What this page is for:",
    "- The reader has been building this app by talking to an agent. This word went past them",
    "  and they did not want to interrupt to ask. Now they are asking.",
    "- Explain what it means IN THIS APP. A general definition they could have searched for is",
    "  not worth writing. `inThisProject` is the whole point of the page.",
    "- `where` must cite real evidence from this project: file paths you actually opened, or",
    "  REQ / FLOW / DEC ids from the design. Never leave it empty. If you could not find the",
    "  word anywhere in this project, say that plainly in `inThisProject` instead of inventing",
    "  a location.",
    "- `oneLine` is for someone who does not code. Do not explain jargon with more jargon.",
    "",
    "WRITE IN THE READER'S LANGUAGE. Look at `mentions` — whatever language they speak there is",
    "the language of this page, every field of it. A page this reader cannot read has no reason",
    "to exist. Keep code identifiers, file paths and established technical names as they are.",
    "",
    "What this page is NOT:",
    "- NOT a review. Do not say anything is wrong, risky, outdated, temporary, insufficient, or",
    "  could be better. Do not suggest changes or alternatives, and do not hint at them by",
    "  saying what this is 'not meant for' or what would happen 'in a real app'. Judging the",
    "  code is a different feature and mixing it in here makes both useless.",
    "- NOT advice about what to do next.",
    "- Describe what IS, and stop there. If the reader wants to know whether it is a good idea,",
    "  that is a different question they have not asked.",
    "",
    "Do NOT change any file. You can only read.",
  ].join("\n");
}

/**
 * 세션 파일에 남은 발화에서 사람이 실제로 한 말만 꺼낸다. 우리가 보낸 프롬프트 래퍼를
 * 벗기되, 그 가운데 `---` 사이에 든 사용자의 원문은 살린다. 우리 것이 아니면(사용자가
 * CLI에서 직접 한 말) 원문 그대로 돌려준다.
 */
export function unwrapUserText(text: string): string {
  const body = text.trimStart();
  if (!WRAPPER_PREFIXES.some((prefix) => body.startsWith(prefix))) return text;
  const match = body.match(/---\s*([\s\S]*?)\s*---/);
  return match?.[1]?.trim() ?? "";
}

const WRAPPER_PREFIXES = [
  "You are interviewing a NON-PROGRAMMER",
  "You are checking a code change",
  "You are doing a focused structure check",
  "You are looking at the conversations",
];

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
