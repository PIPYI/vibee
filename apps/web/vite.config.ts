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
// configured via VITE_BRIDGE_URL. WebSocket connections are unaffected by
// CORS (browsers don't apply the same-origin check to the WebSocket
// handshake), so src/ws.ts connects directly to the bridge's ws:// URL
// without going through this proxy.
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
      },
    },
  };
});
