import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentEventEnvelope,
  AgentId,
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
  const [agent, setAgent] = useState<AgentId>("codex");
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
  // 지금 어느 세션에서 돌고 있는지. Send를 반복해도 같은 세션이 이어지므로 이것을 드러낸다.
  const [session, setSession] = useState<{ id: string; turns: number } | null>(null);
  // 첫 연결 전에는 "connecting" — 아직 실패한 것이 아니므로 경고를 띄우지 않는다.
  const [stream, setStream] = useState<"connecting" | "open" | "closed">("connecting");

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

  /**
   * 이벤트 스트림. bridge를 재시작하면 소켓이 끊기므로 스스로 다시 붙는다.
   * 재접속하면 bridge가 최근 task의 이벤트를 replay 하기 때문에 seq로 중복을 걸러낸다.
   */
  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const handle = (raw: MessageEvent) => {
      const envelope = JSON.parse(raw.data as string) as AgentEventEnvelope;
      const { event } = envelope;

      const push = (text: string, tone: LogLine["tone"] = "info") =>
        setLines((prev) =>
          prev.some((line) => line.seq === envelope.seq)
            ? prev
            : [...prev, { seq: envelope.seq, at: envelope.at, text, tone }],
        );

      switch (event.type) {
        case "task.started":
          setRunning(true);
          setResult(null);
          setMessage("");
          setMcpSeen(new Set());
          push(`Task started — ${event.projectPath}`, "good");
          break;
        case "agent.session":
          setSession((prev) =>
            event.resumed && prev?.id === event.sessionId
              ? { id: event.sessionId, turns: prev.turns + 1 }
              : { id: event.sessionId, turns: 1 },
          );
          push(
            event.resumed
              ? `Continuing session ${short(event.sessionId)}`
              : `New session ${short(event.sessionId)}`,
            "good",
          );
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

    const connect = () => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`;
      socket = new WebSocket(url);
      socket.onmessage = handle;
      socket.onopen = () => setStream("open");
      // 브라우저는 실패 시 error 다음에 반드시 close를 보낸다. 재접속은 여기 한 곳에서만 건다.
      socket.onclose = () => {
        if (disposed) return;
        setStream("closed");
        retry = setTimeout(connect, 1000);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  // agent나 프로젝트를 바꾸면 세션이 달라진다. 이전 세션 표시를 그대로 두면 거짓말이 된다.
  useEffect(() => {
    setSession(null);
  }, [agent, projectPath]);

  const send = useCallback(async () => {
    setError(null);
    setLines([]);
    const selectedItem = MOCK_ITEMS.find((item) => item.id === selectedId) ?? null;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath, prompt, appContext: { selectedItem } }),
    });
    const data = (await response.json()) as StartTaskResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to start the task");
      return;
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [agent, projectPath, prompt, selectedId]);

  const stop = useCallback(async () => {
    if (!taskId) return;
    await fetch(`/api/tasks/${taskId}/stop`, { method: "POST" });
  }, [taskId]);

  /** 세션 참조를 놓아준다. 다음 Send는 새 세션에서 시작한다. 이전 세션은 지워지지 않는다. */
  const newSession = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/sessions/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Failed to start a new session");
      return;
    }
    setSession(null);
    setLines([]);
    setMessage("");
    setResult(null);
    setMcpSeen(new Set());
  }, [agent, projectPath]);

  const activeReadiness = readiness.find((entry) => entry.agent === agent);

  return (
    <main>
      <h1>BYOA + MCP Spike</h1>

      {activeReadiness && (
        <p className={activeReadiness.installed && activeReadiness.authenticated !== false ? "banner ok" : "banner bad"}>
          {activeReadiness.installed && activeReadiness.authenticated !== false
            ? `${agent} ready${activeReadiness.version ? ` — ${activeReadiness.version}` : ""}`
            : (activeReadiness.message ?? `${agent} is not ready.`)}
        </p>
      )}
      {stream === "closed" && (
        <p className="banner bad">Bridge 이벤트 연결이 끊겼습니다. 재연결하는 중… (`npm run bridge`가 떠 있는지 확인)</p>
      )}
      {error && <p className="banner bad">{error}</p>}

      <section className="panel">
        <label>
          Agent
          <select value={agent} onChange={(e) => setAgent(e.target.value as AgentId)}>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
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
          <button onClick={() => void send()} disabled={running || !projectPath.trim() || !prompt.trim()}>
            Send
          </button>
          <button onClick={() => void stop()} disabled={!running} className="secondary">
            Stop
          </button>
          <button onClick={() => void newSession()} disabled={running || !session} className="secondary">
            New Session
          </button>
        </div>

        {session ? (
          <p className="muted">
            세션 <code title={session.id}>{short(session.id)}</code> · turn {session.turns} — Send를 다시 누르면 이
            대화가 이어집니다.{" "}
            <button className="link" onClick={() => void navigator.clipboard.writeText(session.id)}>
              전체 ID 복사
            </button>
          </p>
        ) : (
          <p className="muted">세션 없음 — 다음 Send가 새 세션을 시작합니다.</p>
        )}

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

/**
 * Codex의 thread id는 UUIDv7이라 앞부분이 타임스탬프다. 8자만 보여주면 연달아 만든 두 세션이
 * 같은 것처럼 보인다(실제로 그렇게 헷갈렸다). 구분이 실제로 되는 지점까지 보여준다.
 */
function short(sessionId: string): string {
  return sessionId.slice(0, 13);
}
