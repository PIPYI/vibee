// In-memory (no persistence needed for MVP) task/attempt tracking.
//
// This module assumes the bridge is single-task at a time (see
// hasActiveTask/setActiveTask below): the MVP never runs two architecture
// analyses concurrently, so an attempt counter keyed only by taskId (and a
// single "active task" slot, not a set) is sufficient and simpler than a
// general-purpose registry.

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
