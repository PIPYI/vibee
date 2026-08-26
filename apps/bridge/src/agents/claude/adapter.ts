import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, PermissionResult, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, ModelOption } from "@vibee/protocol";
import { VIBEE_BRIDGE_TOKEN_ENV, VIBEE_BRIDGE_URL_ENV } from "@vibee/protocol";
import type { AgentAdapter, StartTaskInput } from "../types.js";
import { mcpServerEntryPath, nodeExecutable } from "../../platform.js";

const MCP_SERVER_NAME = "vibee";
// The Claude Agent SDK namespaces MCP-server-provided tools as
// `mcp__<serverName>__<toolName>` -- verified against the installed SDK
// version's `CanUseTool`/tool_use naming (the same prefix appears throughout
// sdk.d.ts's MCP-related control requests). Registering our server under the
// name "vibee" is what makes `mcp__vibee__validate_architecture_view` and
// `mcp__vibee__submit_architecture_view` the two tool names the model sees.
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

export type ToolUseDecision = { behavior: "allow" } | { behavior: "deny"; message: string };

function extractFilePath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  const value = (toolInput as Record<string, unknown>)["file_path"];
  return typeof value === "string" ? value : undefined;
}

function isInsideProject(filePath: string, projectPath: string): boolean {
  // String-prefix check, deliberately simple for MVP (per spec). This does
  // not resolve ".." segments or symlinks; it is a coarse guard against the
  // common case of the model writing somewhere outside the project root,
  // not a hardened sandbox boundary.
  const normalizedProject = projectPath.endsWith("/") ? projectPath : `${projectPath}/`;
  return filePath === projectPath || filePath.startsWith(normalizedProject);
}

/**
 * Pure permission-decision logic for the Claude Agent SDK's `canUseTool`
 * callback, pulled out into a standalone function so it is unit-testable
 * without spinning up the real SDK (see src/test/canUseTool.test.ts).
 *
 * Rules:
 * - Any `mcp__vibee__*` tool (our own validate/submit MCP tools) is allowed.
 * - WebFetch and WebSearch are always denied -- an architecture-analysis
 *   agent has no legitimate reason to leave the local filesystem.
 * - Write/Edit are denied when their `file_path` input resolves outside the
 *   project directory being analyzed.
 * - Everything else (notably Read/Grep/Glob, the only native exploration
 *   tools this agent is granted) is allowed by default.
 */
export function decideToolUse(toolName: string, toolInput: unknown, projectPath: string): ToolUseDecision {
  if (toolName.startsWith(MCP_TOOL_PREFIX)) return { behavior: "allow" };

  if (toolName === "WebFetch" || toolName === "WebSearch") {
    return { behavior: "deny", message: `${toolName} is not permitted during architecture analysis.` };
  }

  if (toolName === "Write" || toolName === "Edit") {
    const filePath = extractFilePath(toolInput);
    if (filePath !== undefined && !isInsideProject(filePath, projectPath)) {
      return {
        behavior: "deny",
        message: `${toolName} outside of the project directory (${projectPath}) is not permitted.`,
      };
    }
  }

  return { behavior: "allow" };
}

function toPermissionResult(decision: ToolUseDecision): PermissionResult {
  return decision.behavior === "allow" ? { behavior: "allow" } : { behavior: "deny", message: decision.message };
}

/** Builds the env for the spawned MCP server subprocess: inherited process env plus the two loopback vars. */
function buildMcpServerEnv(bridgeUrl: string, bridgeToken: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env[VIBEE_BRIDGE_URL_ENV] = bridgeUrl;
  env[VIBEE_BRIDGE_TOKEN_ENV] = bridgeToken;
  return env;
}

/**
 * An async generator that never yields a message. Used to open a `query()`
 * call in streaming-input mode (required for the side-channel control
 * requests like `supportedModels()`/`initializationResult()`) without ever
 * submitting a real prompt or triggering a conversational turn -- the
 * generator just sits parked until the caller aborts/closes the query.
 */
async function* noPrompt(signal: AbortSignal): AsyncGenerator<SDKUserMessage> {
  await new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }).catch(() => {
    // swallow: the generator is being torn down via abort/close, not a real error
  });
}

const CONTROL_REQUEST_TIMEOUT_MS = 15_000;

async function withControlQuery<T>(fn: (q: ReturnType<typeof query>) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const q = query({
    prompt: noPrompt(controller.signal),
    options: { abortController: controller, tools: [] },
  });
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("timed out waiting for Claude Code CLI")), CONTROL_REQUEST_TIMEOUT_MS);
    });
    return await Promise.race([fn(q), timeout]);
  } finally {
    controller.abort();
    q.close();
  }
}

export function createClaudeAdapter(config: { bridgeUrl: string; bridgeToken: string }): AgentAdapter {
  const abortControllers = new Map<string, AbortController>();

  return {
    id: "claude",

    async checkReady() {
      try {
        const result = await withControlQuery((q) => q.initializationResult());
        return {
          installed: true,
          authenticated: Boolean(result.account),
        };
      } catch (err) {
        return {
          installed: false,
          authenticated: "unknown",
          message: (err as Error).message,
        };
      }
    },

    async listModels(): Promise<ModelOption[]> {
      const models = await withControlQuery((q) => q.supportedModels());
      return models.map((m) => ({ id: m.value, label: m.displayName }));
    },

    async startTask(input: StartTaskInput, emit: (event: AgentEvent) => void) {
      const controller = new AbortController();
      abortControllers.set(input.taskId, controller);
      emit({ type: "task.started", taskId: input.taskId });

      try {
        const options: Options = {
          cwd: input.projectPath,
          abortController: controller,
          mcpServers: {
            [MCP_SERVER_NAME]: {
              command: nodeExecutable(),
              args: [mcpServerEntryPath()],
              env: buildMcpServerEnv(config.bridgeUrl, config.bridgeToken),
            },
          },
          strictMcpConfig: true,
          tools: ["Read", "Grep", "Glob"],
          canUseTool: async (toolName, toolInput) =>
            toPermissionResult(decideToolUse(toolName, toolInput, input.projectPath)),
          ...(input.model !== undefined ? { model: input.model } : {}),
        };

        const q = query({ prompt: input.prompt, options });

        for await (const message of q) {
          if (message.type === "assistant") {
            for (const block of message.message.content) {
              if (block.type === "text") {
                emit({ type: "agent.message.delta", taskId: input.taskId, text: block.text });
              } else if (block.type === "tool_use") {
                if (block.name === "Read") {
                  const filePath = extractFilePath(block.input);
                  if (filePath !== undefined) {
                    emit({ type: "agent.file.explored", taskId: input.taskId, path: filePath });
                  }
                } else if (block.name.startsWith(MCP_TOOL_PREFIX)) {
                  emit({ type: "mcp.tool.called", taskId: input.taskId, tool: block.name });
                }
              }
            }
            continue;
          }

          if (message.type === "result") {
            // Usage is only ever taken from this final, terminal message --
            // intermediate per-message/per-turn usage is not authoritative
            // for the query() call as a whole (see docs/v1_plan.md 4.5).
            const isRealSuccess = message.subtype === "success" && !message.is_error;
            if (isRealSuccess) {
              const usage = message.usage;
              emit({
                type: "agent.usage",
                taskId: input.taskId,
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                cacheReadTokens: usage.cache_read_input_tokens,
                cacheWriteTokens: usage.cache_creation_input_tokens,
              });
              emit({ type: "task.completed", taskId: input.taskId });
              return "completed";
            }

            const errorMessage =
              message.subtype === "success"
                ? message.result
                : (message.errors.join("; ") || message.subtype);
            emit({ type: "task.error", taskId: input.taskId, message: errorMessage });
            return "error";
          }
        }

        // Stream ended without a terminal result message -- treat as a
        // plain completion since there is no error information to surface.
        emit({ type: "task.completed", taskId: input.taskId });
        return "completed";
      } catch (err) {
        if (controller.signal.aborted) {
          return "interrupted";
        }
        emit({ type: "task.error", taskId: input.taskId, message: (err as Error).message });
        return "error";
      } finally {
        abortControllers.delete(input.taskId);
      }
    },

    async stopTask(taskId: string) {
      abortControllers.get(taskId)?.abort();
    },

    resetSession(_projectPath: string) {
      // Intentional no-op, not an oversight: every startTask() call already
      // starts a brand-new query() with no `resume`/`continue` option, so
      // this adapter never resumes a prior session in the first place.
      // "never resume a session" (docs/v1_plan.md 4.5 / roadmap 7-b) is a
      // hard correctness rule for the future incremental-analysis design --
      // this method exists now, as a no-op, specifically so that rule holds
      // by construction (there is a well-defined place to put real
      // session-reset logic if some future code path ever needs one)
      // instead of holding only by convention someone could accidentally
      // break by adding a `resume` option to startTask without touching
      // this file.
    },
  };
}
