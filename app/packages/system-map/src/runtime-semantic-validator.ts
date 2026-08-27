import type { Diagnostic, RuntimeSemanticDocument, SourceRef } from "@vci/protocol";
import { checkRuntimeSemanticSchema } from "./schema.js";
import { checkWorkingTreeSource } from "./citation.js";

export type RuntimeSemanticValidateContext = { projectPath: string };

type SourcedEntity = { id: string; sources: SourceRef[] | undefined };

function allEntityIds(doc: RuntimeSemanticDocument): Set<string> {
  const ids = new Set<string>();
  for (const a of doc.actors) ids.add(a.id);
  for (const r of doc.runtimes) ids.add(r.id);
  for (const r of doc.responsibilities) ids.add(r.id);
  for (const s of doc.states) ids.add(s.id);
  for (const e of doc.externals) ids.add(e.id);
  return ids;
}

/**
 * Referential integrity, runtime containment, and semantic warning checks
 * beyond what JSON Schema can express (cross-references between the
 * document's own arrays, and "is this graph well-formed" style warnings).
 * Exported on its own (in addition to being chained by
 * `validateRuntimeSemantics`) so each rule can be unit-tested directly
 * against a hand-built document, independent of the schema stage.
 */
export function checkRuntimeSemanticReferences(doc: RuntimeSemanticDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const idOwners = new Map<string, number>();
  for (const id of [
    ...doc.actors.map((a) => a.id),
    ...doc.runtimes.map((r) => r.id),
    ...doc.responsibilities.map((r) => r.id),
    ...doc.states.map((s) => s.id),
    ...doc.externals.map((e) => e.id),
  ]) {
    idOwners.set(id, (idOwners.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idOwners) {
    if (count > 1) {
      diagnostics.push({
        code: "DUPLICATE_ID",
        severity: "error",
        message: `Id "${id}" is used by ${count} entities; every actor/runtime/responsibility/state/external must have a unique id.`,
        subject: id,
        supportedFixes: [`rename all but one entity using id "${id}"`],
      });
    }
  }

  const runtimeIds = new Set(doc.runtimes.map((r) => r.id));

  for (const resp of doc.responsibilities) {
    if (!runtimeIds.has(resp.runtimeId)) {
      diagnostics.push({
        code: "RESPONSIBILITY_WITHOUT_RUNTIME",
        severity: "error",
        message: `Responsibility "${resp.id}" references runtimeId "${resp.runtimeId}", which is not a known runtime.`,
        subject: resp.id,
        evidence: { runtimeId: resp.runtimeId },
        supportedFixes: [`set "${resp.id}".runtimeId to an existing runtime id, or add the missing runtime`],
      });
    }
  }

  for (const state of doc.states) {
    if (state.runtimeId !== undefined && !runtimeIds.has(state.runtimeId)) {
      diagnostics.push({
        code: "UNKNOWN_RUNTIME_REF",
        severity: "error",
        message: `State "${state.id}" references runtimeId "${state.runtimeId}", which is not a known runtime.`,
        subject: state.id,
        evidence: { runtimeId: state.runtimeId },
        supportedFixes: [`set "${state.id}".runtimeId to an existing runtime id, or remove it if the state is shared/external`],
      });
    }
  }

  const entityIds = allEntityIds(doc);
  for (const interaction of doc.interactions) {
    if (!entityIds.has(interaction.from)) {
      diagnostics.push({
        code: "UNKNOWN_INTERACTION_ENDPOINT",
        severity: "error",
        message: `Interaction "${interaction.id}" references unknown "from" endpoint "${interaction.from}".`,
        subject: interaction.id,
        evidence: { from: interaction.from },
        supportedFixes: [`fix "${interaction.id}".from to reference an existing actor/runtime/responsibility/state/external id`],
      });
    }
    if (!entityIds.has(interaction.to)) {
      diagnostics.push({
        code: "UNKNOWN_INTERACTION_ENDPOINT",
        severity: "error",
        message: `Interaction "${interaction.id}" references unknown "to" endpoint "${interaction.to}".`,
        subject: interaction.id,
        evidence: { to: interaction.to },
        supportedFixes: [`fix "${interaction.id}".to to reference an existing actor/runtime/responsibility/state/external id`],
      });
    }
    if (interaction.label.trim().length === 0) {
      diagnostics.push({
        code: "EMPTY_INTERACTION_LABEL",
        severity: "error",
        message: `Interaction "${interaction.id}" has an empty label.`,
        subject: interaction.id,
        supportedFixes: [`give "${interaction.id}" a short label describing the runtime interaction, e.g. "login request"`],
      });
    }
  }

  const primarySourced: SourcedEntity[] = [
    ...doc.responsibilities.map((r) => ({ id: r.id, sources: r.sources })),
    ...doc.states.map((s) => ({ id: s.id, sources: s.sources })),
    ...doc.externals.map((e) => ({ id: e.id, sources: e.sources })),
  ];
  for (const entity of primarySourced) {
    if (!entity.sources || entity.sources.length === 0) {
      diagnostics.push({
        code: "MISSING_PRIMARY_SOURCE",
        severity: "error",
        message: `"${entity.id}" has no source citations; every responsibility/state/external needs at least one.`,
        subject: entity.id,
        supportedFixes: [`add a sources[] entry pointing at the code that justifies "${entity.id}"`],
      });
    }
  }

  for (const runtime of doc.runtimes) {
    const hasResponsibility = doc.responsibilities.some((r) => r.runtimeId === runtime.id);
    const hasState = doc.states.some((s) => s.runtimeId === runtime.id);
    if (!hasResponsibility && !hasState) {
      diagnostics.push({
        code: "ORPHAN_RUNTIME",
        severity: "warning",
        message: `Runtime "${runtime.id}" has no responsibilities or states in it.`,
        subject: runtime.id,
        supportedFixes: [`add at least one responsibility/state with runtimeId "${runtime.id}", or remove the runtime`],
      });
    }
  }

  const touchedByInteraction = new Set<string>();
  for (const interaction of doc.interactions) {
    touchedByInteraction.add(interaction.from);
    touchedByInteraction.add(interaction.to);
  }
  for (const resp of doc.responsibilities) {
    if (!touchedByInteraction.has(resp.id)) {
      diagnostics.push({
        code: "UNCONNECTED_PRIMARY_ENTITY",
        severity: "warning",
        message: `Responsibility "${resp.id}" has no interactions touching it.`,
        subject: resp.id,
        supportedFixes: [`add an interaction to/from "${resp.id}", or remove it if it isn't actually exercised`],
      });
    }
  }

  return diagnostics;
}

/**
 * Verifies every `sources[]` entry across actors/runtimes/responsibilities/
 * states/externals/interactions points at a real file (and, if `line`/
 * `endLine` are given, a range within that file's bounds). Mirrors
 * `checkCitations` in citation.ts but over RuntimeSemanticDocument's
 * differently-shaped entity list.
 *
 * Always checks the live working tree -- see the comment on `checkCitations`
 * in citation.ts for why a pinned git revision is never used here.
 */
export function checkRuntimeSemanticCitations(
  doc: RuntimeSemanticDocument,
  ctx: { projectPath: string },
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const entities: SourcedEntity[] = [
    ...doc.actors.map((a) => ({ id: a.id, sources: a.sources })),
    ...doc.runtimes.map((r) => ({ id: r.id, sources: r.sources })),
    ...doc.responsibilities.map((r) => ({ id: r.id, sources: r.sources })),
    ...doc.states.map((s) => ({ id: s.id, sources: s.sources })),
    ...doc.externals.map((e) => ({ id: e.id, sources: e.sources })),
    ...doc.interactions.map((i) => ({ id: i.id, sources: i.sources })),
  ];
  for (const entity of entities) {
    for (const source of entity.sources ?? []) {
      const problem = checkWorkingTreeSource(ctx.projectPath, source.path, source.line, source.endLine);
      if (problem) {
        diagnostics.push({
          code: "runtime-semantic/citation-invalid",
          severity: "error",
          message: `"${entity.id}" cites an invalid source (${source.path}): ${problem}.`,
          subject: entity.id,
          evidence: { source },
          supportedFixes: [`fix or remove the source citation for "${source.path}" on "${entity.id}"`],
        });
      }
    }
  }
  return diagnostics;
}

/**
 * Full validation chain: schema -> referential/containment integrity ->
 * citation. Mirrors `validateSystemMap`'s short-circuit-on-schema-
 * failure shape.
 */
export function validateRuntimeSemantics(doc: unknown, ctx: RuntimeSemanticValidateContext): Diagnostic[] {
  const schemaDiagnostics = checkRuntimeSemanticSchema(doc);
  if (schemaDiagnostics.length > 0) return schemaDiagnostics;

  const document = doc as RuntimeSemanticDocument;
  const diagnostics = [...checkRuntimeSemanticReferences(document)];
  diagnostics.push(...checkRuntimeSemanticCitations(document, { projectPath: ctx.projectPath }));

  return diagnostics;
}
