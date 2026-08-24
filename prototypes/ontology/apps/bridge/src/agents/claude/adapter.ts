/**
 * Claude adapter.
 *
 * Codex 와 달리 별도 JSON-RPC 클라이언트가 필요 없다 — Agent SDK 의 `query()` 가 그 역할을
 * 대신한다. MCP 등록도 필요 없다: `options.mcpServers` 로 query 마다 직접 넘긴다.
 *
 * **Finding 7 — abort 는 result 메시지가 아니라 예외로 끝난다.** `AbortController.abort()` 를
 * 부르면 async iterator 가 result 를 내지 않고 던진다. 그 예외를 그대로 흘리면 Stop 이
 * `task.error` 가 된다. spike 에서 자동 검증을 빠져나가 수동으로만 발견된 버그다.
 *
 * **Finding 6 — `writableRoots` 에 해당하는 강제가 없다.** Codex 는 OS 샌드박스가 쓰기 범위를
 * 막지만 Claude 에는 대응 옵션이 없다. `canUseTool` 로 검사하되, **`Bash` 로 프로젝트 밖에
 * 쓰는 것은 이 훅 수준에서 막을 수 없다**는 격차가 남는다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type {
  AgentEvent,
  AgentReadiness,
  ModelOption,
  SessionSummary,
} from "@onto/protocol";
import { MCP_SERVER_NAME } from "@onto/protocol";

import { nodeExecutable, probeAgentVersion } from "../../platform.js";
import { describeSession } from "../../prompt.js";
import type { AgentAdapter, StartTaskInput, TaskOutcome } from "../types.js";

/**
 * SDK 는 **선택적 런타임 의존성**이다.
 *
 * 타입을 `typeof import(...)` 로 잡으면 SDK 가 설치되지 않은 환경에서 **빌드 자체가 깨진다.**
 * 그러면 Codex 만 쓰는 사용자도 Claude SDK 를 깔아야 하고, 무엇보다 "설치되지 않았다"를
 * 정직하게 보고할 기회를 잃는다. 그래서 표면만 선언하고 로딩 실패는 `checkReady()` 가 말한다.
 */
type ClaudeSdk = {
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => AsyncIterable<
    Record<string, unknown>
  > & { supportedModels: () => Promise<Array<Record<string, unknown>>> };
};

const SDK_MODULE = "@anthropic-ai/claude-agent-sdk";

/** Claude SDK의 `ModelInfo[]`를 provider 중립 선택지로 바꾼다. */
export function parseClaudeModels(reported: Array<Record<string, unknown>>): ModelOption[] {
  return reported.flatMap((raw) => {
    const id = String(raw["value"] ?? raw["model"] ?? raw["id"] ?? "");
    if (!id) return [];
    const rawEfforts = Array.isArray(raw["supportedEffortLevels"])
      ? raw["supportedEffortLevels"]
      : [];
    const efforts = raw["supportsEffort"] === false
      ? []
      : rawEfforts.flatMap((effort) => typeof effort === "string" && effort ? [{ id: effort }] : []);
    return [{
      id,
      label: String(raw["displayName"] ?? id),
      ...(raw["description"] ? { description: String(raw["description"]) } : {}),
      efforts,
      // Claude가 `default` alias를 모델 목록에 명시적으로 제공한다.
      isDefault: id === "default" || Boolean(raw["isDefault"]),
    } satisfies ModelOption];
  });
}

export type ClaudeAdapterOptions = {
  /** MCP server 진입점 절대 경로. bridge 가 계산해 넘긴다 */
  mcpServerPath: string;
  bridgeUrl: string;
  bridgeToken: string;
};

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;

  private sdk: ClaudeSdk | undefined;
  private readonly sessionByProject = new Map<string, string>();
  private readonly aborters = new Map<string, AbortController>();
  private modelsCache: { at: number; models: ModelOption[] } | undefined;

  constructor(private readonly options: ClaudeAdapterOptions) {}

  private async loadSdk(): Promise<ClaudeSdk> {
    if (this.sdk) return this.sdk;
    // 변수를 거쳐 import 한다 — 번들러·타입 체커가 정적으로 해석하지 않게 한다.
    this.sdk = (await import(SDK_MODULE)) as unknown as ClaudeSdk;
    return this.sdk;
  }

  async checkReady(): Promise<AgentReadiness> {
    const probe = probeAgentVersion("claude");
    if (!probe.ok) {
      return { agent: "claude", installed: false, authenticated: "unknown", message: probe.message };
    }
    try {
      await this.loadSdk();
    } catch (error) {
      // CLI는 있지만 SDK가 없으면 **쓸 수 없는 것은 맞다** — `installed: true`로 보고하면
      // `/api/health`가 이 agent를 선택 가능하게 보여주고, `/api/analyze`의 `!ready.installed`
      // 가드도 통과시켜 실제 turn 시작까지 가서야(`startTask`의 import) 원본 모듈 오류가
      // 그대로 사용자에게 샌다. 여기서 막아야 정직한 보고다.
      return {
        agent: "claude",
        installed: false,
        authenticated: "unknown",
        version: probe.version,
        message: `${SDK_MODULE} 를 불러오지 못했습니다: ${String(error)}`,
      };
    }
    return { agent: "claude", installed: true, authenticated: "unknown", version: probe.version };
  }

  /**
   * **함정: 모델 목록은 살아 있는 query 에만 붙어 있다.**
   *
   * Codex 의 `model/list` 는 독립 RPC 지만 Claude 의 `supportedModels()` 는 `query()` 객체의
   * 메서드다. turn 을 돌리지 않고 목록만 얻으려면 아무것도 yield 하지 않는 generator 로
   * query 를 열어 control 채널만 붙인 뒤 곧바로 abort 해야 한다. 이 방식은 turn 을 시작하지
   * 않으므로 세션 파일도 남지 않는다.
   */
  async listModels(): Promise<ModelOption[]> {
    const FIVE_MINUTES = 5 * 60 * 1000;
    if (this.modelsCache && Date.now() - this.modelsCache.at < FIVE_MINUTES) {
      return this.modelsCache.models;
    }

    const sdk = await this.loadSdk();
    const abortController = new AbortController();
    async function* noUserInput(): AsyncGenerator<never> {
      await new Promise<void>(() => undefined);
    }

    try {
      const probe = sdk.query({
        prompt: noUserInput(),
        options: { strictMcpConfig: true, abortController },
      });
      const reported = (await probe.supportedModels()) as Array<Record<string, unknown>>;
      const models = parseClaudeModels(reported);
      this.modelsCache = { at: Date.now(), models };
      return models;
    } finally {
      abortController.abort();
    }
  }

  async startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome> {
    const sdk = await this.loadSdk();
    const abortController = new AbortController();
    this.aborters.set(input.taskId, abortController);

    const resumeFrom = this.sessionByProject.get(input.projectPath);
    const analyzeLike = input.mode === "analyze" || input.mode === "view";

    const stream = sdk.query({
      prompt: input.prompt,
      options: {
        cwd: input.projectPath,
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: "stdio",
            command: nodeExecutable(),
            args: [this.options.mcpServerPath],
            env: {
              ONTO_BRIDGE_URL: this.options.bridgeUrl,
              ONTO_BRIDGE_TOKEN: this.options.bridgeToken,
            },
          },
        },
        // 다른 MCP 서버를 애초에 로드하지 않는다. Codex 처럼 거부할 필요가 없다.
        strictMcpConfig: true,
        // 프로젝트의 CLAUDE.md 는 기능1의 인계 산출물이지 분석 turn 의 규칙이 아니다 (B5).
        ...(analyzeLike ? { settingSources: [] } : {}),
        permissionMode: "default",
        ...(resumeFrom ? { resume: resumeFrom } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        abortController,
        canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
          if (toolName.startsWith(`mcp__${MCP_SERVER_NAME}__`)) {
            return { behavior: "allow" as const, updatedInput: toolInput };
          }
          if (toolName === "WebFetch" || toolName === "WebSearch") {
            return { behavior: "deny" as const, message: "분석 turn 에서는 네트워크를 쓰지 않습니다." };
          }
          if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
            const path = String(toolInput["file_path"] ?? "");
            if (!path.startsWith(input.projectPath)) {
              return { behavior: "deny" as const, message: "프로젝트 밖에는 쓸 수 없습니다." };
            }
          }
          return { behavior: "allow" as const, updatedInput: toolInput };
        },
      },
    });

    try {
      for await (const message of stream) {
        this.handleMessage(input, message, emit, resumeFrom);
      }
    } catch (error) {
      // Finding 7 — abort 는 result 메시지 경로에 도달하지 않는다.
      if (abortController.signal.aborted) return "interrupted";
      throw error;
    } finally {
      this.aborters.delete(input.taskId);
    }

    return abortController.signal.aborted ? "interrupted" : "completed";
  }

  private handleMessage(
    input: StartTaskInput,
    message: Record<string, unknown>,
    emit: (event: AgentEvent) => void,
    resumeFrom: string | undefined,
  ): void {
    const type = String(message["type"] ?? "");

    if (type === "system" && message["subtype"] === "init") {
      const sessionId = String(message["session_id"] ?? "");
      if (sessionId) {
        this.sessionByProject.set(input.projectPath, sessionId);
        emit({
          type: "agent.session",
          taskId: input.taskId,
          sessionId,
          resumed: resumeFrom !== undefined,
        });
      }
      return;
    }

    if (type === "assistant") {
      const content = ((message["message"] as Record<string, unknown> | undefined)?.["content"] ??
        []) as Array<Record<string, unknown>>;
      for (const block of content) {
        if (block["type"] === "text") {
          emit({ type: "agent.message.delta", taskId: input.taskId, text: String(block["text"] ?? "") });
        } else if (block["type"] === "tool_use") {
          const name = String(block["name"] ?? "");
          emit({ type: "agent.action.started", taskId: input.taskId, name });
          // **agent-stream 증거원** — agent 가 스스로 보고한 것이다 (B4).
          const prefix = `mcp__${MCP_SERVER_NAME}__`;
          if (name.startsWith(prefix)) {
            emit({
              type: "mcp.tool.called",
              taskId: input.taskId,
              tool: name.slice(prefix.length),
              source: "agent-stream",
            });
          }
          // §7.3 — native `Read` 는 MCP 를 거치지 않은 저장소 직접 탐색이다.
          if (name === "Read") {
            const toolInput = (block["input"] ?? {}) as Record<string, unknown>;
            const path = String(toolInput["file_path"] ?? "");
            if (path) emit({ type: "agent.file.explored", taskId: input.taskId, path });
          }
        }
      }
      return;
    }

    // §7.3 turn/token — 최종 usage 는 result 메시지에만 있다(중간 assistant 메시지의
    // usage 는 final 이 아니다). `@anthropic-ai/claude-agent-sdk`의 `SDKResultMessage.usage`
    // (`BetaUsage`: `input_tokens`/`output_tokens`)를 정적으로 확인해 옮겼다 — 이 머신에는
    // claude CLI 가 없어 실제 turn 으로 재확인하지 못했다(M3~M7과 같은 제약, FINDINGS 참고).
    if (type === "result") {
      const usage = message["usage"] as Record<string, unknown> | undefined;
      if (usage) {
        const inputTokens = Number(usage["input_tokens"] ?? 0);
        const outputTokens = Number(usage["output_tokens"] ?? 0);
        const cacheReadTokens = usage["cache_read_input_tokens"];
        const cacheWriteTokens = usage["cache_creation_input_tokens"];
        emit({
          type: "agent.usage",
          taskId: input.taskId,
          stage: input.mode === "analyze" ? "semantic" : input.mode,
          ...(message["session_id"] ? { turnId: String(message["session_id"]) } : {}),
          inputTokens,
          outputTokens,
          ...(typeof cacheReadTokens === "number" ? { cacheReadTokens } : {}),
          ...(typeof cacheWriteTokens === "number" ? { cacheWriteTokens } : {}),
          totalTokens: inputTokens + outputTokens,
          ...(input.model ? { model: input.model } : {}),
        });
      }
    }
  }

  async stopTask(taskId: string): Promise<void> {
    this.aborters.get(taskId)?.abort();
  }

  resetSession(projectPath: string): void {
    this.sessionByProject.delete(projectPath);
  }

  /**
   * Claude 에는 `thread/list` 에 해당하는 RPC 가 없어 디스크를 읽는다.
   *
   * SDK 가 만든 세션은 `claude --resume` picker 에 뜨지 않지만(Finding 8) 파일은 그대로
   * 있으므로 **이 목록이 CLI 보다 완전하다.**
   */
  async listSessions(projectPath: string): Promise<SessionSummary[]> {
    const sanitized = projectPath.replace(/[^A-Za-z0-9]/gu, "-");
    const dir = join(process.env["HOME"] ?? "", ".claude", "projects", sanitized);
    if (!existsSync(dir)) return [];
    const active = this.sessionByProject.get(projectPath);

    const sessions: SessionSummary[] = [];
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith(".jsonl")) continue;
      const absolute = join(dir, entry);
      try {
        const firstLine = readFileSync(absolute, "utf8").split("\n", 1)[0] ?? "";
        const record = JSON.parse(firstLine) as { message?: { content?: unknown } };
        const preview =
          typeof record.message?.content === "string" ? record.message.content : "";
        const id = entry.replace(/\.jsonl$/u, "");
        sessions.push({
          id,
          preview: describeSession(preview),
          updatedAt: statSync(absolute).mtime.toISOString(),
          active: id === active,
        });
      } catch {
        // 읽을 수 없는 세션 파일은 건너뛴다.
      }
    }
    return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async resumeSession(projectPath: string, sessionId: string): Promise<void> {
    // Codex 와 달리 별도 resume 호출이 없다. 다음 query 의 `resume` 옵션이 처리한다.
    this.sessionByProject.set(projectPath, sessionId);
  }

  async dispose(): Promise<void> {
    for (const aborter of this.aborters.values()) aborter.abort();
    this.aborters.clear();
  }
}
