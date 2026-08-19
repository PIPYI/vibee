#!/usr/bin/env node
/**
 * BYOA spike MCP server (stdio).
 *
 * Codex가 child process로 띄운다. agent가 모델이 아니라 *앱*과 대화할 수 있게 하는
 * 두 개의 tool을 노출한다.
 *
 *   get_app_context -> 브라우저가 지금 무엇을 선택하고 있는지 읽는다
 *   show_result     -> 구조화된 결과를 브라우저 Result Panel로 push 한다
 *
 * 이 서버는 자체 상태를 갖지 않는다. 두 tool 모두 loopback HTTP로 local bridge에
 * 위임하며, 그 덕분에 브라우저와 agent가 하나의 앱 상태에 합의하게 된다.
 *
 * stdout은 MCP 프로토콜 전용이다. 모든 로그는 stderr로 보낸다.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  BRIDGE_TOKEN_HEADER,
  type AppContext,
  type ShowResultInput,
} from "@byoa/protocol";
import { loadBridgeConfig, spikeRootFromModule } from "@byoa/protocol/node";

function log(...args: unknown[]): void {
  console.error("[byoa-mcp]", ...args);
}

/**
 * BRIDGE_URL/BRIDGE_TOKEN은 `npm run mcp:register`가 주입한다. 디스크의 설정 파일로
 * fallback 해 두면 수동으로 등록한 서버도 동작한다.
 */
function resolveBridge(): { baseUrl: string; token: string } {
  const envUrl = process.env.BRIDGE_URL;
  const envToken = process.env.BRIDGE_TOKEN;
  if (envUrl && envToken) return { baseUrl: envUrl.replace(/\/$/, ""), token: envToken };

  const config = loadBridgeConfig(spikeRootFromModule(import.meta.url));
  return { baseUrl: envUrl?.replace(/\/$/, "") ?? config.baseUrl, token: envToken ?? config.token };
}

const bridge = resolveBridge();

async function bridgeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${bridge.baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        [BRIDGE_TOKEN_HEADER]: bridge.token,
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new Error(
      `Cannot reach the BYOA bridge at ${bridge.baseUrl}. Is it running (npm run bridge)? ${String(cause)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Bridge responded ${response.status} for ${path}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

const server = new McpServer(
  { name: "byoa-spike", version: "0.1.0" },
  {
    instructions:
      "Tools for the BYOA + MCP integration spike. Call get_app_context before starting work " +
      "to learn which project and UI selection the user is looking at, and call show_result " +
      "exactly once when finished to render a structured summary in the app.",
  },
);

server.registerTool(
  "get_app_context",
  {
    title: "Get app context",
    description:
      "Return the context currently set in the BYOA spike browser UI: the selected project " +
      "path, the prompt the user submitted, and the selected mock app item.",
    inputSchema: {},
  },
  async () => {
    const context = await bridgeFetch<AppContext>("/internal/app-context");
    log("get_app_context ->", context.projectPath, context.selectedItem?.id ?? "(no selection)");
    return {
      content: [{ type: "text", text: JSON.stringify(context, null, 2) }],
      structuredContent: context as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "show_result",
  {
    title: "Show structured result",
    description:
      "Push a structured result to the BYOA spike browser UI. It is rendered in a dedicated " +
      "Result Panel, separate from the agent transcript. Call this exactly once per task.",
    inputSchema: {
      title: z.string().describe("Short headline for the result"),
      summary: z.string().describe("One paragraph describing what was done"),
      status: z.enum(["success", "warning", "error"]),
      filesChanged: z.array(z.string()).optional().describe("Paths touched, relative to the project"),
      details: z.array(z.string()).optional().describe("Extra bullet points"),
    },
  },
  async (input) => {
    const result = input as ShowResultInput;
    const ack = await bridgeFetch<{ taskId: string | null }>("/internal/results", {
      method: "POST",
      body: JSON.stringify(result),
    });
    log("show_result ->", result.status, result.title, `(task ${ack.taskId ?? "none"})`);
    return {
      content: [
        {
          type: "text",
          text: `Result delivered to the BYOA app UI${ack.taskId ? ` for task ${ack.taskId}` : ""}.`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready; bridge = ${bridge.baseUrl}`);
