import { existsSync, readFileSync } from "node:fs";
import type { SystemMapDocument, Diagnostic } from "@vci/protocol";

export type CitationContext = { projectPath: string };

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

/**
 * Exported so other document kinds with their own `sources[]` shape (e.g.
 * RuntimeSemanticDocument in runtime-semantic-validator.ts) can reuse the
 * same file-existence/line-range checking without duplicating it -- this
 * function has no SystemMapDocument-specific logic in it.
 */
export function checkWorkingTreeSource(
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

/**
 * Verifies every `sources[]` entry across all components actually points at
 * a real file (and, if `line`/`endLine` are given, a range within that
 * file's bounds). Only meaningful when at least one component has sources --
 * callers should skip invoking this otherwise (see `validateSystemMap`).
 *
 * Always checks the live working tree. This intentionally ignores any git
 * revision the document/context may carry: the AI exploring the repo always
 * reads the working tree via its Read/Grep/Glob tools (never `git show`), so
 * checking citations against a pinned historical revision would reject
 * citations to files the AI actually saw, whenever the tree has any
 * uncommitted/untracked changes relative to that revision -- a normal state,
 * not an edge case.
 */
export function checkCitations(doc: SystemMapDocument, ctx: CitationContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const component of doc.components) {
    for (const source of component.sources ?? []) {
      const problem = checkWorkingTreeSource(ctx.projectPath, source.path, source.line, source.endLine);
      if (problem) {
        diagnostics.push({
          code: "system-map/citation-invalid",
          severity: "error",
          message: `Component "${component.id}" cites an invalid source (${source.path}): ${problem}.`,
          subject: component.id,
          evidence: { source },
          supportedFixes: [`fix or remove the source citation for "${source.path}" on component "${component.id}"`],
        });
      }
    }
  }
  return diagnostics;
}
