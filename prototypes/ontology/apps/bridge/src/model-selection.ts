import type { ModelOption } from "@onto/protocol";

/**
 * 브라우저가 보낸 선택값이 방금 provider가 보고한 목록과 일치하는지 확인한다.
 * provider 목록을 우리 화이트리스트로 복사하지 않고, 분석 시작 시점의 응답만 기준으로 삼는다.
 */
export function modelSelectionError(
  models: ModelOption[],
  model: string | undefined,
  effort: string | undefined,
): string | undefined {
  if (!model) {
    return effort ? "사고 수준을 지정하려면 모델도 선택해야 합니다." : undefined;
  }

  const selected = models.find((item) => item.id === model);
  if (!selected) {
    return `선택한 모델(${model})이 현재 제공자 목록에 없습니다. 모델 목록을 새로 불러와 다시 선택해 주세요.`;
  }
  if (!effort) return undefined;
  if (selected.efforts.length === 0) {
    return `${selected.label} 모델은 제공자가 조절 가능한 사고 수준을 제공하지 않습니다.`;
  }
  if (!selected.efforts.some((item) => item.id === effort)) {
    return `사고 수준(${effort})이 ${selected.label}의 현재 제공자 목록에 없습니다.`;
  }
  return undefined;
}
