import express from "express";

import { BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from "@vci/protocol";

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env["VCI_BRIDGE_PORT"] ?? DEFAULT_BRIDGE_PORT);
app.listen(port, BRIDGE_HOST, () => {
  console.log(`[vci-bridge] listening on http://${BRIDGE_HOST}:${port}`);
});
