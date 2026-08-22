/**
 * TraceView의 layout — hop으로 층을 나눈다(§6.6).
 *
 * Core가 이미 결정론적으로 정렬해 낸 `codeEntities`(hop, entityKey 순)를 그대로 신뢰한다 —
 * 여기서는 hop 값으로 column을 묶기만 한다. `nonForward`/`cycle` 판정도 Core가 이미
 * 끝냈으므로(U2) 여기서 다시 계산하지 않는다.
 */
import type { TraceEntity } from "@onto/protocol";

export type TraceLayout = {
  /** hop → 그 hop에 속한 entity들(Core가 정렬한 순서 그대로) */
  columns: Array<{ hop: number; entities: TraceEntity[] }>;
  maxHop: number;
};

export function computeTraceLayout(entities: readonly TraceEntity[]): TraceLayout {
  const byHop = new Map<number, TraceEntity[]>();
  for (const entity of entities) {
    if (!byHop.has(entity.hop)) byHop.set(entity.hop, []);
    byHop.get(entity.hop)!.push(entity);
  }
  const hops = [...byHop.keys()].sort((a, b) => a - b);
  return {
    columns: hops.map((hop) => ({ hop, entities: byHop.get(hop)! })),
    maxHop: hops.length > 0 ? Math.max(...hops) : 0,
  };
}
