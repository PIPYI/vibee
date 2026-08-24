import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentEventEnvelope,
  AgentId,
  AgentModelsResponse,
  AgentReadiness,
  AgentSessionsResponse,
  ArchitectureDebtReport,
  BridgeStateResponse,
  DriftFinding,
  ExportDesignResponse,
  HealthResponse,
  ModelOption,
  PendingQuestion,
  SelectedItem,
  SessionSummary,
  ShowResultInput,
  StartArchitectureResponse,
  StartReviewResponse,
  StartTaskResponse,
  StartWikiKeywordsResponse,
  WikiKeyword,
  WikiPage,
  ToolReadiness,
} from "@byoa/protocol";

import { Markdown } from "./Markdown";

/** 실제 앱 선택 상태를 대신하는 mock. get_app_context가 돌려줄 값이 있어야 하기 때문이다. */
const MOCK_ITEMS: SelectedItem[] = [
  { id: "login-screen", label: "Login Screen" },
  { id: "checkout-flow", label: "Checkout Flow" },
  { id: "settings-page", label: "Settings Page" },
];

const DEFAULT_PROMPT = 'README.md의 마지막에 "Edited by BYOA agent." 를 추가해줘.';

type LogLine = { seq: number; at: string; text: string; tone: "info" | "mcp" | "good" | "bad" };

const ARCHITECTURE_CATEGORY_LABEL = {
  "oversized-module": "한 파일에 쌓인 책임",
  "duplicated-logic": "의미가 같은 로직 중복",
  "stale-temporary-workaround": "방치된 임시 조치",
} as const;

export function App() {
  const [agent, setAgent] = useState<AgentId>("codex");
  // 초기값은 비워 두고 bridge가 알려주는 fixture 경로로 채운다.
  const [projectPath, setProjectPath] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedId, setSelectedId] = useState(MOCK_ITEMS[0]!.id);

  // 모델·effort는 provider가 신고한 목록에서 고른다. ""는 "오버라이드 없음"이다.
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [modelsNote, setModelsNote] = useState<string | null>(null);

  const [readiness, setReadiness] = useState<AgentReadiness[]>([]);
  // git은 agent와 같은 급의 전제 조건이다 — 없으면 되돌릴 지점을 남길 수 없다.
  const [tools, setTools] = useState<ToolReadiness[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  // 드리프트 리뷰 (§3.3). 고치는 일은 사용자의 옆 agent가 한다 — 여기서는 finding마다
  // 해소 프롬프트를 보여주고 복사만 시킨다.
  const [driftFindings, setDriftFindings] = useState<DriftFinding[]>([]);
  // 코드가 준비한 세 구조 신호를 agent가 판단한 리포트. 다른 기능과 독립 상태다.
  const [architectureReport, setArchitectureReport] = useState<ArchitectureDebtReport | null>(null);
  // 위키 (§3.5). 키워드는 agent가 고르고, 사용자가 그중 하나를 눌러 페이지를 만든다.
  const [keywords, setKeywords] = useState<WikiKeyword[] | null>(null);
  const [wikiPage, setWikiPage] = useState<WikiPage | null>(null);
  const [wikiDone, setWikiDone] = useState<string[]>([]);
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
  // 인터뷰: agent가 ask_user로 던진 질문과 사용자가 쓰는 답
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [asked, setAsked] = useState<Array<{ question: string; answer: string }>>([]);

  // 설계 초안: 사람용 서술은 bridge가 렌더한 것을 그대로 보여준다 (§5).
  const [narrative, setNarrative] = useState<string | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [handover, setHandover] = useState<ExportDesignResponse | null>(null);

  // 이어받을 수 있는 기존 세션들 (§7).
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);

  // 로드 시 health check를 하고 bridge의 상태로 초기화한다.
  useEffect(() => {
    void fetch("/api/health")
      .then((r) => r.json())
      .then((data: HealthResponse) => {
        setReadiness(data.agents);
        setTools(data.tools ?? []);
      })
      .catch(() => setError("Bridge is not reachable. Start it with `npm run bridge`."));

    void fetch("/api/state")
      .then((r) => r.json())
      .then((data: BridgeStateResponse) => {
        setProjectPath(data.appContext.projectPath || data.defaultProjectPath);
        // bridge가 이미 설계를 들고 있으면(브라우저만 새로고침한 경우) 그대로 되살린다.
        if (data.design) {
          setGaps(data.designGaps);
          void fetch("/api/design/narrative")
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { markdown: string } | null) => d && setNarrative(d.markdown))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  }, []);

  /**
   * agent가 바뀌면 그 provider의 모델 목록을 다시 받아온다.
   *
   * 여기에 provider 이름으로 분기하는 코드가 없다는 점이 중요하다 — 어떤 모델이 있고 어떤
   * effort를 받는지는 전적으로 bridge가 알려준다. 목록을 못 받아도 task는 provider
   * 기본값으로 돌 수 있으므로 실패를 치명적으로 다루지 않는다.
   */
  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setModel("");
    setEffort("");
    setModelsNote("모델 목록을 불러오는 중…");

    void fetch(`/api/models?agent=${encodeURIComponent(agent)}`)
      .then(async (r) => {
        const data = (await r.json()) as AgentModelsResponse & { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setModelsNote(`모델 목록을 불러오지 못했습니다 (${data.error ?? r.status}). 기본값으로 실행됩니다.`);
          return;
        }
        setModels(data.models);
        setModelsNote(null);
      })
      .catch(() => {
        if (!cancelled) setModelsNote("모델 목록을 불러오지 못했습니다. 기본값으로 실행됩니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [agent]);

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
        case "app.design":
          push(`설계 초안 저장됨 — ${event.design.title}`, "mcp");
          // 서술은 bridge가 만든다. 브라우저가 따로 렌더하면 두 벌이 되어 어긋난다.
          void fetch("/api/design/narrative")
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { markdown: string; gaps: string[] } | null) => {
              if (!data) return;
              setNarrative(data.markdown);
              setGaps(data.gaps);
              setHandover(null);
            })
            .catch(() => undefined);
          break;
        case "app.drift":
          // 결론이 도착했는데 화면이 조용하면 "리뷰가 돌지 않았다"와 구분되지 않는다.
          // 판정을 여기서 다시 하지 않는다 — 리포트에 담긴 것을 그대로 보여준다.
          setDriftFindings(event.report.findings);
          if (event.report.findings.length === 0) {
            push("드리프트 없음 — 기준을 모두 확인했고 어긋난 것이 없습니다", "good");
          } else {
            for (const finding of event.report.findings) {
              const where = finding.files.length > 0 ? finding.files.join(", ") : "(파일 미지정)";
              const guess = finding.confidence === "low" ? " (추정)" : "";
              // 커밋을 함께 보여준다. 고칠 대상을 찾는 첫 단서가 "어느 커밋에서 들어왔나"다.
              push(`⚠ ${finding.criterionId} 깨짐 — ${short(finding.commit)} ${where}${guess}: ${finding.detail}`, "bad");
            }
          }
          break;
        case "app.architecture":
          setArchitectureReport(event.report);
          push(`구조 점검 완료 — 기술부채 ${event.report.findings.length}건`, "mcp");
          break;
        case "app.wiki.keywords":
          setKeywords(event.keywords);
          push(`위키 후보 ${event.keywords.length}개`, "mcp");
          break;
        case "app.wiki":
          setWikiPage(event.page);
          setWikiDone((prev) => (prev.includes(event.page.term) ? prev : [...prev, event.page.term]));
          push(`위키 페이지 — ${event.page.term} (근거 ${event.page.where.length}개)`, "mcp");
          break;
        case "app.question":
          setQuestion(event.question);
          setAnswer("");
          push(`질문 도착: ${event.question.question}`, "mcp");
          break;
        case "app.answer":
          push(`답변 전송: ${event.answer}`, "good");
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

  /** 인터뷰 시작. agent가 첫 질문을 던지고 turn을 끝낸다. */
  const startInterview = useCallback(async () => {
    setError(null);
    setLines([]);
    setQuestion(null);
    setAsked([]);
    setResult(null);
    setMessage("");
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath, prompt: "(interview)", mode: "interview", model, effort }),
    });
    const data = (await response.json()) as StartTaskResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to start the interview");
      return;
    }
    // 새 인터뷰는 새 프로젝트다. 지난 설계와 하네스가 지워졌다면 그대로 알린다.
    if (data.cleared?.length) {
      setMessage(`새 인터뷰를 시작하면서 이전 설계를 지웠습니다: ${data.cleared.join(", ")}`);
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [agent, projectPath, model, effort]);

  /**
   * 인터뷰에 말을 건다. 대기 중인 질문에 답하는 것과, 초안을 보고 고쳐 달라고 하는 것이
   * 같은 경로다 (§4.5, §4.10 3단계). 나누면 초안 이후가 막다른 길이 된다.
   */
  const sendMessage = useCallback(async () => {
    if (!answer.trim()) return;
    setError(null);
    setAsked((prev) => [...prev, { question: question?.question ?? "", answer }]);
    setQuestion(null);
    setAnswer("");
    setMessage("");
    const response = await fetch("/api/interview/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath, message: answer, model, effort }),
    });
    const data = (await response.json()) as StartTaskResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to send the message");
      return;
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [agent, projectPath, question, answer, model, effort]);

  /** 이어받을 수 있는 기존 세션들을 불러온다 (§7). */
  const loadSessions = useCallback(async () => {
    if (!projectPath.trim()) return;
    setError(null);
    setLoadingSessions(true);
    try {
      const response = await fetch(
        `/api/sessions?agent=${encodeURIComponent(agent)}&projectPath=${encodeURIComponent(projectPath)}`,
      );
      const data = (await response.json()) as AgentSessionsResponse & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "기존 대화를 불러오지 못했습니다");
        return;
      }
      setSessions(data.sessions);
    } finally {
      setLoadingSessions(false);
    }
  }, [agent, projectPath]);

  /** 고른 세션에 붙는다. 다음에 말을 걸면 그 대화가 이어진다. */
  const resume = useCallback(
    async (sessionId: string) => {
      setError(null);
      const response = await fetch("/api/sessions/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, projectPath, sessionId }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setError(data.error ?? "대화를 이어받지 못했습니다");
        return;
      }
      // 이 대화의 문답은 세션 안에 있다. 화면에 남아 있던 이전 대화 흔적은 지운다.
      setSessions(null);
      setAsked([]);
      setQuestion(null);
      setNarrative(null);
      setGaps([]);
      setHandover(null);
      setLines([]);
      setMessage("");
      setSession({ id: sessionId, turns: 0 });
    },
    [agent, projectPath],
  );

  /** 인계 — 설계와 harness를 프로젝트 디렉터리에 쓴다 (§7). */
  const exportDesign = useCallback(async () => {
    setError(null);
    const response = await fetch("/api/design/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath }),
    });
    const data = (await response.json()) as ExportDesignResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "파일을 만들지 못했습니다");
      return;
    }
    setHandover(data);
  }, [agent, projectPath]);

  /**
   * 드리프트 리뷰 (§3.3). 어디부터 볼지는 bridge가 정한다 — 마지막 리뷰 지점, 없으면
   * 설계가 들어온 커밋. 볼 커밋이 없으면 taskId가 null로 온다.
   */
  const review = useCallback(async () => {
    setError(null);
    setLines([]);
    setDriftFindings([]);
    const response = await fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath, model, effort }),
    });
    const data = (await response.json()) as StartReviewResponse & { taskId: string | null; error?: string };
    if (!response.ok) {
      setError(data.error ?? "리뷰를 시작하지 못했습니다");
      return;
    }
    if (!data.taskId) {
      setError("리뷰할 새 커밋이 없습니다");
      return;
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [agent, projectPath, model, effort]);

  /** 현재 프로젝트 전체를 읽기 전용으로 분석한다. Wiki·Drift 결과는 건드리지 않는다. */
  const analyzeArchitecture = useCallback(async () => {
    setError(null);
    setLines([]);
    setArchitectureReport(null);
    const response = await fetch("/api/architecture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath, model, effort }),
    });
    const data = (await response.json()) as StartArchitectureResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "아키텍처 분석을 시작하지 못했습니다");
      return;
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [agent, projectPath, model, effort]);

  /** 위키 패널을 연다. 후보 키워드를 뽑는 turn이 한 번 돈다 (키워드마다가 아니다). */
  const findKeywords = useCallback(async () => {
    setError(null);
    setLines([]);
    setKeywords(null);
    setWikiPage(null);
    const response = await fetch("/api/wiki/keywords", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath, model, effort }),
    });
    const data = (await response.json()) as StartWikiKeywordsResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "키워드를 뽑지 못했습니다");
      return;
    }
    setWikiDone(data.existing);
    if (!data.taskId) {
      setError("이 프로젝트에서 아직 대화한 기록이 없습니다");
      return;
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [agent, projectPath, model, effort]);

  const writeWiki = useCallback(
    async (term: string) => {
      setError(null);
      setWikiPage(null);
      const response = await fetch("/api/wiki", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, projectPath, term, model, effort }),
      });
      const data = (await response.json()) as { taskId?: string; error?: string };
      if (!response.ok || !data.taskId) {
        setError(data.error ?? "페이지를 만들지 못했습니다");
        return;
      }
      setTaskId(data.taskId);
      setRunning(true);
    },
    [agent, projectPath, model, effort],
  );

  const send = useCallback(async () => {
    setError(null);
    setLines([]);
    const selectedItem = MOCK_ITEMS.find((item) => item.id === selectedId) ?? null;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, projectPath, prompt, appContext: { selectedItem }, model, effort }),
    });
    const data = (await response.json()) as StartTaskResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Failed to start the task");
      return;
    }
    setTaskId(data.taskId);
    setRunning(true);
  }, [agent, projectPath, prompt, selectedId, model, effort]);

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
  // 모델을 고르지 않았으면 provider 기본 모델의 effort 집합을 보여준다.
  // effort 값은 모델마다 다르다 (Codex에는 ultra가 있고, Claude haiku는 아예 없다).
  const activeModel = models.find((entry) => entry.id === model) ?? models.find((entry) => entry.isDefault);
  const efforts = activeModel?.efforts ?? [];

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
      {tools
        .filter((tool) => !tool.installed)
        .map((tool) => (
          <p key={tool.tool} className="banner bad">
            {tool.message ?? `${tool.tool}이(가) 설치되어 있지 않습니다.`}
          </p>
        ))}
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
          Model
          <select
            value={model}
            disabled={models.length === 0}
            onChange={(e) => {
              setModel(e.target.value);
              // effort 집합은 모델마다 다르므로 모델을 바꾸면 선택을 놓는다.
              setEffort("");
            }}
          >
            <option value="">기본값{defaultLabel(models)}</option>
            {models.map((entry) => (
              <option key={entry.id} value={entry.id} title={entry.description}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Effort
          <select value={effort} disabled={efforts.length === 0} onChange={(e) => setEffort(e.target.value)}>
            <option value="">
              기본값{activeModel?.defaultEffort ? ` — ${activeModel.defaultEffort}` : ""}
            </option>
            {efforts.map((entry) => (
              <option key={entry.id} value={entry.id} title={entry.description}>
                {entry.id}
              </option>
            ))}
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
          <button onClick={() => void startInterview()} disabled={running || !projectPath.trim()} className="secondary">
            인터뷰 시작
          </button>
          <button onClick={() => void review()} disabled={running || !projectPath.trim()} className="secondary">
            드리프트 리뷰
          </button>
          <button
            onClick={() => void analyzeArchitecture()}
            disabled={running || !projectPath.trim()}
            className="secondary"
          >
            아키텍처·기술부채
          </button>
          <button onClick={() => void findKeywords()} disabled={running || !projectPath.trim()} className="secondary">
            위키
          </button>
          <button onClick={() => void newSession()} disabled={running || !session} className="secondary">
            New Session
          </button>
          <button
            onClick={() => void (sessions ? setSessions(null) : loadSessions())}
            disabled={running || !projectPath.trim()}
            className="secondary"
          >
            {sessions ? "닫기" : "기존 대화 이어가기"}
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

        {sessions && (
          <div className="sessions">
            {loadingSessions && <p className="muted">불러오는 중…</p>}
            {!loadingSessions && sessions.length === 0 && (
              <p className="muted">이 프로젝트에서 나눈 대화가 아직 없습니다.</p>
            )}
            {sessions.map((entry) => (
              <button
                key={entry.id}
                className="session"
                disabled={running || entry.active}
                onClick={() => void resume(entry.id)}
              >
                <span className="session-preview">{entry.preview}</span>
                <span className="muted">
                  {entry.updatedAt.slice(5, 16).replace("T", " ")}
                  {entry.active ? " · 지금 이어져 있음" : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        {modelsNote && <p className="muted">{modelsNote}</p>}
        {!modelsNote && activeModel && efforts.length === 0 && (
          <p className="muted">{activeModel.label}은(는) effort를 지원하지 않습니다.</p>
        )}

        <div className="row checks">
          <Check label="get_app_context" done={mcpSeen.has("get_app_context")} />
          <Check label="ask_user" done={mcpSeen.has("ask_user")} />
          <Check label="show_result" done={mcpSeen.has("show_result")} />
        </div>
      </section>

      {(question || asked.length > 0 || narrative) && (
        <section className="panel">
          <h2>인터뷰</h2>

          {asked.map((exchange, index) => (
            <div key={index} className="exchange">
              {exchange.question && <p className="asked">{exchange.question}</p>}
              <p className="answered">{exchange.answer}</p>
            </div>
          ))}

          {question && (
            <div className="question">
              <h3>{question.question}</h3>
              {question.why && <p className="muted">{question.why}</p>}
              {question.hints && question.hints.length > 0 && (
                <p className="muted">예) {question.hints.join(" / ")}</p>
              )}
              {question.progress && (
                <p className="muted">
                  {question.progress.total}개 중 {question.progress.step}번째
                </p>
              )}
            </div>
          )}

          {running && !question && <p className="muted">에이전트가 생각하는 중…</p>}

          {/* 입력창은 질문이 없어도 항상 열려 있다 (§4.5). 초안을 보고 고쳐 달라고 하는 것이
              §4.10의 3단계이며, 이 경로가 막히면 초안이 막다른 길이 된다. */}
          <textarea
            rows={3}
            value={answer}
            placeholder={
              question
                ? "자유롭게 답하거나, 하고 싶은 말을 쓰세요"
                : "고칠 것이 있으면 말씀하세요 — \"이건 아닌데\", \"이것도 필요해\""
            }
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div className="row">
            <button onClick={() => void sendMessage()} disabled={running || !answer.trim()}>
              {question ? "답변 보내기" : "보내기"}
            </button>
          </div>
        </section>
      )}

      {/* [2] 정리 (§5). 여기서 초안을 읽고 고친 뒤에만 [3][4]로 넘어간다 —
          인계 버튼이 이 패널 안에만 있는 이유다. */}
      {narrative && (
        <section className="panel">
          <h2>설계 초안</h2>
          <p className="muted">
            읽어 보시고 <strong>틀린 것</strong>이 있으면 위 입력창에 말씀하세요. 초안은 고쳐 쓰라고 있는 것입니다.
          </p>

          <Markdown source={narrative} />

          {gaps.length > 0 && (
            <div className="gaps">
              <h3>아직 정해지지 않은 것</h3>
              {/* §4.10 — 막지 않는다. 경고만 하고 보내준다. 정해지지 않은 채 넘어간 것은
                  DEC으로 남아 나중에 근거가 된다. */}
              <ul>
                {gaps.map((gap: string) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
              <p className="muted">이대로 시작하셔도 됩니다. 나중에 고칠 수 있습니다.</p>
            </div>
          )}

          {!handover ? (
            <div className="row">
              <button onClick={() => void exportDesign()} disabled={running}>
                이대로 시작하기
              </button>
              <span className="muted">
                {agent === "claude" ? "app_design.md · CLAUDE.md" : "app_design.md · AGENTS.md"}를 프로젝트에 만듭니다
              </span>
            </div>
          ) : (
            <div className="handover">
              <h3>준비됐습니다</h3>
              <p>
                <code>{handover.projectPath}</code>에 만들었습니다.
              </p>
              <ul>
                {handover.written.map((file: string) => (
                  <li key={file}>
                    <code>{file}</code>
                  </li>
                ))}
              </ul>
              {handover.skipped.length > 0 && (
                <p className="muted">
                  이미 있던 파일은 건드리지 않았습니다: {handover.skipped.join(", ")}
                </p>
              )}
              {handover.gitInitialized && (
                <p className="muted">
                  되돌릴 수 있도록 이 폴더를 git 저장소로 만들고 지금 상태를 저장해 두었습니다.
                  잘못되면 이 지점으로 되돌아올 수 있습니다.
                </p>
              )}
              <p>
                이제 {agent === "claude" ? "Claude Code" : "Codex"}를 열고 이 폴더에서 작업하세요. 이렇게 시작해 보세요:
              </p>
              <pre className="message">{handover.firstPrompt}</pre>
              <button className="link" onClick={() => void navigator.clipboard.writeText(handover.firstPrompt)}>
                복사
              </button>
            </div>
          )}
        </section>
      )}

      {driftFindings.length > 0 && (
        <section className="panel">
          <h2>드리프트</h2>
          <p className="muted">
            무엇이 맞는지는 이 앱이 정하지 않습니다. 옆에 띄워 둔 {agent === "claude" ? "Claude Code" : "Codex"}에
            프롬프트를 붙여넣으면, 코드가 틀렸는지 결정이 낡았는지 판단해서 직접 고칩니다.
          </p>
          {driftFindings.map((finding, i) => (
            <div key={`${finding.commit}-${finding.criterionId}-${i}`} className="result">
              <h3>
                {finding.criterionId} 깨짐 — {short(finding.commit)}
                {finding.confidence === "low" ? " (추정)" : ""}
              </h3>
              <p>{finding.detail}</p>
              {finding.files.length > 0 && <p className="muted">{finding.files.join(", ")}</p>}
              {finding.resolutionPrompt && (
                <button
                  className="link"
                  onClick={() => void navigator.clipboard.writeText(finding.resolutionPrompt ?? "")}
                >
                  해소 프롬프트 복사
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {architectureReport && (
        <section className="panel">
          <h2>아키텍처·기술부채</h2>
          <p>{architectureReport.summary}</p>
          <p className="muted">
            현재 결과는 <code>.project-intel/architecture.json</code>과 <code>architecture.md</code>에 저장했습니다.
          </p>

          <h3>확인된 기술부채</h3>
          {architectureReport.findings.length === 0 && <p className="muted">근거가 있는 기술부채를 찾지 못했습니다.</p>}
          {architectureReport.findings.map((finding, index) => (
            <div className="result warning" key={`${finding.title}-${index}`}>
              <h4>
                {finding.title} · {ARCHITECTURE_CATEGORY_LABEL[finding.category]} ·{" "}
                {finding.severity === "high" ? "높음" : finding.severity === "medium" ? "중간" : "낮음"}
              </h4>
              <p>{finding.explanation}</p>
              <p>
                <strong>영향:</strong> {finding.impact}
              </p>
              <p>
                <strong>다음 행동:</strong> {finding.suggestion}
              </p>
              {finding.designIds.length > 0 && <p className="muted">관련 설계: {finding.designIds.join(", ")}</p>}
              <p className="muted">파일: {finding.files.join(", ")}</p>
              <ul>
                {finding.evidence.map((evidence, evidenceIndex) => (
                  <li key={`${evidence}-${evidenceIndex}`}>{evidence}</li>
                ))}
              </ul>
              {finding.resolutionPrompt && (
                <button
                  className="link"
                  onClick={() => void navigator.clipboard.writeText(finding.resolutionPrompt ?? "")}
                >
                  해소 프롬프트 복사
                </button>
              )}
            </div>
          ))}

          {architectureReport.limitations.length > 0 && (
            <>
              <h3>분석 한계</h3>
              <ul>
                {architectureReport.limitations.map((limitation, index) => (
                  <li key={`${limitation}-${index}`}>{limitation}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {(keywords || wikiPage) && (
        <section className="panel">
          <h2>위키</h2>
          {keywords && keywords.length === 0 && <p className="muted">설명할 만한 말이 없었습니다.</p>}
          {keywords && keywords.length > 0 && (
            <>
              <p className="muted">어떤 개념을 알고 싶으신가요?</p>
              <div className="row">
                {keywords.map((keyword) => (
                  <button
                    key={keyword.term}
                    className="secondary"
                    disabled={running}
                    title={`${keyword.why}\n\n"${keyword.sample}"`}
                    onClick={() => void writeWiki(keyword.term)}
                  >
                    {keyword.term} <span className="muted">×{keyword.count}</span>
                    {wikiDone.includes(keyword.term) ? " ✓" : ""}
                  </button>
                ))}
              </div>
            </>
          )}
          {wikiPage && (
            <div>
              <h3>{wikiPage.term}</h3>
              <p>{wikiPage.oneLine}</p>
              <p>{wikiPage.inThisProject}</p>
              {/* 근거가 비면 일반론이라는 뜻이다. 그 사실을 감추지 않는다. */}
              {wikiPage.where.length > 0 ? (
                <p className="muted">이 프로젝트에서: {wikiPage.where.join(", ")}</p>
              ) : (
                <p className="muted">이 프로젝트 안에서 근거를 찾지 못했습니다.</p>
              )}
              {wikiPage.related.length > 0 && <p className="muted">함께 보기: {wikiPage.related.join(", ")}</p>}
            </div>
          )}
        </section>
      )}

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

/** provider가 기본으로 고르는 모델 이름을 "기본값" 옵션에 덧붙인다. */
function defaultLabel(models: ModelOption[]): string {
  const fallback = models.find((entry) => entry.isDefault);
  return fallback ? ` — ${fallback.label}` : "";
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
