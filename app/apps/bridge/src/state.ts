import type {
  AgentEvent,
  AgentEventEnvelope,
  AppContext,
  AppContextPatch,
  ArchitectureContext,
  ArchitectureDebtReport,
  AskUserInput,
  DesignDigest,
  DesignDoc,
  InterviewExchange,
  InterviewState,
  PendingQuestion,
  SelectedItem,
  TaskState,
  ReportDriftInput,
  ReviewContext,
  TranscriptMessage,
  WikiContext,
  WikiTranscript,
} from "@vci/protocol";

const MAX_BUFFERED_EVENTS = 500;

/** 초안 전체 대신 실어 보내는 요약 (AppContext.designDigest). */
function digestDesign(design: DesignDoc): DesignDigest {
  return {
    title: design.title,
    summary: design.summary,
    counts: {
      actors: design.actors.length,
      reqs: design.reqs.length,
      surfaces: design.surfaces.length,
      entities: design.entities.length,
      flows: design.flows.length,
      rules: design.rules.length,
      decisions: design.decisions.length,
    },
    ids: [
      ...design.actors,
      ...design.reqs,
      ...design.surfaces,
      ...design.entities,
      ...design.flows,
      ...design.rules,
      ...design.decisions,
    ].map((unit) => unit.id),
  };
}

/**
 * 메모리 상의 앱 상태와 WebSocket fan-out 허브. DB가 없다 — bridge 프로세스가 유일한
 * source of truth다. 기능별 상태(design/drift/wiki/architecture)는 각 기능을 이식하는
 * 단계에서 이 클래스에 추가한다.
 */
export class BridgeState {
  private projectPath = "";
  private prompt = "";
  private selectedItem: SelectedItem | null = null;

  private readonly tasks = new Map<string, TaskState>();
  private activeTaskId: string | null = null;

  private seq = 0;
  private readonly buffer: AgentEventEnvelope[] = [];
  private readonly subscribers = new Set<(envelope: AgentEventEnvelope) => void>();

  private design: DesignDoc | null = null;
  private pendingQuestion: PendingQuestion | null = null;
  private readonly exchanges: InterviewExchange[] = [];
  private questionSeq = 0;

  private reviewContext: ReviewContext | null = null;
  private driftReport: ReportDriftInput | null = null;

  private architectureReport: ArchitectureDebtReport | null = null;
  private architectureContext: ArchitectureContext | null = null;

  private wikiContext: WikiContext | null = null;
  private wikiTranscript: WikiTranscript | null = null;
  private wikiSource: TranscriptMessage[] = [];

  getAppContext(includeDesign = false): AppContext {
    return {
      projectPath: this.projectPath,
      prompt: this.prompt,
      selectedItem: this.selectedItem,
      interview: this.getInterview(),
      design: includeDesign ? this.design : null,
      designDigest: this.design ? digestDesign(this.design) : null,
      metadata: { source: "vci-app" as const, timestamp: new Date().toISOString() },
    };
  }

  // ---------- 인터뷰 ----------

  getInterview(): InterviewState {
    return { pending: this.pendingQuestion, exchanges: [...this.exchanges] };
  }

  /** agent가 `ask_user`로 던진 질문을 등록한다. 이미 대기 중인 질문은 덮어쓴다. */
  askQuestion(input: AskUserInput): PendingQuestion {
    this.pendingQuestion = {
      ...input,
      id: `q${++this.questionSeq}`,
      askedAt: new Date().toISOString(),
    };
    return this.pendingQuestion;
  }

  /**
   * 사용자의 발화를 기록한다.
   *
   * 대기 중인 질문이 있으면 그 답으로, 없으면 **사용자가 먼저 꺼낸 말**로 남긴다. 초안이 나온
   * 뒤 "이건 아닌데"라고 하는 경우가 후자이며, 이것이 인터뷰 3단계다 (§4.10).
   */
  recordMessage(message: string): { question: PendingQuestion | null; answer: string } {
    const question = this.pendingQuestion;
    this.pendingQuestion = null;
    this.exchanges.push({
      question: question?.question ?? "",
      answer: message,
      answeredAt: new Date().toISOString(),
    });
    return { question, answer: message };
  }

  resetInterview(): void {
    this.pendingQuestion = null;
    this.exchanges.length = 0;
    this.questionSeq = 0;
    this.design = null;
  }

  // ---------- 드리프트 리뷰 ----------

  startReview(context: ReviewContext): void {
    this.reviewContext = context;
    this.driftReport = null;
  }

  getReviewContext(): ReviewContext | null {
    return this.reviewContext;
  }

  recordDrift(report: ReportDriftInput): void {
    this.driftReport = report;
  }

  getDriftReport(): ReportDriftInput | null {
    return this.driftReport;
  }

  // ---------- 아키텍처·기술부채 ----------

  startArchitecture(context: ArchitectureContext): void {
    this.architectureReport = null;
    this.architectureContext = context;
  }

  recordArchitecture(report: ArchitectureDebtReport): void {
    this.architectureReport = report;
  }

  getArchitectureReport(): ArchitectureDebtReport | null {
    return this.architectureReport;
  }

  getArchitectureContext(): ArchitectureContext | null {
    return this.architectureContext;
  }

  // ---------- 위키 ----------

  startWiki(context: WikiContext): void {
    this.wikiContext = context;
  }

  startWikiKeywords(transcript: WikiTranscript, source: TranscriptMessage[]): void {
    this.wikiTranscript = transcript;
    this.wikiSource = source;
  }

  getWikiTranscript(): WikiTranscript | null {
    return this.wikiTranscript;
  }

  getWikiSource(): TranscriptMessage[] {
    return this.wikiSource;
  }

  getWikiContext(): WikiContext | null {
    return this.wikiContext;
  }

  // ---------- 설계 산출물 ----------

  getDesign(): DesignDoc | null {
    return this.design;
  }

  /**
   * `save_design`의 결과를 저장한다. **patch가 아니라 전체 문서로 덮어쓴다** — agent가
   * 수정할 때마다 전체를 다시 보내기 때문이다(§4.10 3단계에서 초안이 계속 고쳐진다).
   */
  saveDesign(design: DesignDoc): void {
    this.design = design;
  }

  patchAppContext(patch: AppContextPatch): AppContext {
    if (patch.projectPath !== undefined) this.projectPath = patch.projectPath;
    if (patch.prompt !== undefined) this.prompt = patch.prompt;
    if (patch.selectedItem !== undefined) this.selectedItem = patch.selectedItem;
    return this.getAppContext();
  }

  getActiveTaskId(): string | null {
    return this.activeTaskId;
  }

  getTask(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(): TaskState[] {
    return [...this.tasks.values()];
  }

  createTask(task: TaskState): void {
    this.tasks.set(task.taskId, task);
    this.activeTaskId = task.taskId;
  }

  updateTask(taskId: string, patch: Partial<TaskState>): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    Object.assign(task, patch);
    if (task.status !== "starting" && task.status !== "running" && this.activeTaskId === taskId) {
      this.activeTaskId = null;
    }
  }

  recordMcpCall(taskId: string, tool: string, source: "agent-stream" | "bridge-endpoint"): void {
    this.tasks.get(taskId)?.mcpCalls.push({ tool, at: new Date().toISOString(), source });
  }

  emit(event: AgentEvent): AgentEventEnvelope {
    if (event.type === "task.started") this.buffer.length = 0;
    const envelope: AgentEventEnvelope = { seq: ++this.seq, at: new Date().toISOString(), event };
    this.buffer.push(envelope);
    if (this.buffer.length > MAX_BUFFERED_EVENTS) this.buffer.shift();
    for (const subscriber of this.subscribers) subscriber(envelope);
    return envelope;
  }

  subscribe(subscriber: (envelope: AgentEventEnvelope) => void): () => void {
    for (const envelope of this.buffer) subscriber(envelope);
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}
