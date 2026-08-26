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

import { ANALYSIS_BUNDLE_SCHEMA, BRIDGE_TOKEN_HEADER, analysisContractDigest } from "@onto/protocol";
import { loadBridgeConfig, protoRootFromModule } from "@onto/protocol/bridge-config";
import { jsonSchemaToZod } from "./json-schema-zod.js";

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

/** 큰 Assembly packet은 pretty print와 structuredContent 중복 없이 한 번만 전송한다. */
function compactReply(payload: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
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
  · full assembly의 전체 참조 후보를 처음 받을 때  -> get_assembly_context (첫 조회 정확히 1회)
  · 이 개념은 무엇이고 어디에 근거하는가          -> get_concept_context
  · 여러 개념을 한 번에 조회하려면                -> get_concept_context_batch
  · 어떤 주장들이 있는가                         -> search_claims
  · 이 파일/심볼의 실제 근거는 무엇인가           -> get_evidence (여러 id는 ids 배열로 한 번에)
  · 이 기능은 어떻게 동작하는가 (흐름)            -> get_scenario_context
  · 여러 기능/anchor를 한 번에 조회하려면          -> get_scenario_context_batch
  · 이 anchor에서 인덱싱된 관계로 어디까지 닿는가  -> get_impact_context (authored reachability, impact 아님)
  · 여러 anchor의 관계를 한 번에 조회하려면          -> get_impact_context_batch
  · 검증된 시스템 entity/link ID를 조회하려면          -> get_system_facts (여러 id는 entityIds 배열로 한 번에)
  · 이번 증분 분석의 gap·영향 ID·patch 범위를 보려면    -> get_incremental_analysis_context
  · 엔진이 못 본 근거를 등록하려면                -> propose_evidence
  · 엔진이 모르는 시스템 대상과 관계를 등록하려면   -> propose_system_facts
  · 만든 의미를 저장하려면                       -> submit_semantic_patch
  · 아키텍처/워크플로우/시퀀스 한 벌을 제출하려면    -> submit_analysis_bundle (assembly turn 전용)
  · Bundle 검증 오류의 일부 경로만 고치려면         -> patch_analysis_bundle (draftId 필요)
  · Architecture 뷰를 archify 패턴으로 직접 저작해 검증하려면 -> validate_architecture_view
    (architecture turn 전용. 좌표를 AI가 직접 쓴다 — grounding tool과 무관하다)
  · 검증을 통과한 Architecture 뷰를 저장하려면      -> submit_architecture_view

중요한 규칙:

1. 경로·심볼·줄번호를 지어내지 마라. 모든 참조는 실재하는 id여야 한다.
2. 엔진이 인덱싱하지 못한 단일 근거는 propose_evidence로, 신규 시스템 대상과 그 관계는
   propose_system_facts로 등록하라.
   Core가 검증한 뒤 id를 발급하며, 발급받은 id에만 grounding할 수 있다.
3. 사용자에게 보이는 label은 파일명·함수명이 아니라 프로젝트의 도메인 용어로 쓴다.
   기술 세부는 Trace View에서만 노출한다.
4. full assembly는 get_assembly_context를 첫 자료 조회로 정확히 1회 호출한다. 개별 semantic,
   system fact, impact, scenario, evidence 조회는 packet 누락 또는 validator diagnostics를
   확인할 때만 fallback으로 사용한다.

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
  "get_assembly_context",
  {
    title: "Full Assembly compact context",
    description:
      "full assembly의 첫 자료 조회에서 정확히 1회 호출한다. Concept·Claim·CanonicalScenario와 " +
      "현재 사용 가능한 System Entity/Link 참조 후보 전체를 compact packet으로 돌려준다. " +
      "개별 read tool은 packet 누락 또는 validator diagnostics를 확인할 때만 fallback으로 쓴다.",
    inputSchema: {},
  },
  async () => compactReply(await callBridge("/internal/assembly-context")),
);

server.registerTool(
  "patch_analysis_bundle",
  {
    title: "AnalysisBundle draft 부분 보정",
    description:
      "증분 assembly에서는 get_incremental_analysis_context의 기존 draftId로 바로 쓰고, 전체 assembly에서는 " +
      "submit_analysis_bundle이 retryable=true와 draftId를 돌려준 뒤 쓴다. 전체 Bundle을 " +
      "다시 출력하지 말고 ImpactSet 또는 diagnostics.subject.path가 가리키는 경로만 RFC 6902 형태로 " +
      "add/remove/replace한다. 허용 root는 /architecture, /workflow, /userMap, /sequences뿐이다. " +
      "최대 검증 횟수는 최초 제출을 포함해 3회이며 retryable=false 뒤에는 다시 호출하지 마라.",
    inputSchema: {
      draftId: z.string().min(1),
      operations: z.array(z.object({
        op: z.enum(["add", "remove", "replace"]),
        path: z.string().startsWith("/"),
        value: z.unknown().optional(),
      }).strict()).min(1),
    },
  },
  async ({ draftId, operations }) =>
    reply(
      await callBridge("/internal/patch-analysis-bundle", {
        method: "POST",
        body: JSON.stringify({ draftId, operations }),
      }),
    ),
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
  "get_concept_context_batch",
  {
    title: "Concept 맥락 일괄 조회",
    description:
      "둘 이상의 Concept를 확인할 때 쓴다. Concept마다 get_concept_context를 반복 호출하지 " +
      "말고 최대 12개(conceptId·name 합산)를 한 요청으로 묶는다. 결과는 항목별로 분리된다.",
    inputSchema: {
      conceptIds: z.array(z.string().min(1)).max(12).optional().describe("Concept id들"),
      names: z.array(z.string().min(1)).max(12).optional().describe("이름으로 찾을 것들"),
    },
  },
  async ({ conceptIds, names }) =>
    compactReply(
      await callBridge("/internal/concepts-batch", {
        method: "POST",
        body: JSON.stringify({ conceptIds, names }),
      }),
    ),
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

server.registerTool(
  "get_scenario_context_batch",
  {
    title: "Scenario 맥락 일괄 조회",
    description:
      "둘 이상의 Scenario/Concept anchor를 같은 hops로 확인할 때 쓴다. anchor마다 " +
      "get_scenario_context를 반복 호출하지 말고 최대 12개를 한 요청으로 묶는다. " +
      "결과는 anchor별로 분리된다.",
    inputSchema: {
      anchors: z.array(z.string().min(1)).min(1).max(12),
      hops: z.number().optional().describe("기본 2"),
    },
  },
  async ({ anchors, hops }) =>
    compactReply(
      await callBridge("/internal/scenario-context-batch", {
        method: "POST",
        body: JSON.stringify({ anchors, hops }),
      }),
    ),
);

server.registerTool(
  "get_system_facts",
  {
    title: "검증된 System Fact 조회",
    description:
      "현재 generation의 System Entity와 System Link를 조회한다. Architecture component.entityRefs와 " +
      "connection.systemLinkRefs는 이 응답의 ID를 사용해야 한다. 기본 지도에는 certainty가 " +
      "confirmed|grounded이고 status가 valid|relocated인 Link만 사용하라.",
    inputSchema: {
      origin: z.enum(["engine", "vibee"]).optional(),
      certainty: z.enum(["confirmed", "grounded", "inferred"]).optional(),
      status: z.enum(["valid", "relocated", "stale", "missing", "needs_review"]).optional(),
      entityId: z.string().optional().describe("특정 entity 하나만"),
      entityIds: z
        .array(z.string())
        .optional()
        .describe("특정 entity 여러 개를 한 번에 — 하나씩 반복 호출하지 마라"),
      limit: z.number().int().min(1).max(2000).optional(),
    },
  },
  async ({ origin, certainty, status, entityId, entityIds, limit }) =>
    reply(
      await callBridge(
        `/internal/system-facts${query({ origin, certainty, status, entityId, entityIds: entityIds?.join(","), limit })}`,
      ),
    ),
);

server.registerTool(
  "get_incremental_analysis_context",
  {
    title: "V4 증분 분석 범위",
    description:
      "현재 task의 PreviousSystemDigest, SystemImpactSet, discovery gaps, provider-neutral integration " +
      "catalog, 기존 Bundle draftId와 영향받은 조각의 정확한 JSON path/value(bundleTargets)를 돌려준다. " +
      "증분 turn에서는 저장소 전체나 Bundle 전체를 다시 " +
      "출력하지 말고 이 응답의 filePaths와 허용 ID만 조사·수정한다.",
    inputSchema: {},
  },
  async () => reply(await callBridge("/internal/incremental-analysis-context")),
);

// ---------------------------------------------------------------------------
// 쓰기 tool (§6.5) — 검증은 전부 Core 가 한다. 여기는 loopback 위임만
// ---------------------------------------------------------------------------

const entityRefSchema = z.union([
  z.object({ kind: z.literal("file"), filePath: z.string() }),
  z.object({ kind: z.literal("symbol"), symbolId: z.string() }),
  z.object({ kind: z.literal("route"), routeKey: z.string() }),
  z.object({ kind: z.literal("model"), modelKey: z.string() }),
  z.object({ kind: z.literal("resource"), namespace: z.string(), key: z.string() }),
]);

const graphRoleSchema = z.union([
  z.object({ role: z.literal("entity"), entity: entityRefSchema, label: z.string() }),
  z.object({
    role: z.literal("link"),
    from: entityRefSchema,
    to: entityRefSchema,
    linkKind: z.string(),
    mechanism: z.string().optional(),
    certainty: z.enum(["grounded", "inferred"]).optional(),
  }),
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

const proposedEntityEndpointSchema = z.union([
  z.object({ entityId: z.string().min(1) }).strict(),
  z.object({ localId: z.string().min(1) }).strict(),
]);

server.registerTool(
  "propose_system_facts",
  {
    title: "System Fact 원자적 등록 요청",
    description:
      "Core adapter가 모르는 runtime·route·외부 SDK·저장소와 호출 관계를 발견했을 때 쓴다. " +
      "source anchors, 신규 entities, 그 entities를 endpoint로 쓰는 links를 한 batch로 제출한다. " +
      "Core가 모든 경로와 범위를 직접 검증하고 하나라도 잘못되면 batch 전체를 거절한다. " +
      "grounded source contract가 부족한 fact는 inferred로 낮춰 보존하며 Architecture의 확정 edge에는 쓸 수 없다. " +
      "성공한 제안은 다음 submit_semantic_patch와 같은 generation에 원자적으로 커밋된다.",
    inputSchema: {
      baseAnalysisVersion: z.number().int().min(0),
      anchors: z.array(z.object({
        localId: z.string().min(1),
        kind: z.string().min(1).describe("call, import, dependency, config, route, handler, branch 등의 source 역할"),
        filePath: z.string().min(1),
        location: z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1).optional() }),
        symbolHint: z.string().optional(),
        summary: z.string().min(1),
        normalizationProfile: z.enum(["code", "prose"]).optional(),
      }).strict()),
      entities: z.array(z.object({
        localId: z.string().min(1),
        ref: entityRefSchema,
        kind: z.string().min(1),
        anchorLocalIds: z.array(z.string().min(1)),
        certainty: z.enum(["grounded", "inferred"]),
      }).strict()),
      links: z.array(z.object({
        localId: z.string().min(1),
        from: proposedEntityEndpointSchema,
        to: proposedEntityEndpointSchema,
        kind: z.string().min(1),
        mechanism: z.string().optional(),
        anchorLocalIds: z.array(z.string().min(1)),
        dependencyAnchorLocalIds: z.array(z.string().min(1)).optional(),
        certainty: z.enum(["grounded", "inferred"]),
      }).strict()),
    },
  },
  async (proposal) =>
    reply(await callBridge("/internal/propose-system-facts", { method: "POST", body: JSON.stringify(proposal) })),
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
 * schema3 §5.2 Stage 3~4 — assembly turn 전용. `ir`의 shape을 zod로 다시 베끼지 않는 것은
 * `submit_view_ir`와 같은 이유다(Core의 ajv schema가 유일한 출처, A6).
 */
const analysisBundleInputSchema = jsonSchemaToZod(ANALYSIS_BUNDLE_SCHEMA);

server.registerTool(
  "submit_analysis_bundle",
  {
    title: "Architecture/User Map/Sequence Bundle 제출",
    description:
      "이번 assembly turn에서 만든 ArchitectureIR + WorkflowIR + UserMapIR + SequenceIR 전체를 한 번에 " +
      "제출한다. analyze turn(Stage 2)이 끝난 뒤 이어지는 assembly turn 밖에서 부르면 " +
      "no_active_transaction을 돌려준다.\n\n" +
      "architecture: { title, components: [{ id, label, presentationType, entityRefs, " +
      "evidenceRefs, description?, inputs?, outputs?, boundaryId?, conceptRefs?, sublabel?, " +
      "confidence? }], boundaries: [{ id, label, kind, wraps }], connections: [{ id, from, to, " +
      "systemLinkRefs, evidenceRefs, label?, role? }] }. V3 traceLinkRefs는 읽기 migration 전용이다.\n\n" +
      "workflow: { title, lanes: [{ id, label, kind }], mainPath: [nodeId...], " +
      "nodes: [{ id, laneId, label, presentationType, entityRefs, evidenceRefs, ... }], " +
      "edges: [{ id, from, to, role, evidenceRefs, label?, labelTerms?, sequenceRef? }] }.\n\n" +
      "userMap: { title, journeys: [ScenarioIR...] }. 각 journey는 하나의 Canonical Scenario만 " +
      "설명하며 { id, name, type, goal?, outcome?, participants, steps, transitions, branches?, " +
      "stateChanges?, phases?, entryStepId, outcomeStepIds } 형태다. 서로 다른 목적을 한 journey에 " +
      "합치지 않는다.\n\n" +
      "sequences: [{ id, title, triggeredByEdgeId, participants, messages: [{ id, " +
      "fromParticipantId, toParticipantId, order, label, kind(\"call\" | \"return\" | \"event\"), evidenceRefs }], activations?, " +
      "phases?, evidenceRefs }].\n\n" +
      "**규칙**: entityRefs는 실재하는 System Entity ID만, evidenceRefs는 실재하고 " +
      "present인 evidence id만 가리켜야 한다(빈 배열 금지, I9). connections.systemLinkRefs는 " +
      "confirmed|grounded + valid|relocated System Link의 연속된 방향 경로여야 한다(I20-v4). " +
      "edge.sequenceRef와 그 SequenceIR.triggeredByEdgeId는 서로 일치해야 한다(1엣지-1시퀀스). " +
      "presentationType은 표시용 분류일 뿐이다 — 확신이 없으면 \"unknown\"을 쓴다.\n\n" +
      "자주 틀리는 정확한 계약:\n" + analysisContractDigest() + "\n\n" +
      "실패하면 diagnostics로 이유와 supportedFixes가 온다. retryable=false면 자동 보정 한도를 " +
      "사용한 것이므로 더 제출하지 마라.",
    inputSchema: analysisBundleInputSchema,
  },
  async (bundle) =>
    reply(
      await callBridge("/internal/submit-analysis-bundle", {
        method: "POST",
        body: JSON.stringify(bundle),
      }),
    ),
);

/**
 * v7 — Architecture 뷰 전용 archify 패턴 저작 turn의 산출물 shape. `submit_analysis_bundle`과
 * 달리 여기서는 shape을 느슨하게만 잡는다(A6의 "schema는 한 벌만" 원칙은 지키되, 그 한 벌은
 * `@onto/architecture-view`의 ajv schema다 — `$ref`/`$defs`를 쓰므로 `jsonSchemaToZod`가
 * 아직 지원하지 않는다). 진짜 검증은 bridge가 `validateArchitectureView()`로 한다.
 */
const architectureViewDocumentShape = {
  schemaVersion: z.literal(1),
  title: z.string(),
  viewBox: z.tuple([z.number(), z.number()]).optional(),
  repository: z.object({ url: z.string().optional(), revision: z.string().optional() }).optional(),
  components: z.array(z.record(z.string(), z.unknown())),
  boundaries: z.array(z.record(z.string(), z.unknown())),
  connections: z.array(z.record(z.string(), z.unknown())),
  cards: z.array(z.record(z.string(), z.unknown())).optional(),
};

server.registerTool(
  "validate_architecture_view",
  {
    title: "Architecture 뷰 문서 검증",
    description:
      "저작한 ArchitectureViewDocument를 제출하지 않고 검증만 한다. schema(스키마 미준수) → " +
      "geometry(viewBox 이탈·24px 통로 미달·끊어진 참조·실제 route의 edge-crosses-component·label collision) → completeness(탐지된 런타임/데이터" +
      "저장소/라우트를 인용하는 component가 있는지, warning일 뿐 hard reject 아님) → citation" +
      "(sources[]의 경로·줄 범위가 실재하는지, 인용이 있을 때만 동작) 순으로 돈다. schema 오류가 " +
      "있으면 나머지 층은 건너뛰고 schema 오류만 돌아온다. diagnostics가 비어 있으면 " +
      "submit_architecture_view로 제출한다. schema가 맞으면 응답의 layout에 실제 box/route points도 들어 있다. " +
      "validate_architecture_view와 submit_architecture_view는 합쳐 최대 6회다. severity:\"error\"가 하나라도 있으면 제출이 거절된다.",
    inputSchema: architectureViewDocumentShape,
  },
  async (document) =>
    reply(
      await callBridge("/internal/validate-architecture-view", {
        method: "POST",
        body: JSON.stringify(document),
      }),
    ),
);

server.registerTool(
  "submit_architecture_view",
  {
    title: "Architecture 뷰 문서 제출",
    description:
      "검증을 통과한 ArchitectureViewDocument를 이 프로젝트의 Architecture 뷰로 커밋한다. " +
      "AnalysisBundle.architecture와는 완전히 별도 저장 경로다 — 이 제출은 " +
      "analysis-bundle-validator의 I20-v4/coverage 검증을 거치지 않는다. 서버가 " +
      "validate_architecture_view와 같은 검증을 다시 돌리므로(defense in depth), " +
      "클라이언트가 이미 검증했다고 생략하지 마라 — error가 있으면 여전히 거절되고 " +
      "diagnostics로 돌아온다.",
    inputSchema: architectureViewDocumentShape,
  },
  async (document) =>
    reply(
      await callBridge("/internal/submit-architecture-view", {
        method: "POST",
        body: JSON.stringify(document),
      }),
    ),
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

server.registerTool(
  "get_impact_context_batch",
  {
    title: "Authored Reachability 일괄 조회",
    description:
      "둘 이상의 중요한 Concept/Scenario anchor를 같은 direction·hops로 확인할 때 쓴다. " +
      "anchor마다 get_impact_context를 반복 호출하지 말고 최대 12개를 한 요청으로 묶는다. " +
      "결과는 anchor별로 분리되며 이것도 실행 시 impact가 아니라 인덱싱된 authored reachability다.",
    inputSchema: {
      anchors: z.array(z.string().min(1)).min(1).max(12),
      direction: z.enum(["upstream", "downstream"]),
      hops: z.number().int().min(1).max(6).optional(),
    },
  },
  async ({ anchors, direction, hops }) =>
    reply(await callBridge("/internal/impact-context-batch", {
      method: "POST",
      body: JSON.stringify({ anchors, direction, hops }),
    })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready; bridge = ${bridge.baseUrl}`);
