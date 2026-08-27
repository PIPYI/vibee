import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArchitectureViewDocument } from "@vibee/protocol";

export type ArchitectureViewMeta = {
  committedAt: string;
  gitRevision?: string;
  taskId: string;
};

function vibeeDir(projectPath: string): string {
  return path.join(projectPath, ".vibee");
}

function documentPath(projectPath: string): string {
  return path.join(vibeeDir(projectPath), "architecture-view.json");
}

function metaPath(projectPath: string): string {
  return path.join(vibeeDir(projectPath), "architecture-view.meta.json");
}

/**
 * Reads the previously committed architecture view for a project, if any.
 * Returns `null` when nothing has been committed yet -- this is the normal,
 * expected state for a fresh project and must never throw.
 */
export function readArchitectureView(
  projectPath: string,
): { document: ArchitectureViewDocument; meta: ArchitectureViewMeta } | null {
  const docPath = documentPath(projectPath);
  const mPath = metaPath(projectPath);
  if (!existsSync(docPath) || !existsSync(mPath)) return null;

  const document = JSON.parse(readFileSync(docPath, "utf8")) as ArchitectureViewDocument;
  const meta = JSON.parse(readFileSync(mPath, "utf8")) as ArchitectureViewMeta;
  return { document, meta };
}

/**
 * Commits a document as the project's architecture view, writing both
 * `architecture-view.json` and `architecture-view.meta.json` under
 * `<projectPath>/.vibee/` (created if needed).
 */
export function writeArchitectureView(
  projectPath: string,
  document: ArchitectureViewDocument,
  meta: { gitRevision?: string; taskId: string },
): void {
  const dir = vibeeDir(projectPath);
  mkdirSync(dir, { recursive: true });

  const fullMeta: ArchitectureViewMeta = {
    ...meta,
    committedAt: new Date().toISOString(),
  };

  writeFileSync(documentPath(projectPath), JSON.stringify(document, null, 2), "utf8");
  writeFileSync(metaPath(projectPath), JSON.stringify(fullMeta, null, 2), "utf8");
}
