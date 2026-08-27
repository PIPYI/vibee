#!/usr/bin/env node
/**
 * Vibee MCP server (stdio).
 *
 * Agent가 MCP를 통해 앱에 도달할 수 있게 하는 tool을 노출한다.
 *
 *   get_app_context -> 지금 선택한 프로젝트와 인터뷰 상태를 읽는다
 *   ask_user        -> 인터뷰 중 사용자에게 질문을 던진다
 *   save_design     -> 요구사항 인터뷰 결과를 저장한다
 *   show_result     -> 구조화된 결과를 앱으로 push 한다
 *
 * 이 서버는 자체 상태를 갖지 않는다. 모든 도구가 loopback HTTP로 local bridge에
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
  type ArchitectureContext,
  type ArchitectureDebtReport,
  type AskUserInput,
  type DesignDoc,
  type ShowResultInput,
  type ReviewContext,
  type ReportDriftInput,
  type DriftVerifyContext,
  type VerifyDriftFixInput,
  type WikiContext,
  type WikiPageInput,
  type WikiTranscript,
} from "@vci/protocol";
import { appRootFromModule, loadBridgeConfig } from "@vci/protocol/node";

function log(...args: unknown[]): void {
  console.error("[vci-mcp]", ...args);
}

/**
 * BRIDGE_URL/BRIDGE_TOKEN은 등록 스크립트가 주입한다. 디스크의 설정 파일로
 * fallback 해 두면 수동으로 등록한 서버도 동작한다.
 */
function resolveBridge(): { baseUrl: string; token: string } {
  const envUrl = process.env.BRIDGE_URL;
  const envToken = process.env.BRIDGE_TOKEN;
  if (envUrl && envToken) return { baseUrl: envUrl.replace(/\/$/, ""), token: envToken };

  const config = loadBridgeConfig(appRootFromModule(import.meta.url));
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
      `Cannot reach the Vibee bridge at ${bridge.baseUrl}. Is it running (npm run bridge)? ${String(cause)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Bridge responded ${response.status} for ${path}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// 시스템 맵 tool 3개의 입력 스키마 (vibee의 packages/mcp-server/src/index.ts 포팅).
//
// 형태는 갖추되 값은 느슨하게 둔다 — pos/size가 숫자 배열이라는 "모양"은 선언해야
// Claude Agent SDK의 tool-argument 직렬화가 구조를 안다고 신호를 주지만, 실제 엄격한
// 검증(min/max/enum 등)은 서버 쪽 ajv 스키마(@vci/system-map의 validateSystemMap/
// validateRuntimeSemantics)가 한다. 여기서 거부하지 않고 항상 bridge까지 보내서
// subject/evidence/supportedFixes가 붙은 진짜 diagnostic으로 돌려받게 한다.
const sourceInputSchema = z
  .object({
    path: z.string().optional(),
    line: z.number().optional(),
    endLine: z.number().optional(),
    label: z.string().optional(),
  })
  .passthrough();

const presentationOverrideInputSchema = z
  .object({
    label: z.string().optional(),
    sublabel: z.string().optional(),
    visibility: z.string().optional(),
  })
  .passthrough();

const audiencePresentationInputSchema = z
  .object({
    simple: presentationOverrideInputSchema.optional(),
    technical: presentationOverrideInputSchema.optional(),
  })
  .passthrough();

const componentInputSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    semanticRole: z.string().optional(),
    semanticRefs: z.array(z.string()).optional(),
    label: z.string().optional(),
    sublabel: z.string().optional(),
    presentation: audiencePresentationInputSchema.optional(),
    pos: z.array(z.number()).optional(),
    size: z.array(z.number()).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const boundaryInputSchema = z
  .object({
    id: z.string().optional(),
    kind: z.string().optional(),
    semanticRefs: z.array(z.string()).optional(),
    label: z.string().optional(),
    presentation: audiencePresentationInputSchema.optional(),
    wraps: z.array(z.string()).optional(),
    pad: z.number().optional(),
  })
  .passthrough();

const connectionInputSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    semanticRefs: z.array(z.string()).optional(),
    label: z.string().optional(),
    presentation: audiencePresentationInputSchema.optional(),
    variant: z.string().optional(),
  })
  .passthrough();

const cardInputSchema = z
  .object({
    dot: z.string().optional(),
    title: z.string().optional(),
    items: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * validate_system_map/submit_system_map의 입력. semanticRevision(submit_runtime_semantics가
 * 돌려준 번호)을 문서 필드와 한 평면(flat) 객체로 같이 받는다 — 다른 두 tool과 입력 모양
 * 컨벤션을 하나로 맞추기 위해서다. 여기서는 optional로만 두고, 실제로 있어야 한다는 것과
 * 커밋된 리비전을 가리켜야 한다는 것은 bridge 라우트가 강제한다.
 */
const documentInputSchema = z
  .object({
    semanticRevision: z.number().optional(),
    schemaVersion: z.number().optional(),
    title: z.string().optional(),
    viewBox: z.array(z.number()).optional(),
    repository: z
      .object({ url: z.string().optional(), revision: z.string().optional() })
      .passthrough()
      .optional(),
    presentation: z
      .object({
        defaultAudience: z.string().optional(),
        availableAudiences: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
    components: z.array(componentInputSchema).optional(),
    boundaries: z.array(boundaryInputSchema).optional(),
    connections: z.array(connectionInputSchema).optional(),
    cards: z.array(cardInputSchema).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// RuntimeSemanticDocument 입력 스키마. packages/protocol/src/index.ts의
// RuntimeSemanticDocument와 필드 단위로 대응한다.
// ---------------------------------------------------------------------------

const implementationHintInputSchema = z
  .object({
    label: z.string().optional(),
    kind: z.string().optional(),
  })
  .passthrough();

const actorInputSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const runtimeUnitInputSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    kind: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const responsibilityInputSchema = z
  .object({
    id: z.string().optional(),
    runtimeId: z.string().optional(),
    label: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const stateInputSchema = z
  .object({
    id: z.string().optional(),
    runtimeId: z.string().optional(),
    label: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const externalInputSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    kind: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const interactionInputSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    label: z.string().optional(),
    kind: z.string().optional(),
    implementationHints: z.array(implementationHintInputSchema).optional(),
    sources: z.array(sourceInputSchema).optional(),
  })
  .passthrough();

const runtimeSemanticDocumentInputSchema = z
  .object({
    schemaVersion: z.number().optional(),
    title: z.string().optional(),
    repository: z
      .object({ url: z.string().optional(), revision: z.string().optional() })
      .passthrough()
      .optional(),
    actors: z.array(actorInputSchema).optional(),
    runtimes: z.array(runtimeUnitInputSchema).optional(),
    responsibilities: z.array(responsibilityInputSchema).optional(),
    states: z.array(stateInputSchema).optional(),
    externals: z.array(externalInputSchema).optional(),
    interactions: z.array(interactionInputSchema).optional(),
  })
  .passthrough();

/**
 * 방어적 정규화: JSON 객체/배열이어야 할 값이 JSON으로 인코딩된 문자열로 오면(실측된
 * 실패 패턴 — Claude Agent SDK의 tool-argument 직렬화가 구조를 문자열로 납작하게 만드는
 * 경우가 있었다) 파싱한다. 알려진 문서 모양 안으로만 재귀하므로 label 같은 진짜 문자열
 * 필드를 건드리지 않는다.
 */
function coerceJsonStrings(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return coerceJsonStrings(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(coerceJsonStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, coerceJsonStrings(v)]));
  }
  return value;
}

const server = new McpServer(
  { name: "vci-app", version: "0.1.0" },
  {
    instructions:
      "Tools for the Vibee app. Call get_app_context before starting work " +
      "to learn which project and UI selection the user is looking at, and call show_result " +
      "exactly once when finished to render a structured summary in the app. During a " +
      "requirements interview, ask one question at a time with ask_user and save the draft " +
      "with save_design instead of show_result.",
  },
);

server.registerTool(
  "get_app_context",
  {
    title: "Get app context",
    description:
      "Return the context currently set in the Vibee browser UI: the selected project " +
      "path, the prompt the user submitted, the selected mock app item, and the interview so " +
      "far. The saved design draft is summarised in `designDigest`; the full document is only " +
      "included when you ask for it with includeDesign.",
    inputSchema: {
      includeDesign: z
        .boolean()
        .optional()
        .describe(
          "Include the full saved design document, not just the digest. It is large, so ask " +
            "for it only when you must rewrite the draft and cannot already see it in this " +
            "conversation — typically when you resumed a session someone else started.",
        ),
    },
  },
  async ({ includeDesign }) => {
    const path = includeDesign ? "/internal/app-context?design=full" : "/internal/app-context";
    const context = await bridgeFetch<AppContext>(path);
    log("get_app_context ->", context.projectPath, includeDesign ? "(design: full)" : "(design: digest)");
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
      "Push a structured result to the Vibee browser UI. It is rendered in a dedicated " +
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
          text: `Result delivered to the Vibee app UI${ack.taskId ? ` for task ${ack.taskId}` : ""}.`,
        },
      ],
    };
  },
);

/**
 * 인터뷰용 tool (docs/requirements_flow.md §4.3).
 *
 * **블로킹하지 않는다.** 질문을 앱에 등록만 하고 즉시 반환한다. MCP tool 호출에는 하드
 * 월클럭 타임아웃이 있어(progress 알림으로도 연장되지 않는다) 사람의 답을 기다릴 수 없기
 * 때문이다. agent는 이 tool을 부른 뒤 곧바로 turn을 끝내야 하고, 답변은 다음 turn에서
 * `get_app_context`로 읽는다.
 */
server.registerTool(
  "ask_user",
  {
    title: "Ask the user a question",
    description:
      "Register ONE question for the user and return immediately. This does NOT wait for an " +
      "answer -- end your turn right after calling it. The user's answer arrives in the next " +
      "turn, readable via get_app_context. Never call this more than once per turn.",
    inputSchema: {
      question: z.string().describe("The question, in plain language a non-programmer understands"),
      why: z.string().optional().describe("Why you are asking, so the user is not left guessing"),
      hints: z
        .array(z.string())
        .optional()
        .describe("Example answers. These are hints, NOT choices -- the user types freely"),
      progress: z
        .object({ step: z.number(), total: z.number() })
        .optional()
        .describe("Rough progress so the user knows the interview is bounded"),
    },
  },
  async (input) => {
    const question = input as AskUserInput;
    const ack = await bridgeFetch<{ questionId: string }>("/internal/questions", {
      method: "POST",
      body: JSON.stringify(question),
    });
    log("ask_user ->", question.question);
    return {
      content: [
        {
          type: "text",
          text:
            `Question ${ack.questionId} delivered to the user. ` +
            `End your turn now -- the answer will be in get_app_context next turn.`,
        },
      ],
    };
  },
);

/**
 * 설계 초안을 **구조화된 형태로** 저장한다 (docs/requirements_flow.md §4.11).
 *
 * `show_result`가 산문을 돌려주는 것과 대비된다. 산문은 사람이 읽기엔 좋지만 파싱할 수 없어
 * 일곱 단위를 데이터로 뽑을 수 없고, 그러면 `app_design.md`도 harness도 렌더할 수 없다.
 * 사람이 읽을 설명은 **이 데이터에서 생성하는 것이지 그 반대가 아니다.**
 */
const sourceSchema = z
  .enum(["user", "ai"])
  .describe('"user" if the user said it, "ai" if you filled it in on their behalf');

server.registerTool(
  "save_design",
  {
    title: "Save the structured design",
    description:
      "Save the app design as structured data. Call this INSTEAD of show_result when you are " +
      "ready to present a draft, and call it again (with the full document, not a patch) each " +
      "time the user corrects something. Everything the app produces -- the plain-language " +
      "explanation, app_design.md, and the agent harness -- is rendered from this data, so " +
      "prose belongs in the fields, not around them. Derive FLOW step order and ENTITY " +
      "relations from what the user described; do not leave them empty because they were not " +
      "stated outright. Mark anything you decided yourself with source: \"ai\".",
    inputSchema: {
      title: z.string().describe("Short name for the app, in the user's own words"),
      summary: z.string().describe("One paragraph: what this app is, for a non-programmer"),
      actors: z
        .array(z.object({ id: z.string(), name: z.string(), note: z.string().optional() }))
        .describe("Who uses it"),
      reqs: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            source: sourceSchema,
            note: z.string().optional(),
          }),
        )
        .describe("What they can do (use cases)"),
      surfaces: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            shows: z.array(z.string()).describe("REQ ids reachable from this screen"),
            source: sourceSchema,
            note: z.string().optional(),
          }),
        )
        .describe("Screens. Derive these from the reqs -- never ask the user about screens"),
      entities: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            relations: z
              .array(z.string())
              .describe('Relations to other entities in plain words, e.g. "belongs to E2"'),
            states: z.array(z.string()).describe("States this can be in"),
            source: sourceSchema,
            note: z.string().optional().describe("One line on what this is for, for a non-programmer reader"),
          }),
        )
        .describe("What gets stored"),
      flows: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            steps: z
              .array(
                z.object({
                  actor: z.string().optional().describe("ACTOR id"),
                  surface: z.string().optional().describe("SURFACE id"),
                  action: z.string().describe("What happens in this step"),
                  entity: z.string().optional().describe("ENTITY id this step touches"),
                  effect: z.string().optional().describe('e.g. "created", "state = published"'),
                  rule: z.string().optional().describe("RULE id that applies here"),
                }),
              )
              .describe("ORDERED steps -- the order is the point"),
            source: sourceSchema,
          }),
        )
        .describe("Ordered sequences of steps"),
      rules: z
        .array(
          z.object({
            id: z.string(),
            text: z.string(),
            constrains: z.array(z.string()).describe("REQ ids this rule constrains"),
            source: sourceSchema,
          }),
        )
        .describe("Conditions and constraints"),
      decisions: z
        .array(
          z.object({
            id: z.string(),
            text: z.string().describe("What was decided, including what NOT to build"),
            why: z.string().describe("Why -- this is what makes the decision reusable later"),
            source: sourceSchema,
          }),
        )
        .describe('Decisions. "Not now", "skip that", and defaults you chose all belong here'),
    },
  },
  async (input) => {
    const design = input as DesignDoc;
    const ack = await bridgeFetch<{ taskId: string | null; warnings: string[] }>("/internal/design", {
      method: "POST",
      body: JSON.stringify(design),
    });
    log(
      "save_design ->",
      design.title,
      `(reqs ${design.reqs.length}, flows ${design.flows.length}, decisions ${design.decisions.length})`,
    );
    return {
      content: [
        {
          type: "text",
          text:
            `Design saved and rendered in the app UI.` +
            (ack.warnings.length ? `\n\nDangling references you should fix:\n- ${ack.warnings.join("\n- ")}` : ""),
        },
      ],
    };
  },
);

server.registerTool(
  "get_review_context",
  {
    title: "Get what to review",
    description:
      "Return the commits to review and the criteria to check them against. `commits` is " +
      "oldest-first, each with its own `diff` (produced by the app, so you do not need to run " +
      "git), and `criteria` holds the decisions (DEC) and rules (RULE) recorded for this " +
      "project. Those criteria are the ONLY thing to check. General code review is not what " +
      "this is for.",
    inputSchema: {},
  },
  async () => {
    const context = await bridgeFetch<ReviewContext>("/internal/review-context");
    log(
      "get_review_context ->",
      `commits ${context.commits.length},`,
      `criteria ${context.criteria.length}`,
      context.commits.some((c) => c.truncated) ? "(일부 diff 잘림)" : "",
    );
    return {
      content: [{ type: "text", text: JSON.stringify(context, null, 2) }],
      structuredContent: context as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "report_drift",
  {
    title: "Report drift against the project's decisions",
    description:
      "Report which recorded decisions or rules the reviewed commits break. Call this EXACTLY " +
      "ONCE per review -- one call covering ALL commits, including when nothing is broken " +
      "(pass an empty `findings` array). An empty report is a normal, expected outcome; " +
      "reporting things that are not in `criteria` is not. Do not modify any file: you are " +
      "reporting, not fixing.",
    inputSchema: {
      findings: z
        .array(
          z.object({
            commit: z.string().describe("The sha from `commits` where this broke"),
            criterionId: z.string().describe("The id from `criteria` that this commit breaks"),
            files: z.array(z.string()).describe("Where it broke, relative to the project"),
            detail: z.string().describe("One sentence: what in the change contradicts it"),
            confidence: z
              .enum(["high", "low"])
              .describe('"high" if you can see it in the diff, "low" if you are inferring'),
          }),
        )
        .describe("Empty when the commits break nothing. That is the common case"),
      summary: z.string().describe("One paragraph on what you checked and what you concluded"),
    },
  },
  async (input) => {
    const report = input as ReportDriftInput;
    const ack = await bridgeFetch<{ taskId: string | null; warnings: string[] }>("/internal/drift", {
      method: "POST",
      body: JSON.stringify(report),
    });
    log(
      "report_drift ->",
      `${report.findings.length} finding(s)`,
      report.findings.map((f) => `${f.criterionId}@${f.commit.slice(0, 7)}`).join(", "),
    );
    return {
      content: [
        {
          type: "text",
          text:
            `Drift report delivered to the Vibee UI (${report.findings.length} finding(s)).` +
            (ack.warnings.length ? `\n\nProblems with the report:\n- ${ack.warnings.join("\n- ")}` : ""),
        },
      ],
    };
  },
);

server.registerTool(
  "get_drift_verify_context",
  {
    title: "Get context for verifying one drift fix",
    description:
      "Get the one commit made since a single previously-reported drift finding, plus that " +
      "finding's criterion, original detail, and the CURRENT content of every file the " +
      "finding named (currentFiles). Call this before verify_drift_fix. This is NOT a fresh " +
      "review -- check only whether THIS ONE commit resolves THIS ONE finding, and judge from " +
      "currentFiles (not just the diff) since the diff alone cannot show whether a file the " +
      "latest commit did not touch still violates the criterion.",
    inputSchema: {},
  },
  async () => {
    const context = await bridgeFetch<DriftVerifyContext>("/internal/drift-verify-context");
    log(
      "get_drift_verify_context ->",
      context.criterionId,
      `checked commit ${context.checkedCommit.slice(0, 7)}`,
      context.truncated ? "(diff 잘림)" : "",
    );
    return { content: [{ type: "text", text: JSON.stringify(context, null, 2) }] };
  },
);

server.registerTool(
  "verify_drift_fix",
  {
    title: "Report whether a drift finding is resolved",
    description:
      "Judge whether the checked commit from get_drift_verify_context actually resolves that " +
      "finding's criterion -- a commit touching unrelated code does not resolve it. Call this " +
      "EXACTLY ONCE with your verdict, then end your turn. Do not modify any file.",
    inputSchema: {
      resolved: z.boolean().describe("true if the criterion is no longer violated"),
      detail: z.string().describe("One sentence explaining the verdict, in Korean (한국어)"),
    },
  },
  async (input) => {
    const result = input as VerifyDriftFixInput;
    const ack = await bridgeFetch<{ taskId: string | null }>("/internal/drift-verify", {
      method: "POST",
      body: JSON.stringify(result),
    });
    log("verify_drift_fix ->", result.resolved ? "resolved" : "still violated", `(task ${ack.taskId ?? "none"})`);
    return {
      content: [
        {
          type: "text",
          text: `Verdict delivered to the Vibee UI (${result.resolved ? "resolved" : "still violated"}).`,
        },
      ],
    };
  },
);

server.registerTool(
  "get_architecture_context",
  {
    title: "Get architecture structure-check context",
    description:
      "Get deterministic inputs for the current structure check: file sizes with design " +
      "mappings, function signatures, and temporary markers with git age. Read this before " +
      "opening relevant files and calling report_architecture.",
    inputSchema: {},
  },
  async () => {
    const context = await bridgeFetch<ArchitectureContext>("/internal/architecture-context");
    log(
      "get_architecture_context ->",
      `${context.scannedFiles} files, ${context.signatures.length} signatures, ` +
        `${context.temporaryMarkers.length} temporary markers`,
    );
    return { content: [{ type: "text", text: JSON.stringify(context) }] };
  },
);

/** 세 범주의 판단 결과를 구조화해 앱으로 보낸다. */
server.registerTool(
  "report_architecture",
  {
    title: "Report architecture and technical debt",
    description:
      "Submit evidence-backed findings from the focused structure check. Only oversized-module, " +
      "duplicated-logic and stale-temporary-workaround are allowed. Call exactly once after " +
      "confirming candidates in source files. An empty findings array is valid.",
    inputSchema: {
      summary: z.string().describe("Plain-language summary of this structure check"),
      findings: z.array(
        z.object({
          category: z.enum([
            "oversized-module",
            "duplicated-logic",
            "stale-temporary-workaround",
          ]),
          severity: z.enum(["high", "medium", "low"]),
          title: z.string().describe("Short, concrete title"),
          explanation: z.string().describe("What the current code structure does"),
          impact: z.string().describe("What becomes harder to change or maintain, in plain language"),
          files: z.array(z.string()).describe("Real project-relative paths opened as evidence"),
          evidence: z.array(z.string()).describe("Concrete supplied-list and source-code evidence"),
          designIds: z.array(z.string()).describe("REQ/ENTITY ids from context used as evidence, or []"),
          suggestion: z.string().describe("One bounded next action for the user's coding agent"),
        }),
      ),
      limitations: z.array(z.string()).describe("Important areas that could not be inspected or verified"),
    },
  },
  async (input) => {
    const report = input as ArchitectureDebtReport;
    const ack = await bridgeFetch<{ taskId: string | null; warnings: string[] }>("/internal/architecture", {
      method: "POST",
      body: JSON.stringify(report),
    });
    log("report_architecture ->", `findings ${report.findings.length}`);
    return {
      content: [
        {
          type: "text",
          text:
            `Architecture report delivered to the Vibee UI (${report.findings.length} finding(s)).` +
            (ack.warnings.length ? `\n\nEvidence warnings:\n- ${ack.warnings.join("\n- ")}` : ""),
        },
      ],
    };
  },
);

server.registerTool(
  "get_wiki_transcript",
  {
    title: "Get the conversations to scan",
    description:
      "Return the conversations this person had while building the app, with code blocks and " +
      "this tool's own prompt wrappers already removed. Scan them for words they would not be " +
      "able to define.",
    inputSchema: {},
  },
  async () => {
    const transcript = await bridgeFetch<WikiTranscript>("/internal/wiki-transcript");
    log("get_wiki_transcript ->", `${transcript.messages.length} messages`, transcript.skipped ? `(${transcript.skipped} older skipped)` : "");
    return {
      content: [{ type: "text", text: JSON.stringify(transcript, null, 2) }],
      structuredContent: transcript as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "save_wiki_keywords",
  {
    title: "Save the words worth explaining",
    description:
      "Save the words to offer this person, most useful first. Frequency is not the criterion " +
      "-- the app counts occurrences itself, and the most frequent words are always the most " +
      "ordinary ones. Pick terms of art they could not define, in whatever language they " +
      "appear. An empty list is a valid answer.",
    inputSchema: {
      keywords: z
        .array(
          z.object({
            term: z.string().describe("The word exactly as it appears in the conversation"),
            why: z.string().describe("One short line: why this person might be stuck on it"),
            sample: z.string().describe("A sentence from the conversation where it appears, quoted as-is"),
          }),
        )
        .describe("Twelve or fewer is plenty"),
    },
  },
  async (input) => {
    const { keywords } = input as { keywords: Array<{ term: string }> };
    const ack = await bridgeFetch<{ taskId: string | null }>("/internal/wiki-keywords", {
      method: "POST",
      body: JSON.stringify({ keywords }),
    });
    log("save_wiki_keywords ->", `${keywords.length}`, keywords.map((k) => k.term).join(", "));
    return {
      content: [
        { type: "text", text: `${keywords.length} keyword(s) offered to the user in the app${ack.taskId ? "" : " (no active task)"}.` },
      ],
    };
  },
);

/**
 * 위키용 tool.
 *
 * 리뷰와 달리 이쪽은 **코드를 읽어야 한다.** 어느 파일을 봐야 할지 우리가 미리 알 수 없어서
 * 먹여 줄 수 없기 때문이다. 그래서 위키 turn에만 읽기 도구가 열려 있다.
 */
server.registerTool(
  "get_wiki_context",
  {
    title: "Get what to explain",
    description:
      "Return the word to explain, `mentions` (the places it actually came up in this " +
      "project's conversations, which is the only evidence of what it refers to here), and " +
      "the recorded design. Read the project's own code as well before writing.",
    inputSchema: {},
  },
  async () => {
    const context = await bridgeFetch<WikiContext>("/internal/wiki-context");
    log("get_wiki_context ->", context.term, `mentions ${context.mentions.length}`);
    return {
      content: [{ type: "text", text: JSON.stringify(context, null, 2) }],
      structuredContent: context as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "save_wiki",
  {
    title: "Save a wiki page",
    description:
      "Save one explanation for the non-programmer building this app. Write every field in the " +
      "language the reader speaks in their own conversation -- a page they cannot read is " +
      "worthless. This is a LEARNING page, not a review: never say something is wrong, risky, " +
      "outdated, temporary or improvable, never suggest changes, and do not imply them by " +
      "saying what it is 'not meant for'. Describe what is, and stop. A general definition the " +
      "reader could have searched for is not worth saving -- what makes the page worth keeping " +
      "is what this word means in THIS project.",
    inputSchema: {
      term: z.string().describe("The word being explained, as it appears in their conversation"),
      oneLine: z
        .string()
        .describe("One sentence, in plain words. Do not explain jargon with more jargon"),
      inThisProject: z
        .string()
        .describe("What this actually is in THIS app: where it happens, what it touches, why it is here"),
      where: z
        .array(z.string())
        .describe(
          "Evidence from this project: file paths you actually opened, or REQ / FLOW / DEC ids. " +
            "Never empty -- with nothing here the page is a generic definition",
        ),
      related: z.array(z.string()).describe("Other words from their conversation worth reading next"),
    },
  },
  async (input) => {
    const page = input as WikiPageInput;
    const ack = await bridgeFetch<{ taskId: string | null; warnings: string[] }>("/internal/wiki", {
      method: "POST",
      body: JSON.stringify(page),
    });
    log("save_wiki ->", page.term, `(where ${page.where?.length ?? 0})`);
    return {
      content: [
        {
          type: "text",
          text:
            (ack.warnings.length
              ? `The page for "${page.term}" was saved, but it has problems you should fix by ` +
                `calling save_wiki again with the whole page corrected:\n- ${ack.warnings.join("\n- ")}`
              : `Wiki page for "${page.term}" saved and shown in the app.`),
        },
      ],
    };
  },
);

/**
 * 시스템 맵 tool 3개 (vibee의 submit_runtime_semantics/validate_architecture_view/
 * submit_architecture_view 포팅, 뒤 둘은 이름 충돌을 피하려 validate_system_map/
 * submit_system_map으로 바꿨다). 한 turn 안에서 순서대로 호출된다:
 * submit_runtime_semantics → validate_system_map(반복 가능) → submit_system_map.
 */
server.registerTool(
  "submit_runtime_semantics",
  {
    title: "Submit runtime semantics",
    description:
      "Author a RuntimeSemanticDocument (actors/runtimes/responsibilities/states/externals/interactions, each backed by real source citations) and submit it for server-side validation: schema -> referential integrity -> citations. On success, commits it as an immutable semantic revision and returns { diagnostics: [], semanticRevision } -- you must pass that semanticRevision when you later call validate_system_map/submit_system_map. On failure, returns { diagnostics } describing exactly what to fix; fix and call this tool again (do not guess at a fix without reading subject/evidence/supportedFixes).",
    inputSchema: runtimeSemanticDocumentInputSchema,
  },
  async (input) => {
    const result = await bridgeFetch<Record<string, unknown>>("/internal/submit-runtime-semantics", {
      method: "POST",
      body: JSON.stringify(coerceJsonStrings(input)),
    });
    log("submit_runtime_semantics ->", JSON.stringify(result).slice(0, 200));
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "validate_system_map",
  {
    title: "Validate the system map",
    description:
      "Validate a candidate SystemMapDocument WITHOUT committing it. Input is the document's own fields plus a top-level `semanticRevision` (the number returned by submit_runtime_semantics) -- omit it or reference an unknown revision and validation fails with a diagnostic telling you to call submit_runtime_semantics first. Runs schema -> semantic mapping -> geometry -> citation checks in order; schema errors short-circuit the later stages. Returns { diagnostics, layout? } -- layout (computed component rects, routes, label rects) is included only when there are zero schema-level diagnostics, so you can see the actual rendered coordinates before submitting.",
    inputSchema: documentInputSchema,
  },
  async (input) => {
    const result = await bridgeFetch<Record<string, unknown>>("/internal/validate-system-map", {
      method: "POST",
      body: JSON.stringify(coerceJsonStrings(input)),
    });
    log("validate_system_map ->", JSON.stringify(result).slice(0, 200));
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

server.registerTool(
  "submit_system_map",
  {
    title: "Submit the system map",
    description:
      "Re-validates the candidate SystemMapDocument server-side (same document fields plus the top-level `semanticRevision` used with validate_system_map) and, if it has no severity:\"error\" diagnostics, commits it as the project's system map. If any error diagnostic remains, the submission is rejected and the diagnostics are returned instead -- fix them and call validate_system_map again before retrying submit.",
    inputSchema: documentInputSchema,
  },
  async (input) => {
    const result = await bridgeFetch<Record<string, unknown>>("/internal/submit-system-map", {
      method: "POST",
      body: JSON.stringify(coerceJsonStrings(input)),
    });
    log("submit_system_map ->", JSON.stringify(result).slice(0, 200));
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

const transport = new StdioServerTransport();
server.connect(transport).catch((error: unknown) => {
  log("Server connection failed:", error);
  process.exit(1);
});
