import { useEffect, useRef, useState } from "react";
import type { AgentEvent, Diagnostic } from "@vibee/protocol";
import { getArchitectureView, type ArchitectureViewResponse } from "./api.ts";
import { connectEvents } from "./ws.ts";
import { ProjectPicker } from "./components/ProjectPicker.tsx";
import { AnalyzingConsole } from "./components/AnalyzingConsole.tsx";
import { ArchitectureView } from "./components/ArchitectureView.tsx";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel.tsx";

type ToolCallEntry = { tool: string; at: number };
type UsageEvent = Extract<AgentEvent, { type: "agent.usage" }>;

type Phase = "idle" | "analyzing" | "viewing" | "error";

// While agent.message.delta frames keep arriving, keep the "생각 중..."
// indicator on; if none arrive for this long, assume the current burst of
// thinking/output ended (there's no explicit "delta stream ended" event).
const THINKING_IDLE_TIMEOUT_MS = 1500;

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [projectPath, setProjectPath] = useState<string>("");
  const [taskId, setTaskId] = useState<string | null>(null);

  const [exploredFiles, setExploredFiles] = useState<string[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const [usage, setUsage] = useState<UsageEvent | null>(null);
  const [thinking, setThinking] = useState(false);

  const [viewingData, setViewingData] = useState<ArchitectureViewResponse | null>(null);
  const [errorDiagnostics, setErrorDiagnostics] = useState<Diagnostic[]>([]);

  const committedRef = useRef(false);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (phase !== "analyzing" || taskId === null) return;

    async function fetchAndShowView(currentProjectPath: string, currentTaskId: string) {
      const result = await getArchitectureView(currentProjectPath);
      if (result.ok) {
        setViewingData(result.data);
        setPhase("viewing");
      } else {
        setErrorDiagnostics([
          {
            code: "web/commit-fetch-failed",
            severity: "error",
            message: `다이어그램이 제출되었다는 신호를 받았지만 결과를 불러오지 못했습니다: ${result.error}`,
            subject: currentTaskId,
          },
        ]);
        setPhase("error");
      }
    }

    const unsubscribe = connectEvents((event) => {
      if (event.taskId !== taskId) return;

      switch (event.type) {
        case "task.started": {
          break;
        }
        case "agent.message.delta": {
          setThinking(true);
          if (thinkingTimerRef.current !== null) clearTimeout(thinkingTimerRef.current);
          thinkingTimerRef.current = setTimeout(() => setThinking(false), THINKING_IDLE_TIMEOUT_MS);
          break;
        }
        case "agent.file.explored": {
          setExploredFiles((prev) => [...prev, event.path]);
          break;
        }
        case "mcp.tool.called": {
          setToolCalls((prev) => [...prev, { tool: event.tool, at: Date.now() }]);
          break;
        }
        case "agent.usage": {
          setUsage(event);
          break;
        }
        case "architecture-view.committed": {
          committedRef.current = true;
          void fetchAndShowView(projectPath, taskId);
          break;
        }
        case "task.completed": {
          // Distinct from "architecture-view.committed": the agent's turn
          // can end without ever successfully submitting (e.g. it hit the
          // validate/submit round-trip cap and gave up). If we already
          // handled a "committed" event, this is a no-op.
          if (!committedRef.current) {
            setErrorDiagnostics([
              {
                code: "web/task-completed-without-commit",
                severity: "error",
                message:
                  "AI가 분석을 종료했지만 다이어그램을 제출하지 못했습니다 (검증/제출 횟수 제한에 도달했을 수 있습니다).",
                subject: taskId,
              },
            ]);
            setPhase("error");
          }
          break;
        }
        case "task.error": {
          setErrorDiagnostics([
            {
              code: "web/task-error",
              severity: "error",
              message: event.message,
              subject: taskId,
            },
          ]);
          setPhase("error");
          break;
        }
      }
    });

    return unsubscribe;
    // Deliberately excludes `projectPath` from deps: it's read via closure
    // inside fetchAndShowView but doesn't change mid-analysis, and including
    // it would risk re-subscribing the WS connection unnecessarily.
  }, [phase, taskId]);

  function resetToIdle() {
    setPhase("idle");
    setProjectPath("");
    setTaskId(null);
    setExploredFiles([]);
    setToolCalls([]);
    setUsage(null);
    setThinking(false);
    setViewingData(null);
    setErrorDiagnostics([]);
    committedRef.current = false;
  }

  function handleStarted(info: { taskId: string; projectPath: string }) {
    setProjectPath(info.projectPath);
    setTaskId(info.taskId);
    setExploredFiles([]);
    setToolCalls([]);
    setUsage(null);
    setThinking(false);
    committedRef.current = false;
    setPhase("analyzing");
  }

  function handleStartNewFromViewing() {
    resetToIdle();
  }

  if (phase === "idle") {
    return <ProjectPicker onStarted={handleStarted} />;
  }

  if (phase === "analyzing") {
    return (
      <AnalyzingConsole
        projectPath={projectPath}
        exploredFiles={exploredFiles}
        toolCalls={toolCalls}
        usage={usage}
        thinking={thinking}
      />
    );
  }

  if (phase === "error") {
    return (
      <div className="error-screen">
        <h1>문제가 발생했습니다</h1>
        <DiagnosticsPanel diagnostics={errorDiagnostics} heading="상세 내용" />
        <button type="button" onClick={resetToIdle}>
          처음으로 돌아가기
        </button>
      </div>
    );
  }

  if (phase === "viewing" && viewingData) {
    return (
      <div className="viewing-screen">
        <ArchitectureView document={viewingData.document} svg={viewingData.svg} meta={viewingData.meta} />
        <button type="button" onClick={handleStartNewFromViewing}>
          새 프로젝트 분석 시작
        </button>
      </div>
    );
  }

  return null;
}
