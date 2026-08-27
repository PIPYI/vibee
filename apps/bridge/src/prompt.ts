import { MAX_ARCHITECTURE_VIEW_ATTEMPTS, MAX_RUNTIME_SEMANTIC_ATTEMPTS } from "./state.js";
import { architectureViewSchemaBlock, runtimeSemanticSchemaBlock } from "./prompts/architecture-schema.js";
import { runtimeSemanticContract } from "./prompts/runtime-semantic-contract.js";
import { runtimeSemanticExamples } from "./prompts/runtime-semantic-examples.js";
import { architectureCompositionContract } from "./prompts/architecture-composition-contract.js";
import { audiencePresentationContract } from "./prompts/audience-presentation-contract.js";
import { correctionContract } from "./prompts/correction-contract.js";

// V2 (docs/v2_plan.md §12): the prompt is assembled from role-scoped modules
// under ./prompts/ instead of living as one monolithic template string. Kept
// the V1 exported function name (`buildArchitectureViewPrompt`) rather than
// renaming to e.g. `buildRuntimeArchitecturePrompt` -- it's called from
// exactly one call site (apps/bridge/src/index.ts) and the two-stage
// pipeline it now describes is still, from the caller's perspective, "the
// prompt for the architecture-view task"; renaming would only add
// call-site/test churn for no behavioral benefit.
export function buildArchitectureViewPrompt(projectPath: string, gitRevision?: string): string {
  const revisionSection =
    gitRevision !== undefined
      ? `The project is currently at git revision ${gitRevision}. Your sources[] citations (in both the semantic model and the architecture document) will be checked against this exact revision, so cite what is true at this revision.`
      : `This project is not a git repository (or its revision could not be determined). Your sources[] citations will be checked against the current working-tree files directly, so cite real working-tree paths and do not imply a specific pinned revision.`;

  return `You are analyzing the codebase at:

  ${projectPath}

${revisionSection}

This analysis produces a **runtime architecture**: not a file/framework inventory, but a map of who interacts with the system, what runtimes exist, what each runtime is responsible for, and how those responsibilities interact. It is built in two stages: first a repository-evidence-only semantic model, then one canonical visual composition of that model.

## Step 0: Explore first

Before writing anything, explore the repository using your native Read, Grep, and Glob tools. Understand the macro structure: what runtime units exist (frontend app, backend/API service, database, background workers, external integrations, etc.), who/what interacts with them, and how they are wired together at runtime.

Do not guess at structure you have not actually looked at. Every claim you encode in the semantic model or the diagram should trace back to something you actually read.

${runtimeSemanticContract()}

The document you author for this stage must validate against this exact JSON Schema:

${runtimeSemanticSchemaBlock()}

${runtimeSemanticExamples()}

Call \`submit_runtime_semantics\` with your candidate document once you believe it is complete and evidence-backed.

${architectureCompositionContract()}

The document you author for this stage must validate against this exact JSON Schema:

${architectureViewSchemaBlock()}

${audiencePresentationContract()}

## Architecture authoring rules

- **Curate 6-12 components.** Group by macro responsibility/state/external/actor -- never one component per file or per function. If you are tempted to add a 13th component, reconsider whether two related ones should be one semantic responsibility instead.
- **Canvas and layout.** Default canvas is 1200x760 (the schema's \`viewBox\` default). Lay components out left-to-right in rough "layers" matching data flow -- this is a suggestion for readability, not a schema requirement. Typical component size is around 170-190 wide by 70-90 tall; leave at least 24px of gap between components so the automatic connection routing has room to route around them.
- **Non-runtime boundaries** (\`kind: "region"\`/\`"security-group"\`) may still be used for a deployment grouping or trust boundary that isn't itself a runtime. Only wrap components that genuinely belong together.
- **Connections carry only \`from\`, \`to\`, an optional \`label\`, an optional \`semanticRefs\`, an optional \`presentation\`, and an optional \`variant\`.** There is no \`fromSide\`/\`toSide\`/\`route\`/\`via\`/\`waypoints\`/\`labelAt\` field in this schema -- do not invent one. Anchoring and routing around other components is computed automatically by the renderer/validator from geometry alone.
  - \`variant: "emphasis"\` for the one primary/main path through the system (use sparingly -- ideally exactly one path, or one per runtime for a local primary story).
  - \`variant: "security"\` for connections that cross an authentication or secret boundary.
  - \`variant: "dashed"\` for asynchronous or inferred (not directly observed) connections.
  - Omit \`variant\` (or use \`"default"\`) for ordinary synchronous calls.
- **Citations (\`sources[]\`) must be real.** Stage 1 evidence is inherited automatically onto matching visual components through \`semanticRefs\`. You may omit duplicate component \`sources\`; if you add any, only cite a real \`path\` (and optionally \`line\`/\`endLine\`) you actually saw. Never guess a line number.
- **Cards.** Up to 4 \`cards\` entries, each a short Korean-titled list of Korean plain-language bullet points, for a non-technical reader. Cards default off -- only add them when a group of connections genuinely needs this extra explanation.

${correctionContract({ semanticAttempts: MAX_RUNTIME_SEMANTIC_ATTEMPTS, architectureAttempts: MAX_ARCHITECTURE_VIEW_ATTEMPTS })}`;
}
