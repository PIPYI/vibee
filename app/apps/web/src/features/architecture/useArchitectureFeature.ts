import { useCallback, useEffect, useState } from "react";

import { getHealth, getModels, getState, subscribeEvents, type AgentId, type AgentReadiness, type ModelOption, type TaskState } from "../../api.js";
import type { ArchitectureDebtReport } from "@vci/protocol";

export function useArchitectureFeature() {
  const [agents, setAgents] = useState<AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [report, setReport] = useState<ArchitectureDebtReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    getHealth().then((health) => setAgents(health.agents)).catch(() => undefined);
    getState().then((state) => setTasks(state.tasks)).catch(() => undefined);
    const unsubscribe = subscribeEvents((envelope) => {
      const { event } = envelope;
      if (event.type === "app.architecture") {
        setReport(event.report);
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
  }, []);

  const running = tasks.some((task) => task.status === "running" || task.status === "starting");

  const onStartCheck = useCallback(async () => {
    setError(null);
    setBusy(true);
    setReport(null);
    try {
      const response = await fetch("/api/architecture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, projectPath, model: model || undefined, effort: effort || undefined }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "구조 점검을 시작하지 못했습니다");
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
    report,
    error,
    busy,
    running,
    onStartCheck,
  };
}

export type ArchitectureFeatureState = ReturnType<typeof useArchitectureFeature>;
