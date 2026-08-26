import type { AgentEvent, AgentEventEnvelope, AppContext, AppContextPatch, SelectedItem, TaskState } from "@vci/protocol";

const MAX_BUFFERED_EVENTS = 500;

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

  getAppContext(): AppContext {
    return {
      projectPath: this.projectPath,
      prompt: this.prompt,
      selectedItem: this.selectedItem,
      interview: { pending: null, exchanges: [] },
      design: null,
      designDigest: null,
      metadata: { source: "vci-app" as const, timestamp: new Date().toISOString() },
    };
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
