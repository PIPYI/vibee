import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The bridge (apps/bridge) does not send any Access-Control-Allow-Origin
// header -- it was built as a plain loopback server, and apps/web is
// explicitly out of scope for changes to apps/bridge. That means a direct
// cross-origin fetch() from the Vite dev server's origin (e.g.
// http://127.0.0.1:5173) to the bridge's origin (http://127.0.0.1:4310)
// would be blocked by the browser as a CORS violation, even though both are
// on 127.0.0.1 -- different ports are different origins.
//
// The standard fix that requires zero bridge changes is a dev-server proxy:
// src/api.ts calls same-origin relative paths ("/api/...") while running
// under `vite dev`, and Vite forwards them server-side (server-to-server
// requests are not subject to browser CORS at all) to the real bridge URL
// configured via VITE_BRIDGE_URL. The same proxy also handles /ws: WebSocket
// handshakes are not blocked by CORS, but proxying still avoids cross-host
// loopback problems in WSL and other split browser/server environments.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const bridgeUrl = env["VITE_BRIDGE_URL"] || "http://127.0.0.1:4310";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: bridgeUrl,
          changeOrigin: true,
        },
        // Keep browser-to-bridge traffic on Vite's origin in development.
        // This avoids a separate browser -> WSL loopback hop for WebSocket
        // events while Vite can already reach the bridge from inside WSL.
        "/ws": {
          target: bridgeUrl,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
