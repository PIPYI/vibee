import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentEvent, ModelOption } from "@vibee/protocol";
import { VIBEE_BRIDGE_TOKEN_ENV, VIBEE_BRIDGE_URL_ENV } from "@vibee/protocol";
import { mcpServerEntryPath, nodeExecutable } from "../../platform.js";
import type { AgentAdapter, StartTaskInput } from "../types.js";
import { CodexAppServerClient, type ServerRequest } from "./appServerClient.js";

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
  projectPath: string;
  exploredFiles: Set<string>;
  turnId?: string;
  emit: (event: AgentEvent) => void;
  settle: (outcome: "completed" | "interrupted" | "error", message?: string) => void;
};

type CodexModel = {
  id: string;
  displayName: string;
};

type CodexCommandAction =
  | { type: "read"; path: string }
  | { type: "listFiles"; path: string | null }
  | { type: "search"; path: string | null }
  | { type: "unknown" };

type ThreadItem = {
  type: string;
  command?: string;
  server?: string;
  tool?: string;
  commandActions?: CodexCommandAction[];
};

type RawResponseItem = {
  type: string;
  name?: string;
  input?: string;
};

/** Returns only structured Codex read targets that stay inside the analyzed project. */
export function exploredFilesFromCommandActions(
  actions: readonly CodexCommandAction[] | undefined,
  projectPath: string,
): string[] {
  const files = new Set<string>();
  for (const action of actions ?? []) {
    if (action.type !== "read") continue;
    const absolutePath = path.resolve(projectPath, action.path);
    const relativePath = path.relative(projectPath, absolutePath);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      continue;
    }
    files.add(absolutePath);
  }
  return [...files];
}

function stringProperties(source: string, property: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`(?:"${property}"|${property})\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`, "g");
  for (const match of source.matchAll(pattern)) {
    const literal = match[1];
    if (!literal) continue;
    try {
      values.push(JSON.parse(literal) as string);
    } catch {
      // Ignore malformed code-mode input instead of evaluating model-authored JavaScript.
    }
  }
  return values;
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      word += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else word += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character) || ";&|()".includes(character)) {
      if (word) words.push(word);
      word = "";
    } else {
      word += character;
    }
  }
  if (word) words.push(word);
  return words;
}

/** Extracts existing project files named in code-mode exec_command calls without evaluating their JavaScript. */
export function exploredFilesFromExecInput(input: string, projectPath: string): string[] {
  const bases = new Set([path.resolve(projectPath)]);
  for (const workdir of stringProperties(input, "workdir")) {
    const absoluteWorkdir = path.resolve(projectPath, workdir);
    const relativeWorkdir = path.relative(projectPath, absoluteWorkdir);
    if (relativeWorkdir !== ".." && !relativeWorkdir.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeWorkdir)) {
      bases.add(absoluteWorkdir);
    }
  }

  const files = new Set<string>();
  for (const command of stringProperties(input, "cmd")) {
    for (const word of shellWords(command)) {
      if (!word || word.startsWith("-")) continue;
      for (const base of bases) {
        const absolutePath = path.resolve(base, word);
        const relativePath = path.relative(projectPath, absolutePath);
        if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
          continue;
        }
        try {
          if (statSync(absolutePath).isFile()) files.add(absolutePath);
        } catch {
          // Shell words are only candidates; most are commands, flags, or search expressions.
        }
      }
    }
  }
  return [...files];
}

export function mcpToolsFromExecInput(input: string): string[] {
  const tools = new Set<string>();
  for (const match of input.matchAll(/tools\.(mcp__vibee__[a-zA-Z0-9_]+)\s*\(/g)) {
    if (match[1]) tools.add(match[1]);
  }
  return [...tools];
}

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
      item?: ThreadItem;
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
        if (params.item) emitItem(task, params.item);
        break;
      case "rawResponseItem/completed":
        if (params.item) emitRawResponseItem(task, params.item);
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

  function emitItem(task: RunningTask, item: ThreadItem): void {
    if (item.type === "mcpToolCall" && item.tool) {
      task.emit({ type: "mcp.tool.called", taskId: task.taskId, tool: item.tool });
      return;
    }
    if (item.type !== "commandExecution") return;
    for (const filePath of exploredFilesFromCommandActions(item.commandActions, task.projectPath)) {
      emitExploredFile(task, filePath);
    }
  }

  function emitRawResponseItem(task: RunningTask, item: RawResponseItem): void {
    if (item.type !== "custom_tool_call" || item.name !== "exec" || !item.input) return;
    for (const filePath of exploredFilesFromExecInput(item.input, task.projectPath)) emitExploredFile(task, filePath);
    for (const tool of mcpToolsFromExecInput(item.input)) {
      task.emit({ type: "mcp.tool.called", taskId: task.taskId, tool });
    }
  }

  function emitExploredFile(task: RunningTask, filePath: string): void {
    if (task.exploredFiles.has(filePath)) return;
    task.exploredFiles.add(filePath);
    task.emit({ type: "agent.file.explored", taskId: task.taskId, path: filePath });
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
        onNotification: (notification) => handleNotification(notification.method, notification.params),
        onServerRequest: handleRequest,
        onStderr: (chunk) => console.error(`[codex] ${chunk.trimEnd()}`),
        onExit: (code, signal) => {
          client = null;
          starting = null;
          failRunningTasks(`Codex app-server exited (code=${code} signal=${signal})`);
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
            projectPath: input.projectPath,
            exploredFiles: new Set(),
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
