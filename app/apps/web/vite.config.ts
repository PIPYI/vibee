import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { detectRuntime } from "../../scripts/runtime.mjs";

const BRIDGE = process.env["BRIDGE_URL"] ?? "http://127.0.0.1:44120";
const runtime = detectRuntime();

export default defineConfig({
  plugins: [react()],
  server: {
    // WSL에서는 Windows 쪽 브라우저가 접속할 수 있도록 모든 인터페이스에 bind한다.
    // macOS/Linux/Windows 네이티브에서는 기본적으로 loopback만 연다.
    host: runtime.webHost,
    port: 5273,
    proxy: {
      "/api": { target: BRIDGE, changeOrigin: true },
      "/events": { target: BRIDGE, ws: true, changeOrigin: true },
    },
  },
});
