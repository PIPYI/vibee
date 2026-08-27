import { useCallback, useEffect, useState } from "react";

import { getEnvironment, getHealth, getModels, getState, subscribeEvents, type AgentId, type AgentReadiness, type ModelOption, type TaskState } from "../../api.js";
import type { WikiKeyword, WikiPage } from "@vci/protocol";

export function useWikiFeature() {
  const [agents, setAgents] = useState<AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [pathExample, setPathExample] = useState("/path/to/your/project");
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [existingTerms, setExistingTerms] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<WikiKeyword[] | null>(null);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [myWiki, setMyWiki] = useState<WikiPage[]>([]);
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
    getEnvironment().then((environment) => setPathExample(environment.pathExample)).catch(() => undefined);
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

  // 이 디렉터리에 저장된 '내 위키'가 있으면 불러온다. 위키 기능을 이 프로젝트로 다시
  // 열었을 때 곧바로 보여주기 위함이지, 매번 새로 만드는 게 아니다.
  useEffect(() => {
    const trimmed = projectPath.trim();
    if (!trimmed) {
      setMyWiki([]);
      return;
    }
    fetch(`/api/wiki/my?projectPath=${encodeURIComponent(trimmed)}`)
      .then((response) => response.json())
      .then((body: { pages?: WikiPage[] }) => setMyWiki(body.pages ?? []))
      .catch(() => setMyWiki([]));
  }, [projectPath]);

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
        const body = (await response.json()) as { error?: string; page?: WikiPage };
        if (!response.ok) throw new Error(body.error ?? "페이지를 만들지 못했습니다");
        // 이미 만들어 둔 페이지면 turn 없이 바로 온다 — agent가 끝날 때까지 기다릴 필요가 없다.
        if (body.page) setPage(body.page);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [agent, projectPath, model, effort],
  );

  const onAddToMyWiki = useCallback(
    async (target: WikiPage) => {
      setError(null);
      try {
        const response = await fetch("/api/wiki/my/add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectPath, term: target.term }),
        });
        const body = (await response.json()) as { error?: string; pages?: WikiPage[] };
        if (!response.ok) throw new Error(body.error ?? "내 위키에 추가하지 못했습니다");
        setMyWiki(body.pages ?? []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [projectPath],
  );

  const onBackToMyWiki = useCallback(() => {
    setPage(null);
    setWarnings([]);
  }, []);

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
    pathExample,
    tasks,
    existingTerms,
    keywords,
    page,
    myWiki,
    warnings,
    error,
    busy,
    running,
    onFindKeywords,
    onPickKeyword,
    onAddToMyWiki,
    onBackToMyWiki,
  };
}

export type WikiFeatureState = ReturnType<typeof useWikiFeature>;
