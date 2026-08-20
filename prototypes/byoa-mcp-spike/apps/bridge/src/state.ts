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
  InterviewExchange,
  InterviewState,
  PendingQuestion,
  SelectedItem,
  ShowResultInput,
  TaskState,
} from "@byoa/protocol";

const MAX_BUFFERED_EVENTS = 500;

export class BridgeState {
  private projectPath = "";
  private prompt = "";
  private selectedItem: SelectedItem | null = null;

  private readonly tasks = new Map<string, TaskState>();
  private activeTaskId: string | null = null;

  private seq = 0;
  private readonly buffer: AgentEventEnvelope[] = [];
  private readonly subscribers = new Set<(envelope: AgentEventEnvelope) => void>();

  private pendingQuestion: PendingQuestion | null = null;
  private readonly exchanges: InterviewExchange[] = [];
  private questionSeq = 0;

  getAppContext(): AppContext {
    return {
      projectPath: this.projectPath,
      prompt: this.prompt,
      selectedItem: this.selectedItem,
      interview: this.getInterview(),
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

  /** 대기 중인 질문에 답한다. 답할 질문이 없으면 null. */
  answerQuestion(answer: string): { question: PendingQuestion; answer: string } | null {
    const question = this.pendingQuestion;
    if (!question) return null;
    this.pendingQuestion = null;
    this.exchanges.push({ question: question.question, answer, answeredAt: new Date().toISOString() });
    return { question, answer };
  }

  resetInterview(): void {
    this.pendingQuestion = null;
    this.exchanges.length = 0;
    this.questionSeq = 0;
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
