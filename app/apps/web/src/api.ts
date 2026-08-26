/**
 * bridge와 통신하는 얇은 층. 모든 요청은 `/api/*`로 보내고, vite dev server(`vite.config.ts`)가
 * bridge(127.0.0.1:44120)로 프록시한다 — 브라우저는 bridge의 실제 포트를 알 필요가 없다.
 */
import type {
  AgentEventEnvelope,
  AgentId,
  AgentReadiness,
  AppContext,
  DesignDoc,
  ExportDesignResponse,
  ModelOption,
  TaskState,
} from "@vci/protocol";

export type { AgentEventEnvelope, AgentId, AgentReadiness, AppContext, DesignDoc, ModelOption, TaskState };

export type HealthResponse = { ok: boolean; agents: AgentReadiness[] };
export type StateResponse = { appContext: AppContext; activeTaskId: string | null; tasks: TaskState[] };
export type NarrativeResponse = { markdown: string; gaps: string[] };
/** 생략하면 provider 기본값을 그대로 쓴다 — 화이트리스트로 거르지 않는다. */
export type ModelSelection = { model?: string; effort?: string };

async function asJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return body;
}

export function getHealth(): Promise<HealthResponse> {
  return fetch("/api/health").then((response) => asJson<HealthResponse>(response));
}

export function getState(): Promise<StateResponse> {
  return fetch("/api/state").then((response) => asJson<StateResponse>(response));
}

export function getModels(agent: AgentId): Promise<{ agent: AgentId; models: ModelOption[] }> {
  return fetch(`/api/models?agent=${agent}`).then((response) => asJson(response));
}

export function startInterview(
  agent: AgentId,
  projectPath: string,
  selection: ModelSelection = {},
): Promise<{ taskId: string }> {
  return fetch("/api/interview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, projectPath, ...selection }),
  }).then((response) => asJson(response));
}

export function sendInterviewMessage(
  agent: AgentId,
  projectPath: string,
  message: string,
  selection: ModelSelection = {},
): Promise<{ taskId: string }> {
  return fetch("/api/interview/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, projectPath, message, ...selection }),
  }).then((response) => asJson(response));
}

export function exportDesign(agent: AgentId, projectPath: string): Promise<ExportDesignResponse> {
  return fetch("/api/design/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent, projectPath }),
  }).then((response) => asJson(response));
}

export function getNarrative(): Promise<NarrativeResponse> {
  return fetch("/api/design/narrative").then((response) => asJson(response));
}

/**
 * `/events` WebSocket을 구독한다. 재연결은 하지 않는다 — 이 앱은 로컬 프로세스라 bridge가
 * 죽으면 사용자가 직접 다시 띄운다는 전제다 (spike와 같은 전제).
 */
export function subscribeEvents(onEvent: (envelope: AgentEventEnvelope) => void): () => void {
  const url = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/events`;
  const socket = new WebSocket(url);
  socket.addEventListener("message", (event) => {
    try {
      onEvent(JSON.parse(event.data as string) as AgentEventEnvelope);
    } catch {
      // 파싱 실패한 프레임은 무시한다.
    }
  });
  return () => socket.close();
}
