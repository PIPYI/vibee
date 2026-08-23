/**
 * Runtime Console (schema2 §3, M13) — 대상은 사용자의 저장소가 아니라 **onto 자신**이다.
 * Project Reader와 화면을 공유하지 않는다(I17). 여기서 답하는 질문은 "내 분석기가 방금
 * 무엇을 했는가"이지 "이 프로젝트는 어떻게 동작하는가"가 아니다.
 *
 * 새 데이터가 거의 필요 없다 — WS `AgentEvent` 스트림과 이미 있는
 * `GET /api/tasks/:taskId/mcp-evidence`(B4 두 증거원), `GET /api/state`, generation
 * 이력(`fullMemory().versions`)을 그대로 읽는다.
 *
 * acceptance 20(`task.interrupted`이 실제 agent turn 중단으로 온다)을 여기서 관측할 수
 * 있다 — task 목록에서 실행 중인 task를 고르고 Project Reader의 "중지" 버튼을 누르면
 * 이 화면의 이벤트 로그와 status 배지가 실시간으로 바뀐다.
 */
import { useCallback, useEffect, useState } from "react";

import type { AgentEvent, Diagnostic, TaskState } from "@onto/protocol";

import * as api from "./api.js";
import { useAgentEvents } from "./ws.js";

type DiagnosticEntry = { at: string; tool: string; diagnostics: Diagnostic[] };
type LogLine = { seq: number; text: string; taskId?: string };

function short(id: string): string {
  return id.slice(0, 8);
}

function describeEvent(event: AgentEvent): string {
  switch (event.type) {
    case "task.started":
      return `▶ task 시작 — ${event.mode}`;
    case "task.completed":
      return "✓ task 완료";
    case "task.interrupted":
      return "■ task 중단됨 (acceptance 20)";
    case "task.error":
      return `✗ task 오류 — ${event.message}`;
    case "mcp.tool.called":
      return `MCP ${event.tool} [${event.source}]`;
    case "agent.file.explored":
      return `native 탐색 — ${event.path}`;
    case "agent.usage":
      return `누적 토큰 ${event.totalTokens}`;
    case "validation.failed":
      return `검증 실패 — ${event.tool}`;
    case "memory.patched":
      return `Semantic Memory 갱신 v${event.semanticVersion} — ${event.summary}`;
    case "view.ready":
      return `View 완료 — ${event.viewKind}`;
    case "analysis.progress":
      return event.message;
    case "agent.session":
      return `session ${event.resumed ? "재개" : "시작"}`;
    case "agent.action.started":
      return `▶ ${event.name}`;
    case "agent.action.completed":
      return `✓ ${event.name}`;
    default:
      return "";
  }
}

const STATUS_LABEL: Record<TaskState["status"], string> = {
  starting: "starting",
  running: "running",
  completed: "completed",
  interrupted: "interrupted",
  error: "error",
};

export function RuntimeConsole(): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mcpEvidence, setMcpEvidence] = useState<api.TaskMcpEvidence | null>(null);
  const [diagnosticsByTask, setDiagnosticsByTask] = useState<Record<string, DiagnosticEntry[]>>({});
  const [versions, setVersions] = useState<api.FullMemory["versions"]>([]);
  const [lines, setLines] = useState<LogLine[]>([]);

  const refreshTasks = useCallback(async () => {
    const result = await api.bridgeState();
    setTasks(result.tasks);
  }, []);

  const refreshVersions = useCallback(async () => {
    const memory = await api.fullMemory();
    if (!api.isUnavailable(memory)) setVersions(memory.versions);
  }, []);

  useEffect(() => {
    void refreshTasks();
    void refreshVersions();
    const interval = setInterval(() => {
      void refreshTasks();
    }, 2000);
    return () => clearInterval(interval);
  }, [refreshTasks, refreshVersions]);

  const stream = useAgentEvents((event, envelope) => {
    setLines((prev) => [
      ...prev.slice(-199),
      { seq: envelope.seq, text: describeEvent(event), taskId: "taskId" in event ? event.taskId : undefined },
    ]);
    if (event.type === "validation.failed") {
      setDiagnosticsByTask((prev) => {
        const list = prev[event.taskId] ?? [];
        return { ...prev, [event.taskId]: [...list, { at: envelope.at, tool: event.tool, diagnostics: event.diagnostics as Diagnostic[] }] };
      });
    }
    if (event.type === "memory.patched") void refreshVersions();
    if (
      event.type === "task.started" ||
      event.type === "task.completed" ||
      event.type === "task.interrupted" ||
      event.type === "task.error"
    ) {
      void refreshTasks();
    }
  });

  useEffect(() => {
    if (!selectedTaskId) {
      setMcpEvidence(null);
      return;
    }
    void api.taskMcpEvidence(selectedTaskId).then((result) => {
      setMcpEvidence("error" in result ? null : result);
    });
  }, [selectedTaskId, tasks]);

  const selectedTask = tasks.find((task) => task.taskId === selectedTaskId) ?? null;
  const selectedDiagnostics = selectedTaskId ? (diagnosticsByTask[selectedTaskId] ?? []) : [];
  const selectedLines = selectedTaskId ? lines.filter((line) => line.taskId === selectedTaskId) : lines;

  return (
    <div className="app runtime-console">
      <header className="app-header">
        <h1>onto — Runtime Console</h1>
        <span className={`stream-dot stream-${stream}`} title={`이벤트 스트림: ${stream}`} />
        <span className="dim console-subtitle">onto 자신의 telemetry — 분석 대상 저장소가 아니다 (I17)</span>
      </header>

      <div className="console-body">
        <section className="console-tasks">
          <h2>Tasks</h2>
          <ul className="console-task-list">
            {tasks.length === 0 && <li className="dim">아직 task가 없습니다.</li>}
            {[...tasks].reverse().map((task) => (
              <li key={task.taskId}>
                <button
                  type="button"
                  className={task.taskId === selectedTaskId ? "console-task console-task-selected" : "console-task"}
                  onClick={() => setSelectedTaskId(task.taskId)}
                >
                  <span className={`console-status console-status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
                  <span>
                    {task.agent} · {task.mode}
                  </span>
                  <span className="dim">{short(task.taskId)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="console-detail">
          {!selectedTask && <p className="dim">왼쪽에서 task를 고르세요.</p>}
          {selectedTask && (
            <>
              <h2>Task {short(selectedTask.taskId)}</h2>
              <dl className="console-fields">
                <dt>status</dt>
                <dd className={`console-status console-status-${selectedTask.status}`}>{STATUS_LABEL[selectedTask.status]}</dd>
                <dt>agent</dt>
                <dd>{selectedTask.agent}</dd>
                <dt>mode</dt>
                <dd>{selectedTask.mode}</dd>
                <dt>tokenUsage</dt>
                <dd>{selectedTask.tokenUsage ?? "—"}</dd>
                <dt>exploredFiles</dt>
                <dd>{selectedTask.exploredFiles.length}</dd>
                {selectedTask.error && (
                  <>
                    <dt>error</dt>
                    <dd className="console-error">{selectedTask.error}</dd>
                  </>
                )}
              </dl>

              <h3>MCP 두 증거원 (B4)</h3>
              {!mcpEvidence && <p className="dim">불러오는 중…</p>}
              {mcpEvidence && (
                <table className="console-table">
                  <thead>
                    <tr>
                      <th>tool</th>
                      <th>source</th>
                      <th>outcome</th>
                      <th>at</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mcpEvidence.calls.map((call, index) => (
                      <tr key={index}>
                        <td>{call.tool}</td>
                        <td className={call.source === "agent-stream" ? "console-source-agent" : "console-source-bridge"}>
                          {call.source}
                        </td>
                        <td>{call.outcome ?? "—"}</td>
                        <td className="dim">{call.at}</td>
                      </tr>
                    ))}
                    {mcpEvidence.calls.length === 0 && (
                      <tr>
                        <td colSpan={4} className="dim">
                          MCP 호출이 아직 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {mcpEvidence && mcpEvidence.toolsWithBothSources.length > 0 && (
                <p className="console-both-sources">두 증거원 모두 관측됨: {mcpEvidence.toolsWithBothSources.join(", ")}</p>
              )}

              <h3>Diagnostics</h3>
              {selectedDiagnostics.length === 0 && <p className="dim">이 세션에서 관측된 diagnostics가 없습니다.</p>}
              {selectedDiagnostics.map((entry, index) => (
                <div key={index} className="console-diagnostics-entry">
                  <div className="dim">
                    {entry.tool} · {entry.at}
                  </div>
                  <ul>
                    {entry.diagnostics.map((diagnostic, diagIndex) => (
                      <li key={diagIndex} className={`console-diag-${diagnostic.severity}`}>
                        <code>{diagnostic.code}</code> — {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <h3>이벤트 로그</h3>
              <div className="console-log">
                {selectedLines.slice(-60).map((line) => (
                  <div key={line.seq} className="log-line">
                    {line.text}
                  </div>
                ))}
                {selectedLines.length === 0 && <p className="dim">아직 이벤트가 없습니다.</p>}
              </div>
            </>
          )}
        </section>

        <section className="console-versions">
          <h2>Generation 이력</h2>
          <table className="console-table">
            <thead>
              <tr>
                <th>gen</th>
                <th>source</th>
                <th>message</th>
                <th>at</th>
              </tr>
            </thead>
            <tbody>
              {[...versions].reverse().map((version) => (
                <tr key={version.generation}>
                  <td>{version.generation}</td>
                  <td>{version.source}</td>
                  <td>{version.message}</td>
                  <td className="dim">{version.at}</td>
                </tr>
              ))}
              {versions.length === 0 && (
                <tr>
                  <td colSpan={4} className="dim">
                    이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
