/**
 * turn 프롬프트. 기능별 prompt builder(interview/review/wiki/architecture/analyze/assembly)는
 * 각 기능을 이식하는 단계에서 이 파일에 추가한다. 지금은 세션 목록이 공통으로 쓰는
 * `describeSession`만 둔다 — 기능이 없으니 매칭할 것도 아직 없다.
 */

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
  // 아직 매칭할 기능별 프롬프트가 없다 — 원문이 곧 가장 좋은 설명이다.
  return text.replace(/\s+/g, " ").slice(0, 80);
}
