import { randomBytes } from "node:crypto";

export const DEFAULT_PORT = 4310;

/** Port the bridge's Express+WS server listens on. */
export function resolvePort(): number {
  const raw = process.env["PORT"];
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/** The bridge's own base URL, as seen by subprocesses it spawns on this machine (the MCP server). */
export function resolveBridgeUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * Generates a fresh loopback secret for bridge<->mcp-server auth. Called
 * once at process boot and held only in memory -- this is not a
 * user-configured secret and is never persisted to disk or an env var the
 * user sets; it exists solely so the bridge can tell "a request that came
 * from the MCP server process I spawned" apart from any other localhost
 * traffic. It is regenerated every bridge restart, which is fine because
 * every spawned MCP server subprocess gets the current value injected into
 * its own environment at spawn time (see agents/claude/adapter.ts).
 */
export function generateBridgeToken(): string {
  return randomBytes(24).toString("hex");
}
