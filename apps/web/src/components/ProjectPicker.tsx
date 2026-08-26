import { useEffect, useState } from "react";
import type { ModelOption } from "@vibee/protocol";
import { getModels, startArchitectureView } from "../api.ts";

type Props = {
  onStarted: (info: { taskId: string; projectPath: string }) => void;
};

export function ProjectPicker({ onStarted }: Props) {
  const [projectPath, setProjectPath] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    getModels("claude").then((result) => {
      if (cancelled) return;
      setModelsLoading(false);
      if (result.ok) {
        setModels(result.data.models);
        setModelsError(null);
      } else {
        setModelsError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const trimmed = projectPath.trim();
    if (trimmed.length === 0) {
      setSubmitError("프로젝트 폴더 경로를 입력해주세요.");
      return;
    }

    setSubmitting(true);
    const modelInput = selectedModel.length > 0 ? { model: selectedModel } : {};
    const result = await startArchitectureView({ agent: "claude", projectPath: trimmed, ...modelInput });
    setSubmitting(false);

    if (result.ok) {
      onStarted({ taskId: result.data.taskId, projectPath: trimmed });
    } else {
      setSubmitError(result.error);
    }
  }

  return (
    <form className="project-picker" onSubmit={handleSubmit}>
      <h1>Vibee 아키텍처 시각화</h1>
      <p className="lead">분석할 프로젝트의 폴더 경로를 입력하면 AI가 코드를 읽고 아키텍처 다이어그램을 그려줍니다.</p>

      <label htmlFor="project-path">분석할 프로젝트 폴더 경로</label>
      <input
        id="project-path"
        type="text"
        placeholder="예: /Users/me/projects/my-app"
        value={projectPath}
        onChange={(e) => setProjectPath(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <p className="helper-text">절대 경로를 입력해주세요 (예: &quot;/&quot;로 시작하는 전체 경로). 상대 경로는 인식되지 않습니다.</p>

      <label htmlFor="agent-select">AI 에이전트</label>
      <select id="agent-select" defaultValue="claude" disabled>
        <option value="claude">Claude</option>
        <option value="codex" disabled title="Codex 지원은 아직 준비 중입니다">
          Codex (준비 중)
        </option>
      </select>

      <label htmlFor="model-select">모델</label>
      {modelsLoading ? (
        <p className="helper-text">모델 목록을 불러오는 중...</p>
      ) : modelsError ? (
        <>
          <p className="inline-error">모델 목록을 불러오지 못했습니다: {modelsError}</p>
          <p className="helper-text">모델을 선택하지 않아도 기본 모델로 분석을 진행할 수 있습니다.</p>
        </>
      ) : (
        <select id="model-select" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
          <option value="">기본 모델 사용</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}

      {submitError && <p className="inline-error">{submitError}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? "시작하는 중..." : "아키텍처 다이어그램 생성"}
      </button>
    </form>
  );
}
