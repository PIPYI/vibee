import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentEvent, ModelOption } from "@vibee/protocol";
import { VIBEE_BRIDGE_TOKEN_ENV, VIBEE_BRIDGE_URL_ENV } from "@vibee/protocol";
import { mcpServerEntryPath, nodeExecutable } from "../../platform.js";
import type { AgentAdapter, StartTaskInput } from "../types.js";
import { CodexAppServerClient, type ServerRequest } from "./app-server-client.js";

const execFileAsync = promisify(execFile);
const MCP_SERVER_NAME = "vibee";

const APPROVAL_POLICY = {
  granular: {
    sandbox_approval: false,
    rules: false,
    skill_approval: false,
    request_permissions: false,
    mcp_elicitations: true,
  },
} as const;

type RunningTask = {
  taskId: string;
  threadId: string;
  turnId?: string;
  emit: (event: AgentEvent) => void;
  settle: (outcome: "completed" | "interrupted" | "error", message?: string) => void;
};

type CodexModel = {
  id: string;
  displayName: string;
};

function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function createCodexAdapter(config: { bridgeUrl: string; bridgeToken: string }): AgentAdapter {
  let client: CodexAppServerClient | null = null;
  let starting: Promise<CodexAppServerClient> | null = null;
  const tasksByThread = new Map<string, RunningTask>();

  function failRunningTasks(message: string): void {
    for (const task of [...tasksByThread.values()]) task.settle("error", message);
    tasksByThread.clear();
  }

  async function handleRequest(request: ServerRequest): Promise<unknown> {
    const params = request.params as { serverName?: string } | undefined;
    if (request.method === "mcpServer/elicitation/request") {
      const allowed = params?.serverName === MCP_SERVER_NAME;
      return { action: allowed ? "accept" : "decline", content: allowed ? {} : null, _meta: null };
    }

    switch (request.method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      case "item/permissions/requestApproval":
      case "execCommandApproval":
      case "applyPatchApproval":
        return { decision: "denied" };
      default:
        return {};
    }
  }

  function handleNotification(method: string, rawParams: unknown): void {
    const params = (rawParams ?? {}) as {
      threadId?: string;
      delta?: string;
      turn?: { id: string; status?: string; error?: { message?: string } };
      item?: { type?: string; tool?: string };
      error?: { message?: string };
    };
    const task = params.threadId ? tasksByThread.get(params.threadId) : undefined;
    if (!task) return;

    switch (method) {
      case "turn/started":
        if (params.turn) task.turnId = params.turn.id;
        break;
      case "item/agentMessage/delta":
        if (params.delta) task.emit({ type: "agent.message.delta", taskId: task.taskId, text: params.delta });
        break;
      case "item/started":
        if (params.item?.type === "mcpToolCall" && params.item.tool) {
          task.emit({ type: "mcp.tool.called", taskId: task.taskId, tool: params.item.tool });
        }
        break;
      case "turn/completed": {
        const status = params.turn?.status ?? "completed";
        if (status === "interrupted") task.settle("interrupted");
        else if (status === "failed") task.settle("error", params.turn?.error?.message ?? "Codex turn failed");
        else task.settle("completed");
        break;
      }
      case "error":
        task.settle("error", params.error?.message ?? "Codex reported an error");
        break;
    }
  }

  async function ensureClient(): Promise<CodexAppServerClient> {
    if (client) return client;
    if (starting) return starting;

    const args = [
      "app-server",
      "-c", `mcp_servers.${MCP_SERVER_NAME}.command=${tomlString(nodeExecutable())}`,
      "-c", `mcp_servers.${MCP_SERVER_NAME}.args=${JSON.stringify([mcpServerEntryPath()])}`,
      "-c", `mcp_servers.${MCP_SERVER_NAME}.env.${VIBEE_BRIDGE_URL_ENV}=${tomlString(config.bridgeUrl)}`,
      "-c", `mcp_servers.${MCP_SERVER_NAME}.env.${VIBEE_BRIDGE_TOKEN_ENV}=${tomlString(config.bridgeToken)}`,
    ];

    starting = (async () => {
      const next = new CodexAppServerClient({
        args,
        onNotification: handleNotification,
        onRequest: handleRequest,
        onExit: (message) => {
          client = null;
          starting = null;
          failRunningTasks(message);
        },
      });
      await next.start();
      client = next;
      return next;
    })();

    try {
      return await starting;
    } catch (error) {
      starting = null;
      throw error;
    }
  }

  return {
    id: "codex",

    async checkReady() {
      let version: string | undefined;
      try {
        const result = await execFileAsync("codex", ["--version"]);
        version = result.stdout.trim();
      } catch {
        return {
          installed: false,
          authenticated: false,
          message: "Codex CLI를 찾지 못했습니다. Codex를 설치하거나 PATH를 확인해 주세요.",
        };
      }

      try {
        const activeClient = await ensureClient();
        const result = (await activeClient.request("account/read", {})) as {
          account: unknown | null;
          requiresOpenaiAuth?: boolean;
        };
        const authenticated = result.account !== null || result.requiresOpenaiAuth === false;
        return {
          installed: true,
          authenticated,
          version,
          ...(authenticated ? {} : { message: "Codex CLI에서 먼저 로그인해 주세요 (`codex login`)." }),
        };
      } catch (error) {
        return {
          installed: true,
          authenticated: "unknown",
          version,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listModels(): Promise<ModelOption[]> {
      const activeClient = await ensureClient();
      const models: CodexModel[] = [];
      let cursor: string | null = null;
      do {
        const page = (await activeClient.request("model/list", {
          includeHidden: false,
          ...(cursor ? { cursor } : {}),
        })) as { data: CodexModel[]; nextCursor: string | null };
        models.push(...page.data);
        cursor = page.nextCursor;
      } while (cursor);
      return models.map((model) => ({ id: model.id, label: model.displayName || model.id }));
    },

    async startTask(input: StartTaskInput, emit: (event: AgentEvent) => void) {
      emit({ type: "task.started", taskId: input.taskId });
      let threadId: string | undefined;
      try {
        const activeClient = await ensureClient();
        const started = (await activeClient.request("thread/start", {
          cwd: input.projectPath,
          approvalPolicy: APPROVAL_POLICY,
          sandbox: "read-only",
        })) as { thread: { id: string } };
        const currentThreadId = started.thread.id;
        threadId = currentThreadId;

        const outcome = new Promise<"completed" | "interrupted" | "error">((resolve) => {
          const task: RunningTask = {
            taskId: input.taskId,
            threadId: currentThreadId,
            emit,
            settle: (result, message) => {
              if (!tasksByThread.delete(currentThreadId)) return;
              if (result === "completed") emit({ type: "task.completed", taskId: input.taskId });
              if (result === "error") emit({ type: "task.error", taskId: input.taskId, message: message ?? "Codex task failed" });
              resolve(result);
            },
          };
          tasksByThread.set(currentThreadId, task);
        });

        const turn = (await activeClient.request("turn/start", {
          threadId: currentThreadId,
          input: [{ type: "text", text: input.prompt, text_elements: [] }],
          cwd: input.projectPath,
          approvalPolicy: APPROVAL_POLICY,
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          ...(input.model ? { model: input.model } : {}),
        })) as { turn: { id: string } };
        const task = tasksByThread.get(currentThreadId);
        if (task) task.turnId = turn.turn.id;
        return await outcome;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const task = threadId ? tasksByThread.get(threadId) : undefined;
        if (task) task.settle("error", message);
        else emit({ type: "task.error", taskId: input.taskId, message });
        return "error";
      }
    },

    async stopTask(taskId: string) {
      const task = [...tasksByThread.values()].find((candidate) => candidate.taskId === taskId);
      if (!task?.turnId || !client) return;
      await client.request("turn/interrupt", { threadId: task.threadId, turnId: task.turnId });
    },

    resetSession(_projectPath: string) {
      // Every task starts a fresh Codex thread, matching the Claude adapter.
    },
  };
}
