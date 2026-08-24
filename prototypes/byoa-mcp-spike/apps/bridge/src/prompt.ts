/**
 * spike instruction 래퍼 (문서 §12).
 *
 * 검증하려는 가설은 "agent가 MCP를 통해 앱에 도달할 수 있는가" 자체다. 그래서 모델이
 * 알아서 tool을 집어 들기를 기대하지 않고 두 tool 호출을 명시적으로 지시한다.
 * 사용자의 프롬프트는 가운데에 원문 그대로 전달된다.
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
    "You are inside the BYOA MCP integration spike; the app UI is a browser panel.",
    "",
    // 대기 중인 질문에 대한 답일 수도, 초안을 보고 그냥 던진 말일 수도 있다 (§4.5).
    // 어느 쪽인지는 agent가 get_app_context의 interview를 보고 판단한다.
    answer === null
      ? "The interview is starting now."
      : `The user just said:\n---\n${answer}\n---`,
    "",
    "Do this, in order:",
    "1. Call `get_app_context` (server: byoa-spike) and read `interview` — the questions you",
    "   already asked and the answers you already have. Never repeat a question.",
    "2. Decide what single thing you still need to know most.",
    "3. Call `ask_user` (server: byoa-spike) with exactly ONE question, then END YOUR TURN.",
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

export function buildSpikePrompt(userPrompt: string): string {
  return [
    "You are running inside the BYOA MCP integration spike.",
    "",
    "Before doing the requested work:",
    "1. Call the MCP tool `get_app_context` (server: byoa-spike).",
    "2. Use the returned project/app context as additional context.",
    "",
    "The user's requested task, to be performed in the selected project directory:",
    "---",
    userPrompt,
    "---",
    "",
    "Before finishing:",
    "3. Call the MCP tool `show_result` (server: byoa-spike) exactly once, with a structured",
    "   summary of what you did, including every file you changed.",
    "4. Then give your normal final response.",
  ].join("\n");
}

/**
 * 드리프트 리뷰 프롬프트 (docs/vibe_coding_assistant_design.md §3.3, §7.2).
 *
 * 검증하려는 가설은 두 개이고, 어려운 쪽은 두 번째다.
 *
 * 1. 위반이 있는 커밋에서 **어느 기준이** 깨졌는지 짚어내는가.
 * 2. 위반이 없는 커밋에서 **조용히 있는가.**
 *
 * 리뷰 단위는 커밋 하나다. 한 세션이 여러 커밋을 훑되 **각 커밋을 그 커밋의 diff로만**
 * 판정한다 — 뒤 커밋이 앞 커밋의 위반을 물려받지 않고, 앞 커밋이 뒤의 수정으로 면제되지도
 * 않는다. 그래야 한 번 본 커밋의 판정이 영원히 유효하고, 다시 볼 이유가 없어진다.
 *
 * 그래서 프롬프트가 유도하지 않도록 조심한다. "무엇이 잘못됐는지 찾아라"고 하면 모델은
 * 웬만하면 무언가를 찾아낸다. 찾는 일이 아니라 **대조하는 일**로 지시하고, 아무것도 없을
 * 때도 report_drift를 부르게 해서 침묵과 누락을 구분한다.
 *
 * 범용 코드 리뷰를 시키지 않는 것도 같은 이유다. 버그·스타일 지적은 provider가 이미 잘
 * 하고, 그것이 섞여 들어오면 우리가 재는 것이 흐려진다.
 */
export function buildReviewPrompt(): string {
  return [
    "You are checking a code change against decisions this project already made.",
    "You are inside the BYOA MCP integration spike.",
    "",
    "Do this, in order:",
    "1. Call `get_review_context` (server: byoa-spike). It returns `commits` (oldest first,",
    "   each with its own diff) and `criteria` — the decisions and rules recorded for this",
    "   project.",
    "2. Go through the commits in order. For each one, check every criterion against that",
    "   commit's diff. Work criterion by criterion, not file by file.",
    "3. Call `report_drift` (server: byoa-spike) ONCE for all of them, then end your turn.",
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
 * 해소 프롬프트 (docs/vibe_coding_assistant_design.md §3.3 표의 "해소 프롬프트" 행).
 *
 * 검출은 절반이다. 나머지 절반 — 무엇을 고칠지 정하고 실제로 고치는 일 — 은 우리가 하지
 * 않는다. **판단도 실행도 이 프롬프트를 받는 사용자의 옆 agent가 한다.** 우리 앱은 코드를
 * 쓰는 곳이 아니라 보는 곳이기 때문이다 (`docs/BYOA_MCP_INTEGRATION_SPIKE.md` §1.2).
 *
 * 그래서 두 선택지를 모두 열어 둔다 — 코드가 틀렸으면 코드를 고치고, 결정이 낡았으면
 * `.project-intel/design.json`의 그 항목만 고친다. 이 파일을 고쳐도 된다는 허가를 명시하는
 * 이유는, 평범한 코딩 agent라면 소스 코드만 프로젝트로 보고 이 파일은 건드리면 안 되는
 * 산출물로 취급할 수 있기 때문이다.
 *
 * **프롬프트 문구만으로는 신뢰할 수 없다**는 것이 이미 확인된 바 있다(§16, `findAdvice`) —
 * 그래서 최대한 구체적으로 쓴다: 정확한 파일 경로, 대상 id, 두 선택지, "이 항목만" 이라는
 * 범위 제한까지. 이 프롬프트가 실제로 그렇게 동작하는지는 `scripts/drift.mjs`가 실제 turn을
 * 돌려 확인한다 — LLM 판정이 아니라 design.json/코드의 diff를 기계적으로 검사한다.
 *
 * 순수 템플릿 렌더이며 LLM을 쓰지 않는다. bridge가 `report_drift` 검증 시점에 finding마다
 * 채워 `DriftFinding.resolutionPrompt`로 내보낸다.
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

/**
 * 위키 후보 키워드 프롬프트 (§3.5).
 *
 * **판단을 시키는 turn이다.** 빈도로 뽑으려다 실패해서 여기로 왔다 — 가장 자주 나오는 말이
 * 가장 익숙한 말이라 정반대의 것이 뽑혔다 (SPIKE_FINDINGS.md §16).
 *
 * 그래서 기준을 "많이 나온 말"이 아니라 **"이 사람이 못 알아들었을 말"**로 준다. 우리
 * 프로토콜 어휘(App, turn, context)가 대화에 섞여 있으므로 그것을 빼라고 명시한다.
 */
export function buildWikiKeywordsPrompt(): string {
  return [
    "You are looking at the conversations a NON-PROGRAMMER had while building their app with",
    "an AI agent. Your job is to find the words that probably went past them.",
    "You are inside the BYOA MCP integration spike.",
    "",
    "Do this, in order:",
    "1. Call `get_wiki_transcript` (server: byoa-spike).",
    "2. Pick the words worth offering to explain.",
    "3. Call `save_wiki_keywords` (server: byoa-spike) once, then end your turn.",
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
 * 위키 프롬프트 (docs/vibe_coding_assistant_design.md §3.5).
 *
 * **순수 학습용이다.** 평가하지 않는다 — "이건 위험합니다", "X가 낫습니다", "재검토가
 * 필요합니다"는 전부 이 기능이 하는 일이 아니다. 그것은 드리프트 리뷰의 몫이고, 섞이면
 * 둘 다 못 쓰게 된다.
 *
 * 그리고 **일반론이면 만들 이유가 없다.** 같은 설명을 검색으로 얻을 수 있다면 우리가 할 일이
 * 아니다. 그래서 `where`를 비워 두지 못하게 하고, 근거를 이 프로젝트 안에서만 찾게 한다.
 */
export function buildWikiPrompt(term: string): string {
  return [
    `You are explaining one word to the NON-PROGRAMMER who is building this app: "${term}".`,
    "You are inside the BYOA MCP integration spike.",
    "",
    "Do this, in order:",
    "1. Call `get_wiki_context` (server: byoa-spike). It returns where this word came up in",
    "   their conversations, and the recorded design of the app.",
    "2. Read the project's own code to find where this actually lives. You have Read, Grep and",
    "   Glob. Look — do not guess from the word alone.",
    "3. Call `save_wiki` (server: byoa-spike) once, then end your turn.",
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
 * 세션 파일에 남은 발화에서 **사람이 실제로 한 말만** 꺼낸다.
 *
 * 세션 파일에는 우리가 보낸 프롬프트가 사용자 발화로 남는다. 그대로 두면 "interviewing",
 * "NON-PROGRAMMER" 같은 우리 지시문이 대화로 잡히고, 통째로 버리면 **래퍼 안에 든 사용자의
 * 말까지 같이 버려진다.** 인터뷰 답변과 작업 프롬프트는 래퍼 가운데 `---` 사이에 원문 그대로
 * 들어가 있으므로, 벗기되 그것은 살린다.
 *
 * 우리 것이 아니면(사용자가 CLI에서 직접 한 말) 원문 그대로 돌려준다.
 */
export function unwrapUserText(text: string): string {
  const body = text.trimStart();
  if (!WRAPPER_PREFIXES.some((prefix) => body.startsWith(prefix))) return text;

  // `---` 사이에 사용자의 원문이 있다. 인터뷰 첫 turn처럼 없을 수도 있다.
  const match = body.match(/---\s*([\s\S]*?)\s*---/);
  return match?.[1]?.trim() ?? "";
}

const WRAPPER_PREFIXES = [
  "You are interviewing a NON-PROGRAMMER",
  "You are running inside the BYOA",
  "You are checking a code change",
  "You are explaining one word",
  "You are looking at the conversations",
];

/**
 * 세션 미리보기를 사람이 읽을 이름으로 바꾼다.
 *
 * provider가 주는 미리보기는 "첫 사용자 메시지"인데, 우리가 보낸 첫 메시지는 위의 래퍼다.
 * 그대로 보여주면 모든 세션이 "You are interviewing a NON-PROGRAMMER…"로 똑같아 보여서
 * 어떤 대화였는지 고를 수 없다. 우리가 감싼 것이므로 우리가 풀어서 보여준다.
 */
export function describeSession(preview: string): string {
  const text = preview.trim();
  if (!text) return "(빈 대화)";
  if (text.startsWith("You are interviewing a NON-PROGRAMMER")) return "요구사항 인터뷰";
  if (text.startsWith("You are checking a code change")) return "드리프트 리뷰";
  if (text.startsWith("You are explaining one word")) return "위키";
  if (text.startsWith("You are looking at the conversations")) return "위키 키워드";

  if (text.startsWith("You are running inside the BYOA")) {
    // 래퍼는 사용자의 프롬프트를 `---` 사이에 그대로 끼워 넣는다.
    const match = text.match(/---\s*([\s\S]*?)\s*---/);
    const task = match?.[1]?.trim().replace(/\s+/g, " ");
    return task ? `작업: ${task.slice(0, 80)}` : "작업";
  }

  // 사용자가 CLI에서 직접 시작한 대화. 원문이 곧 가장 좋은 설명이다.
  return text.replace(/\s+/g, " ").slice(0, 80);
}
