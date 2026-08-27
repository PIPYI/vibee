#!/usr/bin/env node
// Stateless stdio MCP server for the vibee architecture-view pipeline.
//
// This process is only ever meant to be spawned by apps/bridge (as an MCP
// server registered on a Claude Agent SDK `query()` call) -- never run
// standalone by a human. It holds no state of its own: every tool call is
// forwarded over loopback HTTP to the bridge (`callBridge`), which is the
// only place that knows about the active task / project path / validation
// attempt counters.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { VIBEE_BRIDGE_TOKEN_HEADER, VIBEE_BRIDGE_TOKEN_ENV, VIBEE_BRIDGE_URL_ENV } from "@vibee/protocol";

export type CallBridgeResult = { ok: true; data: unknown } | { ok: false; error: string; next_step: string };

/**
 * POSTs `body` as JSON to `${VIBEE_BRIDGE_URL}${path}` with the bridge auth
 * header (both read from `process.env` at call time, not cached at module
 * load, so tests can set them per-case). Never throws: a network failure or
 * a non-2xx HTTP response is surfaced as `{ok:false, error, next_step}`
 * instead of a rejected promise, because MCP tool handlers that throw kill
 * the whole stdio transport -- every failure has to come back as tool output
 * the calling model can read and react to.
 */
export async function callBridge(path: string, body: unknown): Promise<CallBridgeResult> {
  const bridgeUrl = process.env[VIBEE_BRIDGE_URL_ENV];
  const bridgeToken = process.env[VIBEE_BRIDGE_TOKEN_ENV];
  if (!bridgeUrl || !bridgeToken) {
    return {
      ok: false,
      error: `${VIBEE_BRIDGE_URL_ENV} and/or ${VIBEE_BRIDGE_TOKEN_ENV} are not set in this process's environment`,
      next_step: "report this failure honestly; this server should only ever be spawned by @vibee/bridge with those variables set",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${bridgeUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [VIBEE_BRIDGE_TOKEN_HEADER]: bridgeToken,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: `could not reach the vibee bridge at ${bridgeUrl}${path}: ${(err as Error).message}`,
      next_step: "report this failure honestly; do not fabricate a validation result and do not retry more than a few times",
    };
  }

  const text = await response.text().catch(() => "");
  let parsed: unknown = text;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `bridge responded ${response.status} ${response.statusText} for ${path}: ${
        typeof parsed === "string" ? parsed : JSON.stringify(parsed)
      }`,
      next_step: "report this failure honestly; do not fabricate a validation result and do not retry more than a few times",
    };
  }

  return { ok: true, data: parsed };
}

// V2 (docs/v2_plan.md §9): two-stage pipeline instead of V1's single stage.
// (1) author a RuntimeSemanticDocument (who/what runtimes/responsibilities/
// state/externals/interactions exist, evidence-backed) and commit it via
// submit_runtime_semantics to get back a semanticRevision; (2) author one
// canonical ArchitectureViewDocument that references that semanticRevision
// and real semantic ids, then validate/submit it as before. The detailed
// per-stage authoring rules live in the bridge's assembled prompt
// (apps/bridge/src/prompt.ts) -- this is just the short tool-discovery blurb
// shown when the model lists available tools.
const INSTRUCTIONS = `This project uses a two-stage architecture pipeline. First, author a RuntimeSemanticDocument (actors/runtimes/responsibilities/states/externals/interactions, each evidence-backed) and call submit_runtime_semantics; fix any returned diagnostics and retry until it returns a semanticRevision. Second, author one canonical ArchitectureViewDocument that references that semanticRevision and real semantic ids, then call validate_architecture_view to check it -- fix every diagnostic using its subject/evidence/supportedFixes, never guess at a fix without reading them. Once validate_architecture_view returns zero severity:"error" diagnostics, call submit_architecture_view exactly once with the same document (including semanticRevision) to commit it.`;

// Shaped but permissive: an earlier version of this schema was a bare
// `z.object({}).passthrough()` (i.e. "any object at all"). In live testing
// against a real Claude Agent SDK turn, every validate_architecture_view call
// arrived with its structured fields (pos/size number arrays, sources[]
// arrays, etc.) flattened to plain strings, which then failed ajv's real
// schema check every time -- the empty declared shape gave the model/SDK's
// tool-argument serialization nothing to go on for "this field is an array
// of numbers" vs "this field is a string". Declaring the real field TYPES
// here (without min/max/regex/enum constraints, and with `.passthrough()` at
// every level) fixes that signal while keeping this layer's own validation
// lenient -- the real strict gate stays the ajv schema compiled server-side
// from architecture-view.schema.json (via validateArchitectureView /
// checkSchema in @vibee/architecture-view). A document that's still wrong in
// some way must reach the bridge and come back as a real diagnostic with
// subject/evidence/supportedFixes, not get silently rejected or mangled by
// this tool-call layer.
const sourceInputSchema = z
  .object({
    path: z.string().optional(),
    line: z.number().optional(),
    endLine: z.number().optional(),
    label: z.string().optional(),
  })
  .passthrough();

// V2: per-audience display override (see PresentationOverride in
// @vibee/protocol). Same permissive, field-shaped-but-unconstrained style as
// everything else here -- e.g. `visibility` is a plain string, not an enum,
// because the real enum check happens in the ajv schema on the bridge side.
const presentationOverrideInputSchema = z
  .object({
    label: z.string().optional(),
    sublabel: z.string().optional(),
    visibility: z.string().optional(),
  })
  .passthrough();

const audiencePresentationInputSchema = z
  .object({
    simple: presentationOverrideInputSchema.optional(),
    technical: presentationOverrideInputSchema.optional(),
  })
  .passthrough();

const componentInputSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    // V2: which RuntimeSemanticDocument entity kind this component stands
    // for, and which id(s) it references. `kind`/role values are left as
    // plain strings here on purpose -- see the passthrough-schema comment
    // above this block.
    semanticRole: z.string().optional(),
    semanticRefs: z.array(z.string()).optional(),
    label: z.string().optional(),
    sublabel: z.string().optional(),
    presentation: audiencePresentationInputSchema.optional(),
    pos: z.array(z.number()).optional(),
    size: z.array(z.number()).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const boundaryInputSchema = z
  .object({
    id: z.string().optional(),
    kind: z.string().optional(),
    semanticRefs: z.array(z.string()).optional(),
    label: z.string().optional(),
    presentation: audiencePresentationInputSchema.optional(),
    wraps: z.array(z.string()).optional(),
    pad: z.number().optional(),
  })
  .passthrough();

const connectionInputSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    semanticRefs: z.array(z.string()).optional(),
    label: z.string().optional(),
    presentation: audiencePresentationInputSchema.optional(),
    variant: z.string().optional(),
  })
  .passthrough();

const cardInputSchema = z
  .object({
    dot: z.string().optional(),
    title: z.string().optional(),
    items: z.array(z.string()).optional(),
  })
  .passthrough();

// V2 (docs/v2_plan.md §9.2): validate_architecture_view/submit_architecture_view
// now also carry a `semanticRevision` identifying the already-committed
// RuntimeSemanticDocument this architecture document was composed from. It is
// merged flatly alongside the document's own fields (one flat JSON object,
// same as every other field on this schema) rather than nested under a
// `document` key -- this matches how this file already shapes its other two
// tools' inputs (a flat document, no wrapper object), so the model only ever
// has to learn one input shape convention across all three tools. Left
// `.optional()` here for the same reason every other field is optional (see
// the passthrough-schema comment above) -- the bridge route is what actually
// enforces that it's present and resolves to a real committed revision.
const documentInputSchema = z
  .object({
    semanticRevision: z.number().optional(),
    schemaVersion: z.number().optional(),
    title: z.string().optional(),
    viewBox: z.array(z.number()).optional(),
    repository: z
      .object({ url: z.string().optional(), revision: z.string().optional() })
      .passthrough()
      .optional(),
    presentation: z
      .object({
        defaultAudience: z.string().optional(),
        availableAudiences: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    components: z.array(componentInputSchema).optional(),
    boundaries: z.array(boundaryInputSchema).optional(),
    connections: z.array(connectionInputSchema).optional(),
    cards: z.array(cardInputSchema).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// RuntimeSemanticDocument input schema (docs/v2_plan.md §7.2, §9.1). Mirrors
// packages/protocol/src/runtime-semantic.ts field-for-field, in the same
// permissive style as the schemas above.
// ---------------------------------------------------------------------------

const implementationHintInputSchema = z
  .object({
    label: z.string().optional(),
    kind: z.string().optional(),
  })
  .passthrough();

const actorInputSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const runtimeUnitInputSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    kind: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const responsibilityInputSchema = z
  .object({
    id: z.string().optional(),
    runtimeId: z.string().optional(),
    label: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const stateInputSchema = z
  .object({
    id: z.string().optional(),
    runtimeId: z.string().optional(),
    label: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const externalInputSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    kind: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const interactionInputSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    label: z.string().optional(),
    kind: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

export const runtimeSemanticDocumentInputSchema = z
  .object({
    schemaVersion: z.number().optional(),
    title: z.string().optional(),
    repository: z
      .object({ url: z.string().optional(), revision: z.string().optional() })
      .passthrough()
      .optional(),
    actors: z.array(actorInputSchema).optional(),
    runtimes: z.array(runtimeUnitInputSchema).optional(),
    responsibilities: z.array(responsibilityInputSchema).optional(),
    states: z.array(stateInputSchema).optional(),
    externals: z.array(externalInputSchema).optional(),
    interactions: z.array(interactionInputSchema).optional(),
  })
  .passthrough();

/**
 * Defensive normalization: if a value that should be a JSON object/array
 * arrives as a JSON-encoded string instead (the exact live-tested failure
 * mode this schema change targets), parse it. Recurses into the known
 * document shape only -- this is a targeted safety net, not a general
 * deep-parse of arbitrary strings, so it can't accidentally mangle a
 * genuinely-string field like `label`.
 */
export function coerceJsonStrings(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return coerceJsonStrings(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(coerceJsonStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, coerceJsonStrings(v)]));
  }
  return value;
}

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "vibee", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "submit_runtime_semantics",
    {
      description:
        "Author a RuntimeSemanticDocument (actors/runtimes/responsibilities/states/externals/interactions, each backed by real source citations) and submit it for server-side validation: schema -> referential integrity -> citations. On success, commits it as an immutable semantic revision and returns { diagnostics: [], semanticRevision } -- you must pass that semanticRevision when you later call validate_architecture_view/submit_architecture_view. On failure, returns { diagnostics } describing exactly what to fix; fix and call this tool again (do not guess at a fix without reading subject/evidence/supportedFixes).",
      inputSchema: runtimeSemanticDocumentInputSchema,
    },
    async (document) => {
      const result = await callBridge("/internal/submit-runtime-semantics", coerceJsonStrings(document));
      const text = result.ok ? JSON.stringify(result.data) : JSON.stringify({ error: result.error, next_step: result.next_step });
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "validate_architecture_view",
    {
      description:
        "Validate a candidate ArchitectureViewDocument WITHOUT committing it. Input is the document's own fields plus a top-level `semanticRevision` (the number returned by submit_runtime_semantics) -- omit it or reference an unknown revision and validation fails with a diagnostic telling you to call submit_runtime_semantics first. Runs schema -> semantic mapping -> geometry -> citation checks in order; schema errors short-circuit the later stages. Returns { diagnostics, layout? } -- layout (computed component rects, routes, label rects) is included only when there are zero schema-level diagnostics, so you can see the actual rendered coordinates before submitting.",
      inputSchema: documentInputSchema,
    },
    async (document) => {
      const result = await callBridge("/internal/validate-architecture-view", coerceJsonStrings(document));
      const text = result.ok ? JSON.stringify(result.data) : JSON.stringify({ error: result.error, next_step: result.next_step });
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "submit_architecture_view",
    {
      description:
        "Re-validates the candidate ArchitectureViewDocument server-side (same document fields plus the top-level `semanticRevision` used with validate_architecture_view) and, if it has no severity:\"error\" diagnostics, commits it as the project's architecture view. If any error diagnostic remains, the submission is rejected and the diagnostics are returned instead -- fix them and call validate_architecture_view again before retrying submit.",
      inputSchema: documentInputSchema,
    },
    async (document) => {
      const result = await callBridge("/internal/submit-architecture-view", coerceJsonStrings(document));
      const text = result.ok ? JSON.stringify(result.data) : JSON.stringify({ error: result.error, next_step: result.next_step });
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}

async function main() {
  const bridgeUrl = process.env[VIBEE_BRIDGE_URL_ENV];
  const bridgeToken = process.env[VIBEE_BRIDGE_TOKEN_ENV];

  if (!bridgeUrl || !bridgeToken) {
    console.error(
      `vibee-mcp-server: missing ${VIBEE_BRIDGE_URL_ENV} and/or ${VIBEE_BRIDGE_TOKEN_ENV} in the environment. ` +
        "This process is only meant to be spawned by @vibee/bridge as a stdio MCP server -- it is not meant to be run standalone.",
    );
    process.exit(1);
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Guard so this module can be imported (e.g. by tests, for `callBridge`)
// without immediately trying to read env vars / exit / connect stdio.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("vibee-mcp-server: fatal error", err);
    process.exit(1);
  });
}
