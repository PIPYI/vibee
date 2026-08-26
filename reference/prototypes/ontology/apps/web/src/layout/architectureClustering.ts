/**
 * 전체 구조 탭의 노드 클러스터링 (v2 §4-1). `architectureComposition.ts`의 rank→tier
 * 재해석과 달리 이건 실제로 새로운 그래프 알고리즘이다 — "이웃 집합이 완전히 같은 노드만
 * 합친다"는 exact-match 방식은 실전 데이터에서 대부분 놓친다(예: 화면들이 공통 서비스
 * 하나는 같이 부르지만 나머지 연결은 갈리는 경우). 대신 같은 tier 안에서 이웃 집합의
 * Jaccard 유사도가 threshold 이상인 노드끼리 Union-Find로 묶어 근사 중복을 잡아낸다.
 */
import type { ArchitectureComponent, ArchitectureConnection, ArchitectureIR, PresentationType } from "@onto/protocol";

import { computeArchitectureLayout } from "./architectureLayout.ts";

export type ArchitectureTier = "screen" | "logic" | "core";

const SIMILARITY_THRESHOLD = 0.6;
const MIN_CLUSTER_SIZE = 3;
const MAX_MERGED_LABELS = 2;

const TIER_LABEL: Record<ArchitectureTier, string> = { screen: "화면", logic: "중간 로직", core: "핵심 서비스" };

function tierOf(rank: number): ArchitectureTier {
  if (rank <= 0) return "screen";
  if (rank === 1) return "logic";
  return "core";
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    const p = this.parent.get(x) ?? x;
    if (p === x) {
      this.parent.set(x, x);
      return x;
    }
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
}

export function computeClusteredArchitectureIR(
  ir: ArchitectureIR,
  opts: { excludeFromClustering?: Set<string> } = {},
): { ir: ArchitectureIR; clusters: Map<string, ArchitectureComponent[]> } {
  const exclude = opts.excludeFromClustering ?? new Set<string>();
  const layout = computeArchitectureLayout(ir);
  const componentById = new Map(ir.components.map((c) => [c.id, c]));
  const boundaryByComponent = new Map<string, string>();
  for (const component of ir.components) if (component.boundaryId) boundaryByComponent.set(component.id, component.boundaryId);
  for (const boundary of ir.boundaries) for (const id of boundary.wraps) boundaryByComponent.set(id, boundary.id);

  const neighborSet = new Map<string, Set<string>>();
  for (const c of ir.components) neighborSet.set(c.id, new Set());
  for (const conn of ir.connections) {
    if (conn.from === conn.to) continue;
    neighborSet.get(conn.from)?.add(conn.to);
    neighborSet.get(conn.to)?.add(conn.from);
  }

  const uf = new UnionFind();
  const forcedGroups = (ir.viewPlan?.groups ?? [])
    .map((group) => ({ ...group, componentIds: group.componentIds.filter((id) => componentById.has(id) && !exclude.has(id)) }))
    .filter((group) => group.componentIds.length >= MIN_CLUSTER_SIZE);
  const forcedMembers = new Set(forcedGroups.flatMap((group) => group.componentIds));
  for (const group of forcedGroups) {
    const first = group.componentIds[0]!;
    group.componentIds.slice(1).forEach((id) => uf.union(first, id));
  }

  // 자동 유사도 클러스터링은 같은 boundary와 같은 의미 layer 안에서만 허용한다.
  const byTier = new Map<string, string[]>();
  for (const c of ir.components) {
    if (exclude.has(c.id) || forcedMembers.has(c.id)) continue;
    const rank = layout.positions.get(c.id)?.rank ?? 0;
    const tier = tierOf(rank);
    const key = `${boundaryByComponent.get(c.id) ?? "unbounded"}|${c.layer ?? tier}`;
    if (!byTier.has(key)) byTier.set(key, []);
    byTier.get(key)!.push(c.id);
  }

  for (const ids of byTier.values()) {
    const sorted = [...ids].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        const similarity = jaccard(neighborSet.get(a) ?? new Set(), neighborSet.get(b) ?? new Set());
        if (similarity >= SIMILARITY_THRESHOLD) uf.union(a, b);
      }
    }
  }

  const groupsByRoot = new Map<string, string[]>();
  const candidates = new Set<string>([...forcedMembers, ...[...byTier.values()].flat()]);
  for (const id of candidates) {
    const root = uf.find(id);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root)!.push(id);
  }

  const idToClusterId = new Map<string, string>();
  const clusters = new Map<string, ArchitectureComponent[]>();
  const clusterComponents: ArchitectureComponent[] = [];
  const sortedRoots = [...groupsByRoot.keys()].sort();
  for (const root of sortedRoots) {
    const members = [...groupsByRoot.get(root)!].sort();
    if (members.length < MIN_CLUSTER_SIZE) continue;
    const tier = tierOf(layout.positions.get(members[0]!)?.rank ?? 0);
    const authoredGroup = forcedGroups.find((group) => group.componentIds.every((id) => members.includes(id)));
    const clusterId = authoredGroup ? `cluster:group:${authoredGroup.id}` : `cluster:${tier}:${root}`;
    const memberComponents = members.map((id) => componentById.get(id)).filter((c): c is ArchitectureComponent => Boolean(c));
    clusters.set(clusterId, memberComponents);
    for (const id of members) idToClusterId.set(id, clusterId);

    const ptCounts = new Map<PresentationType, number>();
    for (const mc of memberComponents) ptCounts.set(mc.presentationType, (ptCounts.get(mc.presentationType) ?? 0) + 1);
    const presentationType = [...ptCounts.entries()].sort((a, b) =>
      a[1] !== b[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1,
    )[0]![0];

    clusterComponents.push({
      id: clusterId,
      label: authoredGroup?.label ?? `${TIER_LABEL[tier]} ${members.length}개`,
      presentationType,
      ...(memberComponents.every((component) => component.layer === memberComponents[0]?.layer) && memberComponents[0]?.layer
        ? { layer: memberComponents[0].layer }
        : {}),
      ...(memberComponents.every((component) => component.boundaryId === memberComponents[0]?.boundaryId) && memberComponents[0]?.boundaryId
        ? { boundaryId: memberComponents[0].boundaryId }
        : {}),
      entityRefs: [...new Set(memberComponents.flatMap((component) => component.entityRefs))].sort(),
      evidenceRefs: [...new Set(memberComponents.flatMap((component) => component.evidenceRefs))].sort(),
      conceptRefs: [...new Set(memberComponents.flatMap((component) => component.conceptRefs ?? []))].sort(),
    });
  }

  const resolvedId = (id: string): string => idToClusterId.get(id) ?? id;
  const passthroughComponents = ir.components.filter((c) => !idToClusterId.has(c.id));
  const newComponents = [...passthroughComponents, ...clusterComponents];

  const connectionGroups = new Map<string, ArchitectureConnection[]>();
  for (const conn of ir.connections) {
    const from = resolvedId(conn.from);
    const to = resolvedId(conn.to);
    if (from === to) continue;
    const key = `${from}->${to}`;
    if (!connectionGroups.has(key)) connectionGroups.set(key, []);
    connectionGroups.get(key)!.push(conn);
  }

  const newConnections: ArchitectureConnection[] = [...connectionGroups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, connections]) => {
      const [from, to] = key.split("->") as [string, string];
      const labels = [...new Set(connections.map((connection) => connection.label).filter((label): label is string => Boolean(label)))].sort();
      const label =
        labels.length === 0
          ? undefined
          : labels.length <= MAX_MERGED_LABELS
            ? labels.join(" · ")
            : `${labels.slice(0, MAX_MERGED_LABELS).join(" · ")} 외 ${labels.length - MAX_MERGED_LABELS}`;
      const roles = [...new Set(connections.map((connection) => connection.role).filter((role): role is NonNullable<ArchitectureConnection["role"]> => Boolean(role)))];
      const traceLinkRefs = [...new Set(connections.flatMap((connection) => connection.traceLinkRefs ?? []))].sort();
      const systemLinkRefs = [...new Set(connections.flatMap((connection) => connection.systemLinkRefs ?? []))].sort();
      return {
        id: `merged:${key}`,
        from,
        to,
        ...(label ? { label } : {}),
        ...(roles.length === 1 ? { role: roles[0]! } : {}),
        ...(systemLinkRefs.length > 0 ? { systemLinkRefs } : {}),
        ...(traceLinkRefs.length > 0 ? { traceLinkRefs } : {}),
        evidenceRefs: [...new Set(connections.flatMap((connection) => connection.evidenceRefs))].sort(),
      };
    });

  const newBoundaries = ir.boundaries.map((b) => ({ ...b, wraps: [...new Set(b.wraps.map(resolvedId))] }));

  return {
    ir: { title: ir.title, components: newComponents, boundaries: newBoundaries, connections: newConnections },
    clusters,
  };
}
