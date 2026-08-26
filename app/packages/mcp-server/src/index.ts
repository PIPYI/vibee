#!/usr/bin/env node
/**
 * Vibe Coding Project Intelligence MCP server (stdio).
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
      `Cannot reach the Vibe Coding Project Intelligence bridge at ${bridge.baseUrl}. Is it running (npm run bridge)? ${String(cause)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Bridge responded ${response.status} for ${path}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

const server = new McpServer(
  { name: "vci-app", version: "0.1.0" },
  {
    instructions:
      "Tools for the Vibe Coding Project Intelligence app. Call get_app_context before starting work " +
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
      "Return the context currently set in the Vibe Coding Project Intelligence browser UI: the selected project " +
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
      "Push a structured result to the Vibe Coding Project Intelligence browser UI. It is rendered in a dedicated " +
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
          text: `Result delivered to the Vibe Coding Project Intelligence app UI${ack.taskId ? ` for task ${ack.taskId}` : ""}.`,
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
            `Drift report delivered to the Vibe Coding Project Intelligence UI (${report.findings.length} finding(s)).` +
            (ack.warnings.length ? `\n\nProblems with the report:\n- ${ack.warnings.join("\n- ")}` : ""),
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
            `Architecture report delivered to the Vibe Coding Project Intelligence UI (${report.findings.length} finding(s)).` +
            (ack.warnings.length ? `\n\nEvidence warnings:\n- ${ack.warnings.join("\n- ")}` : ""),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
server.connect(transport).catch((error: unknown) => {
  log("Server connection failed:", error);
  process.exit(1);
});
