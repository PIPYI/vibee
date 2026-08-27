import type { SystemMapDocument, Diagnostic, RuntimeSemanticDocument } from "@vci/protocol";
import { checkSchema } from "./schema.js";
import { checkGeometry } from "./geometry.js";
import { checkCitations } from "./citation.js";
import { checkSemanticMapping } from "./semantic-mapping.js";
import { applyAudiencePresentation, resolveVisibility } from "./presentation.js";

export type ValidateContext = {
  projectPath: string;
  // When supplied, `checkSemanticMapping` runs too. Omitted, semantic mapping
  // is skipped silently -- this keeps `validateSystemMap` usable in
  // isolation (V1-style tests, or any caller that hasn't wired a semantic
  // revision through yet).
  semanticDocument?: RuntimeSemanticDocument;
  simpleAudienceLanguage?: "ko";
};

const HANGUL = /[가-힣]/u;

function checkKoreanSimplePresentation(document: SystemMapDocument): Diagnostic[] {
  const projected = applyAudiencePresentation(document, "simple");
  const diagnostics: Diagnostic[] = [];
  const check = (text: string | undefined, subject: string) => {
    if (!text || HANGUL.test(text)) return;
    diagnostics.push({
      code: "system-map/simple-text-not-korean",
      severity: "error",
      message: `Simple-view text "${text}" must be written in Korean.`,
      subject,
      evidence: { text },
      supportedFixes: ["add Korean wording or a presentation.simple override; keep proper names only inside a Korean phrase"],
    });
  };

  check(projected.title, "title");
  for (const component of projected.components) {
    if (resolveVisibility(component, "simple") === "hide") continue;
    check(component.label, component.id);
    check(component.sublabel, component.id);
  }
  for (const [index, boundary] of projected.boundaries.entries()) {
    if (resolveVisibility(boundary, "simple") !== "hide") check(boundary.label, boundary.id ?? `boundary-${index}`);
  }
  for (const [index, connection] of projected.connections.entries()) {
    if (resolveVisibility(connection, "simple") !== "hide") check(connection.label, connection.id ?? `connection-${index}`);
  }
  for (const [index, card] of (projected.cards ?? []).entries()) {
    check(card.title, `card-${index}`);
    card.items.forEach((item, itemIndex) => check(item, `card-${index}-item-${itemIndex}`));
  }
  return diagnostics;
}

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
  const diagnostics = [...checkGeometry(document)];

  if (ctx.simpleAudienceLanguage === "ko") {
    diagnostics.push(...checkKoreanSimplePresentation(document));
  }

  if (document.components.some((c) => (c.sources?.length ?? 0) > 0)) {
    diagnostics.push(...checkCitations(document, { projectPath: ctx.projectPath }));
  }

  if (ctx.semanticDocument) {
    diagnostics.push(...checkSemanticMapping(document, ctx.semanticDocument));
  }

  return diagnostics;
}
