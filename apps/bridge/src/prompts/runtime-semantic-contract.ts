// Semantic-extraction-stage instructions (docs/v2_plan.md §7, §12.1). This is
// the FIRST stage of the V2 pipeline: repository evidence -> a
// RuntimeSemanticDocument, with no coordinates and no audience-specific
// presentation at all. The second stage (canonical architecture composition,
// see architecture-composition-contract.ts) is deliberately a separate
// prompt section so the model never conflates "what exists" with "how to
// draw it".
export function runtimeSemanticContract(): string {
  return `## Stage 1: Extract the runtime architecture

A **runtime architecture** answers one question: when this system is actually running, who calls into it, what runtimes exist, what is each runtime responsible for, what state/external systems does it depend on, and what interacts with what? It is not a file/package/framework inventory.

Define each entity kind exactly like this:

- **actor** -- a person or external agent who initiates interaction with the system (a user, an admin, a CLI caller, an external webhook sender). Actors are never inside a runtime.
- **runtime** -- an actual executing unit or process/client environment (e.g. a mobile app process, a browser web app, a server process, a background worker, a desktop main/renderer process). Use \`kind\` to say which.
- **responsibility** -- something a runtime does, named for the job it performs, not the technology it's built with. Every responsibility belongs to exactly one runtime (\`runtimeId\`).
- **state** -- a store or piece of persisted/session state. It may belong to one runtime (\`runtimeId\`) or be shared/external (omit \`runtimeId\`).
- **external** -- a dependency outside this repository's own runtimes (a third-party API, an auth provider, a managed database/queue/storage service).
- **interaction** -- something that actually happens at runtime between two of the entities above (a request, a user action, an event, a state read/write, an auth check) -- not a static import or package dependency.

### Responsibility over technology name

Prefer naming a responsibility for what it does, not for the framework/library/vendor it's implemented with. "Order Processing" is a better \`label\` than "Express Router"; "Session State" is a better \`label\` than "Zustand Store". Preserve the technology fact anyway -- put it in that entity's \`implementationHints\` (each hint is \`{ label, kind }\`, e.g. \`{ "label": "Zustand", "kind": "library" }\`). Nothing about \`implementationHints\` is lost or summarized away; it is preserved verbatim in the semantic model precisely so later stages (technical presentation, detail inspectors) can recover it. A concrete technology can still be its own semantic entity when it is genuinely an independent runtime dependency (e.g. a managed queue), not just because it has a name.

### Evidence discipline

- Do not invent an actor, runtime, responsibility, state, external, or interaction you have not actually seen evidence for. No unfounded guesses -- if you are not sure something exists, leave it out rather than fabricate it.
- Every responsibility, state, external, and interaction needs at least one real \`sources[]\` citation (\`path\`, optionally \`line\`/\`endLine\`) pointing at code you actually read.
- Do not think about coordinates, layout, boxes, or geometry at this stage. This document has no \`pos\`/\`size\` fields at all -- that is a later, separate stage.
- Do not create separate or duplicate semantic entities to account for the simple vs. technical presentation split. There is exactly one semantic model; \`simple\`/\`technical\` differences are display-only and belong to a later stage, never to this one.`;
}
