// Small inline micro-examples for the semantic-extraction stage
// (docs/v2_plan.md §5.2/§12.1). These show authoring CONVENTIONS for
// RuntimeSemanticDocument entities only (field shape, label vs.
// implementationHints split, interaction kind) -- they are not the
// composition-stage SystemMapDocument exemplars from
// @vci/system-map (see architecture-composition-contract.ts), which
// are a different stage entirely.
export function runtimeSemanticExamples(): string {
  return `## Semantic model micro-examples

These tiny snippets demonstrate vocabulary and field shape only -- they are **not a topology to copy**. They are not even fragments of a real system; do not reuse their ids, labels, or entity counts. The real actors/runtimes/responsibilities/states/externals/interactions must come only from repository evidence you actually gathered in this project.

An actor has no \`runtimeId\` -- it exists outside every runtime:

\`\`\`json
{ "id": "actor-traveler", "label": "Traveler", "sources": [{ "path": "src/screens/Home.tsx" }] }
\`\`\`

A responsibility's \`label\` names the job, not the tech; the tech fact lives in \`implementationHints\` instead:

\`\`\`json
{
  "id": "resp-order-processing",
  "runtimeId": "runtime-server",
  "label": "Order Processing",
  "implementationHints": [{ "label": "Express", "kind": "framework" }],
  "sources": [{ "path": "src/orders/router.ts", "line": 12 }]
}
\`\`\`

An interaction carries a \`kind\` describing what actually happens at runtime, never a static dependency:

\`\`\`json
{
  "id": "int-place-order",
  "from": "actor-traveler",
  "to": "resp-order-processing",
  "label": "place order",
  "kind": "request",
  "sources": [{ "path": "src/orders/router.ts", "line": 12 }]
}
\`\`\``;
}
