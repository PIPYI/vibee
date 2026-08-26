/**
 * 아키텍처·기술부채 구조 점검의 결정론적 입력과 파생 문서.
 *
 * 판단은 agent가 하지만, 저장소 전체를 무작정 문맥에 싣지는 않는다. 코드는 파일 크기,
 * 함수/메서드 시그니처, 임시 조치와 git 나이를 정확히 모으고 agent는 세 목록에서 의미를
 * 판단한다 (`docs/product_flow_decisions.md` 질문 5).
 */
import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { promisify } from "node:util";

import type {
  ArchitectureContext,
  ArchitectureDebtFinding,
  ArchitectureDebtReport,
  ArchitectureDesignRef,
  ArchitectureSignature,
  ArchitectureTemporaryMarker,
  DesignDoc,
} from "@vci/protocol";

import { cliSpawnOptions } from "./platform.js";

const run = promisify(execFile);

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".cjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".svelte",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".project-intel",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

const MAX_SCANNED_FILES = 2_000;
const MAX_FILE_SIGNALS = 300;
/**
 * 개수 상한(1,000개)만으로는 큰 저장소에서 시그니처 목록 자체가 부풀 수 있다 — 항목당
 * 최대 240자라 최악의 경우 240,000자에 달한다. Wiki의 전체 대화 캡(40,000자, wiki.ts의
 * MAX_TRANSCRIPT_CHARS)과 같은 규모로 맞춘다 (`docs/product_flow_decisions.md` 질문 5
 * "토큰 비용은 항상 줄이는 방향으로").
 */
const MAX_SIGNATURES = 1_000;
const MAX_SIGNATURE_CHARS = 40_000;
const MAX_TEMPORARY_MARKERS = 100;
const MAX_READ_BYTES = 2 * 1024 * 1024;

type SourceFile = {
  path: string;
  bytes: number;
  lines: number;
  content: string;
  matchedDesignIds: string[];
};

/** 프로젝트 전체에서 분석 가능한 source path를 안정적인 순서로 모은다. */
async function sourcePaths(projectPath: string): Promise<{ paths: string[]; skipped: number }> {
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(absolute);
        continue;
      }
      if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        paths.push(relative(projectPath, absolute));
      }
    }
  }

  await visit(projectPath);
  return {
    paths: paths.slice(0, MAX_SCANNED_FILES),
    skipped: Math.max(0, paths.length - MAX_SCANNED_FILES),
  };
}

function designRefsFrom(design: DesignDoc | null): ArchitectureDesignRef[] {
  if (!design) return [];
  return [
    ...design.reqs.map((item) => ({ id: item.id, name: item.name, kind: "REQ" as const })),
    ...design.entities.map((item) => ({ id: item.id, name: item.name, kind: "ENTITY" as const })),
  ];
}

function matchedDesignIds(path: string, content: string, refs: ArchitectureDesignRef[]): string[] {
  const haystack = `${path}\n${content}`.toLocaleLowerCase();
  return refs
    .filter((ref) => ref.name.trim().length >= 2 && haystack.includes(ref.name.trim().toLocaleLowerCase()))
    .map((ref) => ref.id);
}

function lineCount(content: string): number {
  if (!content) return 0;
  const count = content.split(/\r?\n/).length;
  return /\r?\n$/.test(content) ? count - 1 : count;
}

const FUNCTION_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[\w$]+\s*\([^)]*\)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/,
  /^\s*(?:async\s+)?def\s+[\w_]+\s*\([^)]*\)/,
  /^\s*func\s+(?:\([^)]*\)\s*)?[\w_]+\s*\([^)]*\)/,
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+[\w_]+\s*\([^)]*\)/,
  /^\s*(?:(?:public|private|protected|static|final|abstract|override|open|internal)\s+)*(?:[\w$<>,.?\[\]]+\s+)+[\w$]+\s*\([^;]*\)\s*(?:\{|=>)/,
  /^\s*(?:async\s+)?(?:get\s+|set\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
];

const CONTROL_PREFIX = /^\s*(?:if|for|while|switch|catch|with)\s*\(/;

function extractSignatures(file: SourceFile): ArchitectureSignature[] {
  const signatures: ArchitectureSignature[] = [];
  const lines = file.content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (CONTROL_PREFIX.test(line) || !FUNCTION_PATTERNS.some((pattern) => pattern.test(line))) continue;
    signatures.push({
      path: file.path,
      line: index + 1,
      signature: line.trim().replace(/\s+/g, " ").slice(0, 240),
    });
  }
  return signatures;
}

const TEMPORARY_PATTERN = /\b(?:TODO|FIXME|HACK|XXX)\b|임시로|임시\s*처리|나중에\s*정리/iu;

function temporaryCandidates(file: SourceFile): Array<Omit<ArchitectureTemporaryMarker, "commit" | "committedAt" | "commitsSince">> {
  const markers: Array<Omit<ArchitectureTemporaryMarker, "commit" | "committedAt" | "commitsSince">> = [];
  const lines = file.content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!TEMPORARY_PATTERN.test(line)) continue;
    markers.push({ path: file.path, line: index + 1, text: line.trim().slice(0, 300) });
  }
  return markers;
}

async function gitOutput(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd: projectPath,
    maxBuffer: 4 * 1024 * 1024,
    ...cliSpawnOptions,
  });
  return stdout.trim();
}

async function currentCommit(projectPath: string): Promise<string | null> {
  try {
    return await gitOutput(projectPath, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

async function enrichMarker(
  projectPath: string,
  marker: Omit<ArchitectureTemporaryMarker, "commit" | "committedAt" | "commitsSince">,
): Promise<ArchitectureTemporaryMarker> {
  try {
    const blame = await gitOutput(projectPath, [
      "blame",
      "--line-porcelain",
      "-L",
      `${marker.line},${marker.line}`,
      "--",
      marker.path,
    ]);
    const first = blame.split("\n")[0]?.split(" ")[0] ?? "";
    const timestamp = blame.match(/^author-time (\d+)$/m)?.[1];
    if (!first || /^0+$/.test(first)) return { ...marker, commit: null, committedAt: null, commitsSince: null };
    let commitsSince: number | null = null;
    try {
      commitsSince = Number(await gitOutput(projectPath, ["rev-list", "--count", `${first}..HEAD`]));
    } catch {
      commitsSince = null;
    }
    return {
      ...marker,
      commit: first,
      committedAt: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null,
      commitsSince,
    };
  } catch {
    return { ...marker, commit: null, committedAt: null, commitsSince: null };
  }
}

/**
 * 개수 상한을 통과해도 시그니처 텍스트 총량이 문자 예산을 넘으면 거기서 자른다.
 * 파일 순서(경로순)를 그대로 따르므로 어떤 파일이 잘렸는지는 `truncated.signatures`로
 * 알 수 있을 뿐 어느 파일이 우선인지 편향을 주지 않는다.
 */
function withinCharBudget(items: ArchitectureSignature[], maxChars: number): { kept: ArchitectureSignature[]; truncated: number } {
  const kept: ArchitectureSignature[] = [];
  let used = 0;
  for (const item of items) {
    used += item.signature.length;
    if (used > maxChars) break;
    kept.push(item);
  }
  return { kept, truncated: items.length - kept.length };
}

/** 세 검출 대상에 필요한 목록만 만든다. 여기서는 기술부채를 판단하지 않는다. */
export async function collectArchitectureContext(
  projectPath: string,
  design: DesignDoc | null,
): Promise<ArchitectureContext> {
  const refs = designRefsFrom(design);
  const found = await sourcePaths(projectPath);
  const files: SourceFile[] = [];
  for (const path of found.paths) {
    const absolute = join(projectPath, path);
    const info = await stat(absolute);
    const content = info.size <= MAX_READ_BYTES ? await readFile(absolute, "utf8") : "";
    files.push({
      path,
      bytes: info.size,
      lines: content ? lineCount(content) : 0,
      content,
      matchedDesignIds: content ? matchedDesignIds(path, content, refs) : [],
    });
  }

  const sortedFiles = [...files].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  const allSignatures = files.flatMap(extractSignatures);
  const countCapped = allSignatures.slice(0, MAX_SIGNATURES);
  const { kept: signatures, truncated: budgetTruncated } = withinCharBudget(countCapped, MAX_SIGNATURE_CHARS);
  const allMarkers = files.flatMap(temporaryCandidates);
  const selectedMarkers = allMarkers.slice(0, MAX_TEMPORARY_MARKERS);
  const markers: ArchitectureTemporaryMarker[] = [];
  for (const marker of selectedMarkers) markers.push(await enrichMarker(projectPath, marker));

  return {
    designRefs: refs,
    files: sortedFiles.slice(0, MAX_FILE_SIGNALS).map(({ path, bytes, lines, content, matchedDesignIds }) => ({
      path,
      bytes,
      lines,
      contentScanned: bytes === 0 || content.length > 0,
      matchedDesignIds,
    })),
    signatures,
    temporaryMarkers: markers,
    scannedFiles: files.length,
    currentCommit: await currentCommit(projectPath),
    truncated: {
      files: Math.max(0, sortedFiles.length - MAX_FILE_SIGNALS) + found.skipped,
      signatures: Math.max(0, allSignatures.length - MAX_SIGNATURES) + budgetTruncated,
      temporaryMarkers: Math.max(0, allMarkers.length - MAX_TEMPORARY_MARKERS),
    },
  };
}

/** finding마다 옆 코딩 agent에 넘길 리팩터링 프롬프트를 코드로 만든다. */
export function renderArchitectureResolutionPrompt(finding: ArchitectureDebtFinding): string {
  const files = finding.files.join(", ");
  return [
    "이 프로젝트의 구조 점검에서 다음 기술부채 후보가 확인됐습니다.",
    "",
    `${finding.title} (${finding.category}, ${finding.severity})`,
    finding.explanation,
    `영향: ${finding.impact}`,
    `근거: ${finding.evidence.join(" / ")}`,
    `파일: ${files}`,
    "",
    "위 근거가 현재 코드에도 맞는지 먼저 확인한 뒤, 맞다면 사용자 동작을 바꾸지 않는 범위에서",
    `다음 조치를 수행하세요: ${finding.suggestion}`,
    "관련 테스트를 실행하고, 변경한 파일과 검증 결과를 설명하세요. 근거가 맞지 않으면 억지로",
    "리팩터링하지 말고 어떤 근거가 달라졌는지 알려 주세요.",
  ].join("\n");
}

/** JSON 원본 옆에 두는 사람이 읽는 파생 문서. */
export function renderArchitectureMarkdown(report: ArchitectureDebtReport): string {
  const out = [
    "# 아키텍처·기술부채",
    "",
    report.summary,
    "",
    `- 분석 시각: ${report.generatedAt ?? "알 수 없음"}`,
    `- Git snapshot: ${report.commit ?? "커밋 없음"}`,
    "",
    "## 확인된 항목",
    "",
  ];
  if (report.findings.length === 0) out.push("근거가 있는 항목을 찾지 못했습니다.", "");
  for (const finding of report.findings) {
    out.push(
      `### ${finding.title}`,
      "",
      `- 유형: ${finding.category}`,
      `- 심각도: ${finding.severity}`,
      `- 파일: ${finding.files.map((file) => `\`${file}\``).join(", ")}`,
    );
    if (finding.designIds.length > 0) out.push(`- 설계 단위: ${finding.designIds.join(", ")}`);
    out.push("", finding.explanation, "", `**영향:** ${finding.impact}`, "", "**근거**", "");
    for (const evidence of finding.evidence) out.push(`- ${evidence}`);
    out.push("", "**해소 프롬프트**", "", "```text", finding.resolutionPrompt ?? finding.suggestion, "```", "");
  }
  if (report.limitations.length > 0) {
    out.push("## 분석 한계", "");
    for (const limitation of report.limitations) out.push(`- ${limitation}`);
    out.push("");
  }
  out.push("---", "", `<!-- vci:generated ${report.generatedAt ?? ""} -->`);
  return out.join("\n");
}
