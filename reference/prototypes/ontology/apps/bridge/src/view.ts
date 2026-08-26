/**
 * View cache key — Overview/Scenario 전용 (implementation_plan §6.4 V2, §6.9 [C]).
 *
 * Trace는 여기 없다 — Core가 동기로 투영하므로 캐시가 필요 없다(§6.6).
 *
 * **`analysisVersion`이 아니라 `semanticVersion`으로 키를 잡는다.** 포매팅만 바꾼 커밋도
 * `analysisVersion`을 올리므로, 그것으로 캐시를 무효화하면 의미가 전혀 안 바뀌었는데도
 * Overview/Scenario를 AI로 다시 만들게 된다(V2).
 */
import { createHash } from "node:crypto";

import type { ViewKind, ViewRequest } from "@onto/protocol";

/**
 * view-validator/schema를 바꾸면 올린다 — 옛 캐시가 새 규칙을 통과했다고 보장할 수 없다.
 */
export const VIEW_PLANNER_VERSION = "v1";

/** anchor·question·scope만 해시한다 — viewKind·agent는 캐시 키의 다른 자리에서 이미 구분된다. */
export function hashViewRequest(request: ViewRequest): string {
  const material = JSON.stringify({
    anchor: request.anchor ?? null,
    question: request.question ?? null,
    scope: request.scope ?? null,
  });
  return createHash("sha1").update(material, "utf8").digest("hex");
}

/** `overview`/`scenario` 캐시의 문자열 키. */
export function viewCacheKeyString(
  viewKind: Exclude<ViewKind, "trace">,
  semanticVersion: number,
  requestHash: string,
): string {
  return `${viewKind}:${semanticVersion}:${VIEW_PLANNER_VERSION}:${requestHash}`;
}
