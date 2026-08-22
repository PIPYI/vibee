/**
 * bridge의 메모리 상태와 WebSocket fan-out 허브.
 *
 * bridge 프로세스가 실행 중 상태의 유일한 소유자다. MCP server는 **우리가 아니라 agent가
 * 띄운 별도 프로세스**이므로 loopback HTTP로 여기에 접근한다 (B1).
 *
 * 영속 상태(Semantic Memory·Evidence)는 여기 있지 않고 `@onto/core`의 generation store에 있다.
 */
import type { AnalyzeSession } from "@onto/core";
import type {
  AgentEvent,
  AgentEventEnvelope,
  CachedView,
  EvidenceDiff,
  McpCallSource,
  OverviewIR,
  ScenarioIR,
  TaskState,
} from "@onto/protocol";

const MAX_BUFFERED_EVENTS = 500;

/** `POST /api/views`가 view turn 을 열 때 남기는 것. `/internal/submit-view-ir`가 소비한다. */
export type PendingViewRequest = {
  viewKind: "overview" | "scenario";
  /** turn 시작 시점의 semanticVersion. 캐시 키의 절반이다(V2 — analysisVersion이 아니다) */
  semanticVersion: number;
  requestHash: string;
};

export class BridgeState {
  private projectPath: string | null = null;
  private readonly tasks = new Map<string, TaskState>();
  private activeTaskId: string | null = null;

  /**
   * task 별 AnalyzeTransaction 을 들고 있는 session (§6.5 S2 · §6.3 T3).
   *
   * **여기가 유일한 소유자다.** `/internal/propose-evidence` · `/internal/semantic-patch` 는
   * `state.getActiveTaskId()` 로 현재 task 를 찾고, 그 task 의 session 을 통해서만
   * transaction 에 접근한다 — MCP server 는 상태가 없으므로(B1) session 은 언제나 bridge
   * 쪽에 있어야 한다.
   */
  private readonly analyzeSessions = new Map<string, AnalyzeSession>();
  /** 커밋 1이 만든 dirty evidence 개수. ④ churn 판정의 입력이다 (재인덱싱마다 갱신) */
  private readonly dirtyEvidenceCounts = new Map<string, number>();

  /**
   * Overview/Scenario 캐시 (§6.4). **cache일 뿐이고 source of truth가 아니다** — `@onto/core`의
   * generation store를 거치지 않는다. bridge 프로세스가 재시작되면 비고, 다음 요청이 다시
   * turn을 연다. 그것으로 충분하다 — ScenarioIR/OverviewIR은 언제든 재생성 가능한 View다.
   */
  private readonly viewCache = new Map<string, CachedView<OverviewIR | ScenarioIR>>();
  /** taskId 별로 연 view turn 이 무엇을 만들려는 것이었는지. `/internal/submit-view-ir`가 찾는다 */
  private readonly pendingViewRequests = new Map<string, PendingViewRequest>();
  /** 완료된 view turn 의 taskId → viewCache 키. `GET /api/views/:id`가 taskId로 결과를 찾는다 */
  private readonly viewResultsByTask = new Map<string, string>();

  /**
   * 가장 최근 재인덱싱의 EvidenceDiff (evidenceId → diff). **재인덱싱마다 통째로 갈아 끼운다**
   * — 이전 diff는 지금 시점에서는 의미가 없다. 뷰어의 grounding 배지("코드가 옮겨졌습니다"·
   * "내용이 바뀌었습니다")가 이것을 본다(§6.9 apps/web). `evidence.json`에는 이 분류가
   * 저장되지 않으므로(§6.2 T1은 순간의 판정이지 영속 필드가 아니다) bridge 메모리에만 있다 —
   * 재시작하면 비고, 다음 재인덱싱이 다시 채운다. 그것으로 충분하다 — 배지는 참고 정보이지
   * source of truth가 아니다.
   */
  private lastEvidenceDiffs = new Map<string, EvidenceDiff>();

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

  /** 마지막 bridge-endpoint 호출의 결과를 기록한다. **task 에 묶인다** — 전역 목록으로
   * 판정하면 다른 실행의 호출까지 세어 결과가 오염된다. */
  recordMcpOutcome(outcome: "data" | "unavailable"): void {
    const taskId = this.activeTaskId;
    if (!taskId) return;
    const calls = this.tasks.get(taskId)?.mcpCalls;
    if (!calls) return;
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      if (calls[index]!.source === "bridge-endpoint") {
        calls[index]!.outcome = outcome;
        return;
      }
    }
  }

  setAnalyzeSession(taskId: string, session: AnalyzeSession): void {
    this.analyzeSessions.set(taskId, session);
  }

  getAnalyzeSession(taskId: string): AnalyzeSession | undefined {
    return this.analyzeSessions.get(taskId);
  }

  /**
   * transaction 을 버리고 session 을 잊는다 (T3 · §6.5 S2).
   *
   * turn이 어떻게 끝났든(완료·중단·오류) 반드시 불러야 한다 — **반쯤 쓰인 evidence는
   * 없다.** `POST /api/tasks/:id/stop`도 여기를 부른다. 이미 정리된 task 를 다시 불러도
   * 안전하다(idempotent) — session 이 없으면 조용히 아무것도 하지 않는다.
   */
  disposeAnalyzeSession(taskId: string, reason: string): void {
    const session = this.analyzeSessions.get(taskId);
    if (!session) return;
    session.dispose(reason);
    this.analyzeSessions.delete(taskId);
    this.dirtyEvidenceCounts.delete(taskId);
  }

  setDirtyEvidenceCount(taskId: string, count: number): void {
    this.dirtyEvidenceCounts.set(taskId, count);
  }

  getDirtyEvidenceCount(taskId: string): number | undefined {
    return this.dirtyEvidenceCounts.get(taskId);
  }

  setPendingViewRequest(taskId: string, request: PendingViewRequest): void {
    this.pendingViewRequests.set(taskId, request);
  }

  getPendingViewRequest(taskId: string): PendingViewRequest | undefined {
    return this.pendingViewRequests.get(taskId);
  }

  clearPendingViewRequest(taskId: string): void {
    this.pendingViewRequests.delete(taskId);
  }

  setViewCache(key: string, value: CachedView<OverviewIR | ScenarioIR>): void {
    this.viewCache.set(key, value);
  }

  getViewCache(key: string): CachedView<OverviewIR | ScenarioIR> | undefined {
    return this.viewCache.get(key);
  }

  setViewResultForTask(taskId: string, cacheKey: string): void {
    this.viewResultsByTask.set(taskId, cacheKey);
  }

  getViewResultForTask(taskId: string): CachedView<OverviewIR | ScenarioIR> | undefined {
    const key = this.viewResultsByTask.get(taskId);
    return key ? this.viewCache.get(key) : undefined;
  }

  setLastEvidenceDiffs(diffs: readonly EvidenceDiff[]): void {
    this.lastEvidenceDiffs = new Map(diffs.map((item) => [item.evidenceId, item]));
  }

  getLastEvidenceDiff(evidenceId: string): EvidenceDiff | undefined {
    return this.lastEvidenceDiffs.get(evidenceId);
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
