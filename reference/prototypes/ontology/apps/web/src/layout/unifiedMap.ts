import type { ArchitectureComponent, ScenarioIR, ScenarioStep } from "@onto/protocol";

function intersects(left: Iterable<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

export function componentReferenceSet(component: ArchitectureComponent): Set<string> {
  return new Set([
    ...component.evidenceRefs,
    ...component.entityRefs,
    ...(component.conceptRefs ?? []),
  ]);
}

export function stepReferenceSet(step: ScenarioStep): Set<string> {
  return new Set([...step.evidenceRefs, ...step.conceptRefs]);
}

export function journeyReferenceSet(journey: ScenarioIR): Set<string> {
  return new Set([
    ...(journey.evidenceRefs ?? []),
    ...journey.steps.flatMap((step) => [...step.evidenceRefs, ...step.conceptRefs]),
    ...journey.transitions.flatMap((transition) => transition.evidenceRefs),
  ]);
}

export function relatedComponentIds(
  components: ArchitectureComponent[],
  refs: ReadonlySet<string>,
): Set<string> {
  if (refs.size === 0) return new Set();
  return new Set(
    components
      .filter((component) => intersects(componentReferenceSet(component), refs))
      .map((component) => component.id),
  );
}

export function referencesIntersect(refs: Iterable<string>, focusRefs: ReadonlySet<string>): boolean {
  return focusRefs.size > 0 && intersects(refs, focusRefs);
}
