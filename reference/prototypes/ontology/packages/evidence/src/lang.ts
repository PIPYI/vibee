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

/**
 * `isSourceFile`은 언어를 아는 것만 인정하는 **허용목록**이다 — 그 목록 밖 확장자(Rust·
 * Elixir·PHP·Kotlin 등)는 evidence가 전혀 안 생겨 gap으로도 안 잡히고 완전히 사라진다.
 * 이 상수는 반대 방향이다: "정말로 코드가 아닌 것"만 대는 **차단목록**이라, 새 언어가
 * 추가돼도 하드코딩 없이 자동으로 잡힌다.
 */
const NEVER_SOURCE_EXTENSIONS = new Set([
  // 이미지
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".avif", ".tiff", ".heic",
  // 폰트
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  // 미디어
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg", ".flac", ".m4a",
  // 압축/아카이브
  ".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".bz2",
  // 문서/바이너리 산출물
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".class", ".jar", ".exe", ".dll", ".so", ".dylib", ".wasm", ".pyc", ".o", ".a",
  // 생성물·잠금 파일·소스맵 — 언어를 이미 알아도 "우리가 만든 코드"가 아니다
  ".map", ".min.js", ".min.css",
  // 마크업/스타일/문서 — 프로그래밍 "언어"가 아니라 웹·문서 포맷이다. 특정 프레임워크가
  // 아니라 이 범주 전체(CSS/HTML/Markdown 계열)를 배제한다 — 어떤 프런트엔드 프로젝트든
  // 파일 수가 많아 임계치를 넘기고, "미지 프레임워크"가 아니라 이미 잘 알려진 정적 자산이다.
  ".css", ".scss", ".sass", ".less", ".html", ".htm", ".md", ".mdx", ".markdown", ".txt", ".rst",
]);
const NEVER_SOURCE_FILENAMES = new Set([
  ".ds_store", "thumbs.db",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json",
  "cargo.lock", "poetry.lock", "pipfile.lock", "gemfile.lock", "go.sum",
  "composer.lock", "mix.lock",
]);

/** `NEVER_SOURCE_EXTENSIONS`/`NEVER_SOURCE_FILENAMES`에 없으면 "코드일 수 있다"고 본다. */
export function isNeverSource(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (NEVER_SOURCE_FILENAMES.has(base)) return true;
  return [...NEVER_SOURCE_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

/**
 * `collectSourceFiles`와 반대로, 언어를 몰라도 "코드가 아니라고 확신할 수 없는" 파일은
 * 전부 담는다. `isSourceFile`의 닫힌 허용목록 밖에 있는 프레임워크/언어를 관측 가능하게
 * 만드는 지점이 여기다 — Core가 planDiscoveryGaps에서 이 집합과 `collectSourceFiles`의
 * 차이를 계산해 "언어를 인식하지 못한 파일"을 gap으로 드러낸다.
 */
export function collectAllRepositoryFiles(projectRoot: string): string[] {
  return collectSourceFiles(projectRoot, { predicate: (relPath) => !isNeverSource(relPath) });
}

export function readSource(projectRoot: string, relPath: string): string {
  return readFileSync(join(projectRoot, relPath), "utf8");
}
