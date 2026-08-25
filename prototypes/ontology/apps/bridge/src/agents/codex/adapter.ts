/**
 * Codex adapter.
 *
 * **B3 — 반드시 유지할 승인 정책.** spike 에서 `approvalPolicy: "never"` 가 두 번 깨졌다:
 * 0.147 은 MCP tool 승인을 elicitation 으로 물었고(Finding 1), 0.148 은 묻지 않고 즉시
 * 거부했다(Finding 4). 스키마는 두 버전이 동일했으므로 타입 검사로는 잡히지 않았다.
 *
 * 교훈: **여러 동작을 한 단어로 묶은 설정값은 provider 가 재해석할 여지가 크다.**
 * granular 형태가 "MCP 승인만 나에게 보내라"를 직접 표현하므로 그것을 쓴다.
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

import { probeAgentVersion } from "../../platform.js";
import { describeSession } from "../../prompt.js";
import type { AgentAdapter, StartTaskInput, TaskOutcome } from "../types.js";
import { normalizeStageUsage } from "../usage.js";
import { AppServerClient, type Notification, type ServerRequest } from "./appServerClient.js";

/** "MCP 승인만 우리에게 보내라"를 직접 표현한다. 포괄적 값의 의미 변화에 영향받지 않는다. */
const APPROVAL_POLICY = {
  granular: {
    sandbox_approval: false,
    rules: false,
    skill_approval: false,
    request_permissions: false,
    mcp_elicitations: true,
  },
} as const;

/**
 * granular 승인 정책은 이 capability 를 선언해야 쓸 수 있다.
 *
 * spike 당시(0.148)에는 요구되지 않았는데 이후 CLI 가 바뀌었다 — 선언하지 않으면
 * `thread/start` 가 `askForApproval.granular requires experimentalApi capability (-32600)`
 * 로 거부한다. **이번에도 스키마가 아니라 요구 조건이 바뀐 것**이고, 타입 검사로는 잡히지
 * 않는 종류다(§8).
 *
 * `npm run codex:probe` 로 codex-cli 0.149.0 에서 이 형태가 맞다고 확인했다 —
 * 최상위 `experimentalApi`, `capabilities.experimental`, `clientCapabilities.experimentalApi`
 * 는 모두 거부되었다.
 */
const CLIENT_CAPABILITIES = { experimentalApi: true } as const;

/**
 * granular 이 거부되었는가.
 *
 * 이때 **조용히 `"never"` 로 물러서지 않는다.** 0.148 은 `"never"` 를 "MCP 호출도 거부"로
 * 해석했다(Finding 4). 물러서면 tool 이 한 번도 돌지 않는데 turn 은 성공한 것처럼 끝난다 —
 * 정확히 우리가 막으려는 조용한 실패다. 그래서 무엇이 왜 안 되는지 말하고 멈춘다.
 */
function isGranularRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("granular") || message.includes("experimentalApi");
}

/**
 * `thread/start` 응답에서 thread id 를 꺼낸다.
 *
 * **왜 방어적으로 꺼내는가.** 응답 모양을 `{ threadId }` 로 가정하고 그냥 읽었더니
 * 값이 `undefined` 가 되어 JSON 에서 통째로 빠졌고, 그 다음 `turn/start` 가
 * `invalid type: map, expected a sequence` 로 실패했다 — **input 필드를 가리키는 오류였다.**
 * 진짜 원인은 threadId 였는데 메시지는 엉뚱한 곳을 가리켰고, 그만큼 진단이 늦어졌다.
 *
 * 그래서 후보를 훑되, 못 찾으면 **받은 것을 그대로 보여주며 즉시 실패한다.**
 * undefined 를 다음 호출로 흘려보내지 않는다.
 */
function extractThreadId(result: unknown): string {
  const record = (result ?? {}) as Record<string, unknown>;
  const nested = (record["thread"] ?? {}) as Record<string, unknown>;
  const candidate =
    record["threadId"] ?? record["thread_id"] ?? record["id"] ?? nested["id"] ?? nested["threadId"];

  if (typeof candidate === "string" && candidate.length > 0) return candidate;

  throw new Error(
    "codex `thread/start` 응답에서 thread id 를 찾지 못했습니다. " +
      `받은 것: ${JSON.stringify(result)}\n` +
      "`npm run codex:probe` 로 이 CLI 의 응답 모양을 확인하세요.",
  );
}

type TurnHandle = { threadId: string; turnId?: string; mode: StartTaskInput["mode"]; model?: string };

/**
 * `model/list` 응답은 Codex app-server 버전에 따라 `data` 또는 과거의 `models` 키를 쓴다.
 * reasoning effort도 현재 버전은 `{ reasoningEffort, description }` 객체다. provider가 준
 * 원문 ID와 설명을 보존하되, 숨김 모델과 식별자 없는 행은 사용자 선택지에서 제외한다.
 */
export function parseCodexModelPage(page: Record<string, unknown>): {
  models: ModelOption[];
  nextCursor?: string;
} {
  const rows = (Array.isArray(page["data"])
    ? page["data"]
    : Array.isArray(page["models"])
      ? page["models"]
      : []) as Array<Record<string, unknown>>;

  const models = rows.flatMap((raw) => {
    const id = String(raw["id"] ?? raw["model"] ?? raw["slug"] ?? "");
    if (!id || raw["hidden"] === true) return [];
    const rawEfforts = Array.isArray(raw["supportedReasoningEfforts"])
      ? raw["supportedReasoningEfforts"]
      : [];
    const efforts = rawEfforts.flatMap((item) => {
      if (typeof item === "string") return [{ id: item }];
      if (typeof item !== "object" || item === null) return [];
      const record = item as Record<string, unknown>;
      const effortId = String(record["reasoningEffort"] ?? record["id"] ?? "");
      if (!effortId) return [];
      return [{
        id: effortId,
        ...(record["description"] ? { description: String(record["description"]) } : {}),
      }];
    });
    return [{
      id,
      label: String(raw["displayName"] ?? raw["model"] ?? id),
      ...(raw["description"] ? { description: String(raw["description"]) } : {}),
      efforts,
      ...(raw["defaultReasoningEffort"]
        ? { defaultEffort: String(raw["defaultReasoningEffort"]) }
        : {}),
      isDefault: Boolean(raw["isDefault"]),
    } satisfies ModelOption];
  });

  const nextCursor = page["nextCursor"];
  return {
    models,
    ...(typeof nextCursor === "string" && nextCursor.length > 0 ? { nextCursor } : {}),
  };
}

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;

  private client: AppServerClient | undefined;
  private initialized = false;
  private readonly threadByProject = new Map<string, string>();
  private readonly activeTurns = new Map<string, TurnHandle>();
  private emitters = new Map<string, (event: AgentEvent) => void>();
  private turnResolvers = new Map<string, (outcome: TaskOutcome) => void>();
  /** bridge가 커밋 완료한 stage를 끊을 때만 user Stop과 다른 결과를 사용한다. */
  private readonly stopOutcomes = new Map<string, "completed">();
  private modelsCache: { at: number; models: ModelOption[] } | undefined;

  private ensureClient(): AppServerClient {
    if (this.client) return this.client;
    this.client = new AppServerClient(
      (notification) => this.handleNotification(notification),
      (request) => this.handleServerRequest(request),
    );
    return this.client;
  }

  async checkReady(): Promise<AgentReadiness> {
    const probe = probeAgentVersion("codex");
    if (!probe.ok) {
      return { agent: "codex", installed: false, authenticated: "unknown", message: probe.message };
    }
    return {
      agent: "codex",
      installed: true,
      // 로그인 여부는 turn 을 돌려 봐야 안다. 지어내지 않는다.
      authenticated: "unknown",
      version: probe.version,
    };
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.ensureClient().call("initialize", {
      clientInfo: { name: "onto-bridge", version: "0.1.0" },
      // granular 승인 정책의 전제 조건이다. 선언하지 않으면 thread/start 가 거부한다.
      capabilities: CLIENT_CAPABILITIES,
    });
    this.ensureClient().notify("initialized", {});
    this.initialized = true;
  }

  /**
   * 모델 목록을 **provider 에게 직접 묻는다.** 하드코딩하지 않는 이유는 CLI 를 올리면
   * 목록도 effort 집합도 바뀌기 때문이다. 응답은 커서 기반이라 끝까지 따라간다.
   */
  async listModels(): Promise<ModelOption[]> {
    const FIVE_MINUTES = 5 * 60 * 1000;
    if (this.modelsCache && Date.now() - this.modelsCache.at < FIVE_MINUTES) {
      return this.modelsCache.models;
    }
    await this.initialize();

    const models: ModelOption[] = [];
    let cursor: string | undefined;
    do {
      const rawPage = (await this.ensureClient().call("model/list", cursor ? { cursor } : {})) as Record<string, unknown>;
      const page = parseCodexModelPage(rawPage);
      models.push(...page.models);
      cursor = page.nextCursor;
    } while (cursor);

    this.modelsCache = { at: Date.now(), models };
    return models;
  }

  async startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome> {
    await this.initialize();
    this.emitters.set(input.taskId, emit);

    let threadId = this.threadByProject.get(input.projectPath);
    const resumed = threadId !== undefined;
    if (!threadId) {
      let started: unknown;
      try {
        started = await this.ensureClient().call("thread/start", {
          cwd: input.projectPath,
          approvalPolicy: APPROVAL_POLICY,
          // `sandboxPolicy` 는 여기 없다 — ThreadStartParams 에는 `sandbox?: SandboxMode` 뿐이고
          // 정책 객체는 TurnStartParams 에 있다. 여기 넘기면 **조용히 무시된다** (Finding 2).
        });
      } catch (error) {
        if (isGranularRejection(error)) {
          throw new Error(
            "이 Codex 버전이 granular 승인 정책을 받아들이지 않습니다: " +
              `${error instanceof Error ? error.message : String(error)}\n` +
              "포괄적 값(\"never\")으로 물러서지 않습니다 — 그러면 MCP tool 호출이 조용히 " +
              "거부되어 turn 은 성공한 것처럼 끝납니다.\n" +
              "`npm run codex:probe` 로 이 CLI 가 요구하는 capability 형태를 확인하세요.",
          );
        }
        throw error;
      }
      threadId = extractThreadId(started);
      this.threadByProject.set(input.projectPath, threadId);
    }

    emit({ type: "agent.session", taskId: input.taskId, sessionId: threadId, resumed });
    this.activeTurns.set(input.taskId, { threadId, mode: input.mode, ...(input.model ? { model: input.model } : {}) });

    const outcome = new Promise<TaskOutcome>((resolve) => {
      this.turnResolvers.set(input.taskId, resolve);
    });

    // `turn/start`의 응답은 `{ turnId }`가 아니라 `{ turn: { id, ... } }`다 — codex-cli
    // 0.149.0의 실제 프로토콜을 `codex app-server generate-ts`로 직접 확인해 고쳤다
    // (Finding 1·2와 같은 이유로, 추측 대신 실측했다). 이전 코드는 `turn.turnId`가 항상
    // undefined라 activeTurns에 turnId가 안 실렸고, 그래서 `turn/interrupt`가 필수
    // 필드 `turnId` 없이 나가 codex-cli에게 거부됐다 — stopTask가 조용히 실패하고
    // 있었다(acceptance 20이 실제로 검증된 적이 없어 드러나지 않았다).
    const response = (await this.ensureClient().call("turn/start", {
      threadId,
      // **시퀀스다.** `{ text }` 를 보내면 `invalid type: map, expected a sequence` 로
      // 거부된다. `type` 은 필수다 — 빠뜨리면 `missing field type` (Finding 2).
      input: [{ type: "text", text: input.prompt }],
      cwd: input.projectPath,
      approvalPolicy: APPROVAL_POLICY,
      // 쓰기 범위 제한은 **여기서만** 걸린다. thread/start 에 넘기면 무시된다.
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [input.projectPath] },
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
    })) as { turn?: { id?: string } };
    const turnId = response.turn?.id;
    this.activeTurns.set(input.taskId, {
      threadId,
      mode: input.mode,
      ...(turnId ? { turnId } : {}),
      ...(input.model ? { model: input.model } : {}),
    });

    try {
      return await outcome;
    } finally {
      this.emitters.delete(input.taskId);
      this.turnResolvers.delete(input.taskId);
      this.activeTurns.delete(input.taskId);
      this.stopOutcomes.delete(input.taskId);
    }
  }

  /**
   * MCP tool 승인 (B3).
   *
   * **무조건 수락하지 않는다.** 이 앱이 스스로 등록한 서버의 tool 만 자동 승인하고,
   * 사용자가 개인적으로 설정해 둔 다른 MCP 서버의 호출은 거부한다.
   */
  private handleServerRequest(request: ServerRequest): unknown {
    if (request.method === "mcpServer/elicitation/request") {
      const params = (request.params ?? {}) as { serverName?: string };
      const accepted = params.serverName === MCP_SERVER_NAME;
      for (const emit of this.emitters.values()) {
        const taskId = [...this.emitters.keys()][0] ?? "";
        emit({
          type: "agent.action.completed",
          taskId,
          name: accepted ? "mcp.approval.accepted" : "mcp.approval.declined",
          detail: { server: params.serverName },
        });
        break;
      }
      return accepted
        ? { action: "accept", content: {}, _meta: null }
        : { action: "decline", content: null, _meta: null };
    }
    return {};
  }

  private handleNotification(notification: Notification): void {
    const params = (notification.params ?? {}) as Record<string, unknown>;
    const taskId = this.taskIdFor(String(params["turnId"] ?? ""), String(params["threadId"] ?? ""));
    if (!taskId) return;
    const emit = this.emitters.get(taskId);
    if (!emit) return;

    if (notification.method === "item/started" || notification.method === "item/completed") {
      const item = (params["item"] ?? {}) as Record<string, unknown>;
      const name = String(item["type"] ?? "item");
      if (name === "mcpToolCall") {
        // **agent-stream 증거원** — agent 가 스스로 보고한 것이다 (B4).
        const tool = String(item["tool"] ?? "");
        const serverName = String(item["server"] ?? "");
        if (serverName === MCP_SERVER_NAME && notification.method === "item/started") {
          emit({ type: "mcp.tool.called", taskId, tool, source: "agent-stream" });
        }
        emit({
          type: notification.method === "item/started" ? "agent.action.started" : "agent.action.completed",
          taskId,
          name: `mcp:${serverName}/${tool}`,
        });
        return;
      }
      // **agent-stream 증거원** (§7.3) — codex 가 `commandExecution` 을 `CommandAction[]` 으로
      // best-effort 파싱해 준다(`codex app-server generate-ts`로 확인, `{ type: "read", path }`
      // 가 파일을 직접 읽은 shell 명령이다). MCP 를 거치지 않은 저장소 탐색이 이것으로 잡힌다.
      // item/started 에서만 본다 — mcp.tool.called 와 같은 이유로 완료 시 다시 볼 필요가 없다.
      if (name === "commandExecution" && notification.method === "item/started") {
        const actions = (item["commandActions"] ?? []) as Array<Record<string, unknown>>;
        for (const action of actions) {
          if (action["type"] === "read") {
            const path = String(action["path"] ?? "");
            if (path) emit({ type: "agent.file.explored", taskId, path });
          }
        }
      }
      emit({
        type: notification.method === "item/started" ? "agent.action.started" : "agent.action.completed",
        taskId,
        name,
        detail: item,
      });
      return;
    }

    if (notification.method === "item/agentMessageDelta") {
      emit({ type: "agent.message.delta", taskId, text: String(params["delta"] ?? "") });
      return;
    }

    // **agent-stream 증거원** (§7.3 turn/token) — `codex app-server generate-ts` 로 확인한
    // `ThreadTokenUsageUpdatedNotification { threadId, turnId, tokenUsage: { total: { totalTokens } } }`.
    if (notification.method === "thread/tokenUsage/updated") {
      const tokenUsage = (params["tokenUsage"] ?? {}) as {
        total?: {
          totalTokens?: number;
          inputTokens?: number;
          outputTokens?: number;
          cachedInputTokens?: number;
        };
      };
      const total = tokenUsage.total;
      if (typeof total?.totalTokens === "number") {
        const handle = this.activeTurns.get(taskId);
        const turnId = params["turnId"] ? String(params["turnId"]) : handle?.turnId;
        emit({
          type: "agent.usage",
          taskId,
          stage: handle?.mode === "analyze" ? "semantic" : handle?.mode ?? "chat",
          ...(turnId ? { turnId } : {}),
          ...normalizeStageUsage({
            inputTokens: total.inputTokens,
            outputTokens: total.outputTokens,
            cacheReadTokens: total.cachedInputTokens,
          }, { inputIncludesCacheRead: true }),
          ...(handle?.model ? { model: handle.model } : {}),
        });
      }
      return;
    }

    if (notification.method === "turn/completed") {
      const turn = (params["turn"] ?? {}) as { status?: string };
      // 중단은 예외가 아니라 status 로만 구분된다 (Finding 2).
      const outcome: TaskOutcome = this.stopOutcomes.get(taskId) ??
        (turn.status === "interrupted" ? "interrupted" : "completed");
      this.turnResolvers.get(taskId)?.(outcome);
    }
  }

  private taskIdFor(turnId: string, threadId: string): string | undefined {
    for (const [taskId, handle] of this.activeTurns) {
      if (turnId && handle.turnId === turnId) return taskId;
      if (threadId && handle.threadId === threadId) return taskId;
    }
    return undefined;
  }

  async stopTask(taskId: string, outcome?: "completed"): Promise<void> {
    const handle = this.activeTurns.get(taskId);
    if (!handle) return;
    if (outcome) this.stopOutcomes.set(taskId, outcome);
    else this.stopOutcomes.delete(taskId);
    await this.ensureClient().call("turn/interrupt", {
      threadId: handle.threadId,
      ...(handle.turnId ? { turnId: handle.turnId } : {}),
    });
  }

  resetSession(projectPath: string): void {
    this.threadByProject.delete(projectPath);
  }

  /**
   * 이어받을 수 있는 세션들.
   *
   * rollout 파일의 `originator` 로 **우리가 만든 세션을 구분할 수 있다** — spike §7 에서
   * 확인했다. 사용자의 `codex resume` 목록이 우리 thread 로 오염되는 문제를 다루려면 이 값이
   * 필요하다.
   */
  async listSessions(projectPath: string): Promise<SessionSummary[]> {
    const root = join(process.env["HOME"] ?? "", ".codex", "sessions");
    if (!existsSync(root)) return [];
    const sessions: SessionSummary[] = [];
    const active = this.threadByProject.get(projectPath);

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir).sort()) {
        const absolute = join(dir, entry);
        if (statSync(absolute).isDirectory()) {
          walk(absolute);
          continue;
        }
        if (!entry.endsWith(".jsonl")) continue;
        try {
          const firstLine = readFileSync(absolute, "utf8").split("\n", 1)[0] ?? "";
          const meta = JSON.parse(firstLine) as { payload?: Record<string, unknown> };
          const payload = meta.payload ?? {};
          if (payload["cwd"] !== projectPath) continue;
          const id = String(payload["id"] ?? "");
          sessions.push({
            id,
            preview: describeSession(String(payload["instructions"] ?? "")),
            updatedAt: String(payload["timestamp"] ?? ""),
            active: id === active,
          });
        } catch {
          // 읽을 수 없는 rollout 은 건너뛴다. 목록 기능이 멈출 이유가 아니다.
        }
      }
    };

    try {
      walk(root);
    } catch {
      return [];
    }
    return sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async resumeSession(projectPath: string, sessionId: string): Promise<void> {
    await this.initialize();
    await this.ensureClient().call("thread/resume", { threadId: sessionId });
    this.threadByProject.set(projectPath, sessionId);
  }

  async dispose(): Promise<void> {
    this.client?.dispose();
    this.client = undefined;
    this.initialized = false;
  }
}
