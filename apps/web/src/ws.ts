import type { AgentEvent } from "@vibee/protocol";
import { BRIDGE_URL, wsUrlFrom } from "./config.ts";

const RECONNECT_DELAY_MS = 2000;

/**
 * Subscribes to the bridge's single WebSocket event stream. Every connected
 * client receives every AgentEvent for whatever the one currently-active
 * task is (see docs/v1_plan.md 4.5 / apps/bridge/src/index.ts) -- there is
 * no per-task filtering to do here.
 *
 * In development, events are proxied through the page's own Vite origin.
 * That keeps a Windows browser + WSL bridge on the same reliable path as
 * the API proxy rather than making the browser reach the bridge directly.
 *
 * Reconnects on close with a fixed delay. Per the plan this is explicitly
 * MVP-scoped: no exponential backoff and no resync-on-reconnect (a missed
 * event during a drop is simply lost -- acceptable since the bridge only
 * ever runs one task at a time and the UI's own state machine tolerates a
 * gap by re-fetching GET /api/architecture-view on "committed").
 *
 * Returns an unsubscribe function that closes the socket and stops
 * reconnect attempts.
 */
export function connectEvents(onEvent: (event: AgentEvent) => void): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const url = import.meta.env.DEV ? `${wsUrlFrom(window.location.origin)}/ws` : `${wsUrlFrom(BRIDGE_URL)}/ws`;

  function connect(): void {
    if (stopped) return;
    socket = new WebSocket(url);

    socket.addEventListener("message", (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as AgentEvent;
        onEvent(event);
      } catch {
        // Malformed frame -- ignore rather than crash the UI.
      }
    });

    socket.addEventListener("close", () => {
      if (stopped) return;
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });

    socket.addEventListener("error", () => {
      // The subsequent "close" event drives reconnect; nothing else to do
      // here beyond letting it happen.
    });
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
