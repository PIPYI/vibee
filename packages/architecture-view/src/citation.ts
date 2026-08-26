import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { ArchitectureViewDocument, Diagnostic } from "@vibee/protocol";

export type CitationContext = { projectPath: string; revision?: string };

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.length === 0 ? 1 : trimmed.split("\n").length;
}

function checkRangeInBounds(
  totalLines: number,
  line: number | undefined,
  endLine: number | undefined,
): string | undefined {
  if (line !== undefined && line > totalLines) {
    return `line ${line} is beyond the file's ${totalLines} lines`;
  }
  if (endLine !== undefined && endLine > totalLines) {
    return `endLine ${endLine} is beyond the file's ${totalLines} lines`;
  }
  if (line !== undefined && endLine !== undefined && endLine < line) {
    return `endLine ${endLine} is before line ${line}`;
  }
  return undefined;
}

function checkWorkingTreeSource(
  projectPath: string,
  path: string,
  line: number | undefined,
  endLine: number | undefined,
): string | undefined {
  const fullPath = `${projectPath.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  if (!existsSync(fullPath)) {
    return `file "${path}" does not exist under ${projectPath}`;
  }
  if (line === undefined && endLine === undefined) return undefined;
  let text: string;
  try {
    text = readFileSync(fullPath, "utf8");
  } catch (err) {
    return `file "${path}" could not be read: ${(err as Error).message}`;
  }
  return checkRangeInBounds(countLines(text), line, endLine);
}

function checkGitSource(
  projectPath: string,
  revision: string,
  path: string,
  line: number | undefined,
  endLine: number | undefined,
): string | undefined {
  const exists = spawnSync("git", ["-C", projectPath, "cat-file", "-e", `${revision}:${path}`], {
    encoding: "utf8",
  });
  if (exists.status !== 0) {
    return `file "${path}" does not exist at revision ${revision}`;
  }
  if (line === undefined && endLine === undefined) return undefined;
  const show = spawnSync("git", ["-C", projectPath, "show", `${revision}:${path}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
  if (show.status !== 0) {
    return `file "${path}" could not be read at revision ${revision}: ${show.stderr}`;
  }
  return checkRangeInBounds(countLines(show.stdout), line, endLine);
}

/**
 * Verifies every `sources[]` entry across all components actually points at
 * a real file (and, if `line`/`endLine` are given, a range within that
 * file's bounds). Only meaningful when at least one component has sources --
 * callers should skip invoking this otherwise (see `validateArchitectureView`).
 *
 * When `ctx.revision` is set, verification is done against that git revision
 * via `git cat-file`/`git show` (works even if the working tree has since
 * changed). Otherwise it falls back to reading the working-tree file
 * directly.
 */
export function checkCitations(doc: ArchitectureViewDocument, ctx: CitationContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const component of doc.components) {
    for (const source of component.sources ?? []) {
      const problem = ctx.revision
        ? checkGitSource(ctx.projectPath, ctx.revision, source.path, source.line, source.endLine)
        : checkWorkingTreeSource(ctx.projectPath, source.path, source.line, source.endLine);
      if (problem) {
        diagnostics.push({
          code: "architecture-view/citation-invalid",
          severity: "error",
          message: `Component "${component.id}" cites an invalid source (${source.path}): ${problem}.`,
          subject: component.id,
          evidence: { source, revision: ctx.revision },
          supportedFixes: [`fix or remove the source citation for "${source.path}" on component "${component.id}"`],
        });
      }
    }
  }
  return diagnostics;
}
