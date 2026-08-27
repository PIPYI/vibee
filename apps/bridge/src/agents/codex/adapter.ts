import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentEvent, ModelOption } from "@vibee/protocol";
import { VIBEE_BRIDGE_TOKEN_ENV, VIBEE_BRIDGE_URL_ENV } from "@vibee/protocol";
import type { AgentAdapter, StartTaskInput } from "../types.js";
import { mcpServerEntryPath, nodeExecutable } from "../../platform.js";
import { CodexAppServerClient, type ServerRequest } from "./appServerClient.js";

const MCP_SERVER_NAME = "vibee";

/**
 * Approval policy for the app-server session.
 *
 * `"never"` must not be used here: as of Codex 0.148, `"never"` unconditionally
 * rejects any MCP tool call ("MCP tool call requires approval, but approval
 * policy is never"), regardless of what approval policy string is passed --
 * this is hardcoded inside `codex exec`/app-server itself, not something
 * `@openai/codex-sdk` (or any client) can configure around.
 *
 * The granular form below turns MCP elicitation on and everything else off.
 * That means command execution and file patches proceed inside the sandbox
 * without asking us (they're constrained by `sandbox: "read-only"` /
 * `sandboxPolicy` below instead), while MCP tool calls are the *only* thing
 * routed back to us as a server-initiated `mcpServer/elicitation/request` --
 * which handleServerRequest answers, accepting only our own "vibee" server.
 */
const APPROVAL_POLICY = {
  granular: {
    sandbox_approval: false,
    rules: false,
    skill_approval: false,
    request_permissions: false,
    mcp_elicitations: true,
  },
} as const;

/** Quotes a string as a TOML value for use in `codex -c key=value` CLI overrides. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

type ThreadItem = {
  type: string;
  server?: string;
  tool?: string;
};

type RunningTask = {
  taskId: string;
  threadId: string;
  turnId?: string;
  client: CodexAppServerClient;
  emit: (event: AgentEvent) => void;
  settle: (outcome: { kind: "completed" | "interrupted" } | { kind: "error"; message: string }) => void;
};

/**
 * Attempts to read and parse ~/.codex/models_cache.json. Returns an empty
 * array on any error (file missing, parse failure, etc).
 */
function readModelsCacheFile(): ModelOption[] {
  try {
    const cacheFile = path.join(homedir(), ".codex", "models_cache.json");
    const content = readFileSync(cacheFile, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed: unknown = JSON.parse(content);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "models" in parsed &&
      Array.isArray(parsed.models)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return parsed.models
        .filter((m: unknown) => m !== null && typeof m === "object" && "slug" in m && "display_name" in m)
        .map((m: Record<string, unknown>) => ({
          id: String(m.slug),
          label: String(m.display_name),
        }));
    }
  } catch {
    // Intentional: treat any read/parse error as cache miss, fall through to fallback
  }
  return [];
}

export function createCodexAdapter(config: { bridgeUrl: string; bridgeToken: string }): AgentAdapter {
  // Keyed by threadId (not taskId) because server-initiated requests and
  // notifications from `codex app-server` only carry a threadId, never our
  // taskId. In practice there is at most one entry at a time -- the bridge
  // never runs more than one active task (see state.ts's single-flight
  // active-task registry) -- but keying by threadId is what lets the
  // notification/server-request handlers below find the right task at all.
  const tasksByThread = new Map<string, RunningTask>();

  return {
    id: "codex",

    async checkReady() {
      try {
        // Check installation via `codex --version`
        const versionResult = spawnSync("codex", ["--version"], { encoding: "utf8" });
        if (versionResult.error && (versionResult.error as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            installed: false,
            authenticated: "unknown",
            message: "codex CLI is not installed",
          };
        }

        // Check authentication via `codex login status`
        const statusResult = spawnSync("codex", ["login", "status"], { encoding: "utf8" });
        const authenticated = statusResult.status === 0;

        return {
          installed: true,
          authenticated,
          ...(versionResult.stdout ? { version: versionResult.stdout.trim().split("\n")[0] } : {}),
        };
      } catch (err) {
        return {
          installed: false,
          authenticated: "unknown",
          message: (err as Error).message,
        };
      }
    },

    async listModels(): Promise<ModelOption[]> {
      const cached = readModelsCacheFile();
      if (cached.length > 0) {
        return cached;
      }

      // Fallback to hardcoded models for fresh installs that haven't cached yet
      return [
        { id: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
        { id: "gpt-4o-codex", label: "GPT-4o Codex" },
      ];
    },

    async startTask(input: StartTaskInput, emit: (event: AgentEvent) => void) {
      // A fresh app-server process (and thread) per task -- there is no
      // multi-task/multi-mode session reuse in this bridge (see
      // resetSession() below), so there's nothing to gain from keeping the
      // process alive between tasks, and a lot to gain from not leaking one:
      // each task gets its own process that is disposed in `finally`.
      const client = new CodexAppServerClient({
        args: [
          "app-server",
          "-c",
          `mcp_servers.${MCP_SERVER_NAME}.command=${tomlString(nodeExecutable())}`,
          "-c",
          `mcp_servers.${MCP_SERVER_NAME}.args=${JSON.stringify([mcpServerEntryPath()])}`,
          "-c",
          `mcp_servers.${MCP_SERVER_NAME}.env.${VIBEE_BRIDGE_URL_ENV}=${tomlString(config.bridgeUrl)}`,
          "-c",
          `mcp_servers.${MCP_SERVER_NAME}.env.${VIBEE_BRIDGE_TOKEN_ENV}=${tomlString(config.bridgeToken)}`,
        ],
        onNotification: (notification) => handleNotification(notification.method, notification.params),
        onServerRequest: (request) => handleServerRequest(request),
        onExit: (code, signal) => {
          const task = [...tasksByThread.values()].find((t) => t.taskId === input.taskId);
          task?.settle({ kind: "error", message: `codex app-server exited unexpectedly (code=${code} signal=${signal})` });
        },
      });

      function handleServerRequest(request: ServerRequest): Promise<unknown> {
        if (request.method === "mcpServer/elicitation/request") {
          const params = request.params as { serverName?: string } | undefined;
          // This is the actual fix for the MCP-tool-call rejection bug: with
          // APPROVAL_POLICY routing only MCP elicitations to us, we can
          // scope acceptance to our own registered server ("vibee") and
          // decline everything else, rather than blanket-approving.
          const isOurServer = params?.serverName === MCP_SERVER_NAME;
          return Promise.resolve({
            action: isOurServer ? "accept" : "decline",
            content: isOurServer ? {} : null,
            _meta: null,
          });
        }

        // Shouldn't normally arrive given APPROVAL_POLICY (command/patch
        // approval is turned off there), but deny defensively rather than
        // leave the server request unanswered, which would stall the turn.
        switch (request.method) {
          case "item/commandExecution/requestApproval":
          case "item/fileChange/requestApproval":
          case "item/permissions/requestApproval":
          case "execCommandApproval":
          case "applyPatchApproval":
            return Promise.resolve({ decision: "denied" });
          default:
            return Promise.resolve({});
        }
      }

      function handleNotification(method: string, rawParams: unknown): void {
        const params = (rawParams ?? {}) as {
          threadId?: string;
          delta?: string;
          item?: ThreadItem;
          turn?: { status?: string; error?: { message?: string } };
          error?: { message?: string };
        };

        const task = params.threadId ? tasksByThread.get(params.threadId) : undefined;
        if (!task) return;

        switch (method) {
          case "item/agentMessage/delta":
            if (params.delta) task.emit({ type: "agent.message.delta", taskId: task.taskId, text: params.delta });
            break;

          case "item/completed":
            if (params.item?.type === "mcpToolCall" && params.item.server && params.item.tool) {
              task.emit({
                type: "mcp.tool.called",
                taskId: task.taskId,
                tool: `${params.item.server}__${params.item.tool}`,
              });
            }
            break;

          case "turn/completed": {
            const status = params.turn?.status ?? "completed";
            if (status === "interrupted") {
              task.settle({ kind: "interrupted" });
            } else if (status === "failed") {
              const message = params.turn?.error?.message ?? "Codex turn failed";
              task.settle({ kind: "error", message });
            } else {
              task.emit({ type: "task.completed", taskId: task.taskId });
              task.settle({ kind: "completed" });
            }
            break;
          }

          case "error": {
            const message = params.error?.message ?? "Codex reported an error";
            task.settle({ kind: "error", message });
            break;
          }

          default:
            // item/started, reasoning, commandExecution, fileChange,
            // webSearch, etc -- no AgentEvent mapping needed for MVP.
            break;
        }
      }

      try {
        await client.start();

        const started = (await client.request("thread/start", {
          cwd: input.projectPath,
          approvalPolicy: APPROVAL_POLICY,
          sandbox: "read-only",
        })) as { thread: { id: string } };
        const threadId = started.thread.id;

        const settled = new Promise<"completed" | "interrupted" | "error">((resolve) => {
          const task: RunningTask = {
            taskId: input.taskId,
            threadId,
            client,
            emit,
            settle: (outcome) => {
              tasksByThread.delete(threadId);
              if (outcome.kind === "error") {
                emit({ type: "task.error", taskId: input.taskId, message: outcome.message });
              }
              resolve(outcome.kind === "error" ? "error" : outcome.kind);
            },
          };
          tasksByThread.set(threadId, task);
        });

        emit({ type: "task.started", taskId: input.taskId });

        const turn = (await client.request("turn/start", {
          threadId,
          input: [{ type: "text", text: input.prompt, text_elements: [] }],
          cwd: input.projectPath,
          approvalPolicy: APPROVAL_POLICY,
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          ...(input.model !== undefined ? { model: input.model } : {}),
        })) as { turn: { id: string } };

        const task = tasksByThread.get(threadId);
        if (task) task.turnId = turn.turn.id;

        return await settled;
      } catch (err) {
        emit({ type: "task.error", taskId: input.taskId, message: (err as Error).message });
        return "error";
      } finally {
        await client.dispose();
      }
    },

    async stopTask(taskId: string) {
      const task = [...tasksByThread.values()].find((t) => t.taskId === taskId);
      if (!task?.turnId) return;
      // If the client already tore down (task settled/errored between the
      // lookup above and here), the request below simply rejects -- that's
      // fine, there's nothing left to interrupt.
      await task.client.request("turn/interrupt", { threadId: task.threadId, turnId: task.turnId }).catch(() => {});
    },

    resetSession(_projectPath: string) {
      // Intentional no-op, not an oversight: every startTask() call already
      // starts a brand-new CodexAppServerClient and thread with no
      // resume/resume option, so this adapter never resumes a prior session
      // in the first place. "never resume a session" (docs/v1_plan.md 4.5 /
      // roadmap 7-b) is a hard correctness rule for the future
      // incremental-analysis design -- this method exists now, as a no-op,
      // specifically so that rule holds by construction (there is a
      // well-defined place to put real session-reset logic if some future
      // code path ever needs one) instead of holding only by convention
      // someone could accidentally break by adding a resume option to
      // startTask without touching this file.
    },
  };
}
