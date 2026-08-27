import { useCallback, useEffect, useState } from "react";

import {
  exportDesign,
  getEnvironment,
  getHealth,
  getModels,
  getNarrative,
  getState,
  sendInterviewMessage,
  startInterview,
  subscribeEvents,
  type AgentId,
  type AgentReadiness,
  type AppContext,
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
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [pathExample, setPathExample] = useState("/path/to/your/project");
  const [answer, setAnswer] = useState("");
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [contextProjectPath, setContextProjectPath] = useState("");
  // `/api/state`는 매 poll마다 전체 설계 문서를 보내지 않는다 (appContext.design은
  // `?design=full`을 줘야만 채워진다) — 그래서 존재 여부·제목은 항상 실려 오는
  // designDigest로 판단하고, 실제 본문(narrative)은 /api/design/narrative로 따로 받는다.
  const [design, setDesign] = useState<AppContext["designDigest"]>(null);
  const [pending, setPending] = useState<{
    question: string;
    why?: string;
    hints?: string[];
    progress?: { step: number; total: number };
  } | null>(null);
  const [exchanges, setExchanges] = useState<Array<{ question: string; answer: string }>>([]);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [exportResult, setExportResult] = useState<ExportDesignResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(async () => {
    const state = await getState();
    setTasks(state.tasks);
    const interviewProjectPath = state.appContext.interview.projectPath ?? "";
    setContextProjectPath(interviewProjectPath);
    // macOS의 /var -> /private/var 같은 심볼릭 링크 정규화 뒤에도 같은 프로젝트로 인식한다.
    // 사용자가 아직 다른 경로를 입력하지 않은 초기 로드에서는 마지막 인터뷰 경로도 복구한다.
    setProjectPath((current) => current || interviewProjectPath);
    setDesign(state.appContext.designDigest);
    setPending(state.appContext.interview.pending);
    setExchanges(
      state.appContext.interview.exchanges.map((exchange) => ({ question: exchange.question, answer: exchange.answer })),
    );
    if (state.appContext.designDigest) {
      const result = await getNarrative();
      setNarrative(result.markdown);
      setGaps(result.gaps);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setModel("");
    setEffort("");
    setModelsLoading(true);
    setModelError(null);
    try {
      const response = await getModels(agent);
      // Claude는 "default"라는 alias 항목을 실제 모델(sonnet 등)과 별도로 신고한다.
      // Codex처럼 구체적인 모델 이름만 고르게 한다 — alias는 그중 하나를 가리킬 뿐이다.
      const availableModels = response.models.filter((item) => item.id !== "default");
      setModels(availableModels);
      const chosen = availableModels.find((item) => item.isDefault) ?? availableModels[0];
      if (chosen) {
        setModel(chosen.id);
        setEffort(chosen.defaultEffort ?? chosen.efforts[0]?.id ?? "");
      }
    } catch (cause) {
      setModels([]);
      setModelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setModelsLoading(false);
    }
  }, [agent]);

  // agent를 바꾸면 그 provider가 신고하는 모델 목록을 다시 받아 기본값으로 맞춘다.
  // 하드코딩하지 않는 이유는 §8과 같다 — CLI를 업데이트하면 목록도 effort 집합도 바뀐다.
  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

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
      .then((health) => {
        setAgents(health.agents);
        setConnectionError(null);
      })
      .catch(() => setConnectionError("브리지에 연결할 수 없습니다. npm run bridge가 실행 중인지 확인하세요."));
    getEnvironment().then((environment) => setPathExample(environment.pathExample)).catch(() => undefined);
    refreshState().catch(() => setConnectionError("브리지 상태를 불러오지 못했습니다."));
    const unsubscribe = subscribeEvents((envelope) => {
      const type = envelope.event.type;
      if (
        type === "task.completed" ||
        type === "task.error" ||
        type === "task.interrupted" ||
        type === "app.question" ||
        type === "app.answer" ||
        type === "app.design" ||
        type === "app.result" ||
        type === "task.started"
      ) {
        void refreshState();
      }
    }, (connected) => {
      if (connected) {
        setConnectionError(null);
        // bridge를 나중에 켜거나 재시작해도 페이지 새로고침 없이 준비 상태를 복구한다.
        void getHealth()
          .then((health) => setAgents(health.agents))
          .catch(() => setConnectionError("브리지 준비 상태를 불러오지 못했습니다."));
        void refreshModels();
        void refreshState().catch(() => setConnectionError("브리지 상태를 불러오지 못했습니다."));
      } else {
        setConnectionError("브리지 실시간 연결이 끊겼습니다. 자동으로 다시 연결하는 중입니다…");
      }
    });
    return unsubscribe;
  }, [refreshModels, refreshState]);

  const running = tasks.some((task) => task.status === "running" || task.status === "starting");

  // `tasks`는 bridge가 지금까지 실행한 모든 task의 전역 목록이라 다른 프로젝트의 완료 기록도
  // 섞여 있다. "이 프로젝트 경로의 인터뷰가 시작됐는가"는 그 목록 크기가 아니라
  // `interview.projectPath`(이 인터뷰 전용 필드)가 입력창의 경로와 일치하고 실제 인터뷰
  // 흔적(진행 중/대기 질문/대화 기록/설계)이 있는지로 판단해야 한다. `appContext.projectPath`는
  // Drift/Architecture/Wiki도 액션마다 같이 덮어쓰는 공유 필드라 이 판단에 쓰면 안 된다 —
  // 다른 기능을 쓰는 사이 값이 바뀌어 여기 있는 대화가 사라진 것처럼 보이게 된다.
  const started =
    running || (contextProjectPath !== "" && contextProjectPath === projectPath && (design !== null || pending !== null || exchanges.length > 0));

  const onStart = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const started = await startInterview(agent, projectPath, { model: model || undefined, effort: effort || undefined });
      setProjectPath(started.projectPath);
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
      const sent = await sendInterviewMessage(agent, projectPath, answer, { model: model || undefined, effort: effort || undefined });
      setProjectPath(sent.projectPath);
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
    modelsLoading,
    modelError,
    model,
    onModelChange,
    effort,
    setEffort,
    projectPath,
    setProjectPath,
    pathExample,
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
    connectionError,
    busy,
    running,
    started,
    onStart,
    onSendAnswer,
    onExport,
  };
}

export type DesignFeatureState = ReturnType<typeof useDesignFeature>;
