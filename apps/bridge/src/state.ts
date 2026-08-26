// In-memory (no persistence needed for MVP) task/attempt/semantic-revision
// tracking.
//
// This module assumes the bridge is single-task at a time (see
// hasActiveTask/setActiveTask below): the MVP never runs two architecture
// analyses concurrently, so an attempt counter keyed only by taskId (and a
// single "active task" slot, not a set) is sufficient and simpler than a
// general-purpose registry.

import type { RuntimeSemanticDocument } from "@vibee/protocol";

export const MAX_ARCHITECTURE_VIEW_ATTEMPTS = 6;

const attemptCounters = new Map<string, number>();

export function startAttemptCounter(taskId: string): void {
  attemptCounters.set(taskId, 0);
}

/**
 * Increments the attempt counter for `taskId` and reports whether it is now
 * over the limit. Threshold semantics: calls 1 through MAX_ARCHITECTURE_VIEW_ATTEMPTS
 * (6) report `overLimit: false`; the 7th and every call after that report
 * `overLimit: true`. In other words the cap allows exactly
 * MAX_ARCHITECTURE_VIEW_ATTEMPTS combined validate/submit round-trips before
 * the bridge starts refusing to do the real work and instead hands back a
 * synthetic "stop and report" diagnostic.
 */
export function recordAttempt(taskId: string): { count: number; overLimit: boolean } {
  const count = (attemptCounters.get(taskId) ?? 0) + 1;
  attemptCounters.set(taskId, count);
  return { count, overLimit: count > MAX_ARCHITECTURE_VIEW_ATTEMPTS };
}

export function clearAttemptCounter(taskId: string): void {
  attemptCounters.delete(taskId);
}

// ---------------------------------------------------------------------------
// submit_runtime_semantics attempt cap
// ---------------------------------------------------------------------------

// Separate, smaller cap than MAX_ARCHITECTURE_VIEW_ATTEMPTS: the semantic
// model is a simpler authoring surface (no geometry, no citations against
// rendered layout, no cross-document mapping to get wrong) than the
// validate/submit-architecture-view round-trip, so it should need fewer
// correction rounds to converge. This project's established lesson (see
// MAX_ARCHITECTURE_VIEW_ATTEMPTS above) is that prompt discipline alone
// isn't enough for a live agent turn -- a real server-side cap is required
// here too, independently of the architecture-view cap.
export const MAX_RUNTIME_SEMANTIC_ATTEMPTS = 4;

const semanticAttemptCounters = new Map<string, number>();

export function startSemanticAttemptCounter(taskId: string): void {
  semanticAttemptCounters.set(taskId, 0);
}

/** Same threshold semantics as `recordAttempt`, against MAX_RUNTIME_SEMANTIC_ATTEMPTS. */
export function recordSemanticAttempt(taskId: string): { count: number; overLimit: boolean } {
  const count = (semanticAttemptCounters.get(taskId) ?? 0) + 1;
  semanticAttemptCounters.set(taskId, count);
  return { count, overLimit: count > MAX_RUNTIME_SEMANTIC_ATTEMPTS };
}

export function clearSemanticAttemptCounter(taskId: string): void {
  semanticAttemptCounters.delete(taskId);
}

// ---------------------------------------------------------------------------
// Semantic revisions
// ---------------------------------------------------------------------------

// A successfully-validated RuntimeSemanticDocument is committed as an
// immutable, sequentially-numbered revision (starting at 1) scoped to the
// taskId that produced it -- never mutated in place, and never resumed
// across tasks (matching this project's "every analysis starts a fresh
// session" principle, see docs/v2_plan.md §9.1/§17.1). Composition-stage
// documents (validate_architecture_view/submit_architecture_view) reference
// a revision by number so the bridge can trace a canonical architecture back
// to the exact semantic model it was composed from.
type SemanticRevisionEntry = { revision: number; document: RuntimeSemanticDocument };

const semanticRevisions = new Map<string, SemanticRevisionEntry[]>();

/** Appends a new immutable revision for `taskId`, numbered sequentially starting at 1. */
export function commitSemanticRevision(taskId: string, document: RuntimeSemanticDocument): SemanticRevisionEntry {
  const revisions = semanticRevisions.get(taskId) ?? [];
  const entry: SemanticRevisionEntry = { revision: revisions.length + 1, document };
  revisions.push(entry);
  semanticRevisions.set(taskId, revisions);
  return entry;
}

export function getSemanticRevision(taskId: string, revision: number): RuntimeSemanticDocument | undefined {
  return semanticRevisions.get(taskId)?.find((entry) => entry.revision === revision)?.document;
}

export function getLatestSemanticRevision(taskId: string): SemanticRevisionEntry | undefined {
  const revisions = semanticRevisions.get(taskId);
  return revisions && revisions.length > 0 ? revisions[revisions.length - 1] : undefined;
}

export function clearSemanticRevisions(taskId: string): void {
  semanticRevisions.delete(taskId);
}

// ---------------------------------------------------------------------------
// Single-flight active-task registry
// ---------------------------------------------------------------------------

let activeTask: { taskId: string; projectPath: string } | undefined;

export function hasActiveTask(): boolean {
  return activeTask !== undefined;
}

export function setActiveTask(taskId: string, projectPath: string): void {
  activeTask = { taskId, projectPath };
}

export function clearActiveTask(): void {
  activeTask = undefined;
}

export function getActiveTask(): { taskId: string; projectPath: string } | undefined {
  return activeTask;
}
