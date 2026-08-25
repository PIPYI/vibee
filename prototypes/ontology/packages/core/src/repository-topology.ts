/**
 * 저장소의 거시 골격. package manifest·entrypoint·로컬 데이터 자산만 사용하며 LLM을 부르지
 * 않는다. 의미 이름과 주 경로는 Assembly가 만들지만, 독립 실행 단위와 저장소가 누락되는
 * 것은 이 층이 막는다.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, posix } from "node:path";

import type {
  ArchitectureIR,
  Evidence,
  EvidenceIndex,
  RepositoryCoverage,
  RepositoryDataStore,
  RepositoryRouteSurface,
  RepositoryRuntime,
  RepositoryRuntimeKind,
  RepositoryTopology,
} from "@onto/protocol";

type PackageManifest = {
  name?: string;
  main?: string;
  source?: string;
  module?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
};

function stableId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function normalizeRoot(manifestPath: string): string {
  const root = posix.dirname(manifestPath);
  return root === "." ? "" : root;
}

function pathInside(rootPath: string, filePath: string): boolean {
  return rootPath === "" ? true : filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function fileEvidenceByPath(index: EvidenceIndex): Map<string, Evidence> {
  return new Map(
    index.evidence
      .filter((item) => item.status === "present" && item.kind === "file" && item.filePath)
      .map((item) => [item.filePath!, item] as const),
  );
}

function readManifest(projectPath: string, manifestPath: string): PackageManifest | null {
  const absolute = join(projectPath, manifestPath);
  if (!existsSync(absolute)) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8")) as PackageManifest;
  } catch {
    return null;
  }
}

function runtimeKind(manifest: PackageManifest): RepositoryRuntimeKind {
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  if ("expo" in deps || "react-native" in deps) return "mobile-app";
  if ("vite" in deps || "next" in deps || "react-dom" in deps) return "web-app";
  if ("express" in deps || "fastify" in deps || "@nestjs/core" in deps) return "service";
  return "application";
}

function isRunnableManifest(manifestPath: string, manifest: PackageManifest): boolean {
  const scripts = manifest.scripts ?? {};
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
  const runnableScript = ["start", "dev", "serve", "preview"].some((name) => Boolean(scripts[name]));
  const runnableFramework = ["expo", "vite", "next", "express", "fastify", "@nestjs/core", "electron"].some(
    (name) => name in deps,
  );
  if (runnableScript || runnableFramework) return true;
  // workspace 루트는 build/typecheck만 갖는 경우가 많다. 반면 단일 package 루트는 main/bin이
  // 곧 실행 단위일 수 있다.
  return manifestPath === "package.json" && !manifest.workspaces && Boolean(manifest.main || manifest.bin);
}

function manifestEntrypoints(rootPath: string, manifest: PackageManifest, indexedPaths: Set<string>): string[] {
  const relativeCandidates = new Set<string>();
  for (const value of [manifest.source, manifest.module, manifest.main]) if (value) relativeCandidates.add(value);
  if (typeof manifest.bin === "string") relativeCandidates.add(manifest.bin);
  else for (const value of Object.values(manifest.bin ?? {})) relativeCandidates.add(value);

  const conventional = [
    "app/_layout.tsx",
    "app/index.tsx",
    "src/main.tsx",
    "src/main.ts",
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
    "server.ts",
    "server.js",
  ];
  conventional.forEach((candidate) => relativeCandidates.add(candidate));

  return [...relativeCandidates]
    .map((candidate) => posix.normalize(rootPath ? `${rootPath}/${candidate.replace(/^\.\//u, "")}` : candidate.replace(/^\.\//u, "")))
    .filter((candidate) => indexedPaths.has(candidate))
    .sort();
}

function runtimeForPath(runtimes: RepositoryRuntime[], filePath: string): RepositoryRuntime | undefined {
  return [...runtimes]
    .filter((runtime) => pathInside(runtime.rootPath, filePath))
    .sort((a, b) => b.rootPath.length - a.rootPath.length || a.id.localeCompare(b.id))[0];
}

function dataRoot(filePath: string): string | null {
  const parts = filePath.split("/");
  const index = parts.findIndex((part) => /^(?:data|fixtures?|mocks?|seeds?)$/iu.test(part));
  return index < 0 ? null : parts.slice(0, index + 1).join("/");
}

const TIMESTAMP_LIKE_DIR = /^(?:\d{4}-\d{2}-\d{2}(?:[_t]\d{2}[-:]?\d{2}[-:]?\d{2})?|\d{8}[-_]?\d{6}|\d{10,13}|run[-_]?\d+)$/iu;

/**
 * data root 바로 아래 타임스탬프형 자식 디렉터리가 반복되고, 그 안에서 같은 상대 파일명이
 * 되풀이되는 패턴을 찾는다(V5 C1) — 내용을 열어보지 않는 이름 패턴 휴리스틱이다. 같은 root
 * 안에 사람이 선언한 파일과 파이프라인 산출물이 섞여 있을 수 있으므로, root 전체가 아니라
 * "어떤 자식 디렉터리 이름이 타임스탬프형이고 어떤 상대 파일명이 반복되는가"만 돌려주고,
 * 실제 declared/generated-artifact 판정은 파일 단위로 한다(fileDataOrigin).
 */
function analyzeDataRootOrigin(
  rootPath: string,
  filesUnderRoot: readonly string[],
): { timestampLikeDirs: Set<string>; repeatedTrailingPaths: Set<string> } {
  const trailingByChildDir = new Map<string, string[]>();
  for (const filePath of filesUnderRoot) {
    const rest = rootPath === "" ? filePath : filePath.slice(rootPath.length + 1);
    const segments = rest.split("/");
    if (segments.length < 2) continue;
    const childDir = segments[0]!;
    const trailing = segments.slice(1).join("/");
    const list = trailingByChildDir.get(childDir) ?? [];
    list.push(trailing);
    trailingByChildDir.set(childDir, list);
  }
  const childDirNames = [...trailingByChildDir.keys()];
  const timestampLikeDirs = new Set(childDirNames.filter((name) => TIMESTAMP_LIKE_DIR.test(name)));
  if (childDirNames.length < 2 || timestampLikeDirs.size < 2 || timestampLikeDirs.size / childDirNames.length < 0.5) {
    return { timestampLikeDirs: new Set(), repeatedTrailingPaths: new Set() };
  }

  const countByTrailing = new Map<string, number>();
  for (const childDir of timestampLikeDirs) {
    for (const trailing of new Set(trailingByChildDir.get(childDir) ?? [])) {
      countByTrailing.set(trailing, (countByTrailing.get(trailing) ?? 0) + 1);
    }
  }
  const repeatedTrailingPaths = new Set([...countByTrailing.entries()].filter(([, count]) => count >= 2).map(([trailing]) => trailing));
  return { timestampLikeDirs, repeatedTrailingPaths };
}

function fileDataOrigin(
  rootPath: string,
  filePath: string,
  analysis: { timestampLikeDirs: Set<string>; repeatedTrailingPaths: Set<string> },
): "declared" | "generated-artifact" {
  const rest = rootPath === "" ? filePath : filePath.slice(rootPath.length + 1);
  const segments = rest.split("/");
  if (segments.length < 2) return "declared";
  const childDir = segments[0]!;
  if (!analysis.timestampLikeDirs.has(childDir)) return "declared";
  const trailing = segments.slice(1).join("/");
  return analysis.repeatedTrailingPaths.has(trailing) ? "generated-artifact" : "declared";
}

function entityPath(entityKey: string): string | undefined {
  if (entityKey.startsWith("file:")) return entityKey.slice("file:".length);
  if (entityKey.startsWith("symbol:")) return entityKey.slice("symbol:".length).split("#", 1)[0];
  return undefined;
}

/**
 * "이 entityRefs 중 하나라도 어떤 컴포넌트에 실제로 참조되는가" — dataStore·routeSurface
 * 커버리지 체크가 공유하는 단일 메커니즘(V5 원칙 2). 새 카탈로그가 늘어나도 이 헬퍼를
 * 재사용하는 루프 하나만 추가하면 된다.
 */
function componentsCoverEntityRefs(architecture: ArchitectureIR, entityRefs: readonly string[]): boolean {
  const refs = new Set(entityRefs);
  return architecture.components.some((component) => component.entityRefs.some((ref) => refs.has(ref)));
}

export function detectRepositoryTopology(projectPath: string, index: EvidenceIndex): RepositoryTopology {
  const evidenceByPath = fileEvidenceByPath(index);
  const indexedPaths = new Set(evidenceByPath.keys());
  const manifestPaths = [...indexedPaths].filter((path) => path === "package.json" || path.endsWith("/package.json")).sort();

  const runtimes: RepositoryRuntime[] = [];
  for (const manifestPath of manifestPaths) {
    const manifest = readManifest(projectPath, manifestPath);
    if (!manifest || !isRunnableManifest(manifestPath, manifest)) continue;
    const rootPath = normalizeRoot(manifestPath);
    const entrypoints = manifestEntrypoints(rootPath, manifest, indexedPaths);
    const evidenceRefs = [evidenceByPath.get(manifestPath)?.id, ...entrypoints.map((path) => evidenceByPath.get(path)?.id)]
      .filter((id): id is string => Boolean(id));
    runtimes.push({
      id: stableId("runtime", rootPath || "."),
      label: manifest.name ?? (rootPath || "프로젝트"),
      rootPath,
      manifestPath,
      kind: runtimeKind(manifest),
      entrypointRefs: entrypoints.map((path) => `file:${path}`),
      evidenceRefs: [...new Set(evidenceRefs)].sort(),
    });
  }

  const filesByDataRoot = new Map<string, string[]>();
  for (const filePath of [...indexedPaths].sort()) {
    const rootPath = dataRoot(filePath);
    if (!rootPath) continue;
    const list = filesByDataRoot.get(rootPath) ?? [];
    list.push(filePath);
    filesByDataRoot.set(rootPath, list);
  }
  const originAnalysisByDataRoot = new Map(
    [...filesByDataRoot.entries()].map(([rootPath, files]) => [rootPath, analyzeDataRootOrigin(rootPath, files)] as const),
  );

  const grouped = new Map<
    string,
    { rootPath: string; runtime?: RepositoryRuntime; format: string; origin: "declared" | "generated-artifact"; files: string[] }
  >();
  for (const filePath of [...indexedPaths].sort()) {
    const rootPath = dataRoot(filePath);
    if (!rootPath) continue;
    const extension = extname(filePath).replace(/^\./u, "").toLowerCase() || "data";
    const runtime = runtimeForPath(runtimes, filePath);
    const analysis = originAnalysisByDataRoot.get(rootPath)!;
    const origin = fileDataOrigin(rootPath, filePath, analysis);
    const key = `${runtime?.id ?? "unowned"}|${rootPath}|${extension}|${origin}`;
    const current = grouped.get(key) ?? {
      rootPath,
      ...(runtime ? { runtime } : {}),
      format: extension,
      origin,
      files: [] as string[],
    };
    current.files.push(filePath);
    grouped.set(key, current);
  }

  const dataStores: RepositoryDataStore[] = [...grouped.values()]
    .map((group) => ({
      id: stableId("data", `${group.runtime?.id ?? "unowned"}|${group.rootPath}|${group.format}|${group.origin}`),
      label:
        group.origin === "generated-artifact"
          ? `${group.runtime?.label ?? "공용"} 파이프라인 산출물 ${group.format.toUpperCase()}`
          : `${group.runtime?.label ?? "공용"} 로컬 ${group.format.toUpperCase()}`,
      rootPath: group.rootPath,
      ...(group.runtime ? { runtimeId: group.runtime.id } : {}),
      format: group.format,
      origin: group.origin,
      entityRefs: group.files.sort().map((path) => `file:${path}`),
      evidenceRefs: group.files.map((path) => evidenceByPath.get(path)?.id).filter((id): id is string => Boolean(id)).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const routesByFile = new Map<string, { routeKeys: Set<string>; evidenceIds: Set<string> }>();
  for (const item of index.evidence) {
    if (item.status !== "present" || item.kind !== "route" || item.graph?.role !== "entity" || !item.filePath) continue;
    if (item.graph.entity.kind !== "route") continue;
    const bucket = routesByFile.get(item.filePath) ?? { routeKeys: new Set<string>(), evidenceIds: new Set<string>() };
    bucket.routeKeys.add(item.graph.entity.routeKey);
    bucket.evidenceIds.add(item.id);
    routesByFile.set(item.filePath, bucket);
  }
  const routeSurfaces: RepositoryRouteSurface[] = [...routesByFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, bucket]) => {
      const runtime = runtimeForPath(runtimes, filePath);
      return {
        id: stableId("route-surface", filePath),
        label: `${filePath} 라우트 ${bucket.routeKeys.size}개`,
        filePath,
        ...(runtime ? { runtimeId: runtime.id } : {}),
        routeKeys: [...bucket.routeKeys].sort(),
        entityRefs: [`file:${filePath}`],
        evidenceRefs: [...bucket.evidenceIds].sort(),
      };
    });

  return {
    runtimes: runtimes.sort((a, b) => a.rootPath.localeCompare(b.rootPath)),
    dataStores,
    routeSurfaces,
    coverage: emptyCoverage(runtimes.length, dataStores.length, routeSurfaces.length),
  };
}

function emptyCoverage(runtimeCount: number, dataStoreCount: number, routeSurfaceCount: number): RepositoryCoverage {
  return {
    detectedRuntimeCount: runtimeCount,
    representedRuntimeCount: 0,
    detectedDataStoreCount: dataStoreCount,
    representedDataStoreCount: 0,
    detectedRouteSurfaceCount: routeSurfaceCount,
    representedRouteSurfaceCount: 0,
    missingRuntimeIds: [],
    missingDataStoreIds: [],
    missingRouteSurfaceIds: [],
    sharedBoundaryRuntimeIds: [],
  };
}

export function assessRepositoryCoverage(topology: RepositoryTopology, architecture: ArchitectureIR): RepositoryTopology {
  const componentRuntime = new Map<string, string>();
  const componentById = new Map(architecture.components.map((component) => [component.id, component] as const));

  for (const component of architecture.components) {
    const paths = component.entityRefs.map(entityPath).filter((path): path is string => Boolean(path));
    const runtime = paths.map((path) => runtimeForPath(topology.runtimes, path)).find(Boolean);
    if (!runtime) continue;
    componentRuntime.set(component.id, runtime.id);
  }

  const componentBoundaryIds = new Map<string, Set<string>>();
  for (const component of architecture.components) {
    if (component.boundaryId) componentBoundaryIds.set(component.id, new Set([component.boundaryId]));
  }
  for (const boundary of architecture.boundaries) {
    for (const componentId of boundary.wraps) {
      const ids = componentBoundaryIds.get(componentId) ?? new Set<string>();
      ids.add(boundary.id);
      componentBoundaryIds.set(componentId, ids);
    }
  }

  const representedRuntimes = new Set<string>();
  for (const runtime of topology.runtimes) {
    const components = architecture.components.filter((component) => componentRuntime.get(component.id) === runtime.id);
    const refs = new Set(components.flatMap((component) => component.entityRefs));
    const entrypointsCovered =
      runtime.entrypointRefs.length === 0 ? components.length > 0 : runtime.entrypointRefs.every((ref) => refs.has(ref));
    const hasBoundary = components.some((component) => (componentBoundaryIds.get(component.id)?.size ?? 0) > 0);
    if (entrypointsCovered && hasBoundary) representedRuntimes.add(runtime.id);
  }

  const representedStores = new Set<string>();
  for (const store of topology.dataStores) {
    if (componentsCoverEntityRefs(architecture, store.entityRefs)) representedStores.add(store.id);
  }

  const representedRouteSurfaces = new Set<string>();
  for (const surface of topology.routeSurfaces) {
    if (componentsCoverEntityRefs(architecture, surface.entityRefs)) representedRouteSurfaces.add(surface.id);
  }

  const runtimesByBoundary = new Map<string, Set<string>>();
  for (const component of componentById.values()) {
    const runtimeId = componentRuntime.get(component.id);
    if (!runtimeId) continue;
    for (const boundaryId of componentBoundaryIds.get(component.id) ?? []) {
      const runtimeIds = runtimesByBoundary.get(boundaryId) ?? new Set<string>();
      runtimeIds.add(runtimeId);
      runtimesByBoundary.set(boundaryId, runtimeIds);
    }
  }
  const sharedBoundaryRuntimeIds = new Set<string>();
  for (const runtimeIds of runtimesByBoundary.values()) {
    if (runtimeIds.size < 2) continue;
    runtimeIds.forEach((id) => sharedBoundaryRuntimeIds.add(id));
  }

  const coverage: RepositoryCoverage = {
    detectedRuntimeCount: topology.runtimes.length,
    representedRuntimeCount: representedRuntimes.size,
    detectedDataStoreCount: topology.dataStores.length,
    representedDataStoreCount: representedStores.size,
    detectedRouteSurfaceCount: topology.routeSurfaces.length,
    representedRouteSurfaceCount: representedRouteSurfaces.size,
    missingRuntimeIds: topology.runtimes.map((runtime) => runtime.id).filter((id) => !representedRuntimes.has(id)),
    // generated-artifact는 커버리지 게이트가 요구하지 않는다 — 파이프라인이 실행마다 만드는
    // 산출물이라 architecture에 나타나지 않아도 결함이 아니다(V5 C1).
    missingDataStoreIds: topology.dataStores
      .filter((store) => store.origin !== "generated-artifact")
      .map((store) => store.id)
      .filter((id) => !representedStores.has(id)),
    missingRouteSurfaceIds: topology.routeSurfaces
      .map((surface) => surface.id)
      .filter((id) => !representedRouteSurfaces.has(id)),
    sharedBoundaryRuntimeIds: [...sharedBoundaryRuntimeIds].sort(),
  };
  return { ...topology, coverage };
}

export function describeRepositoryTopology(topology: RepositoryTopology): string {
  const lines = [
    `독립 실행 런타임 ${topology.runtimes.length}개:`,
    ...topology.runtimes.map((runtime) =>
      [
        `- ${runtime.id}: ${runtime.label} (${runtime.kind}), root=${runtime.rootPath || "."}, manifest=${runtime.manifestPath}`,
        `  entrypoint entityRefs: ${runtime.entrypointRefs.length > 0 ? runtime.entrypointRefs.join(", ") : "(탐지 없음)"}`,
        `  evidenceRefs: ${runtime.evidenceRefs.join(", ")}`,
      ].join("\n"),
    ),
    "",
    `로컬 데이터 저장소 ${topology.dataStores.length}개:`,
    ...topology.dataStores.map((store) =>
      [
        `- ${store.id}: ${store.label}, root=${store.rootPath}, runtime=${store.runtimeId ?? "공용"}, ` +
          `origin=${store.origin}, 파일 ${store.entityRefs.length}개`,
        `  entityRefs: ${store.entityRefs.join(", ")}`,
        `  evidenceRefs: ${store.evidenceRefs.join(", ")}`,
      ].join("\n"),
    ),
    "",
    `라우트 표면 ${topology.routeSurfaces.length}개:`,
    ...topology.routeSurfaces.map((surface) =>
      [
        `- ${surface.id}: ${surface.filePath}, runtime=${surface.runtimeId ?? "미상"}, route ${surface.routeKeys.length}개`,
        `  routeKeys: ${surface.routeKeys.join(", ")}`,
      ].join("\n"),
    ),
  ];
  return lines.join("\n");
}
