import { useCallback, useEffect, useState } from "react";

import { getHealth, getModels, getState, subscribeEvents, type AgentId, type AgentReadiness, type ModelOption, type TaskState } from "../../api.js";
import type { WikiKeyword, WikiPage } from "@vci/protocol";

export function useWikiFeature() {
  const [agents, setAgents] = useState<AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [existingTerms, setExistingTerms] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<WikiKeyword[] | null>(null);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
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
      if (event.type === "app.wiki.keywords") setKeywords(event.keywords);
      if (event.type === "app.wiki") setPage(event.page);
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

  const onFindKeywords = useCallback(async () => {
    setError(null);
    setBusy(true);
    setKeywords(null);
    setPage(null);
    try {
      const response = await fetch("/api/wiki/keywords", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, projectPath, model: model || undefined, effort: effort || undefined }),
      });
      const body = (await response.json()) as { error?: string; existing?: string[]; messages?: number };
      if (!response.ok) throw new Error(body.error ?? "키워드 후보를 찾지 못했습니다");
      setExistingTerms(body.existing ?? []);
      if (body.messages === 0) setError("이 프로젝트에서 아직 나눈 대화가 없습니다.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [agent, projectPath, model, effort]);

  const onPickKeyword = useCallback(
    async (term: string) => {
      setError(null);
      setBusy(true);
      setPage(null);
      setWarnings([]);
      try {
        const response = await fetch("/api/wiki", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agent, projectPath, term, model: model || undefined, effort: effort || undefined }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "페이지를 만들지 못했습니다");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [agent, projectPath, model, effort],
  );

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
    existingTerms,
    keywords,
    page,
    warnings,
    error,
    busy,
    running,
    onFindKeywords,
    onPickKeyword,
  };
}

export type WikiFeatureState = ReturnType<typeof useWikiFeature>;
