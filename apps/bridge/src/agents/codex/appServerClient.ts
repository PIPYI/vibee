import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

type JsonRpcId = number | string;

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

export type ServerRequest = { id: JsonRpcId; method: string; params: unknown };
export type ServerNotification = { method: string; params: unknown };

export type CodexAppServerClientOptions = {
  command?: string;
  args?: string[];
  onNotification: (notification: ServerNotification) => void;
  onServerRequest: (request: ServerRequest) => Promise<unknown>;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

/** Minimal newline-delimited JSON-RPC client for `codex app-server`. */
export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private nextId = 0;
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  constructor(private readonly options: CodexAppServerClientOptions) {}

  async start(): Promise<{ userAgent: string; codexHome: string }> {
    const child = spawn(this.options.command ?? "codex", this.options.args ?? ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

    child.on("error", (error) => this.failAll(new Error(`Codex app-server failed to start: ${error.message}`)));
    child.on("exit", (code, signal) => {
      const message = `Codex app-server exited (code=${code} signal=${signal})`;
      this.failAll(new Error(message));
      this.options.onExit?.(code, signal);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => this.options.onStderr?.(chunk));

    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));

    const initialize = (await this.request("initialize", {
      clientInfo: { name: "vibee-bridge", title: "Vibee Bridge", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })) as { userAgent: string; codexHome: string };
    this.notify("initialized", {});
    return initialize;
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error("Codex app-server is not running"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      console.error(`[codex] unparsed stdout: ${line}`);
      return;
    }

    if (message.id !== undefined && message.method === undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (code ${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method) {
      const request = { id: message.id, method: message.method, params: message.params };
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

    if (message.method) this.options.onNotification({ method: message.method, params: message.params });
  }

  private send(message: JsonRpcMessage): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failAll(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}
