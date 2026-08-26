/**
 * Local bridge. HTTP API + WebSocket 이벤트 허브 + agent adapter.
 * loopback에만 bind 한다. 기능별 라우트는 각 기능을 이식하는 단계에서 이 파일에 추가한다.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocketServer } from "ws";

import { BRIDGE_HOST, BRIDGE_TOKEN_HEADER, type AgentReadiness, type ModelOption } from "@vci/protocol";
import type {
  AskUserInput,
  ArchitectureContext,
  ArchitectureDebtReport,
  DesignDoc,
  ExportDesignRequest,
  InterviewMessageRequest,
  ReviewContext,
  ReviewCommit,
  ReviewCriterion,
  ReviewStart,
  ReportDriftInput,
  StartArchitectureRequest,
  StartReviewRequest,
  ReviewLog,
  StartWikiKeywordsRequest,
  StartWikiRequest,
  WikiKeyword,
  WikiPage,
  WikiPageInput,
} from "@vci/protocol";
import { appRootFromModule, loadBridgeConfig } from "@vci/protocol/node";

import { ClaudeAdapter } from "./agents/claude/adapter.js";
import { CodexAdapter } from "./agents/codex/adapter.js";
import type { AgentAdapter, TaskMode } from "./agents/types.js";
import { BridgeState } from "./state.js";
import {
  HARNESS_MARKER,
  designGaps,
  renderAppDesign,
  renderHarness,
  renderNarrative,
  suggestFirstPrompt,
  validateDesign,
} from "./design.js";
import {
  collectArchitectureContext,
  renderArchitectureMarkdown,
  renderArchitectureResolutionPrompt,
} from "./architecture.js";
import {
  buildArchitecturePrompt,
  buildInterviewPrompt,
  buildReviewPrompt,
  buildWikiKeywordsPrompt,
  buildWikiPrompt,
  renderResolutionPrompt,
} from "./prompt.js";
import {
  condenseTranscript,
  countOccurrences,
  findAdvice,
  findMentions,
  renderWikiMarkdown,
} from "./wiki.js";
import { cliSpawnOptions } from "./platform.js";

const log = (...args: unknown[]): void => console.log("[vci-bridge]", ...args);

const appRoot = appRootFromModule(import.meta.url);
const config = loadBridgeConfig(appRoot);
const state = new BridgeState();

const codex = new CodexAdapter(log);
const claude = new ClaudeAdapter(log, {
  mcpServerEntry: join(appRoot, "packages", "mcp-server", "dist", "index.js"),
  bridgeUrl: config.baseUrl,
  bridgeToken: config.token,
});
const adapters = new Map<string, AgentAdapter>([
  ["codex", codex],
  ["claude", claude],
]);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req: Request, res: Response) => {
  const readiness: AgentReadiness[] = [await codex.checkReady(), await claude.checkReady()];
  res.json({ ok: true, agents: readiness });
});

app.get("/api/state", (_req: Request, res: Response) => {
  res.json({
    appContext: state.getAppContext(),
    activeTaskId: state.getActiveTaskId(),
    tasks: state.listTasks(),
  });
});

const MODEL_CACHE_MS = 5 * 60 * 1000;
const modelCache = new Map<string, { at: number; models: ModelOption[] }>();

app.get("/api/models", async (req: Request, res: Response) => {
  const agentId = String(req.query["agent"] ?? "");
  const adapter = adapters.get(agentId);
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${agentId}. Supported agents: ${supported}.` });
    return;
  }
  const cached = modelCache.get(agentId);
  if (cached && Date.now() - cached.at < MODEL_CACHE_MS) {
    res.json({ agent: adapter.id, models: cached.models });
    return;
  }
  try {
    const models = await adapter.listModels();
    modelCache.set(agentId, { at: Date.now(), models });
    res.json({ agent: adapter.id, models });
  } catch (error) {
    res.status(502).json({ error: asMessage(error) });
  }
});

app.post("/api/app-context", (req: Request, res: Response) => {
  res.json(state.patchAppContext(req.body ?? {}));
});

app.post("/api/tasks/:taskId/stop", async (req: Request, res: Response) => {
  const taskId = String(req.params["taskId"]);
  const task = state.getTask(taskId);
  if (!task) {
    res.status(404).json({ error: `Task not found: ${taskId}` });
    return;
  }
  await adapters.get(task.agent)?.stopTask(taskId);
  res.json({ ok: true });
});

function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (req.get(BRIDGE_TOKEN_HEADER) !== config.token) {
    res.status(401).json({ error: "invalid bridge token" });
    return;
  }
  next();
}

app.get("/internal/app-context", requireToken, (req: Request, res: Response) => {
  res.json(state.getAppContext(req.query["design"] === "full"));
});

/** 새 인터뷰를 시작한다. */
app.post("/api/interview", async (req: Request, res: Response) => {
  const body = req.body as { agent?: string; projectPath?: string; model?: string; effort?: string };
  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is already running. Stop it before starting another." });
    return;
  }
  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body?.projectPath ?? "");
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const ready = await adapter.checkReady();
  if (!ready.installed || ready.authenticated === false) {
    res.status(412).json({ error: ready.message ?? "Agent is not ready." });
    return;
  }

  // 새 인터뷰는 새 프로젝트다. 지난 인터뷰의 흔적을 세 곳에서 모두 지운다.
  state.resetInterview();
  adapter.resetSession(projectPath);
  let cleared: string[] = [];
  try {
    cleared = await clearGeneratedArtifacts(projectPath);
    if (cleared.length > 0) log(`이전 인터뷰 산출물 제거: ${cleared.join(", ")}`);
  } catch (error) {
    log(`이전 인터뷰 산출물 제거 실패: ${asMessage(error)}`);
  }

  const taskId = randomUUID();
  state.patchAppContext({ projectPath, prompt: "" });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: "",
    selectedItem: null,
    status: "starting",
    model: body?.model || undefined,
    effort: body?.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId, ...(cleared.length > 0 ? { cleared } : {}) });
  void runTask(adapter, taskId, projectPath, buildInterviewPrompt(null), "interview", {
    model: body?.model || undefined,
    effort: body?.effort || undefined,
  });
});

/** 인터뷰에 말을 건다. 발화를 기록하고 다음 turn을 자동으로 시작한다. */
app.post("/api/interview/message", async (req: Request, res: Response) => {
  const body = req.body as InterviewMessageRequest;
  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is still running." });
    return;
  }
  if (!body?.message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const recorded = state.recordMessage(body.message);
  const taskId = randomUUID();
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: body.message,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  state.emit({ type: "app.answer", taskId, questionId: recorded.question?.id ?? "", answer: body.message });
  res.json({ taskId });

  void runTask(adapter, taskId, projectPath, buildInterviewPrompt(body.message), "interview", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/** 설계 초안을 프로젝트에 app_design.md + harness로 내보낸다. */
app.post("/api/design/export", async (req: Request, res: Response) => {
  const design = state.getDesign();
  if (!design) {
    res.status(409).json({ error: "There is no design to export yet. Finish the interview first." });
    return;
  }
  const body = req.body as ExportDesignRequest;
  if (!adapters.has(body?.agent ?? "")) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body?.projectPath ?? "");
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const harnessName = adapters.get(body?.agent ?? "")?.id === "claude" ? "CLAUDE.md" : "AGENTS.md";
  const files: Array<{ name: string; content: string }> = [
    { name: "app_design.md", content: renderAppDesign(design) },
    { name: harnessName, content: renderHarness(design, harnessName) },
  ];

  const written: string[] = [];
  const skipped: string[] = [];
  try {
    for (const file of files) {
      const target = join(projectPath, file.name);
      if (await isHandWritten(target)) {
        skipped.push(file.name);
        continue;
      }
      await writeFile(target, file.content, "utf8");
      written.push(file.name);
    }
    const intelDir = join(projectPath, DESIGN_DIR);
    await mkdir(intelDir, { recursive: true });
    await writeFile(join(intelDir, "design.json"), JSON.stringify(design, null, 2), "utf8");
    written.push(`${DESIGN_DIR}/design.json`);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
    return;
  }

  const gitInitialized = await ensureGitRepo(projectPath);
  log(`design exported to ${projectPath}: ${written.join(", ")}`);
  if (skipped.length > 0) log(`  skipped (hand-written): ${skipped.join(", ")}`);
  if (gitInitialized) log("  git repository initialized with a first commit");

  res.json({
    projectPath,
    written,
    skipped,
    gitInitialized,
    firstPrompt: suggestFirstPrompt(design),
    gaps: designGaps(design),
  });
});

/** 사람용 설명. 브라우저가 초안을 보여줄 때 쓴다. */
app.get("/api/design/narrative", (_req: Request, res: Response) => {
  const design = state.getDesign();
  if (!design) {
    res.status(404).json({ error: "No design yet." });
    return;
  }
  res.json({ markdown: renderNarrative(design), gaps: designGaps(design) });
});

app.post("/internal/results", requireToken, (req: Request, res: Response) => {
  const result = req.body;
  if (!result?.title || !result?.summary || !result?.status) {
    res.status(400).json({ error: "title, summary and status are required" });
    return;
  }
  const taskId = noteMcpEndpointHit("show_result");
  if (taskId) state.emit({ type: "app.result", taskId, result });
  else log("show_result arrived with no active task; ignoring for UI routing");
  res.json({ taskId });
});

app.post("/internal/questions", requireToken, (req: Request, res: Response) => {
  const input = req.body as AskUserInput;
  if (!input?.question?.trim()) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  const question = state.askQuestion(input);
  const taskId = noteMcpEndpointHit("ask_user");
  if (taskId) state.emit({ type: "app.question", taskId, question });
  else log("ask_user arrived with no active task; question stored but not routed to the UI");
  res.json({ questionId: question.id });
});

app.post("/internal/design", requireToken, (req: Request, res: Response) => {
  const design = req.body as DesignDoc;
  if (!design?.title?.trim() || !Array.isArray(design.reqs)) {
    res.status(400).json({ error: "title and the seven unit arrays are required" });
    return;
  }
  const warnings = validateDesign(design);
  state.saveDesign(design);
  const taskId = noteMcpEndpointHit("save_design");
  if (taskId) state.emit({ type: "app.design", taskId, design });
  else log("save_design arrived with no active task; design stored but not routed to the UI");
  log(`save_design: ${design.title} (reqs ${design.reqs.length}, flows ${design.flows.length})`);
  for (const warning of warnings) log(`  ! ${warning}`);
  res.json({ taskId, warnings });
});

/**
 * 드리프트 리뷰. PR 리뷰와 같은 모양이되 기준이 다르다 — 범용 베스트프랙티스가 아니라
 * 이 프로젝트가 인터뷰에서 정한 DEC/RULE 하나만 본다.
 */
app.post("/api/review", async (req: Request, res: Response) => {
  const body = req.body as StartReviewRequest;
  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is still running." });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  // Drift는 "이 프로젝트가 정한 것과 대조한다"가 존재 이유다 — 대조할 기준은 우리
  // 인터뷰가 인계한 프로젝트에만 있다. 사용자가 알아보는 표식은 `.project-intel/design.json`이
  // 아니라 프로젝트 루트의 `app_design.md`이므로, 그 파일에 우리 마커가 있는지로
  // "인터뷰에서 넘어왔는가"를 가린다. design.json이 있어도 app_design.md가 없거나
  // 사용자가 직접 쓴 것이면(마커 없음) 인터뷰 인계로 보지 않는다.
  if (!(await cameFromInterview(projectPath))) {
    res.status(400).json({
      error: "이 프로젝트는 요구사항 인터뷰에서 넘어온 것이 아닙니다 (app_design.md가 없거나 직접 쓴 파일입니다). Drift는 인터뷰가 인계한 프로젝트에서만 쓸 수 있습니다.",
    });
    return;
  }

  const inMemory = state.getAppContext().projectPath === projectPath ? state.getDesign() : null;
  const design = (await loadDesignFromDisk(projectPath)) ?? inMemory;
  if (!design) {
    res.status(400).json({ error: `app_design.md는 있는데 ${DESIGN_DIR}/design.json을 찾을 수 없습니다 — 손상됐거나 지워진 것 같습니다.` });
    return;
  }

  const criteria = criteriaFrom(design);
  if (criteria.length === 0) {
    res.status(400).json({ error: "The design has no DEC or RULE to check against." });
    return;
  }

  let start;
  let commits: Awaited<ReturnType<typeof collectCommits>>["commits"];
  let skipped: number;
  try {
    const resolved = await resolveReviewStart(projectPath, body.since);
    start = resolved.start;
    ({ commits, skipped } = await collectCommits(projectPath, resolved.since));
  } catch (error) {
    res.status(400).json({ error: `git log failed: ${asMessage(error)}` });
    return;
  }

  if (commits.length === 0) {
    res.json({ taskId: null, commits: [], start, skipped: 0, criteriaCount: criteria.length });
    return;
  }

  state.startReview({ commits, criteria, skipped });

  const taskId = randomUUID();
  const label = `review ${commits.length}개 커밋`;
  state.patchAppContext({ projectPath, prompt: label, selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: label,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({
    taskId,
    commits: commits.map((c) => ({ sha: c.sha, subject: c.subject })),
    start,
    skipped,
    criteriaCount: criteria.length,
  });

  void runTask(adapter, taskId, projectPath, buildReviewPrompt(), "review", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/**
 * 기존 코드베이스 전체의 아키텍처·기술부채를 읽기 전용으로 분석한다.
 * Wiki·Drift와 결과 상태를 공유하지 않는다.
 */
app.post("/api/architecture", async (req: Request, res: Response) => {
  const body = req.body as StartArchitectureRequest;
  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is still running." });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  // Architecture는 Drift와 달리 인터뷰를 거치지 않은 프로젝트에서도 동작한다 —
  // design.json이 없으면 collectArchitectureContext가 빈 designRefs를 돌려주고,
  // agent가 코드만 보고 판단한다 (docs/product_flow_decisions.md 질문 7).
  const inMemory = state.getAppContext().projectPath === projectPath ? state.getDesign() : null;
  const design = (await loadDesignFromDisk(projectPath)) ?? inMemory;
  let context;
  try {
    context = await collectArchitectureContext(projectPath, design);
  } catch (error) {
    res.status(400).json({ error: `구조 점검 입력을 만들지 못했습니다: ${asMessage(error)}` });
    return;
  }

  state.startArchitecture(context);
  // 구조 점검 한 번이 독립된 sitting 하나다. 다른 mode의 세션 참조는 건드리지 않는다.
  adapter.resetSession(projectPath, "architecture");

  const taskId = randomUUID();
  const label = "architecture and technical debt";
  state.patchAppContext({ projectPath, prompt: label, selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: label,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId });

  void runTask(adapter, taskId, projectPath, buildArchitecturePrompt(), "architecture", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

app.get("/internal/review-context", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_review_context");
  const context = state.getReviewContext();
  if (!context) {
    res.status(409).json({ error: "No review is in progress." });
    return;
  }
  res.json(context);
});

app.post("/internal/drift", requireToken, (req: Request, res: Response) => {
  const report = req.body as ReportDriftInput;
  if (!Array.isArray(report?.findings) || typeof report?.summary !== "string") {
    res.status(400).json({ error: "findings (array) and summary (string) are required" });
    return;
  }

  const context = state.getReviewContext();
  const knownCommits = new Set((context?.commits ?? []).map((c) => c.sha));
  const warnings: string[] = [];
  const findings = report.findings.map((finding) => {
    const criterion = context?.criteria.find((c) => c.id === finding.criterionId);
    if (!criterion) warnings.push(`Unknown criterion id: ${finding.criterionId}`);
    if (!knownCommits.has(finding.commit)) warnings.push(`Unknown commit: ${finding.commit}`);
    return criterion ? { ...finding, resolutionPrompt: renderResolutionPrompt(finding, criterion) } : finding;
  });
  const enrichedReport: ReportDriftInput = { ...report, findings };

  state.recordDrift(enrichedReport);
  const taskId = noteMcpEndpointHit("report_drift");
  if (taskId) state.emit({ type: "app.drift", taskId, report: enrichedReport });
  else log("report_drift arrived with no active task; stored but not routed to the UI");

  log(`report_drift: ${findings.length}건`);
  for (const warning of warnings) log(`  ! ${warning}`);

  const projectPath = state.getAppContext().projectPath;
  const task = taskId ? state.getTask(taskId) : undefined;
  if (context && projectPath) {
    void (async () => {
      try {
        const existing = await readReviewLog(projectPath);
        existing.lastReviewedSha = context.commits.at(-1)?.sha ?? existing.lastReviewedSha;
        existing.runs.push({
          at: new Date().toISOString(),
          agent: task?.agent ?? "codex",
          commits: context.commits.map((c) => c.sha),
          findings,
          summary: report.summary,
        });
        await writeReviewLog(projectPath, existing);
      } catch (error) {
        log(`리뷰 기록 저장 실패: ${asMessage(error)}`);
      }
    })();
  }

  res.json({ taskId, warnings });
});

app.get("/internal/architecture-context", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_architecture_context");
  const context = state.getArchitectureContext();
  if (!context) {
    res.status(409).json({ error: "No architecture structure check is in progress." });
    return;
  }
  res.json(context);
});

app.post("/internal/architecture", requireToken, async (req: Request, res: Response) => {
  const report = req.body as ArchitectureDebtReport;
  if (
    typeof report?.summary !== "string" ||
    !Array.isArray(report?.findings) ||
    !Array.isArray(report?.limitations) ||
    report.findings.some(
      (finding) =>
        !["oversized-module", "duplicated-logic", "stale-temporary-workaround"].includes(finding.category) ||
        !Array.isArray(finding.files) ||
        !Array.isArray(finding.evidence) ||
        !Array.isArray(finding.designIds),
    )
  ) {
    res.status(400).json({ error: "summary, findings, evidence, designIds and limitations are required" });
    return;
  }

  const projectPath = state.getAppContext().projectPath;
  const context = state.getArchitectureContext();
  if (!context) {
    res.status(409).json({ error: "No architecture structure check is in progress." });
    return;
  }
  const evidence = new Set(report.findings.flatMap((finding) => finding.files));
  const knownDesignIds = new Set(context.designRefs.map((ref) => ref.id));
  const warnings: string[] = [];
  for (const file of evidence) {
    if (!file || file.startsWith("/") || file.split(/[\\/]/).includes("..")) {
      warnings.push(`Invalid project-relative evidence path: ${file || "(empty)"}`);
      continue;
    }
    try {
      await stat(join(projectPath, file));
    } catch {
      warnings.push(`Evidence path does not exist: ${file}`);
    }
  }
  for (const finding of report.findings) {
    for (const id of finding.designIds) {
      if (!knownDesignIds.has(id)) warnings.push(`Unknown design id: ${id}`);
    }
  }

  const automaticLimitations: string[] = [];
  if (context.designRefs.length === 0) {
    automaticLimitations.push(
      ".project-intel/design.json이 없어, oversized-module 판정에 REQ/ENTITY 경계 대신 agent가 코드를 직접 읽은 판단만 사용했습니다.",
    );
  }
  const unreadContent = context.files.filter((file) => !file.contentScanned).length;
  if (unreadContent > 0) {
    automaticLimitations.push(`크기 상한 때문에 본문을 읽지 않은 source 파일이 ${unreadContent}개 있습니다.`);
  }
  if (context.truncated.files > 0) {
    automaticLimitations.push(`source 파일 상한으로 ${context.truncated.files}개를 목록에서 제외했습니다.`);
  }
  if (context.truncated.signatures > 0) {
    automaticLimitations.push(`함수/메서드 시그니처 상한으로 ${context.truncated.signatures}개를 제외했습니다.`);
  }
  if (context.truncated.temporaryMarkers > 0) {
    automaticLimitations.push(`임시 조치 마커 상한으로 ${context.truncated.temporaryMarkers}개를 제외했습니다.`);
  }

  const generatedAt = new Date().toISOString();
  const enrichedReport: ArchitectureDebtReport = {
    ...report,
    limitations: [...new Set([...report.limitations, ...automaticLimitations])],
    generatedAt,
    commit: context.currentCommit,
    findings: report.findings.map((finding) => ({
      ...finding,
      resolutionPrompt: renderArchitectureResolutionPrompt(finding),
    })),
  };

  try {
    await writeArchitectureReport(projectPath, enrichedReport);
  } catch (error) {
    res.status(500).json({ error: `아키텍처 리포트 저장 실패: ${asMessage(error)}` });
    return;
  }

  state.recordArchitecture(enrichedReport);
  const taskId = noteMcpEndpointHit("report_architecture");
  if (taskId) state.emit({ type: "app.architecture", taskId, report: enrichedReport });
  else log("report_architecture arrived with no active task; stored but not routed to the UI");

  log(`report_architecture: 부채 ${report.findings.length}건 → ${DESIGN_DIR}/architecture.{json,md}`);
  for (const warning of warnings) log(`  ! ${warning}`);
  res.json({ taskId, warnings });
});

/**
 * 위키 후보 키워드. agent가 고른다 — 빈도는 낯섦과 반대 방향이라 기준이 될 수 없다.
 * 위키 패널을 열 때 한 번이고, 키워드마다가 아니다.
 */
app.post("/api/wiki/keywords", async (req: Request, res: Response) => {
  const body = req.body as StartWikiKeywordsRequest;
  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is still running." });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  let messages;
  try {
    messages = await adapter.readTranscript(projectPath);
  } catch (error) {
    res.status(500).json({ error: asMessage(error) });
    return;
  }

  const existing = await listWikiTerms(projectPath);
  const transcript = condenseTranscript(messages);
  if (transcript.messages.length === 0) {
    res.json({ taskId: null, messages: 0, existing });
    return;
  }

  state.startWikiKeywords(transcript, messages);

  const taskId = randomUUID();
  state.patchAppContext({ projectPath, prompt: "wiki keywords", selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: "wiki keywords",
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId, messages: transcript.messages.length, existing });

  void runTask(adapter, taskId, projectPath, buildWikiKeywordsPrompt(), "wiki", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

/** 키워드 하나를 골랐을 때 페이지를 만든다. 위키 turn은 읽되 쓰지 않는다. */
app.post("/api/wiki", async (req: Request, res: Response) => {
  const body = req.body as StartWikiRequest;
  const adapter = adapters.get(body?.agent ?? "");
  if (!adapter) {
    const supported = [...adapters.keys()].join(", ");
    res.status(400).json({ error: `Unsupported agent: ${body?.agent}. Supported agents: ${supported}.` });
    return;
  }
  if (state.getActiveTaskId()) {
    res.status(409).json({ error: "A task is still running." });
    return;
  }
  if (!body?.term?.trim()) {
    res.status(400).json({ error: "term is required" });
    return;
  }

  let projectPath: string;
  try {
    projectPath = await canonicalizeProjectPath(body.projectPath);
  } catch (error) {
    res.status(400).json({ error: asMessage(error) });
    return;
  }

  const term = body.term.trim();
  const messages = await adapter.readTranscript(projectPath);
  state.startWiki({ term, mentions: findMentions(messages, term), design: await loadDesignFromDisk(projectPath) });

  const taskId = randomUUID();
  state.patchAppContext({ projectPath, prompt: `wiki ${term}`, selectedItem: null });
  state.createTask({
    taskId,
    agent: adapter.id,
    projectPath,
    prompt: `wiki ${term}`,
    selectedItem: null,
    status: "starting",
    model: body.model || undefined,
    effort: body.effort || undefined,
    startedAt: new Date().toISOString(),
    mcpCalls: [],
  });

  res.json({ taskId, term });

  void runTask(adapter, taskId, projectPath, buildWikiPrompt(term), "wiki", {
    model: body.model || undefined,
    effort: body.effort || undefined,
  });
});

app.get("/internal/wiki-transcript", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_wiki_transcript");
  const transcript = state.getWikiTranscript();
  if (!transcript) {
    res.status(409).json({ error: "No wiki keyword pass is in progress." });
    return;
  }
  res.json(transcript);
});

app.post("/internal/wiki-keywords", requireToken, (req: Request, res: Response) => {
  const input = req.body as { keywords?: Array<{ term: string; why: string; sample: string }> };
  if (!Array.isArray(input?.keywords)) {
    res.status(400).json({ error: "keywords (array) is required" });
    return;
  }

  const source = state.getWikiSource();
  const keywords: WikiKeyword[] = input.keywords
    .filter((entry) => entry?.term?.trim())
    .map((entry) => ({
      term: entry.term.trim(),
      why: entry.why?.trim() ?? "",
      sample: entry.sample?.trim() ?? "",
      count: countOccurrences(source, entry.term.trim()),
    }));

  const taskId = noteMcpEndpointHit("save_wiki_keywords");
  if (taskId) state.emit({ type: "app.wiki.keywords", taskId, keywords });
  else log("save_wiki_keywords arrived with no active task; keywords not routed to the UI");

  log(`save_wiki_keywords: ${keywords.length}개`);
  res.json({ taskId, keywords });
});

app.get("/internal/wiki-context", requireToken, (_req: Request, res: Response) => {
  noteMcpEndpointHit("get_wiki_context");
  const context = state.getWikiContext();
  if (!context) {
    res.status(409).json({ error: "No wiki page is being written." });
    return;
  }
  res.json(context);
});

app.post("/internal/wiki", requireToken, (req: Request, res: Response) => {
  const input = req.body as WikiPageInput;
  if (!input?.term?.trim() || !input?.oneLine?.trim() || !input?.inThisProject?.trim()) {
    res.status(400).json({ error: "term, oneLine and inThisProject are required" });
    return;
  }

  const warnings: string[] = [];
  if (!Array.isArray(input.where) || input.where.length === 0) {
    warnings.push("`where` is empty — without evidence from this project the page is a generic definition.");
  }
  for (const advice of findAdvice(input.oneLine, input.inThisProject)) {
    warnings.push(`This reads as a judgement, which this page must not make — ${advice}`);
  }

  const page: WikiPage = {
    term: input.term.trim(),
    oneLine: input.oneLine.trim(),
    inThisProject: input.inThisProject.trim(),
    where: input.where ?? [],
    related: input.related ?? [],
    createdAt: new Date().toISOString(),
  };

  const taskId = noteMcpEndpointHit("save_wiki");
  if (taskId) state.emit({ type: "app.wiki", taskId, page });
  else log("save_wiki arrived with no active task; page stored but not routed to the UI");

  log(`save_wiki: ${page.term}`);
  for (const warning of warnings) log(`  ! ${warning}`);

  const projectPathCtx = state.getAppContext().projectPath;
  if (projectPathCtx) void writeWikiPage(projectPathCtx, page).catch((error) => log(`위키 저장 실패: ${asMessage(error)}`));

  res.json({ taskId, warnings });
});

/** 존재하는 디렉터리가 아니면 거부하고, 심볼릭 링크는 해소한다. */
export async function canonicalizeProjectPath(input: string): Promise<string> {
  if (!input?.trim()) throw new Error("projectPath is required");
  let resolved: string;
  try {
    resolved = await realpath(input.trim());
  } catch {
    throw new Error(`Project path does not exist: ${input}`);
  }
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`);
  return resolved;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 존재하는 파일이 사람이 쓴 것인지. 우리 표식이 없으면 사람이 쓴 것으로 본다. */
async function isHandWritten(path: string): Promise<boolean> {
  try {
    const existing = await readFile(path, "utf8");
    return !existing.includes(HARNESS_MARKER);
  } catch {
    return false;
  }
}

/**
 * `app_design.md`가 **우리 인터뷰가 내보낸 것**인지. `isHandWritten`과 반대 방향의
 * 질문이다 — 저건 "우리가 덮어써도 되는가"(없으면 true, 즉 안전)를 묻고, 이건
 * "인터뷰 인계가 실제로 일어났는가"(없으면 false, 즉 인계 안 됨)를 묻는다.
 */
async function cameFromInterview(projectPath: string): Promise<boolean> {
  try {
    const content = await readFile(join(projectPath, "app_design.md"), "utf8");
    return content.includes(HARNESS_MARKER);
  } catch {
    return false;
  }
}

const GENERATED_DOCS = ["app_design.md", "AGENTS.md", "CLAUDE.md"] as const;
const DESIGN_DIR = ".project-intel";
const MAX_DIFF_CHARS = 20_000;
const MAX_REVIEW_COMMITS = 50;
const REVIEW_LOG = "reviews.json";

/** 설계를 디스크에서 읽는다. bridge가 재시작돼도 인터뷰가 남긴 것이 유일한 원본이다. */
async function loadDesignFromDisk(projectPath: string): Promise<DesignDoc | null> {
  try {
    const raw = await readFile(join(projectPath, DESIGN_DIR, "design.json"), "utf8");
    return JSON.parse(raw) as DesignDoc;
  } catch {
    return null;
  }
}

/** 프로젝트가 git 저장소가 아니면 만들고 첫 커밋을 남긴다. 원격은 건드리지 않는다. */
async function ensureGitRepo(projectPath: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const opts = { cwd: projectPath, ...cliSpawnOptions };
  try {
    await run("git", ["rev-parse", "--git-dir"], opts);
    return false;
  } catch {
    // 저장소가 아니다. 아래에서 만든다.
  }
  try {
    await run("git", ["init"], opts);
    await run("git", ["add", "-A"], opts);
    await run("git", ["commit", "-m", "Start from the design produced by the requirements interview"], opts);
    return true;
  } catch (error) {
    log(`git init skipped: ${asMessage(error)}`);
    return false;
  }
}

/** 인터뷰를 새로 시작할 때 프로젝트에 남은 지난 산출물을 지운다. */
async function clearGeneratedArtifacts(projectPath: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of GENERATED_DOCS) {
    const path = join(projectPath, name);
    try {
      await stat(path);
    } catch {
      continue;
    }
    if (await isHandWritten(path)) continue;
    await rm(path, { force: true });
    removed.push(name);
  }
  const intel = join(projectPath, DESIGN_DIR);
  try {
    await stat(intel);
    await rm(intel, { recursive: true, force: true });
    removed.push(`${DESIGN_DIR}/`);
  } catch {
    // 없다
  }
  return removed;
}

async function runTask(
  adapter: AgentAdapter,
  taskId: string,
  projectPath: string,
  prompt: string,
  mode: TaskMode,
  overrides: { model?: string; effort?: string } = {},
): Promise<void> {
  state.updateTask(taskId, { status: "running" });
  state.emit({ type: "task.started", taskId, agent: adapter.id, projectPath });
  try {
    const outcome = await adapter.startTask({ taskId, projectPath, prompt, mode, ...overrides }, (event) => {
      if (event.type === "mcp.tool.called") state.recordMcpCall(taskId, event.tool, event.source);
      state.emit(event);
    });
    state.updateTask(taskId, { status: outcome, endedAt: new Date().toISOString() });
    state.emit(outcome === "interrupted" ? { type: "task.interrupted", taskId } : { type: "task.completed", taskId });
  } catch (error) {
    const message = asMessage(error);
    state.updateTask(taskId, { status: "error", endedAt: new Date().toISOString(), error: message });
    state.emit({ type: "task.error", taskId, message });
  }
}

function noteMcpEndpointHit(tool: string): string | null {
  const taskId = state.getActiveTaskId();
  if (!taskId) return null;
  state.recordMcpCall(taskId, tool, "bridge-endpoint");
  state.emit({ type: "mcp.tool.called", taskId, tool, source: "bridge-endpoint" });
  return taskId;
}

/** 리뷰가 대조할 기준 목록. DEC과 RULE을 한 목록으로 준다. */
function criteriaFrom(design: DesignDoc): ReviewCriterion[] {
  return [
    ...design.decisions.map((d) => ({ id: d.id, text: d.text, why: d.why, source: d.source })),
    ...design.rules.map((r) => ({ id: r.id, text: r.text, source: r.source })),
  ];
}

/** 프로젝트에서 git을 돌리고 stdout을 그대로 돌려준다. */
async function gitOutput(projectPath: string, args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run("git", args, { cwd: projectPath, maxBuffer: 32 * 1024 * 1024, ...cliSpawnOptions });
  return stdout;
}

async function gitLines(projectPath: string, args: string[]): Promise<string[]> {
  const out = await gitOutput(projectPath, args);
  return out.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function readReviewLog(projectPath: string): Promise<ReviewLog> {
  try {
    const raw = await readFile(join(projectPath, DESIGN_DIR, REVIEW_LOG), "utf8");
    return JSON.parse(raw) as ReviewLog;
  } catch {
    return { lastReviewedSha: null, runs: [] };
  }
}

async function writeReviewLog(projectPath: string, log: ReviewLog): Promise<void> {
  const dir = join(projectPath, DESIGN_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, REVIEW_LOG), JSON.stringify(log, null, 2), "utf8");
}

/** 구조 점검은 이력 배열을 쌓지 않고 현재 snapshot을 덮어쓴다. 추세는 git이 남긴다. */
async function writeArchitectureReport(projectPath: string, report: ArchitectureDebtReport): Promise<void> {
  const dir = join(projectPath, DESIGN_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "architecture.json"), JSON.stringify(report, null, 2), "utf8");
  await writeFile(join(dir, "architecture.md"), renderArchitectureMarkdown(report), "utf8");
}

function wikiSlug(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") || "page";
}

/** JSON이 원본, 마크다운은 파생물이다 — 이미 있는 도구(Obsidian, GitHub 미리보기 등)가 그대로 동작한다. */
async function writeWikiPage(projectPath: string, page: WikiPage): Promise<void> {
  const dir = join(projectPath, DESIGN_DIR, "wiki");
  await mkdir(dir, { recursive: true });
  const slug = wikiSlug(page.term);
  await writeFile(join(dir, `${slug}.json`), JSON.stringify(page, null, 2), "utf8");
  await writeFile(join(dir, `${slug}.md`), renderWikiMarkdown(page), "utf8");
}

/** 이미 만들어 둔 페이지들. 화면이 "이미 있음"을 표시하는 데 쓴다. */
async function listWikiTerms(projectPath: string): Promise<string[]> {
  try {
    const dir = join(projectPath, DESIGN_DIR, "wiki");
    const files = (await readdir(dir)).filter((name) => name.endsWith(".json"));
    const terms = await Promise.all(
      files.map(async (name) => {
        try {
          return (JSON.parse(await readFile(join(dir, name), "utf8")) as WikiPage).term;
        } catch {
          return null;
        }
      }),
    );
    return terms.filter((term): term is string => Boolean(term));
  } catch {
    return [];
  }
}

/** ref가 이 저장소에 실제로 있는지. */
async function commitExists(projectPath: string, ref: string): Promise<boolean> {
  try {
    await gitOutput(projectPath, ["cat-file", "-e", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** 어디부터 볼지 정한다. 설계보다 앞선 커밋은 판정 대상이 아니다. */
async function resolveReviewStart(
  projectPath: string,
  since: string | undefined,
): Promise<{ start: ReviewStart; since: string | null }> {
  if (since?.trim()) return { start: "explicit", since: since.trim() };

  const log = await readReviewLog(projectPath);
  if (log.lastReviewedSha && (await commitExists(projectPath, log.lastReviewedSha))) {
    return { start: "last-review", since: log.lastReviewedSha };
  }

  try {
    const shas = await gitLines(projectPath, [
      "log", "--format=%H", "--diff-filter=A", "--", `${DESIGN_DIR}/design.json`,
    ]);
    const handover = shas.at(-1);
    if (handover) return { start: "design", since: handover };
  } catch {
    // 저장소가 아니거나 아직 커밋이 없다.
  }

  return { start: "recent", since: null };
}

/** 리뷰할 커밋들을 모은다. 오래된 것부터 준다. */
async function collectCommits(
  projectPath: string,
  since: string | null,
): Promise<{ commits: ReviewCommit[]; skipped: number }> {
  const range = since ? [`${since}..HEAD`] : [`-n`, String(MAX_REVIEW_COMMITS)];
  const SEP = "";
  const lines = await gitLines(projectPath, [
    "log", "--reverse", "--no-merges", `--format=%H${SEP}%s${SEP}%an${SEP}%aI`, ...range,
  ]);

  const skipped = Math.max(0, lines.length - MAX_REVIEW_COMMITS);
  const selected = lines.slice(0, MAX_REVIEW_COMMITS);

  const commits: ReviewCommit[] = [];
  for (const line of selected) {
    const [sha, subject = "", author = "", at = ""] = line.split(SEP);
    if (!sha) continue;
    const changedFiles = await gitLines(projectPath, ["show", "--name-only", "--format=", sha]);
    const raw = await gitOutput(projectPath, ["show", "--format=", sha]);
    const truncated = raw.length > MAX_DIFF_CHARS;
    commits.push({
      sha,
      subject,
      author,
      at,
      changedFiles,
      diff: truncated ? `${raw.slice(0, MAX_DIFF_CHARS)}\n... (truncated)` : raw,
      truncated,
    });
  }
  return { commits, skipped };
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/events" });

wss.on("connection", (socket) => {
  const unsubscribe = state.subscribe((envelope) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(envelope));
  });
  socket.on("close", unsubscribe);
  socket.on("error", unsubscribe);
});

server.listen(config.port, BRIDGE_HOST, () => {
  log(`listening on http://${BRIDGE_HOST}:${config.port}`);
  log(`events:   ws://${BRIDGE_HOST}:${config.port}/events`);
  log(`config:   ${config.configPath}`);
});
