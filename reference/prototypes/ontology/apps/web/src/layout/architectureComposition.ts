/**
 * "구성 개요" 탭의 결정론적 분류 (v2 §2) — 전체 그래프를 다 펼치는 대신, 컴포넌트를
 * 화면/중간 로직/핵심 서비스 세 단계로 큐레이션해서 보여준다.
 *
 * 새 그래프 알고리즘이 아니다 — `architectureLayout.ts`의 `computeArchitectureLayout()`이
 * 이미 계산하는 결정론적 `rank`(root로부터의 최장 경로)를 그대로 재해석한다. rank 0은
 * 아무도 의존하지 않는 진입점(주로 화면), rank가 커질수록 다른 컴포넌트에게 더 많이
 * 의존받는 중심(서비스)이라는 뜻이라, 이 재해석이 곧 "구조적 중심성" 축이 된다.
 *
 * 실측 검증(chungnam-mission-app, 19개 컴포넌트): rank 0(12개)/rank 1(3개)/rank 2(4개)로
 * 나뉘어 참고 mockup의 화면 12·중간로직 3·핵심서비스 4와 정확히 일치했다.
 */
import type { ArchitectureComponent, ArchitectureIR } from "@onto/protocol";

// architectureComposition.ts는(다른 web src 파일과 달리) node:test가 .ts를 그대로 실행하며
// 이 파일을 직접 import한다 — 그 경로에서는 .js 확장자가 sibling .ts로 안 풀린다(tsconfig의
// allowImportingTsExtensions를 그대로 쓴다). vite도 같은 확장자를 그대로 지원한다.
import { computeArchitectureLayout } from "./architectureLayout.ts";

export type ArchitectureTier = "screen" | "logic" | "state" | "core";

export type ArchitectureCompositionTier = {
  tier: ArchitectureTier;
  label: string;
  components: ArchitectureComponent[];
};

export type ArchitectureCompositionGroup = {
  /** boundary가 0~1개(가장 흔한 경우)면 null — 헤더 없이 단일 그룹으로 보여준다 */
  boundaryId: string | null;
  boundaryLabel: string | null;
  tiers: ArchitectureCompositionTier[];
};

const TIER_LABEL: Record<ArchitectureTier, string> = {
  screen: "화면",
  logic: "중간 로직",
  state: "상태 · 데이터",
  core: "핵심 서비스",
};

function tierOf(rank: number): ArchitectureTier {
  if (rank <= 0) return "screen";
  if (rank === 1) return "logic";
  return "core";
}

function tierOfComponent(component: ArchitectureComponent, rank: number): ArchitectureTier {
  switch (component.layer) {
    case "actor":
    case "interface":
    case "external":
      return "screen";
    case "service":
      return "logic";
    case "state":
    case "data":
      return "state";
    default:
      return tierOf(rank);
  }
}

function tiersFor(components: ArchitectureComponent[], ir: ArchitectureIR): ArchitectureCompositionTier[] {
  if (components.length === 0) return [];
  const idSet = new Set(components.map((c) => c.id));
  const subIr: ArchitectureIR = {
    title: ir.title,
    components,
    boundaries: [],
    connections: ir.connections.filter((c) => idSet.has(c.from) && idSet.has(c.to)),
  };
  const layout = computeArchitectureLayout(subIr);

  // flat-graph 폴백: 컴포넌트 간 연결이 거의 없어 계층이 안 나오면 억지로 3단 분류하지 않는다.
  if (layout.maxRank === 0 && components.every((component) => !component.layer)) {
    return [{ tier: "screen", label: "구성 요소", components }];
  }

  const byTier = new Map<ArchitectureTier, ArchitectureComponent[]>();
  for (const component of components) {
    const rank = layout.positions.get(component.id)?.rank ?? 0;
    const tier = tierOfComponent(component, rank);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(component);
  }

  const order: ArchitectureTier[] = ["screen", "logic", "state", "core"];
  return order
    .filter((tier) => byTier.has(tier))
    .map((tier) => ({ tier, label: TIER_LABEL[tier], components: byTier.get(tier)! }));
}

export function computeArchitectureComposition(ir: ArchitectureIR): ArchitectureCompositionGroup[] {
  if (ir.boundaries.length <= 1) {
    return [{ boundaryId: null, boundaryLabel: null, tiers: tiersFor(ir.components, ir) }];
  }

  const wrapped = new Set<string>();
  const groups: ArchitectureCompositionGroup[] = ir.boundaries.map((boundary) => {
    const members = ir.components.filter((c) => boundary.wraps.includes(c.id));
    members.forEach((c) => wrapped.add(c.id));
    return { boundaryId: boundary.id, boundaryLabel: boundary.label, tiers: tiersFor(members, ir) };
  });

  const unwrapped = ir.components.filter((c) => !wrapped.has(c.id));
  if (unwrapped.length > 0) {
    groups.push({ boundaryId: null, boundaryLabel: "그 외", tiers: tiersFor(unwrapped, ir) });
  }
  return groups;
}
