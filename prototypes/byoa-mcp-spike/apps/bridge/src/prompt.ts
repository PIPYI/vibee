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

  if (text.startsWith("You are running inside the BYOA")) {
    // 래퍼는 사용자의 프롬프트를 `---` 사이에 그대로 끼워 넣는다.
    const match = text.match(/---\s*([\s\S]*?)\s*---/);
    const task = match?.[1]?.trim().replace(/\s+/g, " ");
    return task ? `작업: ${task.slice(0, 80)}` : "작업";
  }

  // 사용자가 CLI에서 직접 시작한 대화. 원문이 곧 가장 좋은 설명이다.
  return text.replace(/\s+/g, " ").slice(0, 80);
}
