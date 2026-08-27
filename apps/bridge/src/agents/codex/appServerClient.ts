/**
 * Minimal JSON-RPC client over stdio for talking to `codex app-server`.
 *
 * This exists instead of `@openai/codex-sdk` because that package only
 * drives `codex exec` (headless, single-shot mode), and `codex exec`
 * unconditionally rejects any MCP tool call regardless of the configured
 * approval policy ("MCP tool call requires approval, but approval policy is
 * never" -- confirmed hardcoded behavior in Codex 0.148+). `codex app-server`
 * is a persistent JSON-RPC process that instead routes MCP tool calls to us
 * as a server-initiated `mcpServer/elicitation/request`, which we can answer
 * -- see adapter.ts's APPROVAL_POLICY and handleServerRequest for the actual
 * fix. This file only knows JSON-RPC framing; it has no opinion about what
 * methods mean.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type JsonRpcId = number | string;

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type ServerNotification = { method: string; params: unknown };
export type ServerRequest = { id: JsonRpcId; method: string; params: unknown };

export type CodexAppServerClientOptions = {
  command?: string;
  args?: string[];
  onNotification: (notification: ServerNotification) => void;
  /**
   * Called for server -> client requests (approval prompts, elicitations).
   * Must resolve to the payload that goes back as the JSON-RPC `result`.
   */
  onServerRequest: (request: ServerRequest) => Promise<unknown>;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private nextId = 0;
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private disposed = false;

  constructor(private readonly options: CodexAppServerClientOptions) {}

  /** Spawns the process and completes the `initialize`/`initialized` handshake. */
  async start(): Promise<{ userAgent: string; codexHome: string }> {
    if (this.child) throw new Error("CodexAppServerClient already started");

    const command = this.options.command ?? "codex";
    const args = this.options.args ?? ["app-server"];
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    child.on("error", (error) => this.failAllPending(new Error(`codex app-server failed to start: ${error.message}`)));
    child.on("exit", (code, signal) => {
      this.failAllPending(new Error(`codex app-server exited (code=${code} signal=${signal})`));
      this.options.onExit?.(code, signal);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.options.onStderr?.(chunk));

    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));

    const initialize = (await this.request("initialize", {
      clientInfo: { name: "vibee-bridge", title: "Vibee Bridge", version: "0.1.0" },
      // thread/* and turn/* live behind the experimental API.
      capabilities: { experimentalApi: true, requestAttestation: false },
    })) as { userAgent: string; codexHome: string };

    this.notify("initialized", {});
    return initialize;
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      this.options.onStderr?.(`[unparsed stdout] ${trimmed}\n`);
      return;
    }

    // Response to a request we sent.
    if (message.id !== undefined && message.method === undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (code ${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }

    // A request from the server. Not responding to it stalls the turn.
    if (message.id !== undefined && message.method) {
      const request: ServerRequest = { id: message.id, method: message.method, params: message.params };
      void this.options
        .onServerRequest(request)
        .then((result) => this.send({ jsonrpc: "2.0", id: request.id, result }))
        .catch((error: unknown) =>
          this.send({
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
          }),
        );
      return;
    }

    if (message.method) {
      this.options.onNotification({ method: message.method, params: message.params });
    }
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.child || this.disposed) return Promise.reject(new Error("codex app-server is not running"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: JsonRpcMessage): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAllPending(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.failAllPending(new Error("task is shutting down"));
    this.reader?.close();
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      // In case SIGTERM is ignored, don't leak the process indefinitely.
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 2000).unref();
    });
  }
}
