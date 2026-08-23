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

function entityPath(entityKey: string): string | undefined {
  if (entityKey.startsWith("file:")) return entityKey.slice("file:".length);
  if (entityKey.startsWith("symbol:")) return entityKey.slice("symbol:".length).split("#", 1)[0];
  return undefined;
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

  const grouped = new Map<string, { rootPath: string; runtime?: RepositoryRuntime; format: string; files: string[] }>();
  for (const filePath of [...indexedPaths].sort()) {
    const rootPath = dataRoot(filePath);
    if (!rootPath) continue;
    const extension = extname(filePath).replace(/^\./u, "").toLowerCase() || "data";
    const runtime = runtimeForPath(runtimes, filePath);
    const key = `${runtime?.id ?? "unowned"}|${rootPath}|${extension}`;
    const current = grouped.get(key) ?? {
      rootPath,
      ...(runtime ? { runtime } : {}),
      format: extension,
      files: [] as string[],
    };
    current.files.push(filePath);
    grouped.set(key, current);
  }

  const dataStores: RepositoryDataStore[] = [...grouped.values()]
    .map((group) => ({
      id: stableId("data", `${group.runtime?.id ?? "unowned"}|${group.rootPath}|${group.format}`),
      label: `${group.runtime?.label ?? "공용"} 로컬 ${group.format.toUpperCase()}`,
      rootPath: group.rootPath,
      ...(group.runtime ? { runtimeId: group.runtime.id } : {}),
      format: group.format,
      entityRefs: group.files.sort().map((path) => `file:${path}`),
      evidenceRefs: group.files.map((path) => evidenceByPath.get(path)?.id).filter((id): id is string => Boolean(id)).sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    runtimes: runtimes.sort((a, b) => a.rootPath.localeCompare(b.rootPath)),
    dataStores,
    coverage: emptyCoverage(runtimes.length, dataStores.length),
  };
}

function emptyCoverage(runtimeCount: number, dataStoreCount: number): RepositoryCoverage {
  return {
    detectedRuntimeCount: runtimeCount,
    representedRuntimeCount: 0,
    detectedDataStoreCount: dataStoreCount,
    representedDataStoreCount: 0,
    missingRuntimeIds: [],
    missingDataStoreIds: [],
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
    const refs = new Set(store.entityRefs);
    if (architecture.components.some((component) => component.entityRefs.some((ref) => refs.has(ref)))) representedStores.add(store.id);
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
    missingRuntimeIds: topology.runtimes.map((runtime) => runtime.id).filter((id) => !representedRuntimes.has(id)),
    missingDataStoreIds: topology.dataStores.map((store) => store.id).filter((id) => !representedStores.has(id)),
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
        `- ${store.id}: ${store.label}, root=${store.rootPath}, runtime=${store.runtimeId ?? "공용"}, 파일 ${store.entityRefs.length}개`,
        `  entityRefs: ${store.entityRefs.join(", ")}`,
        `  evidenceRefs: ${store.evidenceRefs.join(", ")}`,
      ].join("\n"),
    ),
  ];
  return lines.join("\n");
}
