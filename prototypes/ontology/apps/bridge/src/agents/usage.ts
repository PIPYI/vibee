import type { StageUsage } from "@onto/protocol";

type RawUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
  providerTotalTokens?: number | undefined;
};

/**
 * Provider별 cache 보고 차이를 하나의 StageUsage 의미로 맞춘다.
 *
 * Claude의 input은 cache read와 별개지만, Codex의 input에는 cache read가 포함된다.
 * 따라서 반환값의 inputTokens는 언제나 cache를 제외한 입력이고, billableTokens는 언제나
 * input+output이다. totalTokens는 cache까지 포함한 진단용 처리량이며 provider간 대표값으로
 * 쓰지 않는다. provider가 raw total을 주면 재조합과 비교해 불일치를 표시한다.
 */
export function normalizeStageUsage(
  raw: RawUsage,
  options: { inputIncludesCacheRead: boolean },
): Pick<StageUsage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "billableTokens" | "totalTokens" | "providerTotalTokens" | "providerTotalMismatch"> {
  const inputTokens = tokenCount(raw.inputTokens);
  const outputTokens = tokenCount(raw.outputTokens);
  const cacheReadTokens = tokenCount(raw.cacheReadTokens);
  const cacheWriteTokens = tokenCount(raw.cacheWriteTokens);
  const providerTotalTokens = tokenCount(raw.providerTotalTokens);
  const uncachedInputTokens = inputTokens === undefined
    ? undefined
    : options.inputIncludesCacheRead
      ? Math.max(0, inputTokens - (cacheReadTokens ?? 0))
      : inputTokens;
  const billableCounts = [uncachedInputTokens, outputTokens]
    .filter((value): value is number => value !== undefined);
  const counts = [uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]
    .filter((value): value is number => value !== undefined);
  // Codex raw total은 cache 포함 raw input+output과 같은 정의다. cache write 등 별도
  // 항목이 있는 provider에는 raw total을 보내지 않으므로 이 비교가 거짓 경고를 만들지 않는다.
  const providerComparableTotal = inputTokens !== undefined && outputTokens !== undefined
    ? inputTokens + outputTokens
    : undefined;

  return {
    ...(uncachedInputTokens !== undefined ? { inputTokens: uncachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(billableCounts.length > 0 ? { billableTokens: billableCounts.reduce((sum, value) => sum + value, 0) } : {}),
    ...(counts.length > 0 ? { totalTokens: counts.reduce((sum, value) => sum + value, 0) } : {}),
    ...(providerTotalTokens !== undefined ? { providerTotalTokens } : {}),
    ...(providerTotalTokens !== undefined && providerComparableTotal !== undefined && providerTotalTokens !== providerComparableTotal
      ? { providerTotalMismatch: true as const }
      : {}),
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined;
}
