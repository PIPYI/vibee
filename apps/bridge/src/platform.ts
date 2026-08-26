import { fileURLToPath } from "node:url";
import path from "node:path";

/** Absolute path to the Node.js executable running this process. */
export function nodeExecutable(): string {
  return process.execPath;
}

// This file lives at apps/bridge/src/platform.ts. Compiled output lives at
// apps/bridge/dist/platform.js. Either way this file sits exactly one
// directory below apps/bridge/ (src/ or dist/), so climbing three levels
// from this file's own directory lands on the repo root in both cases --
// the relative path from here to the mcp-server package is stable across
// tsx (running src/ directly) and the compiled dist/ build without needing
// a separate "resolve from dist vs src" branch. We deliberately don't use
// `import.meta.resolve` for
// this because that resolves through package.json `exports`/`main` (i.e.
// @vibee/mcp-server's declared `dist/index.js` entry point) which is exactly
// what we want here anyway -- but resolving from node_modules requires the
// package to be a real resolvable dependency and hoisted predictably, which
// is one more moving part than a plain relative path in a workspace we
// already know the layout of.
const MCP_SERVER_ENTRY_RELATIVE = "../../../packages/mcp-server/dist/index.js";

/** Absolute path to the built @vibee/mcp-server entry point (dist/index.js). */
export function mcpServerEntryPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, MCP_SERVER_ENTRY_RELATIVE);
}
