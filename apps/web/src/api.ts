import type { AgentId, ArchitectureViewDocument, ModelOption } from "@vibee/protocol";
import { API_BASE } from "./config.ts";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    // Network-level failure (bridge not running, DNS, etc.) -- there is no
    // HTTP status here, so we use 0 as a sentinel the UI can special-case.
    return { ok: false, status: 0, error: (err as Error).message };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `request failed with status ${res.status}`;
    return { ok: false, status: res.status, error: message };
  }

  return { ok: true, data: body as T };
}

export function getHealth(): Promise<ApiResult<{ ok: true }>> {
  return request("/api/health");
}

export function getModels(agent: AgentId): Promise<ApiResult<{ models: ModelOption[] }>> {
  return request(`/api/models?agent=${encodeURIComponent(agent)}`);
}

export function startArchitectureView(input: {
  agent: AgentId;
  projectPath: string;
  model?: string;
}): Promise<ApiResult<{ taskId: string }>> {
  return request("/api/architecture-view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export type ArchitectureViewResponse = {
  document: ArchitectureViewDocument;
  svgByAudience: { simple: string; technical: string };
  meta: { committedAt: string; gitRevision?: string; taskId: string };
};

export function getArchitectureView(projectPath: string): Promise<ApiResult<ArchitectureViewResponse>> {
  return request(`/api/architecture-view?projectPath=${encodeURIComponent(projectPath)}`);
}
