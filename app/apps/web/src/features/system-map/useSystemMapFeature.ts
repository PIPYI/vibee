import { useCallback, useEffect, useRef, useState } from "react";

import { getHealth, getModels, getState, subscribeEvents, type AgentId, type AgentReadiness, type ModelOption, type TaskState } from "../../api.js";
import type { SystemMapDocument } from "@vci/protocol";

export type SystemMapMeta = { committedAt: string; gitRevision?: string; taskId: string };
export type SystemMapResult = { document: SystemMapDocument; svg: string; meta: SystemMapMeta };

export function useSystemMapFeature() {
  const [agents, setAgents] = useState<AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [result, setResult] = useState<SystemMapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // system-map.committed 이벤트가 오면 그 taskId의 프로젝트 경로로 GET /api/system-map을
  // 호출해야 하는데, POST 시점의 projectPath를 클로저로 들고 있어야 한다 (state는 그 사이
  // 사용자가 입력창을 고치면 바뀔 수 있다).
  const activeProjectPathRef = useRef("");
  const committedRef = useRef(false);

  useEffect(() => {
    setModel("");
    setEffort("");
    getModels(agent)
      .then((response) => {
        const list = response.models.filter((item) => item.id !== "default");
        setModels(list);
        const chosen = list.find((item) => item.isDefault) ?? list[0];
        if (chosen) {
          setModel(chosen.id);
          setEffort(chosen.defaultEffort ?? chosen.efforts[0]?.id ?? "");
        }
      })
      .catch(() => setModels([]));
  }, [agent]);

  const onModelChange = useCallback(
    (id: string) => {
      setModel(id);
      const chosen = models.find((item) => item.id === id);
      setEffort(chosen?.defaultEffort ?? chosen?.efforts[0]?.id ?? "");
    },
    [models],
  );

  const fetchResult = useCallback(async (path: string) => {
    try {
      const response = await fetch(`/api/system-map?projectPath=${encodeURIComponent(path)}`);
      const body = (await response.json()) as SystemMapResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "시스템 맵을 불러오지 못했습니다");
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    getHealth().then((health) => setAgents(health.agents)).catch(() => undefined);
    getState().then((state) => setTasks(state.tasks)).catch(() => undefined);
    const unsubscribe = subscribeEvents((envelope) => {
      const { event } = envelope;
      if (event.type === "system-map.committed") {
        committedRef.current = true;
        void fetchResult(activeProjectPathRef.current);
      }
      if (event.type === "task.error") {
        setError(event.message);
      }
      if (event.type === "task.completed" && !committedRef.current) {
        // agent turn은 끝났는데 system-map.committed가 한 번도 안 왔다 — 검증/제출 횟수
        // 상한에 도달했거나 중간에 포기한 경우다.
        setError("AI가 분석을 종료했지만 시스템 맵을 제출하지 못했습니다 (검증/제출 횟수 제한에 도달했을 수 있습니다).");
      }
      if (
        event.type === "task.completed" ||
        event.type === "task.error" ||
        event.type === "task.interrupted" ||
        event.type === "task.started"
      ) {
        void getState().then((state) => setTasks(state.tasks));
      }
    });
    return unsubscribe;
  }, [fetchResult]);

  const running = tasks.some((task) => task.status === "running" || task.status === "starting");

  const onStart = useCallback(async () => {
    setError(null);
    setBusy(true);
    setResult(null);
    committedRef.current = false;
    activeProjectPathRef.current = projectPath;
    try {
      const response = await fetch("/api/system-map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, projectPath, model: model || undefined, effort: effort || undefined }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "시스템 맵 생성을 시작하지 못했습니다");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [agent, projectPath, model, effort]);

  return {
    agents,
    agent,
    setAgent,
    models,
    model,
    onModelChange,
    effort,
    setEffort,
    projectPath,
    setProjectPath,
    tasks,
    result,
    error,
    busy,
    running,
    onStart,
  };
}

export type SystemMapFeatureState = ReturnType<typeof useSystemMapFeature>;
