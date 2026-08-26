import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const BRIDGE = process.env["BRIDGE_URL"] ?? "http://127.0.0.1:43220";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: BRIDGE, changeOrigin: true },
      "/events": { target: BRIDGE, ws: true, changeOrigin: true },
    },
  },
});
