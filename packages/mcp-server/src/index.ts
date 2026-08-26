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

const INSTRUCTIONS = `Author an ArchitectureViewDocument (a small JSON IR describing this codebase's architecture), then call validate_architecture_view to check it. Fix every diagnostic using its subject/evidence/supportedFixes -- never guess at a fix without reading them. Once validate_architecture_view returns zero severity:"error" diagnostics, call submit_architecture_view exactly once to commit the document. validate_architecture_view and submit_architecture_view together cost at most 6 calls total -- if two consecutive rounds do not reduce the error count, stop and report the remaining diagnostics honestly instead of continuing to guess.`;

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

const componentInputSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    label: z.string().optional(),
    sublabel: z.string().optional(),
    pos: z.array(z.number()).optional(),
    size: z.array(z.number()).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const boundaryInputSchema = z
  .object({
    kind: z.string().optional(),
    label: z.string().optional(),
    wraps: z.array(z.string()).optional(),
    pad: z.number().optional(),
  })
  .passthrough();

const connectionInputSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    label: z.string().optional(),
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

const documentInputSchema = z
  .object({
    schemaVersion: z.number().optional(),
    title: z.string().optional(),
    viewBox: z.array(z.number()).optional(),
    repository: z
      .object({ url: z.string().optional(), revision: z.string().optional() })
      .passthrough()
      .optional(),
    components: z.array(componentInputSchema).optional(),
    boundaries: z.array(boundaryInputSchema).optional(),
    connections: z.array(connectionInputSchema).optional(),
    cards: z.array(cardInputSchema).optional(),
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
    "validate_architecture_view",
    {
      description:
        "Validate a candidate ArchitectureViewDocument WITHOUT committing it. Runs schema -> geometry -> citation checks in order; schema errors short-circuit the later stages. Returns { diagnostics, layout? } -- layout (computed component rects, routes, label rects) is included only when there are zero schema-level diagnostics, so you can see the actual rendered coordinates before submitting.",
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
        "Re-validates the candidate ArchitectureViewDocument server-side and, if it has no severity:\"error\" diagnostics, commits it as the project's architecture view. If any error diagnostic remains, the submission is rejected and the diagnostics are returned instead -- fix them and call validate_architecture_view again before retrying submit.",
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
