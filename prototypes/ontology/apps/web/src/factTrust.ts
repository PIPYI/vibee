import type { FactCertainty, FactOrigin, SystemEntity, SystemFactStatus, SystemLink } from "@onto/protocol";

export type FactTrustSummary = {
  level: "confirmed" | "restored" | "review";
  label: "확인됨" | "코드 근거로 복원" | "확인 필요";
  description: string;
  origin: FactOrigin[];
  certainty: FactCertainty[];
  statuses: SystemFactStatus[];
  factCount: number;
};

export function summarizeFactTrust(facts: readonly (SystemEntity | SystemLink)[]): FactTrustSummary | undefined {
  if (facts.length === 0) return undefined;
  const origin = [...new Set(facts.map((item) => item.origin))];
  const certainty = [...new Set(facts.map((item) => item.certainty))];
  const statuses = [...new Set(facts.map((item) => item.status))];
  if (facts.some((item) => item.status === "needs_review" || item.status === "stale" || item.status === "missing" || item.certainty === "inferred")) {
    return {
      level: "review",
      label: "확인 필요",
      description: "코드가 바뀌었거나 직접 근거가 충분하지 않아 이 부분만 다시 확인해야 합니다.",
      origin, certainty, statuses, factCount: facts.length,
    };
  }
  if (facts.some((item) => item.origin === "vibee")) {
    return {
      level: "restored",
      label: "코드 근거로 복원",
      description: "Core가 미리 알지 못한 구조를 Vibee가 코드 위치와 함께 찾았고 Core가 범위·참조를 검증했습니다.",
      origin, certainty, statuses, factCount: facts.length,
    };
  }
  return {
    level: "confirmed",
    label: "확인됨",
    description: "Core가 결정론적으로 찾았고 현재 코드에서도 근거가 유지되는 구조입니다.",
    origin, certainty, statuses, factCount: facts.length,
  };
}

export const FACT_ORIGIN_LABEL: Record<FactOrigin, string> = { engine: "Core 발견", vibee: "Vibee 발견" };
export const FACT_STATUS_LABEL: Record<SystemFactStatus, string> = {
  valid: "현재 유효", relocated: "위치 이동 확인", needs_review: "재검토 필요", stale: "일부 근거 변경", missing: "직접 근거 사라짐",
};
