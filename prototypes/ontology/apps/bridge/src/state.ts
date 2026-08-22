/**
 * bridge의 메모리 상태와 WebSocket fan-out 허브.
 *
 * bridge 프로세스가 실행 중 상태의 유일한 소유자다. MCP server는 **우리가 아니라 agent가
 * 띄운 별도 프로세스**이므로 loopback HTTP로 여기에 접근한다 (B1).
 *
 * 영속 상태(Semantic Memory·Evidence)는 여기 있지 않고 `@onto/core`의 generation store에 있다.
 */
import type { AgentEvent, AgentEventEnvelope, McpCallSource, TaskState } from "@onto/protocol";

const MAX_BUFFERED_EVENTS = 500;

export class BridgeState {
  private projectPath: string | null = null;
  private readonly tasks = new Map<string, TaskState>();
  private activeTaskId: string | null = null;

  private seq = 0;
  private readonly buffer: AgentEventEnvelope[] = [];
  private readonly subscribers = new Set<(envelope: AgentEventEnvelope) => void>();

  getProjectPath(): string | null {
    return this.projectPath;
  }

  setProjectPath(path: string): void {
    this.projectPath = path;
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

  /**
   * MCP 호출을 기록한다. **두 증거원을 따로 남긴다** (B4).
   *
   * `agent-stream`은 agent가 스스로 보고한 것이고, `bridge-endpoint`는 별도 프로세스가
   * 실제로 우리에게 도달한 사실이다. 한쪽만 관측되는 것은 실패로 취급한다 — spike에서
   * 실제로 `agent-stream`만 잡히고 tool이 돌지 않은 적이 있다(Finding 4).
   */
  recordMcpCall(taskId: string | null, tool: string, source: McpCallSource): void {
    const target = taskId ?? this.activeTaskId;
    if (!target) return;
    this.tasks.get(target)?.mcpCalls.push({ tool, at: new Date().toISOString(), source });
  }

  /** 이 task에서 두 증거원이 모두 관측된 tool들. acceptance 2·3이 이것을 본다. */
  toolsWithBothSources(taskId: string): string[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];
    const bySource = new Map<string, Set<McpCallSource>>();
    for (const call of task.mcpCalls) {
      const set = bySource.get(call.tool) ?? new Set<McpCallSource>();
      set.add(call.source);
      bySource.set(call.tool, set);
    }
    return [...bySource.entries()]
      .filter(([, sources]) => sources.has("agent-stream") && sources.has("bridge-endpoint"))
      .map(([tool]) => tool)
      .sort();
  }

  emit(event: AgentEvent): AgentEventEnvelope {
    // 새 task의 이벤트가 이전 task의 것을 대체한다. 재접속한 브라우저가 서로 다른 두 실행의
    // 이벤트를 섞어 replay 하지 않게 한다 (Finding 3).
    if (event.type === "task.started") this.buffer.length = 0;

    const envelope: AgentEventEnvelope = { seq: ++this.seq, at: new Date().toISOString(), event };
    this.buffer.push(envelope);
    if (this.buffer.length > MAX_BUFFERED_EVENTS) this.buffer.shift();
    for (const subscriber of this.subscribers) subscriber(envelope);
    return envelope;
  }

  /**
   * 새 클라이언트에 가장 최근 task의 이벤트를 replay 한 뒤 이후 이벤트를 흘린다.
   *
   * **소비자는 taskId로 걸러야 한다** (B8) — replay 구간을 구분하지 못하면 이전 task의
   * `task.completed`를 자기 것으로 오인한다. spike의 acceptance 스크립트가 정확히 그것으로
   * 망가졌다(Finding 5).
   */
  subscribe(subscriber: (envelope: AgentEventEnvelope) => void): () => void {
    for (const envelope of this.buffer) subscriber(envelope);
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}
