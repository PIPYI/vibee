import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import type { AgentEvent, AgentId, ArchitectureViewDocument } from "@vibee/protocol";
import { VIBEE_BRIDGE_TOKEN_HEADER, hasError } from "@vibee/protocol";
import {
  calculateArchitectureLayout,
  renderArchitectureViewSvg,
  validateArchitectureView,
  type ArchitectureLayout,
} from "@vibee/architecture-view";
import { generateBridgeToken, resolveBridgeUrl, resolvePort } from "./bridge-config.js";
import { createClaudeAdapter } from "./agents/claude/adapter.js";
import { codexAdapter } from "./agents/codex/adapter.js";
import type { AgentAdapter } from "./agents/types.js";
import { buildArchitectureViewPrompt } from "./prompt.js";
import {
  MAX_ARCHITECTURE_VIEW_ATTEMPTS,
  clearActiveTask,
  clearAttemptCounter,
  getActiveTask,
  hasActiveTask,
  recordAttempt,
  setActiveTask,
  startAttemptCounter,
} from "./state.js";
import { readArchitectureView, writeArchitectureView } from "./store.js";

const port = resolvePort();
const bridgeUrl = resolveBridgeUrl(port);
const bridgeToken = generateBridgeToken();

const claudeAdapter = createClaudeAdapter({ bridgeUrl, bridgeToken });

function adapterFor(agent: AgentId): AgentAdapter {
  return agent === "claude" ? claudeAdapter : codexAdapter;
}

/**
 * Best-effort git revision lookup. Never throws: a project that isn't a git
 * repo (or has no git installed) is a completely normal case, not an error.
 */
export function resolveGitRevision(projectPath: string): string | undefined {
  try {
    const result = spawnSync("git", ["-C", projectPath, "rev-parse", "HEAD"], { encoding: "utf8" });
    if (result.status !== 0) return undefined;
    const revision = result.stdout.trim();
    return revision.length > 0 ? revision : undefined;
  } catch {
    return undefined;
  }
}

/** JSON-serializable form of ArchitectureLayout (its Maps don't survive JSON.stringify as-is). */
function serializeLayout(layout: ArchitectureLayout) {
  return {
    componentRects: Object.fromEntries(layout.componentRects),
    routes: Object.fromEntries(layout.routes),
    labelRects: Object.fromEntries(layout.labelRects),
  };
}

const app = express();
app.use(express.json({ limit: "10mb" }));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
const wsClients = new Set<WebSocket>();

wss.on("connection", (socket) => {
  wsClients.add(socket);
  socket.on("close", () => wsClients.delete(socket));
});

/**
 * Broadcasts an AgentEvent to every connected WS client. The MVP has only
 * ever one active task at a time (see state.ts), so there is no need for
 * per-client task filtering -- every connected client is assumed to be
 * watching the one active task.
 */
function emit(event: AgentEvent): void {
  const payload = JSON.stringify(event);
  for (const socket of wsClients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

function requireBridgeToken(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const provided = req.header(VIBEE_BRIDGE_TOKEN_HEADER);
  if (provided !== bridgeToken) {
    res.status(401).json({ error: "invalid or missing bridge token" });
    return;
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/architecture-view", (req, res) => {
  const body = req.body as { agent?: AgentId; projectPath?: string; model?: string };

  if (hasActiveTask()) {
    res.status(409).json({ error: "another analysis task is already running" });
    return;
  }

  const agentId = body.agent;
  if (agentId !== "claude" && agentId !== "codex") {
    res.status(400).json({ error: `unknown agent "${String(body.agent)}"` });
    return;
  }

  if (typeof body.projectPath !== "string" || body.projectPath.length === 0) {
    res.status(400).json({ error: "projectPath is required" });
    return;
  }

  const adapter = adapterFor(agentId);

  void (async () => {
    const readiness = await adapter.checkReady();
    if (!readiness.installed || readiness.authenticated === false) {
      res.status(412).json({ error: readiness.message ?? `agent "${agentId}" is not ready` });
      return;
    }

    let realProjectPath: string;
    try {
      realProjectPath = fs.realpathSync(body.projectPath as string);
      if (!fs.statSync(realProjectPath).isDirectory()) throw new Error("not a directory");
    } catch {
      res.status(400).json({ error: `"${body.projectPath}" is not an existing directory` });
      return;
    }

    const gitRevision = resolveGitRevision(realProjectPath);
    const prompt = buildArchitectureViewPrompt(realProjectPath, gitRevision);

    const taskId = randomUUID();
    setActiveTask(taskId, realProjectPath);
    startAttemptCounter(taskId);

    res.status(200).json({ taskId });

    adapter.resetSession(realProjectPath);
    const modelInput = body.model !== undefined ? { model: body.model } : {};
    adapter
      .startTask({ taskId, projectPath: realProjectPath, prompt, mode: "architecture", ...modelInput }, emit)
      .catch((err: unknown) => {
        emit({ type: "task.error", taskId, message: (err as Error).message });
      })
      .finally(() => {
        // MVP simplification: a failed task's attempt counter is cleared
        // here too (not preserved for later inspection). We accept losing
        // "how many rounds did the failed run use" on task-level failure in
        // exchange for not leaking counters across tasks; the counter is
        // scoped to a single taskId regardless, so this is a cleanliness
        // choice, not a correctness one.
        clearAttemptCounter(taskId);
        clearActiveTask();
      });
  })();
});

app.post("/internal/validate-architecture-view", requireBridgeToken, (req, res) => {
  // The MCP tool call doesn't carry a taskId in its input by design (see
  // docs/v1_plan.md 4.5 / packages/mcp-server) -- it's associated with
  // whatever the bridge's single active task currently is. This is safe
  // only because the MVP never runs more than one task at a time (see
  // state.ts's single-flight active-task registry).
  const active = getActiveTask();
  if (!active) {
    res.status(200).json({
      diagnostics: [
        {
          code: "architecture-view/no-active-task",
          severity: "error",
          message: "There is no active analysis task to validate against.",
        },
      ],
    });
    return;
  }

  const { overLimit } = recordAttempt(active.taskId);
  if (overLimit) {
    res.status(200).json({
      diagnostics: [
        {
          code: "architecture-view/validate-limit",
          severity: "error",
          message: `Validate/submit round-trip limit (${MAX_ARCHITECTURE_VIEW_ATTEMPTS}) reached -- stop and report the remaining diagnostics instead of continuing.`,
        },
      ],
    });
    return;
  }

  const gitRevision = resolveGitRevision(active.projectPath);
  const ctx = gitRevision !== undefined ? { projectPath: active.projectPath, gitRevision } : { projectPath: active.projectPath };
  const diagnostics = validateArchitectureView(req.body, ctx);

  const hasSchemaDiagnostics = diagnostics.some((d) => d.code === "architecture-view/schema");
  if (!hasSchemaDiagnostics) {
    const layout = calculateArchitectureLayout(req.body as ArchitectureViewDocument);
    res.status(200).json({ diagnostics, layout: serializeLayout(layout) });
    return;
  }

  res.status(200).json({ diagnostics });
});

app.post("/internal/submit-architecture-view", requireBridgeToken, (req, res) => {
  const active = getActiveTask();
  if (!active) {
    res.status(200).json({
      diagnostics: [
        {
          code: "architecture-view/no-active-task",
          severity: "error",
          message: "There is no active analysis task to submit against.",
        },
      ],
    });
    return;
  }

  const { overLimit } = recordAttempt(active.taskId);
  if (overLimit) {
    res.status(200).json({
      diagnostics: [
        {
          code: "architecture-view/validate-limit",
          severity: "error",
          message: `Validate/submit round-trip limit (${MAX_ARCHITECTURE_VIEW_ATTEMPTS}) reached -- stop and report the remaining diagnostics instead of continuing.`,
        },
      ],
    });
    return;
  }

  const gitRevision = resolveGitRevision(active.projectPath);
  const ctx = gitRevision !== undefined ? { projectPath: active.projectPath, gitRevision } : { projectPath: active.projectPath };
  const diagnostics = validateArchitectureView(req.body, ctx);

  if (hasError(diagnostics)) {
    res.status(200).json({ diagnostics });
    return;
  }

  const metaInput = gitRevision !== undefined ? { gitRevision, taskId: active.taskId } : { taskId: active.taskId };
  writeArchitectureView(active.projectPath, req.body as ArchitectureViewDocument, metaInput);
  clearAttemptCounter(active.taskId);

  // Distinct from the agent turn's own "task.completed" (that marks the
  // agent finishing its turn, which can happen with or without a successful
  // submission) -- this marks that a document was actually committed and is
  // now available from GET /api/architecture-view. "architecture-view.committed"
  // is a dedicated AgentEvent variant added to @vibee/protocol for exactly
  // this notification.
  emit({ type: "architecture-view.committed", taskId: active.taskId });

  res.status(200).json({ committed: true });
});

app.get("/api/architecture-view", (req, res) => {
  const projectPath = req.query["projectPath"];
  if (typeof projectPath !== "string" || projectPath.length === 0) {
    res.status(400).json({ error: "projectPath query parameter is required" });
    return;
  }

  const stored = readArchitectureView(projectPath);
  if (!stored) {
    res.status(404).json({ error: "no architecture view has been committed for this project yet" });
    return;
  }

  // Rendered on every read (not cached) so a renderer improvement
  // retroactively benefits already-committed projects.
  const svg = renderArchitectureViewSvg(stored.document);
  res.status(200).json({ document: stored.document, svg, meta: stored.meta });
});

app.get("/api/models", (req, res) => {
  const agent = req.query["agent"];
  if (agent !== "claude" && agent !== "codex") {
    res.status(400).json({ error: `unknown agent "${String(agent)}"` });
    return;
  }

  adapterFor(agent)
    .listModels()
    .then((models) => res.status(200).json({ models }))
    .catch((err: unknown) => {
      res.status(500).json({ error: (err as Error).message });
    });
});

httpServer.listen(port, () => {
  console.error(`[vibee-bridge] listening on http://127.0.0.1:${port}`);
  console.error(`[vibee-bridge] bridge token (in-memory, regenerated on restart): ${bridgeToken}`);
});
