/**
 * 언어 설정과 파일 수집 (implementation_plan C1).
 *
 * CoderMind의 `LanguageConfig` 패턴을 가져오되 우리 것은 훨씬 얇다 — M1은 TS/JS 하나다.
 * 다른 언어를 붙일 자리를 남겨 두는 것이 목적이고, **파싱 실패를 조용히 건너뛰지 않는
 * 것**(adapterReport)이 핵심이다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type LanguageConfig = {
  name: string;
  extensions: readonly string[];
  testGlobs: readonly string[];
};

export const TYPESCRIPT: LanguageConfig = {
  name: "typescript",
  extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  testGlobs: [".test.", ".spec.", "__tests__"],
};

export const PYTHON: LanguageConfig = {
  name: "python",
  extensions: [".py"],
  testGlobs: ["test_", "_test.py", "/tests/"],
};

/**
 * 심볼/호출 그래프까지 복원하는 전용 파서는 없지만, generic-patterns.ts의 언어 비종속
 * 라우트 탐지기가 스캔할 수 있도록 파일 수집·file evidence 대상에는 포함하는 언어들.
 */
export const GENERIC_PATTERN_LANGUAGES: LanguageConfig[] = [
  { name: "java", extensions: [".java"], testGlobs: ["Test.java", "Tests.java", "/test/"] },
  { name: "csharp", extensions: [".cs"], testGlobs: ["Test.cs", "Tests.cs", "/Tests/"] },
  { name: "ruby", extensions: [".rb"], testGlobs: ["_spec.rb", "/spec/"] },
  { name: "go", extensions: [".go"], testGlobs: ["_test.go"] },
];

/** 걸어 들어가지 않는 디렉터리. `.project-intel`은 우리 산출물이므로 인덱싱하지 않는다. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".project-intel",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  ".venv",
  "__pycache__",
]);

const GENERIC_PATTERN_EXTENSIONS = GENERIC_PATTERN_LANGUAGES.flatMap((language) => language.extensions);
const GENERIC_PATTERN_TEST_GLOBS = GENERIC_PATTERN_LANGUAGES.flatMap((language) => language.testGlobs);

export function isSourceFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return [...TYPESCRIPT.extensions, ...PYTHON.extensions, ...GENERIC_PATTERN_EXTENSIONS].some((extension) =>
    lower.endsWith(extension),
  );
}

export function isTypeScriptSourceFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return TYPESCRIPT.extensions.some((extension) => lower.endsWith(extension));
}

export function isPythonSourceFile(relPath: string): boolean {
  return relPath.toLowerCase().endsWith(".py");
}

/** 전용 심볼 파서는 없지만 generic-patterns.ts 라우트 탐지 대상인 파일. */
export function isGenericPatternSourceFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return GENERIC_PATTERN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function isTestFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return [...TYPESCRIPT.testGlobs, ...PYTHON.testGlobs, ...GENERIC_PATTERN_TEST_GLOBS].some((marker) =>
    lower.includes(marker),
  );
}

/** POSIX 구분자로 통일한다. evidence id가 플랫폼마다 달라지면 안 된다. */
export function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/**
 * 프로젝트의 소스 파일을 수집한다. 반환 순서는 **정렬되어 있다** — 인덱스 결과의
 * 결정론이 여기서 시작된다.
 */
export function collectSourceFiles(
  projectRoot: string,
  options: { predicate?: (relPath: string) => boolean } = {},
): string[] {
  const accept = options.predicate ?? isSourceFile;
  const found: string[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const absolute = join(dir, entry);
      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(absolute);
      } else if (stats.isFile()) {
        const relPath = toPosix(relative(projectRoot, absolute));
        if (accept(relPath)) found.push(relPath);
      }
    }
  };

  walk(projectRoot);
  return found.sort();
}

export function readSource(projectRoot: string, relPath: string): string {
  return readFileSync(join(projectRoot, relPath), "utf8");
}
