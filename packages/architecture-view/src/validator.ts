import type { ArchitectureViewDocument, Diagnostic, RuntimeSemanticDocument } from "@vibee/protocol";
import { checkSchema } from "./schema.js";
import { checkGeometry } from "./geometry.js";
import { checkCitations } from "./citation.js";
import { checkSemanticMapping } from "./semantic-mapping.js";

export type ValidateContext = {
  projectPath: string;
  // When supplied, `checkSemanticMapping` runs too. Omitted, semantic mapping
  // is skipped silently -- this keeps `validateArchitectureView` usable in
  // isolation (V1-style tests, or any caller that hasn't wired a semantic
  // revision through yet).
  semanticDocument?: RuntimeSemanticDocument;
};

/**
 * Full validation: schema -> geometry -> citation, plus semantic mapping
 * when a semantic document is supplied. Geometry, citation, and semantic
 * mapping checks assume a schema-valid document, so if the schema check
 * fails, its diagnostics are returned immediately without attempting the
 * later stages.
 */
export function validateArchitectureView(doc: unknown, ctx: ValidateContext): Diagnostic[] {
  const schemaDiagnostics = checkSchema(doc);
  if (schemaDiagnostics.length > 0) return schemaDiagnostics;

  const document = doc as ArchitectureViewDocument;
  const diagnostics = [...checkGeometry(document)];

  if (document.components.some((c) => (c.sources?.length ?? 0) > 0)) {
    diagnostics.push(...checkCitations(document, { projectPath: ctx.projectPath }));
  }

  if (ctx.semanticDocument) {
    diagnostics.push(...checkSemanticMapping(document, ctx.semanticDocument));
  }

  return diagnostics;
}
