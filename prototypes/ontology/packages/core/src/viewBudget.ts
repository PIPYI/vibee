/**
 * Overview/Scenario의 soft budget (implementation_plan §6.7).
 *
 * **schema가 아니라 여기다.** `participants ≤ 6` 같은 개수 제한을 schema `maxItems`로 걸면
 * "실제 흐름에 참여자가 7이면 안 된다"는 검증되지 않은 제품 존재론 주장이 되고, 하드 실패로
 * 두면 agent가 통과하려고 의미 있는 내용을 조용히 버린다. 그래서 여기 값을 넘겨도 **제출은
 * 성공한다** — `view-validator`가 `severity: "warning"`으로만 알린다.
 *
 * 이 값은 설계 약속이 아니라 §53 View Utility에서 측정해 조정할 값이다. 초기값은
 * §28~§33이 든 예시(비전공자가 한 화면에서 따라갈 수 있는 정도)에서 그대로 가져왔다 —
 * 근거가 있는 추정이지 결론이 아니다.
 */
export const VIEW_BUDGET = {
  overview: {
    /** Area가 이 개수를 넘으면 한눈에 훑는다는 §22의 목적을 벗어난다. */
    maxAreas: 8,
    /** Area 하나 안의 item 개수. */
    maxItemsPerArea: 8,
  },
  scenario: {
    /** §29 예시가 다루는 흐름은 참여자가 손에 꼽을 정도다. */
    maxParticipants: 6,
    /** §30 — step은 Concept 1:1이 아니라 압축된 단위이므로 20은 이미 넉넉하다. */
    maxSteps: 20,
  },
} as const;
