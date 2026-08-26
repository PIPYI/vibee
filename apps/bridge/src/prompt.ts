import { architectureViewExampleText, architectureViewSchemaText } from "@vibee/architecture-view";

// The fenced markers below are load-bearing: prompt.test.ts finds the text
// between them and re-parses it to assert it deep-equals
// JSON.parse(architectureViewSchemaText()). Never hand-write a description
// of the schema here instead of embedding the real text -- that is exactly
// the drift this test exists to catch (see docs/v1_plan.md 4.2).
const SCHEMA_FENCE_START = "```json architecture-view-schema";
const SCHEMA_FENCE_END = "```";

export function buildArchitectureViewPrompt(projectPath: string, gitRevision?: string): string {
  const schemaText = architectureViewSchemaText();
  const exampleText = architectureViewExampleText();

  const revisionSection =
    gitRevision !== undefined
      ? `The project is currently at git revision ${gitRevision}. Your sources[] citations will be checked against this exact revision, so cite what is true at this revision.`
      : `This project is not a git repository (or its revision could not be determined). Your sources[] citations will be checked against the current working-tree files directly, so cite real working-tree paths and do not imply a specific pinned revision.`;

  return `You are analyzing the codebase at:

  ${projectPath}

${revisionSection}

## Step 1: Explore first

Before writing anything, explore the repository using your native Read, Grep, and Glob tools. Understand the macro structure: what runtime units exist (frontend app, backend/API service, database, background workers, external integrations, etc.), how they are wired together, and which single path through the system is the most important one to show a non-technical reader.

Do not guess at structure you have not actually looked at. Every claim you encode in the diagram should trace back to something you actually read.

## Step 2: Author an ArchitectureViewDocument

The document you author must validate against this exact JSON Schema:

${SCHEMA_FENCE_START}
${schemaText}
${SCHEMA_FENCE_END}

Here is an example document showing the general SHAPE of a valid document (its content is generic filler, not a description of this project -- do not reuse its component names, labels, or structure, only its shape):

\`\`\`json
${exampleText}
\`\`\`

## Authoring rules

- **Curate 6-12 components.** Group by macro runtime unit (e.g. "API Server", "Primary Database", "Job Queue") -- never one component per file or per function. If you are tempted to add a 13th component, merge two related ones into one boundary instead.
- **Canvas and layout.** Default canvas is 1200x760 (the schema's \`viewBox\` default). Lay components out left-to-right in rough "layers" matching data flow (e.g. clients on the left, services in the middle, data stores/external services on the right) -- this is a suggestion for readability, not a schema requirement. Typical component size is around 170-190 wide by 70-90 tall; leave at least 24px of gap between components so the automatic connection routing has room to route around them.
- **Boundaries** group components that share an independent runtime or trust context: use \`kind: "region"\` for a deployment/runtime grouping (e.g. "Client", "Cloud Provider") and \`kind: "security-group"\` for a trust boundary (e.g. "Trusted Backend Services"). Only wrap components that genuinely belong together; do not create a boundary for a single component unless it is meaningfully isolated (e.g. an external third-party service).
- **Connections carry only \`from\`, \`to\`, an optional \`label\`, and an optional \`variant\`.** There is no \`fromSide\`/\`toSide\`/\`route\`/\`via\`/\`waypoints\`/\`labelAt\` field in this schema -- do not invent one. Anchoring and routing around other components is computed automatically by the renderer/validator from geometry alone.
  - \`variant: "emphasis"\` for the one primary/main path through the system (use sparingly -- ideally exactly one path).
  - \`variant: "security"\` for connections that cross an authentication or secret boundary.
  - \`variant: "dashed"\` for asynchronous or inferred (not directly observed) connections.
  - Omit \`variant\` (or use \`"default"\`) for ordinary synchronous calls.
- **Citations (\`sources[]\`) must be real.** Only cite a \`path\` (and optionally \`line\`/\`endLine\`) you actually saw with Read/Grep/Glob during Step 1. Omitting \`sources\` entirely on a component is always safe. Never guess a line number to make a citation look more precise -- an invalid citation is a validation error, but a component with no citations at all is not.
- **Cards.** Up to 4 \`cards\` entries, each a short titled list of plain-language bullet points (e.g. "Request flow", "Background jobs") explaining what happens along a group of connections, for a non-technical reader. Keep each card to a handful of short items; this is overflow/explanatory content, not a restatement of the whole diagram.

## Step 3: Validate, fix, submit

Call the \`validate_architecture_view\` MCP tool with your candidate document. It runs schema checks, then geometry checks, then citation checks (schema errors short-circuit the rest), and returns \`{ diagnostics, layout? }\` -- \`layout\` (actual computed component/route/label coordinates) is included once there are zero schema-level diagnostics, so you can sanity-check real layout before submitting.

For every diagnostic returned, use its \`subject\`, \`evidence\`, and \`supportedFixes\` fields to make a targeted fix -- do not guess at what might be wrong. Re-run \`validate_architecture_view\` after each round of fixes.

Once \`validate_architecture_view\` returns zero \`severity: "error"\` diagnostics, call \`submit_architecture_view\` exactly once with the same document to commit it. The bridge re-validates on submit and will reject the submission (returning diagnostics instead of committing) if any error remains.

**Hard cap: \`validate_architecture_view\` and \`submit_architecture_view\` together cost at most 6 calls total.** If two consecutive validate rounds do not reduce the error count, stop iterating and report the remaining diagnostics honestly instead of continuing to guess at fixes.

If any tool call fails (network error, bridge error, or anything else), report that failure honestly in your final summary -- never fabricate a successful validation or submission result you did not actually receive.`;
}
