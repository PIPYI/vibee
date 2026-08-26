import { useCallback, useEffect, useState } from "react";

import {
  exportDesign,
  getHealth,
  getModels,
  getNarrative,
  getState,
  sendInterviewMessage,
  startInterview,
  subscribeEvents,
  type AgentId,
  type AgentReadiness,
  type DesignDoc,
  type ModelOption,
  type TaskState,
} from "../../api.js";
import type { ExportDesignResponse } from "@vci/protocol";

/**
 * Design(요구사항 인터뷰) 기능의 모든 상태와 동작을 한 곳에 모은다.
 *
 * turn이 끝나면(질문이든 설계 저장이든) `/api/state`를 다시 읽어 진실을 새로 가져온다 —
 * WS 이벤트 하나하나를 조합해 화면 상태를 재구성하지 않는다. 이 앱은 로컬 프로세스라
 * 왕복 한 번 더 하는 비용이 로직을 단순하게 유지하는 이득보다 작다.
 */
export function useDesignFeature() {
  const [agents, setAgents] = useState<AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [answer, setAnswer] = useState("");
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [design, setDesign] = useState<DesignDoc | null>(null);
  const [pending, setPending] = useState<{ question: string; why?: string; hints?: string[] } | null>(null);
  const [exchanges, setExchanges] = useState<Array<{ question: string; answer: string }>>([]);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [exportResult, setExportResult] = useState<ExportDesignResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(async () => {
    const state = await getState();
    setTasks(state.tasks);
    setDesign(state.appContext.design ?? null);
    setPending(state.appContext.interview.pending);
    setExchanges(
      state.appContext.interview.exchanges.map((exchange) => ({ question: exchange.question, answer: exchange.answer })),
    );
    if (state.appContext.design) {
      const result = await getNarrative();
      setNarrative(result.markdown);
      setGaps(result.gaps);
    }
  }, []);

  // agent를 바꾸면 그 provider가 신고하는 모델 목록을 다시 받아 기본값으로 맞춘다.
  // 하드코딩하지 않는 이유는 §8과 같다 — CLI를 업데이트하면 목록도 effort 집합도 바뀐다.
  useEffect(() => {
    setModel("");
    setEffort("");
    getModels(agent)
      .then((response) => {
        // Claude는 "default"라는 alias 항목을 실제 모델(sonnet 등)과 별도로 신고한다.
        // Codex처럼 구체적인 모델 이름만 고르게 한다 — alias는 그중 하나를 가리킬 뿐이다.
        const models = response.models.filter((item) => item.id !== "default");
        setModels(models);
        const chosen = models.find((item) => item.isDefault) ?? models[0];
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
    getHealth()
      .then((health) => setAgents(health.agents))
      .catch(() => undefined);
    refreshState().catch(() => undefined);
    const unsubscribe = subscribeEvents((envelope) => {
      const type = envelope.event.type;
      if (
        type === "task.completed" ||
        type === "task.error" ||
        type === "task.interrupted" ||
        type === "app.question" ||
        type === "app.answer" ||
        type === "app.design" ||
        type === "task.started"
      ) {
        void refreshState();
      }
    });
    return unsubscribe;
  }, [refreshState]);

  const running = tasks.some((task) => task.status === "running" || task.status === "starting");

  const onStart = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await startInterview(agent, projectPath, { model: model || undefined, effort: effort || undefined });
      await refreshState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [agent, projectPath, model, effort, refreshState]);

  const onSendAnswer = useCallback(async () => {
    if (!answer.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await sendInterviewMessage(agent, projectPath, answer, { model: model || undefined, effort: effort || undefined });
      setAnswer("");
      await refreshState();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [agent, answer, projectPath, model, effort, refreshState]);

  const onExport = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await exportDesign(agent, projectPath);
      setExportResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [agent, projectPath]);

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
    answer,
    setAnswer,
    tasks,
    design,
    pending,
    exchanges,
    narrative,
    gaps,
    exportResult,
    error,
    busy,
    running,
    onStart,
    onSendAnswer,
    onExport,
  };
}

export type DesignFeatureState = ReturnType<typeof useDesignFeature>;
