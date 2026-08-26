import type { TaskState } from "../api.js";

/** mockup의 Blocked/In progress/Complete 배지 — 새 상태를 만들지 않고 기존 TaskState.status를 센다. */
export function TopBar({ projectPath, tasks }: { projectPath: string; tasks: TaskState[] }) {
  const counts = {
    error: tasks.filter((task) => task.status === "error").length,
    running: tasks.filter((task) => task.status === "running" || task.status === "starting").length,
    completed: tasks.filter((task) => task.status === "completed").length,
  };

  // 경로를 상위 디렉터리와 현재 프로젝트 폴더명으로 분리하여 가독성 증대
  const pathParts = projectPath ? projectPath.split("/").filter(Boolean) : [];
  const projectName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "";
  const parentPath = pathParts.length > 1 ? `/${pathParts.slice(0, -1).join("/")}/` : "/";

  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span className="breadcrumb-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        {projectPath ? (
          <>
            <span className="breadcrumb-path">{parentPath}</span>
            <span className="breadcrumb-name">{projectName}</span>
          </>
        ) : (
          <span className="breadcrumb-placeholder">프로젝트를 선택하세요</span>
        )}
      </div>

      <div className="status-badges">
        {counts.error > 0 && (
          <span className="badge badge-error">
            <span className="dot error" /> 오류 {counts.error}
          </span>
        )}
        {counts.running > 0 && (
          <span className="badge badge-running">
            <span className="dot running" /> 진행 중 {counts.running}
          </span>
        )}
        {counts.completed > 0 && (
          <span className="badge badge-completed">
            <span className="dot completed" /> 완료 {counts.completed}
          </span>
        )}
      </div>
    </header>
  );
}
