/**
 * `codex app-server` JSON-RPC 클라이언트 (stdio).
 *
 * **OS를 알지 않는다** — spawn 방법은 `../../platform.js`가 정한다.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import { killTree, resolveAgentExecutable } from "../../platform.js";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export type Notification = { method: string; params: unknown };

/** server -> client 요청. elicitation 승인이 이 경로로 온다 (B3). */
export type ServerRequest = { id: number | string; method: string; params: unknown };

export class AppServerClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private reader: Interface | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();

  constructor(
    private readonly onNotification: (notification: Notification) => void,
    private readonly onServerRequest: (request: ServerRequest) => unknown,
  ) {}

  start(): void {
    if (this.child) return;
    const spec = resolveAgentExecutable("codex");
    // 인자는 전부 상수 문자열이다. 셸을 켜는 플랫폼에서도 사용자 입력이 섞이지 않는다.
    this.child = spawn(spec.command, ["app-server"], {
      ...spec.spawnOptions,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error("[codex]", text);
    });

    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on("line", (line) => this.handleLine(line));

    this.child.on("exit", (code, signal) => {
      const error = new Error(`codex app-server 가 종료되었습니다 (code ${code}, signal ${signal})`);
      for (const [, call] of this.pending) call.reject(error);
      this.pending.clear();
      this.child = undefined;
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      console.error("[codex] JSON 이 아닌 줄:", trimmed.slice(0, 200));
      return;
    }

    // 응답
    if (message["id"] !== undefined && message["method"] === undefined) {
      const call = this.pending.get(Number(message["id"]));
      if (!call) return;
      this.pending.delete(Number(message["id"]));
      if (message["error"]) {
        const detail = message["error"] as { message?: string; code?: number };
        call.reject(new Error(`${detail.message ?? "알 수 없는 오류"} (code ${detail.code ?? "?"})`));
      } else {
        call.resolve(message["result"]);
      }
      return;
    }

    // server -> client 요청
    if (message["id"] !== undefined && message["method"] !== undefined) {
      const result = this.onServerRequest({
        id: message["id"] as number | string,
        method: String(message["method"]),
        params: message["params"],
      });
      this.write({ jsonrpc: "2.0", id: message["id"], result });
      return;
    }

    // 알림
    if (message["method"] !== undefined) {
      this.onNotification({ method: String(message["method"]), params: message["params"] });
    }
  }

  private write(payload: unknown): void {
    this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  call(method: string, params?: unknown): Promise<unknown> {
    this.start();
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.start();
    this.write({ jsonrpc: "2.0", method, params });
  }

  dispose(): void {
    this.reader?.close();
    // 셸을 거쳐 띄운 플랫폼에서는 트리째 정리해야 agent 가 고아로 남지 않는다.
    killTree(this.child?.pid);
    this.child = undefined;
  }
}
