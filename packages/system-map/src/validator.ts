import type { SystemMapDocument, Diagnostic, RuntimeSemanticDocument } from "@vci/protocol";
import { checkSchema } from "./schema.js";
import { checkSystemMapGeometry } from "./geometry.js";
import { checkCitations } from "./citation.js";
import { checkSemanticMapping } from "./semantic-mapping.js";

export type ValidateContext = {
  projectPath: string;
  // When supplied, `checkSemanticMapping` runs too. Omitted, semantic mapping
  // is skipped silently -- this keeps `validateSystemMap` usable in
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
export function validateSystemMap(doc: unknown, ctx: ValidateContext): Diagnostic[] {
  const schemaDiagnostics = checkSchema(doc);
  if (schemaDiagnostics.length > 0) return schemaDiagnostics;

  const document = doc as SystemMapDocument;
  const diagnostics = [...checkSystemMapGeometry(document)];

  if (document.components.some((c) => (c.sources?.length ?? 0) > 0)) {
    diagnostics.push(...checkCitations(document, { projectPath: ctx.projectPath }));
  }

  if (ctx.semanticDocument) {
    diagnostics.push(...checkSemanticMapping(document, ctx.semanticDocument));
  }

  return diagnostics;
}
