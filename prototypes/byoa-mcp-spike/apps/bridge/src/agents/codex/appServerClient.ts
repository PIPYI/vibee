/**
 * stdio 위에서 `codex app-server`와 통신하는 최소한의 JSON-RPC 클라이언트.
 *
 * 범위를 일부러 좁게 잡았다. 여기는 *agent control 채널*만 담당한다 (spike 문서 §1.2 A).
 * 앱 상태나 MCP에 대해서는 아무것도 모른다.
 *
 * Codex 프로토콜 객체는 여기서 멈춘다. 위층의 adapter가 provider 중립인 AgentEvent
 * union으로 번역한 뒤에야 브라우저에 도달한다.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import { cliSpawnOptions, isWindows, killTree } from "../../platform.js";

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
   * server -> client 요청(승인 프롬프트, elicitation)이 왔을 때 호출된다.
   * JSON-RPC `result`에 실을 payload를 resolve 해야 한다.
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

  /** 프로세스를 띄우고 `initialize`/`initialized` 핸드셰이크를 마친다. */
  async start(): Promise<{ userAgent: string; codexHome: string }> {
    if (this.child) throw new Error("CodexAppServerClient already started");

    const command = this.options.command ?? "codex";
    const args = this.options.args ?? ["app-server"];
    // 윈도우에서는 codex가 .cmd 래퍼라 shell을 거쳐야 한다 (platform.ts 참고).
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], ...cliSpawnOptions });
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
      clientInfo: { name: "byoa-mcp-spike-bridge", title: "BYOA MCP Spike Bridge", version: "0.1.0" },
      // thread/*, turn/* 는 experimental API 뒤에 있다.
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

    // 우리가 보낸 요청에 대한 응답.
    if (message.id !== undefined && message.method === undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.message} (code ${message.error.code})`));
      else waiter.resolve(message.result);
      return;
    }

    // 서버가 보낸 요청. 응답하지 않으면 turn이 멈춘다.
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
    this.failAllPending(new Error("bridge is shutting down"));
    this.reader?.close();
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      child.stdin.end();
      // 윈도우에서는 우리가 아는 pid가 cmd.exe라 트리째 정리해야 agent가 고아로 남지 않는다.
      void killTree(child);
      // 시그널이 무시되는 경우에도 app-server가 남지 않도록 한다 (§19 cleanup).
      setTimeout(() => {
        if (child.exitCode === null && !isWindows) child.kill("SIGKILL");
        resolve();
      }, 2000).unref();
    });
  }
}
