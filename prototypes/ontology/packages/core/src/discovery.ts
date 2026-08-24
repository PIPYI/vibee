import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, posix } from "node:path";

import type {
  DiscoveryGap,
  EvidenceIndex,
  ExternalIntegrationCandidate,
  SystemFactStore,
} from "@onto/protocol";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".svelte"]);
const LOCAL_PREFIXES = [".", "/", "$lib/", "@/"];

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const stableId = (prefix: string, material: string): string =>
  `${prefix}:${createHash("sha256").update(material, "utf8").digest("hex").slice(0, 24)}`;
const providerKey = (name: string): string => name.toLowerCase().replace(/^@/u, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

function safeRead(projectPath: string, relPath: string): string | undefined {
  try {
    const path = join(projectPath, relPath);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

function manifestDependencies(projectPath: string, files: readonly string[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const path of files) {
    const text = safeRead(projectPath, path);
    if (!text) continue;
    if (path.endsWith("package.json")) {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
          const record = parsed[section];
          if (!record || typeof record !== "object" || Array.isArray(record)) continue;
          for (const name of Object.keys(record as Record<string, unknown>)) {
            const paths = result.get(name) ?? new Set<string>();
            paths.add(path);
            result.set(name, paths);
          }
        }
      } catch {
        // malformed manifest는 adapter report가 맡고 discovery는 다른 root를 계속 계산한다.
      }
    } else if (/(?:^|\/)(?:requirements[^/]*\.txt|pyproject\.toml)$/u.test(path)) {
      for (const line of text.split(/\r?\n/u)) {
        const match = line.trim().match(/^([A-Za-z0-9_.-]+)\s*(?:[<>=!~]|$)/u);
        if (!match) continue;
        const name = match[1]!.toLowerCase();
        const paths = result.get(name) ?? new Set<string>();
        paths.add(path);
        result.set(name, paths);
      }
    }
  }
  return result;
}

function sourceSignals(projectPath: string, files: readonly string[]): {
  imports: Map<string, Set<string>>;
  calls: Map<string, Set<string>>;
  configKeys: Map<string, Set<string>>;
} {
  const imports = new Map<string, Set<string>>();
  const calls = new Map<string, Set<string>>();
  const configKeys = new Map<string, Set<string>>();
  const record = (map: Map<string, Set<string>>, key: string, path: string): void => {
    const values = map.get(key) ?? new Set<string>();
    values.add(path);
    map.set(key, values);
  };

  for (const path of files) {
    if (!SOURCE_EXTENSIONS.has(extname(path)) || /(?:^|\/)README(?:\.|$)/iu.test(path)) continue;
    const text = safeRead(projectPath, path);
    if (!text) continue;
    const bindings = new Map<string, string>();
    for (const match of text.matchAll(/(?:import\s+(?:([^;\n]+?)\s+from\s+)?|require\s*\()\s*["']([^"']+)["']/gu)) {
      const name = match[2]!;
      if (LOCAL_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      record(imports, name, path);
      const clause = match[1] ?? "";
      for (const binding of clause.match(/[A-Za-z_$][\w$]*/gu) ?? []) {
        if (!["type", "as", "from"].includes(binding)) bindings.set(binding, name);
      }
    }
    for (const match of text.matchAll(/^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import\s+([^\n]+)|import\s+([A-Za-z0-9_.]+)(?:\s+as\s+([A-Za-z0-9_]+))?)/gmu)) {
      const name = (match[1] ?? match[3])!.split(".")[0]!;
      record(imports, name, path);
      const clause = match[2] ?? match[4] ?? name;
      for (const binding of clause.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []) bindings.set(binding, name);
    }
    for (const [binding, name] of bindings) {
      const escaped = binding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      if (new RegExp(`\\b${escaped}\\s*(?:\\.|\\()`, "u").test(text)) record(calls, name, path);
    }
    for (const match of text.matchAll(/(?:process\.env\.|os\.environ(?:\.get)?\s*\(?\s*["']?)([A-Z][A-Z0-9_]{2,})/gu)) {
      record(configKeys, match[1]!, path);
    }
  }
  return { imports, calls, configKeys };
}

function isCovered(name: string, facts: SystemFactStore): string[] {
  const needle = providerKey(name);
  const meaningfulTokens = needle
    .split("-")
    .map((item) => item.replace(/js$/u, ""))
    .filter((item) => item.length >= 5);
  return facts.entities
    .filter((item) => {
      if (item.ref.kind !== "resource" || item.status === "missing") return false;
      const material = providerKey(`${item.ref.namespace}-${item.ref.key}`);
      return material.includes(needle) || meaningfulTokens.some((token) => material.includes(token));
    })
    .map((item) => item.id)
    .sort();
}

/** manifest/import/call/config를 provider 중립적으로 묶는다. README는 입력에서 명시적으로 제외한다. */
export function buildExternalIntegrationCatalog(
  projectPath: string,
  evidence: EvidenceIndex,
  facts: SystemFactStore,
): ExternalIntegrationCandidate[] {
  const indexedFiles = sorted([
    ...Object.keys(evidence.fileHashes),
    ...evidence.evidence.map((item) => item.filePath).filter((item): item is string => Boolean(item)),
  ]);
  const pythonManifests = new Set<string>();
  for (const file of indexedFiles.filter((path) => path.endsWith(".py"))) {
    let directory = posix.dirname(file);
    while (directory !== "." && directory !== "/" && directory !== "") {
      for (const name of ["requirements.txt", "pyproject.toml"]) {
        const candidate = posix.join(directory, name);
        if (existsSync(join(projectPath, candidate))) pythonManifests.add(candidate);
      }
      directory = posix.dirname(directory);
    }
  }
  const files = sorted([
    ...indexedFiles,
    ...pythonManifests,
    ...["package.json", "requirements.txt", "pyproject.toml"].filter((path) => existsSync(join(projectPath, path))),
  ]);
  const manifests = manifestDependencies(projectPath, files);
  const signals = sourceSignals(projectPath, files);
  // import만 있고 manifest 선언이 없는 이름은 Python stdlib/node: built-in일 수 있다.
  // 외부 연동 후보는 dependency+import 조합부터 시작해 문서/이름만으로 서비스를 만들지 않는다.
  const names = sorted(manifests.keys());
  return names.map((name) => {
    const coveredBySystemFactIds = isCovered(name, facts);
    return {
      id: stableId("integration", name),
      packageName: name,
      providerKey: providerKey(name),
      manifestPaths: sorted(manifests.get(name) ?? []),
      importPaths: sorted(signals.imports.get(name) ?? []),
      callPaths: sorted(signals.calls.get(name) ?? []),
      configKeys: sorted(
        [...signals.configKeys.entries()]
          .filter(([, paths]) => [...paths].some((path) => signals.imports.get(name)?.has(path)))
          .map(([key]) => key),
      ),
      coveredBySystemFactIds,
      status: coveredBySystemFactIds.length > 0 ? "covered" : "discovery-gap",
    };
  });
}

export function planDiscoveryGaps(input: {
  projectPath: string;
  evidence: EvidenceIndex;
  facts: SystemFactStore;
}): { gaps: DiscoveryGap[]; catalog: ExternalIntegrationCandidate[] } {
  const catalog = buildExternalIntegrationCatalog(input.projectPath, input.evidence, input.facts);
  const evidenceByPath = new Map<string, string[]>();
  for (const item of input.evidence.evidence) {
    if (!item.filePath || item.status !== "present") continue;
    const values = evidenceByPath.get(item.filePath) ?? [];
    values.push(item.id);
    evidenceByPath.set(item.filePath, values);
  }
  const gaps: DiscoveryGap[] = [];
  for (const candidate of catalog) {
    if (candidate.status === "covered" || candidate.importPaths.length === 0) continue;
    const filePaths = sorted([...candidate.manifestPaths, ...candidate.importPaths, ...candidate.callPaths]);
    gaps.push({
      id: stableId("gap", `${candidate.id}:integration`),
      kind: candidate.callPaths.length > 0 ? "unresolved-import-call" : "manifest-dependency",
      reason:
        candidate.callPaths.length > 0
          ? `${candidate.packageName} import와 실제 사용이 있지만 검증된 System Fact가 없습니다.`
          : `${candidate.packageName} 의존성과 import가 있지만 runtime/resource 의미가 연결되지 않았습니다.`,
      filePaths,
      evidenceRefs: sorted(filePaths.flatMap((path) => evidenceByPath.get(path) ?? [])),
      packageName: candidate.packageName,
      ...(candidate.configKeys.length > 0 ? { configKeys: candidate.configKeys } : {}),
      priority: candidate.callPaths.length > 0 ? "high" : "medium",
    });
  }
  for (const report of input.evidence.adapterReport) {
    if (report.level === "info") continue;
    gaps.push({
      id: stableId("gap", `adapter:${report.adapterId}:${report.filePath ?? ""}:${report.message}`),
      kind: "adapter-degraded",
      reason: report.message,
      filePaths: report.filePath ? [report.filePath] : [],
      evidenceRefs: report.filePath ? sorted(evidenceByPath.get(report.filePath) ?? []) : [],
      priority: report.level === "error" ? "high" : "medium",
    });
  }
  const runtimeFiles = Object.keys(input.evidence.fileHashes).filter((path) =>
    /(?:^|\/)(?:\+server|\+page|hooks\.server)\.(?:js|ts|svelte)$/u.test(path),
  );
  const runtimeCovered = input.facts.entities.some(
    (item) => item.ref.kind === "resource" && item.ref.namespace === "runtime" && item.status !== "missing",
  );
  if (runtimeFiles.length > 0 && !runtimeCovered) {
    gaps.push({
      id: stableId("gap", `runtime:${runtimeFiles.sort().join("|")}`),
      kind: "runtime-boundary",
      reason: "프레임워크 경계 파일이 있지만 검증된 runtime/route System Fact가 없습니다.",
      filePaths: sorted(runtimeFiles),
      evidenceRefs: sorted(runtimeFiles.flatMap((path) => evidenceByPath.get(path) ?? [])),
      priority: "high",
    });
  }
  gaps.sort((a, b) => (a.priority !== b.priority ? ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) : a.id.localeCompare(b.id)));
  return { gaps, catalog };
}
