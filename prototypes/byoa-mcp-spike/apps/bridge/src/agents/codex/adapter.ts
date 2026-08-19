/**
 * Codex adapter. `codex app-server`를 구동하고, 그 알림을 AgentEvent union으로 정규화한다.
 *
 * 여기서 OpenAI 모델 API를 직접 호출하는 일은 없다. 추론은 사용자가 이미 설치하고
 * 로그인해 둔 Codex CLI가 담당하며, 우리는 turn을 시작하고 그 결과 이벤트 스트림을 읽을 뿐이다.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { MCP_SERVER_NAME, type AgentEvent, type AgentReadiness } from "@byoa/protocol";

import type { AgentAdapter, StartTaskInput, TaskOutcome } from "../types.js";
import { CodexAppServerClient, type ServerRequest } from "./appServerClient.js";

const execFileAsync = promisify(execFile);

type ThreadItem = {
  type: string;
  id: string;
  command?: string;
  server?: string;
  tool?: string;
  status?: unknown;
  changes?: Array<{ path?: string }>;
  text?: string;
};

type RunningTask = {
  taskId: string;
  threadId: string;
  turnId?: string;
  emit: (event: AgentEvent) => void;
  settle: (outcome: { kind: TaskOutcome } | { kind: "error"; message: string }) => void;
};

/**
 * 승인 정책.
 *
 * `"never"`를 쓰면 안 된다. Codex 0.148부터 `"never"`는 MCP tool 호출을 아예 거부한다
 * (`MCP tool call requires approval, but approval policy is never`). 0.147까지는 같은 설정에서도
 * elicitation으로 물어봤다. 자세한 경위는 SPIKE_FINDINGS.md Finding 4.
 *
 * granular 형태로 **MCP elicitation만 켜고 나머지 승인은 모두 끈다.** 그러면 command/patch는
 * 샌드박스 안에서 승인 없이 진행되고, MCP tool 호출만 우리에게 물어보므로
 * `handleServerRequest`에서 `byoa-spike` 서버에 한해 수락할 수 있다.
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

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;

  private client: CodexAppServerClient | null = null;
  private starting: Promise<CodexAppServerClient> | null = null;
  /** 프로젝트 디렉터리당 thread 하나. 여러 turn에 걸쳐 재사용한다 (문서 §7). */
  private readonly threadsByProject = new Map<string, string>();
  private readonly tasksByThread = new Map<string, RunningTask>();

  constructor(private readonly log: (...args: unknown[]) => void) {}

  async checkReady(): Promise<AgentReadiness> {
    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync("codex", ["--version"]);
      version = stdout.trim();
    } catch {
      return {
        agent: "codex",
        installed: false,
        authenticated: false,
        message: "Codex is not ready. Install the Codex CLI and log in first.",
      };
    }

    try {
      const client = await this.ensureClient();
      const account = (await client.request("account/read", {})) as {
        account: { type?: string } | null;
        requiresOpenaiAuth?: boolean;
      };
      const authenticated = account.account !== null || account.requiresOpenaiAuth === false;
      return {
        agent: "codex",
        installed: true,
        authenticated,
        version,
        // 이메일이나 credential은 일부러 담지 않는다. 브라우저가 알 필요가 없다.
        message: authenticated ? undefined : "Codex is not ready. Please log in with `codex login`.",
      };
    } catch (error) {
      return {
        agent: "codex",
        installed: true,
        authenticated: "unknown",
        version,
        message: `Could not query Codex auth status: ${asMessage(error)}`,
      };
    }
  }

  private async ensureClient(): Promise<CodexAppServerClient> {
    if (this.client) return this.client;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const client = new CodexAppServerClient({
        onNotification: (notification) => this.handleNotification(notification.method, notification.params),
        onServerRequest: (request) => this.handleServerRequest(request),
        onStderr: (chunk) => this.log("[codex stderr]", chunk.trimEnd()),
        onExit: (code, signal) => {
          this.log(`codex app-server exited (code=${code} signal=${signal})`);
          this.client = null;
          this.starting = null;
          this.threadsByProject.clear();
          for (const task of this.tasksByThread.values()) {
            task.settle({ kind: "error", message: "codex app-server exited unexpectedly" });
          }
          this.tasksByThread.clear();
        },
      });
      const info = await client.start();
      this.log(`codex app-server ready (${info.userAgent})`);
      this.client = client;
      return client;
    })();

    try {
      return await this.starting;
    } catch (error) {
      this.starting = null;
      throw error;
    }
  }

  async startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome> {
    const client = await this.ensureClient();
    const threadId = await this.ensureThread(client, input.projectPath);

    const settled = new Promise<TaskOutcome>((resolve, reject) => {
      const task: RunningTask = {
        taskId: input.taskId,
        threadId,
        emit,
        settle: (outcome) => {
          this.tasksByThread.delete(threadId);
          if (outcome.kind === "error") reject(new Error(outcome.message));
          else resolve(outcome.kind);
        },
      };
      this.tasksByThread.set(threadId, task);
    });

    const turn = (await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: input.prompt, text_elements: [] }],
      cwd: input.projectPath,
      approvalPolicy: APPROVAL_POLICY,
      // agent의 쓰기를 사용자가 선택한 디렉터리 안으로 제한한다 (문서 §17).
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [input.projectPath],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    })) as { turn: { id: string } };

    const task = this.tasksByThread.get(threadId);
    if (task) task.turnId = turn.turn.id;

    return settled;
  }

  private async ensureThread(client: CodexAppServerClient, projectPath: string): Promise<string> {
    const existing = this.threadsByProject.get(projectPath);
    if (existing) return existing;

    const started = (await client.request("thread/start", {
      cwd: projectPath,
      approvalPolicy: APPROVAL_POLICY,
      sandbox: "workspace-write",
    })) as { thread: { id: string } };

    this.threadsByProject.set(projectPath, started.thread.id);
    return started.thread.id;
  }

  async stopTask(taskId: string): Promise<void> {
    const entry = [...this.tasksByThread.values()].find((task) => task.taskId === taskId);
    if (!entry?.turnId || !this.client) return;
    await this.client.request("turn/interrupt", { threadId: entry.threadId, turnId: entry.turnId });
  }

  /**
   * server -> client 요청. 성격이 다른 두 가지가 여기로 들어온다.
   *
   * 1. MCP tool 호출 승인. Codex 0.147은 이것을 `_meta.codex_approval_kind = "mcp_tool_call"`이
   *    붙은 `mcpServer/elicitation/request`로 보낸다. `approvalPolicy: "never"`가 적용되지
   *    않으므로 클라이언트가 반드시 응답해야 하며, 응답하지 않으면 거부로 처리된다.
   *    이 spike가 직접 등록한 서버에 대해서만 수락하고, 사용자가 따로 설정해 둔 다른 MCP
   *    서버의 요청은 거부한다.
   *
   * 2. command/patch 승인. `approvalPolicy: "never"`에서는 오지 않아야 한다. 그래도 온다면
   *    조용히 샌드박스를 넓히는 대신 거부하고 이벤트로 드러낸다.
   */
  private async handleServerRequest(request: ServerRequest): Promise<unknown> {
    const params = request.params as
      | { threadId?: string; serverName?: string; message?: string }
      | undefined;
    const task = params?.threadId ? this.tasksByThread.get(params.threadId) : undefined;

    if (request.method === "mcpServer/elicitation/request") {
      const isSpikeServer = params?.serverName === MCP_SERVER_NAME;
      this.log(
        `mcp elicitation from "${params?.serverName}" -> ${isSpikeServer ? "accept" : "decline"}: ${params?.message ?? ""}`,
      );
      task?.emit({
        type: "agent.action.completed",
        taskId: task.taskId,
        name: isSpikeServer ? "mcp.approval.accepted" : "mcp.approval.declined",
        detail: { server: params?.serverName },
      });
      return { action: isSpikeServer ? "accept" : "decline", content: isSpikeServer ? {} : null, _meta: null };
    }

    this.log(`unexpected approval request from codex: ${request.method} (denied)`);
    task?.emit({
      type: "agent.action.completed",
      taskId: task.taskId,
      name: "approval.denied",
      detail: { method: request.method },
    });

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

  private handleNotification(method: string, rawParams: unknown): void {
    const params = (rawParams ?? {}) as {
      threadId?: string;
      turnId?: string;
      turn?: { id: string; status?: string; error?: { message?: string } };
      item?: ThreadItem;
      delta?: string;
      error?: { message?: string };
    };

    const task = params.threadId ? this.tasksByThread.get(params.threadId) : undefined;
    if (!task) return;

    switch (method) {
      case "turn/started":
        if (params.turn) task.turnId = params.turn.id;
        break;

      case "item/agentMessage/delta":
        if (params.delta) task.emit({ type: "agent.message.delta", taskId: task.taskId, text: params.delta });
        break;

      case "item/started":
        if (params.item) this.emitItem(task, params.item, "started");
        break;

      case "item/completed":
        if (params.item) this.emitItem(task, params.item, "completed");
        break;

      case "turn/completed": {
        const status = params.turn?.status ?? "completed";
        if (status === "interrupted") task.settle({ kind: "interrupted" });
        else if (status === "failed") {
          task.settle({ kind: "error", message: params.turn?.error?.message ?? "Codex turn failed" });
        } else task.settle({ kind: "completed" });
        break;
      }

      case "error":
        task.settle({ kind: "error", message: params.error?.message ?? "Codex reported an error" });
        break;

      default:
        break;
    }
  }

  private emitItem(task: RunningTask, item: ThreadItem, phase: "started" | "completed"): void {
    // mcpToolCall 아이템은 Codex 자신이 우리 MCP server를 호출했다고 남긴 기록이다.
    // 우리 HTTP 엔드포인트와 무관한, agent 스트림에서 나온 1차 증거다.
    if (item.type === "mcpToolCall" && phase === "started" && item.tool) {
      task.emit({ type: "mcp.tool.called", taskId: task.taskId, tool: item.tool, source: "agent-stream" });
    }

    const name = describeItem(item);
    if (!name) return;

    task.emit(
      phase === "started"
        ? { type: "agent.action.started", taskId: task.taskId, name, detail: detailFor(item) }
        : { type: "agent.action.completed", taskId: task.taskId, name, detail: detailFor(item) },
    );
  }

  async dispose(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.starting = null;
    this.tasksByThread.clear();
    this.threadsByProject.clear();
    await client?.dispose();
  }
}

function describeItem(item: ThreadItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return "command";
    case "fileChange":
      return "fileChange";
    case "mcpToolCall":
      return `mcp:${item.server ?? "?"}/${item.tool ?? "?"}`;
    case "webSearch":
      return "webSearch";
    case "reasoning":
    case "agentMessage":
    case "userMessage":
      return null;
    default:
      return item.type;
  }
}

function detailFor(item: ThreadItem): unknown {
  switch (item.type) {
    case "commandExecution":
      return { command: item.command };
    case "fileChange":
      return { files: (item.changes ?? []).map((change) => change.path).filter(Boolean) };
    case "mcpToolCall":
      return { server: item.server, tool: item.tool };
    default:
      return undefined;
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
