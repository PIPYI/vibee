import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { extname, join, posix } from "node:path";

import type {
  DiscoveryGap,
  EvidenceIndex,
  ExternalIntegrationCandidate,
  SystemFactStore,
} from "@onto/protocol";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".svelte"]);
const LOCAL_PREFIXES = [".", "/", "$lib/", "@/"];

// node:module의 builtinModules는 언어(JS/TS)에 종속되지 않는 실제 런타임 정보라서 하드코딩이 아니다.
const NODE_BUILTIN_MODULES = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));

// Python은 Node 런타임에서 내부 조회가 불가능하므로, 표준 라이브러리 top-level 모듈 이름만
// 별도로 유지한다. 매니페스트 없이 import되는 이름이 이 목록에 없으면 외부 연동 후보로 본다.
const PYTHON_STDLIB_MODULES = new Set([
  "__future__", "__main__", "_thread", "abc", "aifc", "argparse", "array", "ast", "asyncio",
  "atexit", "base64", "bdb", "binascii", "bisect", "builtins", "bz2", "calendar", "cgi", "cgitb",
  "chunk", "cmath", "cmd", "code", "codecs", "codeop", "collections", "colorsys", "compileall",
  "concurrent", "configparser", "contextlib", "contextvars", "copy", "copyreg", "cProfile", "crypt",
  "csv", "ctypes", "curses", "dataclasses", "datetime", "dbm", "decimal", "difflib", "dis",
  "distutils", "doctest", "email", "encodings", "ensurepip", "enum", "errno", "faulthandler",
  "fcntl", "filecmp", "fileinput", "fnmatch", "fractions", "ftplib", "functools", "gc", "getopt",
  "getpass", "gettext", "glob", "graphlib", "grp", "gzip", "hashlib", "heapq", "hmac", "html",
  "http", "idlelib", "imaplib", "imghdr", "imp", "importlib", "inspect", "io", "ipaddress",
  "itertools", "json", "keyword", "lib2to3", "linecache", "locale", "logging", "lzma", "mailbox",
  "mailcap", "marshal", "math", "mimetypes", "mmap", "modulefinder", "msilib", "msvcrt",
  "multiprocessing", "netrc", "nntplib", "numbers", "operator", "optparse", "os", "ossaudiodev",
  "pathlib", "pdb", "pickle", "pickletools", "pipes", "pkgutil", "platform", "plistlib", "poplib",
  "posixpath", "pprint", "profile", "pstats", "pty", "pwd", "py_compile", "pyclbr", "pydoc",
  "queue", "quopri", "random", "re", "readline", "reprlib", "resource", "rlcompleter", "runpy",
  "sched", "secrets", "select", "selectors", "shelve", "shlex", "shutil", "signal", "site",
  "smtpd", "smtplib", "sndhdr", "socket", "socketserver", "spwd", "sqlite3", "sre_compile",
  "sre_constants", "sre_parse", "ssl", "stat", "statistics", "string", "stringprep", "struct",
  "subprocess", "sunau", "symtable", "sys", "sysconfig", "syslog", "tabnanny", "tarfile",
  "telnetlib", "tempfile", "termios", "textwrap", "threading", "time", "timeit", "tkinter",
  "token", "tokenize", "tomllib", "trace", "traceback", "tracemalloc", "tty", "turtle", "types",
  "typing", "unicodedata", "unittest", "urllib", "uu", "uuid", "venv", "warnings", "wave",
  "weakref", "webbrowser", "winreg", "winsound", "wsgiref", "xdrlib", "xml", "xmlrpc", "zipapp",
  "zipfile", "zipimport", "zlib", "zoneinfo",
]);

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
    // Python 전용 문법이다 — JS의 "import X from 'y'"도 우연히 "import X" 부분까지는 매칭되므로
    // (as절이 optional이라 "from" 앞에서 매칭이 끝나버린다) .py 파일에만 적용해야 한다. 아니면
    // 바인딩 식별자(예: 기본 import한 "React")를 패키지 이름으로 잘못 기록하게 된다.
    if (extname(path) === ".py") {
      for (const match of text.matchAll(/^\s*(?:from\s+([A-Za-z0-9_.]+)\s+import\s+([^\n]+)|import\s+([A-Za-z0-9_.]+)(?:\s+as\s+([A-Za-z0-9_]+))?)/gmu)) {
        const name = (match[1] ?? match[3])!.split(".")[0]!;
        record(imports, name, path);
        const clause = match[2] ?? match[4] ?? name;
        for (const binding of clause.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []) bindings.set(binding, name);
      }
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

/**
 * "매니페스트에 없어도 import되고 non-stdlib/non-local이면 후보로 본다"는 원시 판별 로직.
 * 언어에 상관없이 재사용할 수 있도록 external-integration 후보 계산과 A2의 라우트/서비스
 * 탐지기가 공유하는 공용 유틸이다.
 */
export function isExternalLookingImportName(name: string, localNames: ReadonlySet<string>): boolean {
  if (!name) return false;
  const bare = name.replace(/^node:/u, "");
  if (NODE_BUILTIN_MODULES.has(bare)) return false;
  if (PYTHON_STDLIB_MODULES.has(name)) return false;
  if (localNames.has(name)) return false;
  return true;
}

/**
 * 로컬 first-party 모듈/패키지 이름 집합 — 인덱싱된 파일 트리의 모든 깊이의 디렉터리 이름과
 * 파일 stem을 모은다. 저장소 최상위(예: "backend")뿐 아니라 그 아래 패키지(예:
 * "backend/routes" → "routes")나 모듈(예: "backend/firebase_config.py" → "firebase_config")도
 * Python에서는 sys.path 구성에 따라 아무 접두사 없이 import될 수 있어서, 최상위만 보면
 * "routes"·"utils"처럼 흔한 로컬 패키지 이름을 외부 연동으로 오탐한다.
 */
export function localModuleNames(indexedFiles: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const path of indexedFiles) {
    for (const segment of path.split("/")) {
      const stem = segment.replace(/\.(?:js|jsx|mjs|cjs|ts|tsx|py|svelte)$/u, "");
      if (stem.length > 0) names.add(stem);
    }
  }
  return names;
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
  // import만 있고 manifest 선언이 없는 이름은 Python stdlib/node: built-in이거나 로컬 first-party
  // 모듈일 수 있다. 그 둘을 뺀 나머지는 매니페스트가 아예 없는 런타임(Flask 등)에서도 후보가 된다.
  const localNames = localModuleNames(files);
  const manifestLessImportNames = sorted(signals.imports.keys()).filter(
    (name) => !manifests.has(name) && isExternalLookingImportName(name, localNames),
  );
  const names = sorted([...manifests.keys(), ...manifestLessImportNames]);
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
  gaps.push(...unrecognizedSourceLanguageGaps(input.evidence));
  gaps.sort((a, b) => (a.priority !== b.priority ? ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) : a.id.localeCompare(b.id)));
  return { gaps, catalog };
}

/** 한 언어 그룹의 gap에 담는 대표 파일 수 — 그 이상은 reason 텍스트의 총개수로만 알린다. */
const UNRECOGNIZED_LANGUAGE_SAMPLE_SIZE = 50;
/** 이 미만이면 프로젝트에 우연히 섞인 파일 한둘로 보고 gap을 만들지 않는다. */
const UNRECOGNIZED_LANGUAGE_MIN_COUNT = 3;
/** 전체 파일 대비 이 비율 이상이면 개수가 적어도(예: 소형 저장소) gap을 만든다. */
const UNRECOGNIZED_LANGUAGE_MIN_SHARE = 0.05;

/**
 * `isSourceFile`의 닫힌 언어 허용목록 밖에 있어 지금까지 evidence가 전혀 없던 파일들을
 * gap으로 드러낸다. 특정 프레임워크/언어를 하나도 하드코딩하지 않는다 — 확장자별로 묶어
 * "이 확장자는 우리가 모른다"는 사실만 알린다. 이게 있어야 `get_incremental_analysis_context`가
 * "gap 밖은 조사하지 마라"고 해도 미지 언어가 조사 범위 밖으로 완전히 사라지지 않는다.
 */
function unrecognizedSourceLanguageGaps(evidence: EvidenceIndex): DiscoveryGap[] {
  if (evidence.unindexedFiles.length === 0) return [];
  const totalFiles = Object.keys(evidence.fileHashes).length + evidence.unindexedFiles.length;
  const byExtension = new Map<string, string[]>();
  for (const item of evidence.unindexedFiles) {
    const key = item.extension || "(확장자 없음)";
    const values = byExtension.get(key) ?? [];
    values.push(item.filePath);
    byExtension.set(key, values);
  }
  const gaps: DiscoveryGap[] = [];
  for (const [extension, filePaths] of byExtension) {
    const share = totalFiles > 0 ? filePaths.length / totalFiles : 0;
    if (filePaths.length < UNRECOGNIZED_LANGUAGE_MIN_COUNT && share < UNRECOGNIZED_LANGUAGE_MIN_SHARE) continue;
    const sample = sorted(filePaths).slice(0, UNRECOGNIZED_LANGUAGE_SAMPLE_SIZE);
    gaps.push({
      id: stableId("gap", `unrecognized-language:${extension}`),
      kind: "unrecognized-source-language",
      reason:
        `${extension} 파일 ${filePaths.length}개가 인식된 언어/프레임워크 밖에 있어 ` +
        "evidence가 전혀 없습니다. 직접 읽고 propose_evidence/propose_system_facts로 등록하세요." +
        (filePaths.length > sample.length ? ` (파일 목록은 처음 ${sample.length}개만 표시)` : ""),
      filePaths: sample,
      evidenceRefs: [],
      priority: "medium",
    });
  }
  return gaps;
}
