import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentEventEnvelope,
  AgentReadiness,
  BridgeStateResponse,
  SelectedItem,
  ShowResultInput,
  StartTaskResponse,
} from "@byoa/protocol";

/** 실제 앱 선택 상태를 대신하는 mock. get_app_context가 돌려줄 값이 있어야 하기 때문이다. */
const MOCK_ITEMS: SelectedItem[] = [
  { id: "login-screen", label: "Login Screen" },
  { id: "checkout-flow", label: "Checkout Flow" },
  { id: "settings-page", label: "Settings Page" },
];

const DEFAULT_PROMPT = 'README.md의 마지막에 "Edited by BYOA agent." 를 추가해줘.';

type LogLine = { seq: number; at: string; text: string; tone: "info" | "mcp" | "good" | "bad" };

export function App() {
  // 초기값은 비워 두고 bridge가 알려주는 fixture 경로로 채운다.
  const [projectPath, setProjectPath] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedId, setSelectedId] = useState(MOCK_ITEMS[0]!.id);

  const [readiness, setReadiness] = useState<AgentReadiness[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ShowResultInput | null>(null);
  const [mcpSeen, setMcpSeen] = useState<Set<string>>(new Set());

  const logRef = useRef<HTMLDivElement>(null);

  // 로드 시 health check를 하고 bridge의 상태로 초기화한다.
  useEffect(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then((data: { agents: AgentReadiness[] }) => setReadiness(data.agents))
      .catch(() => setError("Bridge is not reachable. Start it with `npm run bridge`."));

    void fetch("/api/state")
      .then((r) => r.json())
      .then((data: BridgeStateResponse) => {
        setProjectPath(data.appContext.projectPath || data.defaultProjectPath);
      })
      .catch(() => undefined);
  }, []);

  // UI 상태를 bridge에 미러링해서 `get_app_context`가 화면에 보이는 값을 그대로 반영하게 한다.
  useEffect(() => {
    if (!projectPath) return; // 아직 bridge에서 기본 경로를 받아오기 전
    const selectedItem = MOCK_ITEMS.find((item) => item.id === selectedId) ?? null;
    const timer = setTimeout(() => {
      void fetch("/api/app-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath, prompt, selectedItem }),
      }).catch(() => undefined);
    }, 200);
    return () => clearTimeout(timer);
  }, [projectPath, prompt, selectedId]);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`;
    const socket = new WebSocket(url);

    socket.onmessage = (raw) => {
      const envelope = JSON.parse(raw.data as string) as AgentEventEnvelope;
      const { event } = envelope;

      const push = (text: string, tone: LogLine["tone"] = "info") =>
        setLines((prev) => [...prev, { seq: envelope.seq, at: envelope.at, text, tone }]);

      switch (event.type) {
        case "task.started":
          setRunning(true);
          setResult(null);
          setMessage("");
          setMcpSeen(new Set());
          push(`Task started — ${event.projectPath}`, "good");
          break;
        case "agent.message.delta":
          setMessage((prev) => prev + event.text);
          break;
        case "agent.action.started":
          push(`▶ ${event.name}${formatDetail(event.detail)}`);
          break;
        case "agent.action.completed":
          push(`✔ ${event.name}${formatDetail(event.detail)}`);
          break;
        case "mcp.tool.called":
          setMcpSeen((prev) => new Set(prev).add(event.tool));
          push(`MCP ${event.tool} called  [${event.source}]`, "mcp");
          break;
        case "app.result":
          setResult(event.result);
          push("Structured result received via show_result", "mcp");
          break;
        case "task.completed":
          setRunning(false);
          push("Task completed", "good");
          break;
        case "task.interrupted":
          setRunning(false);
          push("Task interrupted", "bad");
          break;
        case "task.error":
          setRunning(false);
          push(`Task error: ${event.message}`, "bad");
          break;
      }
    };

    socket.onerror = () => setError("WebSocket connection to the bridge failed.");
    return () => socket.close();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const run = useCallback(async () => {
    setError(null);
    setLines([]);
    const selectedItem = MOCK_ITEMS.find((item) => item.id === selectedId) ?? null;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "codex", projectPath, prompt, appContext: { selectedItem } }),
    });
    const data = (await response.json()) as StartTaskResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to start the task");
      return;
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [projectPath, prompt, selectedId]);

  const stop = useCallback(async () => {
    if (!taskId) return;
    await fetch(`/api/tasks/${taskId}/stop`, { method: "POST" });
  }, [taskId]);

  const codex = readiness.find((entry) => entry.agent === "codex");

  return (
    <main>
      <h1>BYOA + MCP Spike</h1>

      {codex && (
        <p className={codex.installed && codex.authenticated !== false ? "banner ok" : "banner bad"}>
          {codex.installed && codex.authenticated !== false
            ? `Codex ready${codex.version ? ` — ${codex.version}` : ""}`
            : (codex.message ?? "Codex is not ready.")}
        </p>
      )}
      {error && <p className="banner bad">{error}</p>}

      <section className="panel">
        <label>
          Agent
          <select defaultValue="codex">
            <option value="codex">Codex</option>
            <option value="claude" disabled>
              Claude (Phase B)
            </option>
          </select>
        </label>

        <label>
          Project Path
          <input value={projectPath} onChange={(e) => setProjectPath(e.target.value)} spellCheck={false} />
        </label>

        <label>
          Mock App Selection
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {MOCK_ITEMS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Prompt
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>

        <div className="row">
          <button onClick={() => void run()} disabled={running || !projectPath.trim()}>
            Run
          </button>
          <button onClick={() => void stop()} disabled={!running} className="secondary">
            Stop
          </button>
          <span className="muted">{taskId ? `task ${taskId.slice(0, 8)}` : "no task yet"}</span>
        </div>

        <div className="row checks">
          <Check label="get_app_context" done={mcpSeen.has("get_app_context")} />
          <Check label="show_result" done={mcpSeen.has("show_result")} />
        </div>
      </section>

      <section className="panel">
        <h2>Agent Activity</h2>
        <div className="log" ref={logRef}>
          {lines.length === 0 && <p className="muted">No events yet.</p>}
          {lines.map((line) => (
            <div key={line.seq} className={`line ${line.tone}`}>
              <span className="ts">{line.at.slice(11, 19)}</span>
              {line.text}
            </div>
          ))}
        </div>
        {message && (
          <>
            <h3>Agent message</h3>
            <pre className="message">{message}</pre>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Structured Result</h2>
        {!result && <p className="muted">Nothing pushed through show_result yet.</p>}
        {result && (
          <div className={`result ${result.status}`}>
            <h3>{result.title}</h3>
            <p className="status">{result.status}</p>
            <p>{result.summary}</p>
            {result.filesChanged && result.filesChanged.length > 0 && (
              <>
                <h4>Files changed</h4>
                <ul>
                  {result.filesChanged.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </>
            )}
            {result.details && result.details.length > 0 && (
              <ul>
                {result.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function Check({ label, done }: { label: string; done: boolean }) {
  return (
    <span className={`check ${done ? "done" : ""}`}>
      {done ? "✔" : "○"} {label}
    </span>
  );
}

function formatDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const record = detail as Record<string, unknown>;
  if (typeof record.command === "string") return `  ${truncate(record.command, 90)}`;
  if (Array.isArray(record.files)) return `  ${record.files.join(", ")}`;
  if (typeof record.tool === "string") return `  ${String(record.server)}/${record.tool}`;
  if (typeof record.method === "string") return `  ${record.method}`;
  return "";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
