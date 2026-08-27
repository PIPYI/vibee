import type { ShowResultInput, TaskState } from "@vci/protocol";

const STATUS_LABEL: Record<ShowResultInput["status"], string> = {
  success: "완료",
  warning: "확인 필요",
  error: "오류",
};

export function ResultPanel({ task }: { task: TaskState }) {
  const result = task.result;
  if (!result) return null;

  return (
    <section className={`result-panel result-${result.status}`} aria-live="polite">
      <div className="result-panel-header">
        <div>
          <span className={`chip chip-${result.status === "error" ? "danger" : result.status}`}>
            {STATUS_LABEL[result.status]}
          </span>
          <h2>{result.title}</h2>
        </div>
        <span className="result-agent">{task.agent}</span>
      </div>
      <p>{result.summary}</p>
      {result.details && result.details.length > 0 && (
        <ul>
          {result.details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      )}
      {result.filesChanged && result.filesChanged.length > 0 && (
        <div className="result-files">
          <strong>변경된 파일</strong>
          {result.filesChanged.map((file) => <code key={file}>{file}</code>)}
        </div>
      )}
    </section>
  );
}
