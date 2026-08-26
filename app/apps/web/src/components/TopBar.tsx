import type { TaskState } from "../api.js";

/** mockup의 Blocked/In progress/Complete 배지 — 새 상태를 만들지 않고 기존 TaskState.status를 센다. */
export function TopBar({ projectPath, tasks }: { projectPath: string; tasks: TaskState[] }) {
  const counts = {
    error: tasks.filter((task) => task.status === "error").length,
    running: tasks.filter((task) => task.status === "running" || task.status === "starting").length,
    completed: tasks.filter((task) => task.status === "completed").length,
  };

  return (
    <header className="topbar">
      <span className="breadcrumb">{projectPath ? projectPath : "프로젝트를 선택하세요"}</span>
      <div className="status-badges">
        {counts.error > 0 && (
          <span className="badge">
            <span className="dot error" /> 오류 {counts.error}
          </span>
        )}
        {counts.running > 0 && (
          <span className="badge">
            <span className="dot running" /> 진행 중 {counts.running}
          </span>
        )}
        {counts.completed > 0 && (
          <span className="badge">
            <span className="dot completed" /> 완료 {counts.completed}
          </span>
        )}
      </div>
    </header>
  );
}
