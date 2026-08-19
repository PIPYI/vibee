/**
 * spike instruction 래퍼 (문서 §12).
 *
 * 검증하려는 가설은 "agent가 MCP를 통해 앱에 도달할 수 있는가" 자체다. 그래서 모델이
 * 알아서 tool을 집어 들기를 기대하지 않고 두 tool 호출을 명시적으로 지시한다.
 * 사용자의 프롬프트는 가운데에 원문 그대로 전달된다.
 */
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
