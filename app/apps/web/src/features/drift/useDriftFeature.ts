import { useCallback, useEffect, useState } from "react";

import { getHealth, getModels, getState, subscribeEvents, type AgentId, type AgentReadiness, type ModelOption, type TaskState } from "../../api.js";
import type { DriftFinding, ReportDriftInput, ReviewStart, VerifyDriftFixInput } from "@vci/protocol";

/** finding 하나에 대한 "피드백 받기" 결과. `${originalCommit}:${criterionId}`로 finding과 잇는다. */
type VerifyRecord = {
  checkedCommit: string;
  result: VerifyDriftFixInput;
  /** 몇 번째 확인인지. 강제로 멈추게 하지 않는다 — 판단은 사용자 몫이고, 이건 그 판단에
   *  필요한 정보(지금까지 몇 번 시도했는지)만 보여주는 것이다. */
  attempt: number;
  /** 아직 위반일 때만 있다 — 다음에 agent에게 줄, 이번 실패를 반영한 새 프롬프트. */
  nextPrompt?: string;
};
export const verifyKey = (commit: string, criterionId: string) => `${commit}:${criterionId}`;

export function useDriftFeature() {
  const [agents, setAgents] = useState<AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [reviewInfo, setReviewInfo] = useState<{ start: ReviewStart; skipped: number; criteriaCount: number; commitCount: number } | null>(null);
  const [report, setReport] = useState<ReportDriftInput | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyRecord>>({});
  // 이번 리뷰가 새로 찾은 것과는 별개로, 아직 해결 확인이 안 된 전체 목록. 화면은 이걸
  // 기준으로 그린다 — 그래야 새 리뷰를 돌려도 안 고쳐진 옛날 finding이 사라지지 않는다.
  const [openFindings, setOpenFindings] = useState<DriftFinding[]>([]);
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
      if (event.type === "app.drift") {
        setReport(event.report);
        setOpenFindings(event.openFindings);
      }
      if (event.type === "app.drift.verify") {
        const key = verifyKey(event.originalCommit, event.criterionId);
        setVerifyResults((prev) => ({
          ...prev,
          [key]: {
            checkedCommit: event.checkedCommit,
            result: event.result,
            attempt: (prev[key]?.attempt ?? 0) + 1,
            nextPrompt: event.nextPrompt,
          },
        }));
        setOpenFindings(event.openFindings);
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

  const onStartReview = useCallback(async () => {
    setError(null);
    setBusy(true);
    setReport(null);
    setVerifyResults({});
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, projectPath, model: model || undefined, effort: effort || undefined }),
      });
      const body = (await response.json()) as {
        error?: string;
        start: ReviewStart;
        skipped: number;
        criteriaCount: number;
        commits: unknown[];
        openFindings: DriftFinding[];
      };
      if (!response.ok) throw new Error(body.error ?? "리뷰를 시작하지 못했습니다");
      setReviewInfo({ start: body.start, skipped: body.skipped, criteriaCount: body.criteriaCount, commitCount: body.commits.length });
      // turn이 끝나기 전에도 "지금까지 안 고쳐진 것"은 바로 보여준다.
      setOpenFindings(body.openFindings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [agent, projectPath, model, effort]);

  /**
   * finding 하나에 "피드백 받기". 리뷰 전체를 다시 돌리지 않는다 — 사용자가 옆에 띄운
   * agent로 이 finding을 고쳐 커밋 하나를 새로 만들었다는 전제로, 그 커밋 하나만 본다.
   */
  const onVerifyFix = useCallback(
    async (finding: DriftFinding) => {
      setError(null);
      setBusy(true);
      try {
        const response = await fetch("/api/drift/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent,
            projectPath,
            model: model || undefined,
            effort: effort || undefined,
            commit: finding.commit,
            criterionId: finding.criterionId,
            files: finding.files,
            detail: finding.detail,
          }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "확인을 시작하지 못했습니다");
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
    reviewInfo,
    report,
    openFindings,
    verifyResults,
    error,
    busy,
    running,
    onStartReview,
    onVerifyFix,
  };
}

export type DriftFeatureState = ReturnType<typeof useDriftFeature>;
