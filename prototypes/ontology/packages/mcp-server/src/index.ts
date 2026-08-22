#!/usr/bin/env node
/**
 * ontology MCP server (stdio).
 *
 * agent가 모델이 아니라 **앱**과 대화할 수 있게 하는 tool들을 노출한다 (§48).
 *
 * 이 서버는 **자체 상태를 갖지 않는다.** 모든 tool이 loopback HTTP로 bridge에 위임하며,
 * 그 덕분에 브라우저와 agent가 하나의 프로젝트 상태에 합의한다 (B1). agent가 spawn한
 * 별도 프로세스이므로 bridge의 메모리에 직접 닿을 수 없다.
 *
 * **이 파일은 OS를 알지 않는다** — 실행 파일 해석은 bridge의 platform 계층에만 있다.
 *
 * stdout은 MCP 프로토콜 전용이다. 모든 로그는 stderr로 보낸다.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { BRIDGE_TOKEN_HEADER } from "@onto/protocol";
import { loadBridgeConfig, protoRootFromModule } from "@onto/protocol/bridge-config";

function log(...args: unknown[]): void {
  console.error("[onto-mcp]", ...args);
}

/** BRIDGE_URL/BRIDGE_TOKEN은 등록 스크립트가 주입한다. 없으면 디스크 설정으로 fallback. */
function resolveBridge(): { baseUrl: string; token: string } {
  const envUrl = process.env.ONTO_BRIDGE_URL;
  const envToken = process.env.ONTO_BRIDGE_TOKEN;
  if (envUrl && envToken) return { baseUrl: envUrl.replace(/\/$/u, ""), token: envToken };

  const config = loadBridgeConfig(protoRootFromModule(import.meta.url));
  return {
    baseUrl: envUrl?.replace(/\/$/u, "") ?? config.baseUrl,
    token: envToken ?? config.token,
  };
}

const bridge = resolveBridge();

/**
 * bridge 호출. **절대 throw 하지 않는다** (C5).
 *
 * tool handler에서 예외가 나가면 MCP transport가 닫히고, 클라이언트에는
 * `MCP error -32000: Connection closed`라는 불투명한 메시지만 남는다. 사용자가 무엇을
 * 해야 하는지 알 수 없게 되므로, 실패도 **읽을 수 있는 payload**로 돌려준다.
 */
async function callBridge(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${bridge.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        [BRIDGE_TOKEN_HEADER]: bridge.token,
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    return {
      error: "bridge_unreachable",
      next_step: "앱의 bridge가 떠 있는지 확인하세요 (`npm run bridge`).",
      detail: `${bridge.baseUrl} 에 닿지 못했습니다: ${String(cause)}`,
    };
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      error: "bridge_error",
      status: response.status,
      detail: text.slice(0, 2000),
    };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: "bridge_bad_json", detail: text.slice(0, 2000) };
  }
}

function reply(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
} {
  const text = JSON.stringify(payload, null, 2);
  const structured =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

/**
 * instructions에 **질문 ↔ tool 매핑**을 싣는다 (C6).
 *
 * spike가 확인한 것: agent는 MCP를 자발적으로 부르지 않는다(SPIKE_FINDINGS §6.5).
 * tool description과 instructions 설계가 실제 사용률을 좌우한다.
 */
const INSTRUCTIONS = `이 서버는 현재 프로젝트의 Semantic Memory와 Evidence Index에 접근하게 해 준다.

Evidence Index는 결정론적으로 만들어진다 — 파일·심볼·정의·참조·호출·라우트·UI 이벤트·
DB 읽기/쓰기·설정이 들어 있다. Semantic Memory는 AI가 만들고 Core가 근거를 검증한 의미다.

무엇을 물어보면 어느 tool이 답하는가:

  · 이 프로젝트에 무엇이 있는가 (개요)           -> get_project_semantic_memory
  · 이 개념은 무엇이고 어디에 근거하는가          -> get_concept_context
  · 어떤 주장들이 있는가                         -> search_claims
  · 이 파일/심볼의 실제 근거는 무엇인가           -> get_evidence
  · 이 기능은 어떻게 동작하는가 (흐름)            -> get_scenario_context
  · 이걸 고치면 어디에 영향이 가는가              -> get_impact_context (아직 비활성)

중요한 규칙:

1. 경로·심볼·줄번호를 지어내지 마라. 모든 참조는 실재하는 id여야 한다.
2. 엔진이 인덱싱하지 못한 근거를 발견했다면 버리지 말고 propose_evidence로 등록을 요청하라.
   Core가 검증한 뒤 id를 발급하며, 발급받은 id에만 grounding할 수 있다.
3. 사용자에게 보이는 label은 파일명·함수명이 아니라 프로젝트의 도메인 용어로 쓴다.
   기술 세부는 Trace View에서만 노출한다.

tool이 error: "memory_unavailable" 을 돌려주면 아직 분석하지 않은 프로젝트다.
next_step 필드를 사용자에게 그대로 전달하라.`;

const server = new McpServer({ name: "onto", version: "0.1.0" }, { instructions: INSTRUCTIONS });

// ---------------------------------------------------------------------------
// 읽기 tool
// ---------------------------------------------------------------------------

server.registerTool(
  "get_project_semantic_memory",
  {
    title: "프로젝트 의미 구조 요약",
    description:
      "현재 프로젝트의 Semantic Memory를 돌려준다. 기본은 digest(버전·개수·주요 Concept·" +
      "canonical scenario 목록)이며, 전체가 필요할 때만 detail: \"full\"로 요청한다. " +
      "전체는 크므로 매 turn 가져오지 마라 — 이미 이 대화에서 본 것을 다시 받는 셈이 된다.",
    inputSchema: {
      detail: z
        .enum(["digest", "full"])
        .optional()
        .describe("기본 digest. full은 다른 곳에서 시작한 세션을 이어받을 때만"),
    },
  },
  async ({ detail }) => reply(await callBridge(`/internal/memory${query({ detail })}`)),
);

server.registerTool(
  "get_concept_context",
  {
    title: "Concept 하나의 맥락",
    description:
      "Concept와 그것에 연결된 Claim(들어오는 것·나가는 것), grounding evidence 요약, " +
      "그리고 **재사용을 검토할 기존 Concept 후보**를 돌려준다. 새 Concept를 만들기 전에 " +
      "반드시 확인하라 — 같은 의미가 분석마다 새 Concept가 되면 실패다.",
    inputSchema: {
      conceptId: z.string().optional().describe("Concept id"),
      name: z.string().optional().describe("이름으로 찾을 때"),
    },
  },
  async ({ conceptId, name }) =>
    reply(await callBridge(`/internal/concepts${query({ conceptId, name })}`)),
);

server.registerTool(
  "search_claims",
  {
    title: "Claim 검색",
    description:
      "Claim을 검색한다. predicate는 자유 문장이므로 정확 일치가 아니라 부분 일치로 찾는다.",
    inputSchema: {
      q: z.string().describe("검색어"),
      conceptId: z.string().optional().describe("이 Concept가 subject 또는 object인 것만"),
      limit: z.number().optional().describe("기본 20"),
    },
  },
  async ({ q, conceptId, limit }) =>
    reply(await callBridge(`/internal/claims${query({ q, conceptId, limit })}`)),
);

server.registerTool(
  "get_evidence",
  {
    title: "Evidence 조회",
    description:
      "Evidence 레코드를 돌려준다. id·파일 경로·kind·심볼 중 하나로 좁힌다. " +
      "includeSource를 켜면 해당 범위의 실제 소스를 함께 준다. " +
      "여기 있는 id만 grounding에 쓸 수 있다 — 지어내지 마라.",
    inputSchema: {
      ids: z.array(z.string()).optional().describe("evidence id들"),
      filePath: z.string().optional().describe("이 파일의 evidence"),
      kind: z.string().optional().describe("file · symbol · call · route · db_write 등"),
      symbolId: z.string().optional().describe("<relPath>#<qualifiedName>"),
      includeSource: z.boolean().optional().describe("소스 발췌를 함께 받을지"),
      limit: z.number().optional().describe("기본 50"),
    },
  },
  async ({ ids, filePath, kind, symbolId, includeSource, limit }) =>
    reply(
      await callBridge("/internal/evidence", {
        method: "POST",
        body: JSON.stringify({ ids, filePath, kind, symbolId, includeSource, limit }),
      }),
    ),
);

server.registerTool(
  "get_scenario_context",
  {
    title: "Scenario 맥락",
    description:
      "anchor에서 N hop 이내의 Concept·Claim·Evidence를 bounded하게 돌려준다. " +
      "\"이 기능이 어떻게 동작하는가\"를 설명할 재료다.",
    inputSchema: {
      anchor: z.string().describe("Concept id 또는 이름"),
      question: z.string().optional().describe("사용자의 질문 원문"),
      hops: z.number().optional().describe("기본 2"),
    },
  },
  async ({ anchor, question, hops }) =>
    reply(await callBridge(`/internal/scenario-context${query({ anchor, question, hops })}`)),
);

/**
 * Impact View는 이번 범위 밖이다 (§4).
 *
 * tool을 아예 없애지 않고 **자리를 남긴다** — agent가 물어봤을 때 "없다"가 아니라
 * "아직 켜지지 않았다"를 알려 주는 편이 정직하고, 나중에 붙일 자리도 분명해진다.
 */
server.registerTool(
  "get_impact_context",
  {
    title: "Impact 맥락 (아직 비활성)",
    description:
      "이 프로토타입에서는 아직 켜지지 않았다. 호출하면 not_enabled를 돌려준다. " +
      "영향 범위를 물어보면 대신 get_evidence와 Trace로 근거를 직접 따라가라.",
    inputSchema: { anchor: z.string().optional() },
  },
  async () =>
    reply({
      error: "not_enabled",
      next_step:
        "Impact View는 이 프로토타입 범위 밖입니다. get_evidence 로 근거를 직접 따라가세요.",
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready; bridge = ${bridge.baseUrl}`);
