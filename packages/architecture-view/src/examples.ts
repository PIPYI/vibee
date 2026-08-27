import { readFileSync } from "node:fs";

// Weak micro-exemplars (docs/v2_plan.md §5.2/§13): each shows one narrow
// authoring rule (actor placement, label/sublabel role split, runtime
// boundaries, primary-path-vs-branch) at 2-4 components, not a full topology
// to copy. Wiring these into the authoring prompt is a bridge-layer concern
// (a later stage); this module only loads their raw text.
const ACTOR_OUTSIDE_RUNTIME_URL = new URL("../examples/runtime/actor-outside-runtime.json", import.meta.url);
const RESPONSIBILITY_OVER_TECHNOLOGY_URL = new URL(
  "../examples/runtime/responsibility-over-technology.json",
  import.meta.url,
);
const RUNTIME_BOUNDARY_URL = new URL("../examples/runtime/runtime-boundary.json", import.meta.url);
const PRIMARY_PATH_AND_BRANCH_URL = new URL("../examples/runtime/primary-path-and-branch.json", import.meta.url);

let cachedActorOutsideRuntimeText: string | undefined;
let cachedResponsibilityOverTechnologyText: string | undefined;
let cachedRuntimeBoundaryText: string | undefined;
let cachedPrimaryPathAndBranchText: string | undefined;

export function actorOutsideRuntimeExampleText(): string {
  if (cachedActorOutsideRuntimeText === undefined) {
    cachedActorOutsideRuntimeText = readFileSync(ACTOR_OUTSIDE_RUNTIME_URL, "utf8").trim();
  }
  return cachedActorOutsideRuntimeText;
}

export function responsibilityOverTechnologyExampleText(): string {
  if (cachedResponsibilityOverTechnologyText === undefined) {
    cachedResponsibilityOverTechnologyText = readFileSync(RESPONSIBILITY_OVER_TECHNOLOGY_URL, "utf8").trim();
  }
  return cachedResponsibilityOverTechnologyText;
}

export function runtimeBoundaryExampleText(): string {
  if (cachedRuntimeBoundaryText === undefined) {
    cachedRuntimeBoundaryText = readFileSync(RUNTIME_BOUNDARY_URL, "utf8").trim();
  }
  return cachedRuntimeBoundaryText;
}

export function primaryPathAndBranchExampleText(): string {
  if (cachedPrimaryPathAndBranchText === undefined) {
    cachedPrimaryPathAndBranchText = readFileSync(PRIMARY_PATH_AND_BRANCH_URL, "utf8").trim();
  }
  return cachedPrimaryPathAndBranchText;
}
