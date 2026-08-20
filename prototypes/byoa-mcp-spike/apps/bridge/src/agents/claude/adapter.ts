/**
 * Claude adapter (Phase B). Claude Agent SDK의 `query()`를 구동하고, 그 메시지 스트림을
 * AgentEvent union으로 정규화한다.
 *
 * Codex adapter와 달리 별도 JSON-RPC 클라이언트가 필요 없다 — `query()`가 그 역할을 대신한다.
 * 여기서도 Anthropic Messages API를 직접 호출하지 않는다. 추론은 사용자가 이미 설치하고
 * 로그인해 둔 Claude Code가 담당하며, 우리는 query를 시작하고 결과 이벤트 스트림을 읽을 뿐이다.
 */
import { execFile } from "node:child_process";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  query,
  type CanUseTool,
  type McpStdioServerConfig,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { MCP_SERVER_NAME, type AgentEvent, type AgentReadiness } from "@byoa/protocol";

import { cliSpawnOptions } from "../../platform.js";
import type { AgentAdapter, StartTaskInput, TaskOutcome } from "../types.js";

const execFileAsync = promisify(execFile);

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

  /** 프로젝트 경로당 마지막 session_id. Codex의 "프로젝트당 thread 하나 재사용"에 대응한다. */
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

    const resumeFrom = this.sessionByProject.get(input.projectPath);

    const stream = query({
      prompt: input.prompt,
      options: {
        cwd: input.projectPath,
        mcpServers,
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
        this.handleMessage(input.taskId, message, emit, pendingTools, input.projectPath, resumeFrom);

        if (message.type === "result") {
          if (message.subtype === "success" && !message.is_error) return "completed";
          if (abortController.signal.aborted) return "interrupted";
          // SDKResultError는 사람이 읽을 메시지를 따로 싣지 않는다. subtype이 유일한 사유다.
          throw new Error(`Claude turn failed: ${message.subtype}`);
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

  async stopTask(taskId: string): Promise<void> {
    this.running.get(taskId)?.abortController.abort();
  }

  resetSession(projectPath: string): void {
    // session_id 참조만 버린다. 세션 파일은 ~/.claude/projects에 그대로 남아
    // `claude --resume`으로 이어받을 수 있다.
    this.sessionByProject.delete(projectPath);
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
    resumeFrom: string | undefined,
  ): void {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.sessionByProject.set(projectPath, message.session_id);
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

function filePathOf(input: Record<string, unknown>): string | undefined {
  const value = input.file_path ?? input.path;
  return typeof value === "string" ? value : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(root, candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + sep);
}
