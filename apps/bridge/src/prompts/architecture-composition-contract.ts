import {
  actorOutsideRuntimeExampleText,
  primaryPathAndBranchExampleText,
  responsibilityOverTechnologyExampleText,
  runtimeBoundaryExampleText,
} from "@vci/system-map";

// Composition-stage instructions (docs/v2_plan.md §11, §12.2). This is the
// SECOND stage of the V2 pipeline: the already-committed RuntimeSemanticDocument
// is composed into exactly one canonical SystemMapDocument (with
// coordinates). This stage does not re-explore the repository or re-derive
// topology from scratch -- it lays out what Stage 1 already found.
export function architectureCompositionContract(): string {
  return `## Stage 2: Compose the canonical architecture

The semantic model you just committed is the **source of truth** for this stage. Do not re-derive topology from scratch or re-interpret the repository as if Stage 1 had not happened -- every component/boundary/connection you author here must trace back to an actor/runtime/responsibility/state/external/interaction from that semantic model via \`semanticRefs\`.

Author **exactly one canonical architecture document** (one graph, one layout, one set of \`pos\`/\`size\` coordinates). You are not authoring a "simple" layout and a "technical" layout -- there is only ever one canonical graph, with audience differences expressed purely through \`presentation\` overrides (see the audience-presentation rules below), never through a second graph.

Composition rules:

- Place real runtime boundaries (\`kind: "runtime"\`) first, one per semantic runtime, each with \`semanticRefs\` pointing at that runtime's id.
- Place actors outside every runtime boundary -- never inside a \`kind: "runtime"\` boundary's \`wraps\`.
- Make the most important interaction path clearly readable. If one global primary story doesn't fit naturally, it is fine to have a clear primary story per runtime instead.
- Put side branches near the responsibility they relate to.
- Remove low-value edges rather than including every static relationship, but every component kept on the canvas must retain at least one evidence-backed connection. Never fix a route/label collision by deleting an interaction if that leaves either endpoint disconnected; reposition components first, or remove an unsupported component together with its visual-only edges.
- Leave \`cards\` off by default (an empty or omitted array) unless a group of connections genuinely needs plain-language explanation for a non-technical reader.
- Every component, boundary, and connection you author must carry \`semanticRefs\` back into the semantic model -- an unreferenced or invented visual entity is not allowed.

### Examples show grammar, not topology

The examples below demonstrate individual authoring conventions (actor placement, label/sublabel role split, runtime boundary shape, primary-path-vs-branch) at 2-3 components each. **They are weak exemplars, not a topology template.** Do not reproduce their node counts, boundary counts, branch counts, rows, columns, or coordinates. Derive the actual graph exclusively from the semantic model you committed in Stage 1, which itself came only from repository evidence -- never from these examples.

Actor placed outside a runtime boundary:

\`\`\`json
${actorOutsideRuntimeExampleText()}
\`\`\`

Responsibility-first \`label\`, with implementation detail in \`sublabel\`:

\`\`\`json
${responsibilityOverTechnologyExampleText()}
\`\`\`

Two runtimes as separate boundaries, each with its own internal responsibilities:

\`\`\`json
${runtimeBoundaryExampleText()}
\`\`\`

A primary path (\`variant: "emphasis"\`) with a side branch off the primary responsibility:

\`\`\`json
${primaryPathAndBranchExampleText()}
\`\`\``;
}
