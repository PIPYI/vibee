import type { StageUsage } from "@onto/protocol";

type RawUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
};

/**
 * Provider별 cache 보고 차이를 하나의 StageUsage 의미로 맞춘다.
 *
 * Claude의 input은 cache read와 별개지만, Codex의 input에는 cache read가 포함된다.
 * 따라서 반환값의 inputTokens는 언제나 cache를 제외한 입력이고, totalTokens는 알려진
 * 네 종류의 처리 토큰을 합친 값이다.
 */
export function normalizeStageUsage(
  raw: RawUsage,
  options: { inputIncludesCacheRead: boolean },
): Pick<StageUsage, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalTokens"> {
  const inputTokens = tokenCount(raw.inputTokens);
  const outputTokens = tokenCount(raw.outputTokens);
  const cacheReadTokens = tokenCount(raw.cacheReadTokens);
  const cacheWriteTokens = tokenCount(raw.cacheWriteTokens);
  const uncachedInputTokens = inputTokens === undefined
    ? undefined
    : options.inputIncludesCacheRead
      ? Math.max(0, inputTokens - (cacheReadTokens ?? 0))
      : inputTokens;
  const counts = [uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]
    .filter((value): value is number => value !== undefined);

  return {
    ...(uncachedInputTokens !== undefined ? { inputTokens: uncachedInputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(counts.length > 0 ? { totalTokens: counts.reduce((sum, value) => sum + value, 0) } : {}),
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined;
}
