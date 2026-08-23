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
  type AskUserInput,
  type DesignDoc,
  type ReportDriftInput,
  type ReviewContext,
  type ShowResultInput,
  type WikiContext,
  type WikiPageInput,
  type WikiTranscript,
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
      "Return the context currently set in the BYOA spike browser UI: the selected project " +
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

/**
 * 드리프트 리뷰용 tool (docs/vibe_coding_assistant_design.md §3.3, §7.2).
 *
 * diff를 bridge가 만들어 넘기므로 agent에게 셸이 필요 없다. 리뷰 turn은 읽기 전용으로
 * 돌고 내장 도구가 없다 — 이 두 tool이 리뷰어가 가진 전부다.
 */
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
            `Drift report delivered to the BYOA app UI (${report.findings.length} finding(s)).` +
            (ack.warnings.length ? `\n\nProblems with the report:\n- ${ack.warnings.join("\n- ")}` : ""),
        },
      ],
    };
  },
);

/**
 * 위키 후보 키워드용 tool (§3.5).
 *
 * 빈도로 뽑으려다 실패해서 turn을 하나 쓰게 됐다 — 가장 자주 나오는 말이 가장 익숙한 말이라
 * 정반대의 것이 뽑혔다 (SPIKE_FINDINGS.md §16). 세는 일은 그대로 bridge가 한다.
 */
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
 * 위키용 tool (docs/vibe_coding_assistant_design.md §3.5).
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

const transport = new StdioServerTransport();
await server.connect(transport);
log(`ready; bridge = ${bridge.baseUrl}`);
