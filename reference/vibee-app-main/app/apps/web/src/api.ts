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
export type EnvironmentResponse = {
  platform: "macos" | "windows" | "wsl" | "linux";
  architecture: string;
  nodeVersion: string;
  pathSeparator: "/" | "\\";
  pathExample: string;
};
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

export function getEnvironment(): Promise<EnvironmentResponse> {
  return fetch("/api/environment").then((response) => asJson<EnvironmentResponse>(response));
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
): Promise<{ taskId: string; projectPath: string }> {
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
): Promise<{ taskId: string; projectPath: string }> {
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
 * `/events` WebSocket을 구독한다.
 *
 * 연결이 끊기면 다시 붙는다 — 개발 중에는 bridge를 자주 재시작하는데, 탭은 그대로 열려 있는
 * 경우가 흔하다. 재연결해도 놓친 이벤트를 따로 복구할 필요는 없다: bridge의 `subscribe`
 * (apps/bridge/src/state.ts)가 새 연결마다 현재 버퍼를 그대로 다시 보내주기 때문이다.
 */
export function subscribeEvents(
  onEvent: (envelope: AgentEventEnvelope) => void,
  onConnectionChange?: (connected: boolean) => void,
): () => void {
  const url = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/events`;
  let closed = false;
  let socket: WebSocket;

  const connect = () => {
    socket = new WebSocket(url);
    socket.addEventListener("open", () => onConnectionChange?.(true));
    socket.addEventListener("message", (event) => {
      try {
        onEvent(JSON.parse(event.data as string) as AgentEventEnvelope);
      } catch {
        // 파싱 실패한 프레임은 무시한다.
      }
    });
    socket.addEventListener("close", () => {
      if (!closed) {
        onConnectionChange?.(false);
        setTimeout(() => {
          if (!closed) connect();
        }, 1000);
      }
    });
    socket.addEventListener("error", () => {
      if (!closed) onConnectionChange?.(false);
    });
  };
  connect();

  return () => {
    closed = true;
    socket.close();
  };
}
