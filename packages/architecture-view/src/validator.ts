import type { ArchitectureViewDocument, Diagnostic } from "@vibee/protocol";
import { checkSchema } from "./schema.js";
import { checkGeometry } from "./geometry.js";
import { checkCitations } from "./citation.js";

export type ValidateContext = { projectPath: string; gitRevision?: string };

/**
 * Full three-stage validation: schema -> geometry -> citation. Geometry and
 * citation checks assume a schema-valid document, so if the schema check
 * fails, its diagnostics are returned immediately without attempting the
 * later stages.
 */
export function validateArchitectureView(doc: unknown, ctx: ValidateContext): Diagnostic[] {
  const schemaDiagnostics = checkSchema(doc);
  if (schemaDiagnostics.length > 0) return schemaDiagnostics;

  const document = doc as ArchitectureViewDocument;
  const diagnostics = [...checkGeometry(document)];

  if (document.components.some((c) => (c.sources?.length ?? 0) > 0)) {
    const revision = document.repository?.revision ?? ctx.gitRevision;
    diagnostics.push(
      ...checkCitations(
        document,
        revision !== undefined ? { projectPath: ctx.projectPath, revision } : { projectPath: ctx.projectPath },
      ),
    );
  }

  return diagnostics;
}
