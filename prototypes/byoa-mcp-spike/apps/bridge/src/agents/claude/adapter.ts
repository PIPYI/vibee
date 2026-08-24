/**
 * Claude adapter (Phase B). Claude Agent SDK의 `query()`를 구동하고, 그 메시지 스트림을
 * AgentEvent union으로 정규화한다.
 *
 * Codex adapter와 달리 별도 JSON-RPC 클라이언트가 필요 없다 — `query()`가 그 역할을 대신한다.
 * 여기서도 Anthropic Messages API를 직접 호출하지 않는다. 추론은 사용자가 이미 설치하고
 * 로그인해 둔 Claude Code가 담당하며, 우리는 query를 시작하고 결과 이벤트 스트림을 읽을 뿐이다.
 */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

import {
  query,
  type CanUseTool,
  type EffortLevel,
  type McpStdioServerConfig,
  type PermissionResult,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import {
  MCP_SERVER_NAME,
  type AgentEvent,
  type AgentReadiness,
  type ModelOption,
  type SessionSummary,
  type TranscriptMessage,
} from "@byoa/protocol";

import { cliSpawnOptions } from "../../platform.js";
import { describeSession } from "../../prompt.js";
import { READ_ONLY_TOOLS, isReadOnlyMode, needsReadTools } from "../types.js";
import type { AgentAdapter, StartTaskInput, TaskMode, TaskOutcome } from "../types.js";

const execFileAsync = promisify(execFile);

/** Codex adapter의 ALL_MODES와 같은 이유로 둔다. */
const ALL_MODES: readonly TaskMode[] = ["task", "interview", "review", "wiki", "architecture"];

/** 세션 캐시 키. mode가 다르면 다른 대화다 (Codex adapter의 threadKey와 같은 이유). */
function sessionKey(projectPath: string, mode: TaskMode): string {
  return `${mode} ${projectPath}`;
}

type RunningTask = {
  abortController: AbortController;
};

type ToolDescriptor = { name: string; detail?: unknown };

export type ClaudeAdapterConfig = {
  /** `packages/mcp-server/dist/index.js`의 절대 경로. Codex처럼 전역 등록이 필요 없고,
   *  query마다 이 경로를 stdio MCP 서버로 직접 넘긴다. */
  mcpServerEntry: string;
  bridgeUrl: string;
  bridgeToken: string;
};

export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;

  /**
   * 프로젝트 경로 × mode당 마지막 session_id. Codex의 "프로젝트당 thread 하나 재사용"에
   * 대응한다. mode를 키에 넣는 이유는 Codex adapter의 threadsByProject와 같다.
   */
  private readonly sessionByProject = new Map<string, string>();
  private readonly running = new Map<string, RunningTask>();

  constructor(
    private readonly log: (...args: unknown[]) => void,
    private readonly config: ClaudeAdapterConfig,
  ) {}

  async checkReady(): Promise<AgentReadiness> {
    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync("claude", ["--version"], cliSpawnOptions);
      version = stdout.trim();
    } catch {
      return {
        agent: "claude",
        installed: false,
        authenticated: false,
        message: "Claude Code is not ready. Install the Claude CLI and log in first.",
      };
    }

    // Codex adapter처럼 별도 계정 조회 API가 없다. 여기서는 "unknown"으로 두고, 실제 미인증은
    // 첫 turn에서 task.error로 드러난다 — index.ts의 준비 게이트는 "unknown"을 통과시킨다.
    return { agent: "claude", installed: true, authenticated: "unknown", version };
  }

  /**
   * Claude가 스스로 신고하는 모델 목록.
   *
   * `supportedModels()`는 Codex의 `model/list`와 달리 **살아있는 query 객체에만** 있다.
   * 그래서 프롬프트를 하나도 yield 하지 않는 async generator로 query를 열어 control 채널만
   * 붙이고 목록을 받은 뒤 곧바로 abort 한다 — turn은 시작되지 않고 세션도 남지 않는다.
   */
  async listModels(): Promise<ModelOption[]> {
    const abortController = new AbortController();
    const probe = query({
      prompt: noUserInput(),
      options: { strictMcpConfig: true, abortController },
    });

    try {
      const models = await probe.supportedModels();
      return models.map((model) => ({
        id: model.value,
        label: model.displayName || model.value,
        description: model.description || undefined,
        // supportsEffort가 false면 effort를 지원하지 않는 모델이다 (예: haiku).
        efforts: (model.supportsEffort ? (model.supportedEffortLevels ?? []) : []).map((level) => ({ id: level })),
        // SDK는 모델별 기본 effort를 알려주지 않는다. Codex와 달리 여기서는 비워 둔다.
        isDefault: model.value === "default",
      }));
    } finally {
      abortController.abort();
    }
  }

  async startTask(input: StartTaskInput, emit: (event: AgentEvent) => void): Promise<TaskOutcome> {
    const abortController = new AbortController();
    this.running.set(input.taskId, { abortController });

    const pendingTools = new Map<string, ToolDescriptor>();
    const mcpServers: Record<string, McpStdioServerConfig> = {
      [MCP_SERVER_NAME]: {
        command: "node",
        args: [this.config.mcpServerEntry],
        env: { BRIDGE_URL: this.config.bridgeUrl, BRIDGE_TOKEN: this.config.bridgeToken },
      },
    };

    const canUseTool: CanUseTool = (toolName, toolInput) =>
      Promise.resolve(this.evaluateToolUse(toolName, toolInput, input.projectPath, input.taskId, emit));

    const readOnly = isReadOnlyMode(input.mode);
    const resumeFrom = this.sessionByProject.get(sessionKey(input.projectPath, input.mode));

    const stream = query({
      prompt: input.prompt,
      options: {
        cwd: input.projectPath,
        mcpServers,
        // 인터뷰도 리뷰도 대화지 작업이 아니다. 내장 도구를 전부 끄면 Task(하위 에이전트)·
        // Read·Bash가 사라지고 MCP tool만 남는다 — 둘 다 필요한 건 그게 전부다.
        // 리뷰가 볼 diff는 우리가 get_review_context로 넘기므로 셸이 필요 없다.
        // 이렇게 두지 않으면 프로젝트에 놓인 하네스를 읽고 앱을 만들기 시작한다
        // (SPIKE_FINDINGS.md §14).
        ...(needsReadTools(input.mode)
          ? { tools: [...READ_ONLY_TOOLS] }
          : readOnly
            ? { tools: [] }
            : {}),
        // CLAUDE.md는 `settingSources`에 "project"가 있을 때만 로드된다. 생략하면 CLI처럼
        // 전부 로드하므로, 코드를 쓰지 않는 mode에서는 명시적으로 비운다. 그 CLAUDE.md는
        // [4] 인계 산출물이지 인터뷰의 규칙도 리뷰의 기준도 아니다.
        ...(readOnly ? { settingSources: [] } : {}),
        // 생략하면 SDK가 사용자의 기본 모델을 쓴다.
        model: input.model,
        // 값은 `listModels()`가 신고한 이 모델의 effort 목록에서 온 것이므로 그대로 넘긴다.
        // 여기서 화이트리스트로 거르지 않는 이유는 §8과 같다 — Claude가 새 effort 단계를
        // 추가하면 우리 목록이 먼저 낡고, 조용히 무시되면 원인을 찾기 어렵다.
        // 잘못된 값은 SDK가 거부하게 두고 task.error로 드러낸다.
        effort: input.effort as EffortLevel | undefined,
        // 사용자의 다른 .mcp.json/전역 설정을 아예 로드하지 않는다 — byoa-spike 외 서버는
        // 존재하지 않으므로 Codex처럼 elicitation을 서버별로 골라 거부할 필요가 없다.
        strictMcpConfig: true,
        includePartialMessages: true,
        permissionMode: "default",
        resume: resumeFrom,
        abortController,
        canUseTool,
        stderr: (chunk: string) => this.log("[claude stderr]", chunk.trimEnd()),
      },
    });

    try {
      for await (const message of stream) {
        this.handleMessage(input.taskId, message, emit, pendingTools, input.projectPath, input.mode, resumeFrom);

        if (message.type === "result") {
          if (message.subtype === "success" && !message.is_error) return "completed";
          if (abortController.signal.aborted) return "interrupted";
          // subtype만 실으면 진단이 안 된다 — `subtype: "success"`인데 `is_error`가 참인
          // 경우가 실제로 있었고, 그때 "Claude turn failed: success"만 남아 원인을 알 수
          // 없었다. SDK가 무엇을 실어 보내든 그대로 남긴다.
          const detail =
            typeof (message as { result?: unknown }).result === "string"
              ? (message as { result: string }).result
              : JSON.stringify(message).slice(0, 600);
          throw new Error(`Claude turn failed (${message.subtype}): ${detail}`);
        }
      }
      // result 메시지 없이 스트림이 끝나는 것은 비정상이다.
      if (abortController.signal.aborted) return "interrupted";
      throw new Error("Claude query ended without a result message");
    } catch (error) {
      // abort는 result 메시지가 아니라 예외로 끝난다. 사용자가 Stop을 누른 것이므로
      // 실패가 아니라 interrupted다 (Codex의 turn/interrupt와 같은 결과).
      if (abortController.signal.aborted) return "interrupted";
      throw error;
    } finally {
      this.running.delete(input.taskId);
    }
  }

  /**
   * 이 프로젝트의 기존 세션들.
   *
   * Codex의 `thread/list`에 해당하는 RPC가 SDK에 없어서 디스크를 직접 읽는다.
   * Claude Code는 세션을 `~/.claude/projects/<경로를 -로 바꾼 이름>/<uuid>.jsonl`에 남긴다.
   * SDK가 만든 세션은 `claude --resume` picker에 뜨지 않지만(Finding 8) 파일은 그대로 있으므로
   * 여기서는 보인다 — 오히려 이 목록이 CLI보다 완전하다.
   */
  async listSessions(projectPath: string): Promise<SessionSummary[]> {
    const dir = join(homedir(), ".claude", "projects", encodeProjectDir(projectPath));
    let entries: string[];
    try {
      entries = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      return []; // 아직 이 프로젝트에서 대화한 적이 없다
    }

    // 이 프로젝트에서 우리가 물고 있는 세션은 mode마다 하나씩 있을 수 있다.
    const held = this.heldSessions(projectPath);
    const sessions = await Promise.all(
      entries.map(async (name) => {
        const path = join(dir, name);
        const info = await stat(path);
        return {
          id: basename(name, ".jsonl"),
          preview: describeSession(await firstUserMessage(path)),
          updatedAt: info.mtime.toISOString(),
          active: held.has(basename(name, ".jsonl")),
        };
      }),
    );

    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
  }

  async resumeSession(projectPath: string, sessionId: string): Promise<void> {
    // Codex와 달리 별도 resume 호출이 없다. 다음 query의 `resume` 옵션이 처리한다.
    // 이어받기는 인터뷰 패널에서만 노출되므로 인터뷰 쪽에 건다.
    this.sessionByProject.set(sessionKey(projectPath, "interview"), sessionId);
  }

  /**
   * 이 프로젝트의 대화 전문. `listSessions`와 같은 파일을 읽되 첫 줄이 아니라 전부 읽는다.
   *
   * **우리 앱이 시작한 대화만이 아니다.** 사용자가 옆 창에서 바이브코딩한 세션도 같은
   * 디렉터리에 남으므로 함께 읽힌다 — 위키가 알고 싶어 하는 말은 대개 그쪽에서 나온다.
   */
  async readTranscript(projectPath: string): Promise<TranscriptMessage[]> {
    const dir = join(homedir(), ".claude", "projects", encodeProjectDir(projectPath));
    let entries: string[];
    try {
      entries = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      return [];
    }

    // 최근 것부터 상한까지만. 대화가 쌓여도 비용이 선형으로만 늘게 한다.
    const withTime = await Promise.all(
      entries.map(async (name) => ({ name, at: (await stat(join(dir, name))).mtimeMs })),
    );
    const recent = withTime.sort((a, b) => b.at - a.at).slice(0, MAX_TRANSCRIPT_FILES);

    const messages: TranscriptMessage[] = [];
    for (const { name } of recent) messages.push(...(await readSessionMessages(join(dir, name))));
    return messages;
  }

  /** 이 프로젝트에서 지금 물고 있는 session id들 (mode별로 하나씩). */
  private heldSessions(projectPath: string): Set<string> {
    const held = new Set<string>();
    for (const mode of ALL_MODES) {
      const id = this.sessionByProject.get(sessionKey(projectPath, mode));
      if (id) held.add(id);
    }
    return held;
  }

  async stopTask(taskId: string): Promise<void> {
    this.running.get(taskId)?.abortController.abort();
  }

  resetSession(projectPath: string, mode?: TaskMode): void {
    // session_id 참조만 버린다. 세션 파일은 ~/.claude/projects에 그대로 남아
    // `claude --resume`으로 이어받을 수 있다.
    if (mode) {
      this.sessionByProject.delete(sessionKey(projectPath, mode));
      return;
    }
    for (const mode of ALL_MODES) {
      this.sessionByProject.delete(sessionKey(projectPath, mode));
    }
  }

  async dispose(): Promise<void> {
    for (const task of this.running.values()) task.abortController.abort();
    this.running.clear();
    this.sessionByProject.clear();
  }

  /**
   * 도구 호출 승인. Codex의 `handleServerRequest`(elicitation 승인)에 대응한다.
   *
   * Claude Agent SDK에는 Codex의 `sandboxPolicy.workspaceWrite.writableRoots` 같은 OS 레벨
   * 쓰기 범위 강제가 없다 (SDK 문서: 파일시스템/네트워크 제한은 sandbox 설정이 아니라 이
   * permission 훅으로 한다). 그래서 여기서 직접 Write/Edit 대상 경로를 검사한다. Bash로
   * 임의 경로에 쓰는 것까지는 이 훅 수준에서 막을 수 없다 — Codex 대비 격차이며
   * SPIKE_FINDINGS.md에 기록한다.
   */
  private evaluateToolUse(
    toolName: string,
    toolInput: Record<string, unknown>,
    projectPath: string,
    taskId: string,
    emit: (event: AgentEvent) => void,
  ): PermissionResult {
    const mcpPrefix = `mcp__${MCP_SERVER_NAME}__`;
    if (toolName.startsWith(mcpPrefix)) {
      const tool = toolName.slice(mcpPrefix.length);
      emit({ type: "mcp.tool.called", taskId, tool, source: "agent-stream" });
      return { behavior: "allow" };
    }

    if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
      const path = filePathOf(toolInput);
      if (path && !isWithin(projectPath, path)) {
        return { behavior: "deny", message: `Writes are restricted to ${projectPath} (docs §17).` };
      }
      return { behavior: "allow" };
    }

    if (toolName === "WebFetch" || toolName === "WebSearch") {
      return { behavior: "deny", message: "Network access is disabled in this spike (docs §17)." };
    }

    return { behavior: "allow" };
  }

  private handleMessage(
    taskId: string,
    message: SDKMessage,
    emit: (event: AgentEvent) => void,
    pendingTools: Map<string, ToolDescriptor>,
    projectPath: string,
    mode: TaskMode,
    resumeFrom: string | undefined,
  ): void {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.sessionByProject.set(sessionKey(projectPath, mode), message.session_id);
          emit({
            type: "agent.session",
            taskId,
            sessionId: message.session_id,
            resumed: resumeFrom !== undefined,
          });
        }
        break;

      case "stream_event": {
        const raw = message.event as { type: string; delta?: { type: string; text?: string } };
        if (raw.type === "content_block_delta" && raw.delta?.type === "text_delta" && raw.delta.text) {
          emit({ type: "agent.message.delta", taskId, text: raw.delta.text });
        }
        break;
      }

      case "assistant": {
        const content = message.message.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>;
        for (const block of content) {
          if (block.type !== "tool_use" || !block.id || !block.name) continue;
          const descriptor = describeTool(block.name, (block.input ?? {}) as Record<string, unknown>);
          if (!descriptor) continue;
          pendingTools.set(block.id, descriptor);
          emit({ type: "agent.action.started", taskId, name: descriptor.name, detail: descriptor.detail });
        }
        break;
      }

      case "user": {
        const content = message.message.content;
        if (!Array.isArray(content)) break;
        for (const block of content as Array<{ type: string; tool_use_id?: string }>) {
          if (block.type !== "tool_result" || !block.tool_use_id) continue;
          const descriptor = pendingTools.get(block.tool_use_id);
          if (!descriptor) continue;
          pendingTools.delete(block.tool_use_id);
          emit({ type: "agent.action.completed", taskId, name: descriptor.name, detail: descriptor.detail });
        }
        break;
      }

      default:
        break;
    }
  }
}

/** Codex의 `describeItem`/`detailFor`에 대응. Read/Grep/Glob 등 조회 성격 도구는 Codex도
 *  action으로 드러내지 않으므로 여기서도 null을 반환해 UI 이벤트를 만들지 않는다. */
function describeTool(name: string, input: Record<string, unknown>): ToolDescriptor | null {
  const mcpPrefix = `mcp__${MCP_SERVER_NAME}__`;
  if (name.startsWith(mcpPrefix)) {
    const tool = name.slice(mcpPrefix.length);
    return { name: `mcp:${MCP_SERVER_NAME}/${tool}`, detail: { server: MCP_SERVER_NAME, tool } };
  }
  if (name === "Bash") return { name: "command", detail: { command: input.command } };
  if (name === "Write" || name === "Edit" || name === "NotebookEdit") {
    const path = filePathOf(input);
    return { name: "fileChange", detail: { files: path ? [path] : [] } };
  }
  return null;
}

/** Claude Code가 세션 디렉터리 이름을 만드는 방식: 경로의 `/`를 `-`로 바꾼다. */
function encodeProjectDir(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

/**
 * 세션 파일에서 첫 사용자 메시지를 뽑는다. 어떤 대화였는지 알아보게 하는 용도다.
 * 파일이 클 수 있으므로 한 줄씩 읽다가 찾으면 곧바로 멈춘다.
 */
async function firstUserMessage(path: string): Promise<string> {
  const reader = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      let entry: { type?: string; message?: { content?: unknown } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "user") continue;

      const content = entry.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((block) => (typeof block === "object" && block && "text" in block ? String(block.text) : ""))
                .join(" ")
            : "";
      if (text.trim()) return text.trim();
    }
  } finally {
    reader.close();
  }
  return "(빈 대화)";
}

/** 위키 키워드를 뽑을 때 훑을 세션 파일 수 상한. */
const MAX_TRANSCRIPT_FILES = 10;

/**
 * 세션 파일 하나의 사용자·에이전트 발화를 전부 뽑는다.
 *
 * tool_use / tool_result 블록은 버린다 — 거기 담긴 것은 파일 내용과 명령 출력이라
 * 키워드로 뽑으면 식별자와 로그가 쏟아진다. 사람이 읽은 것은 텍스트 블록뿐이다.
 */
async function readSessionMessages(path: string): Promise<TranscriptMessage[]> {
  const reader = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  const messages: TranscriptMessage[] = [];
  try {
    for await (const line of reader) {
      let entry: { type?: string; message?: { content?: unknown } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== "user" && entry.type !== "assistant") continue;

      const content = entry.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((block) => typeof block === "object" && block && (block as { type?: string }).type === "text")
                .map((block) => String((block as { text?: unknown }).text ?? ""))
                .join(" ")
            : "";
      if (text.trim()) messages.push({ role: entry.type === "user" ? "user" : "agent", text: text.trim() });
    }
  } finally {
    reader.close();
  }
  return messages;
}

/** 프롬프트를 하나도 보내지 않는 입력 스트림. listModels가 turn 없이 control 채널만 열 때 쓴다. */
async function* noUserInput(): AsyncGenerator<SDKUserMessage> {
  await new Promise<void>(() => {});
}

function filePathOf(input: Record<string, unknown>): string | undefined {
  const value = input.file_path ?? input.path;
  return typeof value === "string" ? value : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(root, candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + sep);
}
