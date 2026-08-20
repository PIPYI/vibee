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
    answer === null
      ? "The interview is starting now."
      : `The user just answered your last question:\n---\n${answer}\n---`,
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
    "`show_result` once with the draft: what you understood, what screens there will be, and",
    "what you decided on their behalf. Then end your turn.",
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
