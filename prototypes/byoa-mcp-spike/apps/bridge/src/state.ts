/**
 * 메모리 상의 앱 상태와 WebSocket fan-out 허브.
 *
 * 이 spike에는 DB가 없다 (문서 §16). bridge 프로세스가 유일한 source of truth이고,
 * MCP server는 우리가 아니라 Codex가 띄운 *별도 프로세스*이기 때문에 loopback HTTP로
 * 여기에 접근한다.
 */
import type {
  AgentEvent,
  AgentEventEnvelope,
  AppContext,
  AppContextPatch,
  AskUserInput,
  DesignDigest,
  DesignDoc,
  InterviewExchange,
  InterviewState,
  PendingQuestion,
  ReportDriftInput,
  ReviewContext,
  SelectedItem,
  ShowResultInput,
  TaskState,
} from "@byoa/protocol";

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

  /**
   * 지금 리뷰 turn이 보고 있는 것. turn 하나에 하나뿐이라 큐를 두지 않는다.
   * 리포트가 도착하면 여기에 짝지어 둔다 — 어느 diff에 대한 판정인지 알아야 한다.
   */
  private reviewContext: ReviewContext | null = null;
  private driftReport: ReportDriftInput | null = null;

  private pendingQuestion: PendingQuestion | null = null;
  private readonly exchanges: InterviewExchange[] = [];
  private questionSeq = 0;

  /**
   * `includeDesign`이 false면 설계 초안은 요약만 싣는다. 이유는 AppContext.design 주석 참고 —
   * 초안 전체를 매 turn 실어 보내면 agent가 자기가 쓴 문서를 계속 되받는다.
   */
  getAppContext(includeDesign = false): AppContext {
    return {
      projectPath: this.projectPath,
      prompt: this.prompt,
      selectedItem: this.selectedItem,
      interview: this.getInterview(),
      design: includeDesign ? this.design : null,
      designDigest: this.design ? digestDesign(this.design) : null,
      metadata: { source: "byoa-mcp-spike", timestamp: new Date().toISOString() },
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

  // ---------- 드리프트 리뷰 ----------

  /** 리뷰 turn을 시작하면서 기준과 diff를 걸어 둔다. 지난 리포트는 여기서 버린다. */
  startReview(context: ReviewContext): void {
    this.reviewContext = context;
    this.driftReport = null;
  }

  getReviewContext(): ReviewContext | null {
    return this.reviewContext;
  }

  /**
   * agent의 판정을 받는다. **위반이 없어도 호출된다** — 빈 findings와 "아예 부르지 않음"을
   * 구분할 수 있어야 오탐 시험이 성립한다.
   */
  recordDrift(report: ReportDriftInput): void {
    this.driftReport = report;
  }

  getDriftReport(): ReportDriftInput | null {
    return this.driftReport;
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

  recordResult(taskId: string, result: ShowResultInput): void {
    this.updateTask(taskId, { result });
  }

  // ---------- 이벤트 허브 ----------

  emit(event: AgentEvent): AgentEventEnvelope {
    // 새 task의 이벤트가 이전 task의 것을 대체한다. 재접속한 브라우저가 서로 다른 두 실행의
    // 이벤트를 섞어서 replay 하는 일이 없도록 하기 위함이다.
    if (event.type === "task.started") this.buffer.length = 0;

    const envelope: AgentEventEnvelope = { seq: ++this.seq, at: new Date().toISOString(), event };
    this.buffer.push(envelope);
    if (this.buffer.length > MAX_BUFFERED_EVENTS) this.buffer.shift();
    for (const subscriber of this.subscribers) subscriber(envelope);
    return envelope;
  }

  /** 새 클라이언트에 가장 최근 task의 이벤트를 replay 한 뒤, 이후 이벤트를 실시간으로 흘린다. */
  subscribe(subscriber: (envelope: AgentEventEnvelope) => void): () => void {
    for (const envelope of this.buffer) subscriber(envelope);
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}
