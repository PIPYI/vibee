// The bridge's own base URL (used to build the direct WebSocket URL, and as
// the Vite dev-server proxy target -- see vite.config.ts for why HTTP calls
// go through a relative same-origin path instead of this URL directly).
export const BRIDGE_URL: string = import.meta.env["VITE_BRIDGE_URL"] ?? "http://127.0.0.1:4310";

/**
 * Base for HTTP calls to the bridge's REST API.
 *
 * In dev (`vite dev`), we deliberately use a relative, same-origin path so
 * requests are proxied by Vite (see vite.config.ts) instead of hitting the
 * bridge's origin directly -- the bridge sends no CORS headers, and
 * apps/bridge is out of scope for this change, so a direct cross-origin
 * fetch from the dev server's origin would be blocked by the browser.
 *
 * In a production build there is no dev-server proxy, so we fall back to
 * calling BRIDGE_URL directly. That only works if the built app ends up
 * served from the same origin as the bridge, or behind a reverse proxy that
 * forwards /api -- there is no such deployment story in this MVP, so this
 * path is effectively unverified; `vite dev` is the supported way to run
 * apps/web against apps/bridge for now.
 */
export const API_BASE: string = import.meta.env.DEV ? "" : BRIDGE_URL;

/** Converts an http(s) bridge URL into the equivalent ws(s) URL. */
export function wsUrlFrom(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}
