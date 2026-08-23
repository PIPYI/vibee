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
  · 이 anchor에서 인덱싱된 관계로 어디까지 닿는가  -> get_impact_context (authored reachability, impact 아님)
  · 엔진이 못 본 근거를 등록하려면                -> propose_evidence
  · 만든 의미를 저장하려면                       -> submit_semantic_patch

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

// ---------------------------------------------------------------------------
// 쓰기 tool (§6.5) — 검증은 전부 Core 가 한다. 여기는 loopback 위임만
// ---------------------------------------------------------------------------

const entityRefSchema = z.union([
  z.object({ kind: z.literal("file"), filePath: z.string() }),
  z.object({ kind: z.literal("symbol"), symbolId: z.string() }),
  z.object({ kind: z.literal("route"), routeKey: z.string() }),
  z.object({ kind: z.literal("model"), modelKey: z.string() }),
]);

const graphRoleSchema = z.union([
  z.object({ role: z.literal("entity"), entity: entityRefSchema, label: z.string() }),
  z.object({ role: z.literal("link"), from: entityRefSchema, to: entityRefSchema, linkKind: z.string() }),
]);

server.registerTool(
  "propose_evidence",
  {
    title: "발견한 근거 등록 요청",
    description:
      "엔진이 인덱싱하지 못한 근거(switch 로 짜인 상태 기계, 설정이 결정하는 정책, 템플릿 " +
      "리터럴 route, 주석의 불변식 등)를 발견했을 때 쓴다. **버리지 말고 여기로 등록을 " +
      "요청하라.** Core 가 그 범위를 직접 읽어 검증한 뒤 id 를 발급한다 — 발급받은 id 에만 " +
      "grounding 할 수 있다. analyze turn 밖에서 부르면 no_active_transaction 을 돌려준다.",
    inputSchema: {
      kind: z.string().describe("evidence kind. 예: policy_note · state_machine · route_pattern"),
      filePath: z.string().describe("repo-relative POSIX 경로. \"..\"·절대경로·.git 은 거절된다"),
      location: z.object({
        startLine: z.number().int().min(1),
        endLine: z.number().int().min(1).optional(),
      }),
      symbolHint: z
        .string()
        .optional()
        .describe("이것이라고 믿는 qualified name. 불일치는 error 가 아니라 warning"),
      summary: z.string().describe("왜 이것이 근거인가"),
      confidence: z.number().min(0).max(1).optional(),
      normalizationProfile: z
        .enum(["code", "prose"])
        .optional()
        .describe("생략하면 확장자로 Core 가 정한다. 주석·문서·설정 범위는 prose 를 권한다"),
      graph: graphRoleSchema
        .optional()
        .describe("Trace 에 표시할 EntityRef 힌트. 해석되지 않으면 근거로는 등록되지만 Trace 에는 나오지 않는다"),
    },
  },
  async (proposal) =>
    reply(await callBridge("/internal/propose-evidence", { method: "POST", body: JSON.stringify(proposal) })),
);

const conceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  hints: z.array(z.string()).optional(),
  evidenceRefs: z.array(z.string()),
  intentRefs: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "uncertain", "deprecated", "needs_review"]),
});

const claimSchema = z.object({
  id: z.string(),
  subjectConceptId: z.string(),
  predicate: z.string().describe("자유 문장이다. 미리 정한 관계 종류로 정규화하지 마라"),
  object: z.union([z.object({ conceptId: z.string() }), z.object({ value: z.string() })]),
  description: z.string().optional(),
  semanticHint: z.string().optional(),
  evidenceRefs: z.array(z.string()),
  intentRefs: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "uncertain", "contradicted", "needs_review"]),
});

const scenarioEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["user", "system"]),
  goal: z.string().optional(),
  anchorConceptIds: z.array(z.string()),
  status: z.enum(["active", "uncertain", "deprecated"]),
});

const groundingUpdateSchema = z.union([
  z.object({
    target: z.literal("concept"),
    conceptId: z.string(),
    evidenceRefs: z.array(z.string()),
    confidence: z.number().min(0).max(1).optional(),
  }),
  z.object({
    target: z.literal("claim"),
    claimId: z.string(),
    evidenceRefs: z.array(z.string()),
    confidence: z.number().min(0).max(1).optional(),
  }),
]);

server.registerTool(
  "submit_semantic_patch",
  {
    title: "Semantic Patch 제출",
    description:
      "Concept·Claim·Scenario 의 추가/갱신/삭제를 하나의 patch 로 제출한다. base 버전이 " +
      "head 와 다르면 version/stale-base 로 거절되고 그 사이의 SemanticDiff 가 diagnostics 에 " +
      "함께 온다 — 그것을 보고 rebase 한 뒤 다시 제출하라. 그 외의 실패도 diagnostics 로 " +
      "돌아오며 같은 turn 에서 고쳐 다시 제출할 수 있다. 새 Concept 를 만들기 전에는 " +
      "get_concept_context 로 재사용 후보를 먼저 확인하라.",
    inputSchema: {
      baseAnalysisVersion: z.number().int().describe("이 turn 시작 시점의 analysisVersion. turn 내내 그대로"),
      baseSemanticVersion: z.number().int().describe("이 patch 가 기준으로 삼는 semanticVersion"),
      addedConcepts: z.array(conceptSchema).optional(),
      updatedConcepts: z.array(conceptSchema).optional(),
      removedConceptIds: z.array(z.string()).optional(),
      addedClaims: z.array(claimSchema).optional(),
      updatedClaims: z.array(claimSchema).optional(),
      removedClaimIds: z.array(z.string()).optional(),
      addedScenarios: z.array(scenarioEntrySchema).optional(),
      updatedScenarios: z.array(scenarioEntrySchema).optional(),
      removedScenarioIds: z.array(z.string()).optional(),
      groundingUpdates: z.array(groundingUpdateSchema).optional(),
    },
  },
  async (patch) =>
    reply(await callBridge("/internal/semantic-patch", { method: "POST", body: JSON.stringify(patch) })),
);

/**
 * `ir`의 정확한 shape은 Core의 ajv schema(단 한 벌, A6)가 검증한다 — 여기서 zod로
 * 다시 베끼지 않는다. `description`이 그 shape을 사람이 읽는 말로 설명한다.
 */
server.registerTool(
  "submit_view_ir",
  {
    title: "View IR 제출",
    description:
      "Overview 또는 Scenario View를 제출한다. **좌표(x/y)를 넣지 마라** — layout은 " +
      "렌더러가 계산한다. 개수 제한은 없지만 넘치면 warning으로 알려 준다(제출은 성공한다).\n\n" +
      "viewKind \"overview\"의 ir: { title, areas: [{ id, label, items: [{ id, label, " +
      "conceptRefs?, scenarioRefs? }] }], importantConnections?: [{ from, to, label? }] }. " +
      "conceptRefs/scenarioRefs는 실재하는 Concept/Scenario id여야 하고, " +
      "importantConnections의 from/to는 이 Overview 안의 item id를 가리켜야 한다.\n\n" +
      "viewKind \"scenario\"의 ir: { id, name, type: \"user\"|\"system\", goal?, outcome?, " +
      "participants: [{ id, label, conceptRefs? }], steps: [{ id, label, participantId?, " +
      "conceptRefs, evidenceRefs }], transitions: [{ fromStepId, toStepId, condition?, loop?, " +
      "evidenceRefs }], branches?, stateChanges?, entryStepId, outcomeStepIds }. " +
      "**모든 step은 evidenceRefs가 하나 이상 있어야 하고 entryStepId에서 도달할 수 있어야 " +
      "한다.** DAG일 필요는 없다 — 재시도/재신청 루프는 그 transition에 loop:true와 " +
      "반드시 condition을 함께 표시한다(같은 행동을 반복된 step으로 펼치지 마라).\n\n" +
      "실패하면 diagnostics로 이유와 supportedFixes가 온다 — 같은 turn에서 고쳐 다시 제출하라.",
    inputSchema: {
      viewKind: z.enum(["overview", "scenario"]),
      ir: z.record(z.unknown()).describe("OverviewIR 또는 viewKind가 가리키는 ScenarioIR"),
    },
  },
  async ({ viewKind, ir }) =>
    reply(await callBridge("/internal/submit-view-ir", { method: "POST", body: JSON.stringify({ viewKind, ir }) })),
);

/**
 * Authored reachability (schema2 §6, M12) — **Impact가 아니다.** archify가 스스로 그은
 * 경계를 그대로 따른다: 이 tool이 답하는 것은 "인덱싱된 관계를 따라 여기서 저기에 닿는가"
 * 뿐이다. "이걸 고치면 무엇이 깨지는가"(실행 시 인과)는 답하지 않는다 — 인덱서가 못 본
 * 관계(동적 디스패치·설정·문자열 키)는 결과에 없다.
 *
 * Trace(§6.6 R4)와 같은 이유로 **결정론적으로 투영**한다 — AI가 만들지 않는다.
 */
server.registerTool(
  "get_impact_context",
  {
    title: "Authored Reachability",
    description:
      "anchor에서 한 방향으로 인덱싱된 관계를 따라 도달 가능한 code entity를 bounded하게 " +
      "돌려준다. direction: \"downstream\"은 anchor가 무엇으로 이어지는가, \"upstream\"은 " +
      "무엇이 anchor로 이어지는가. **이것은 authored reachability이지 impact가 아니다** — " +
      "실행 시 영향·인과를 주장하지 않는다. anchor는 Concept id/name, symbolId(path#name " +
      "모양), 또는 file path.",
    inputSchema: {
      anchor: z.string(),
      direction: z.enum(["upstream", "downstream"]),
      hops: z.number().int().min(1).max(6).optional(),
    },
  },
  async ({ anchor, direction, hops }) =>
    reply(await callBridge(`/internal/impact-context${query({ anchor, direction, hops })}`)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready; bridge = ${bridge.baseUrl}`);
