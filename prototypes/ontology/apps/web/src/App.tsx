/**
 * 셸 — 프로젝트 선택, agent 실행, WS 로그, 그리고 Progressive Disclosure의 네비게이션
 * (§41: Overview item → Scenario / Scenario step → StepDetail → "실제 코드 보기" → Trace).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentId, OverviewIR, ScenarioIR, ScenarioStep, TraceIR, ViewAnchor } from "@onto/protocol";

import * as api from "./api.js";
import { EvidenceExplorer } from "./components/EvidenceExplorer.js";
import { OverviewView, type OverviewItemSelection } from "./components/OverviewView.js";
import { ScenarioView } from "./components/ScenarioView.js";
import { StepDetail } from "./components/StepDetail.js";
import { TraceView } from "./components/TraceView.js";
import { useAgentEvents } from "./ws.js";

type Panel = "explorer" | "overview" | "scenario" | "trace";
type LogLine = { seq: number; text: string; tone: "info" | "good" | "bad" | "mcp" };

function short(id: string): string {
  return id.slice(0, 8);
}

export function App(): React.JSX.Element {
  const [agents, setAgents] = useState<api.AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");

  const [projectPathInput, setProjectPathInput] = useState("");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [memory, setMemory] = useState<api.FullMemory | null>(null);

  const [panel, setPanel] = useState<Panel>("explorer");
  const [overview, setOverview] = useState<OverviewIR | null>(null);
  const [scenario, setScenario] = useState<ScenarioIR | null>(null);
  const [trace, setTrace] = useState<TraceIR | null>(null);
  const [crumbs, setCrumbs] = useState<Array<{ label: string; panel: Panel }>>([]);
  const [selectedStep, setSelectedStep] = useState<ScenarioStep | null>(null);

  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);

  useEffect(() => {
    void api.health().then((h) => setAgents(h.agents));
    void api.bridgeState().then((s) => {
      if (s.projectPath) {
        setProjectPath(s.projectPath);
        setProjectPathInput(s.projectPath);
      }
    });
  }, []);

  const refreshMemory = useCallback(async () => {
    const result = await api.fullMemory();
    if (!api.isUnavailable(result)) setMemory(result);
    else setMemory(null);
    return result;
  }, []);

  const conceptNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const concept of memory?.memory.concepts ?? []) map.set(concept.id, concept.name);
    return map;
  }, [memory]);
  const claimById = useMemo(() => {
    const map = new Map<string, string>();
    for (const claim of memory?.memory.claims ?? []) map.set(claim.id, claim.predicate);
    return map;
  }, [memory]);
  const resolveConceptName = useCallback((id: string) => conceptNameById.get(id) ?? id, [conceptNameById]);
  const resolveClaimPredicate = useCallback((id: string) => claimById.get(id), [claimById]);

  const stream = useAgentEvents((event, envelope) => {
    const push = (text: string, tone: LogLine["tone"] = "info") =>
      setLines((prev) => (prev.some((line) => line.seq === envelope.seq) ? prev : [...prev, { seq: envelope.seq, text, tone }]));

    switch (event.type) {
      case "task.started":
        setRunning(true);
        push(`turn 시작 — ${event.mode}`, "good");
        break;
      case "analysis.progress":
        push(event.message);
        break;
      case "agent.action.started":
        push(`▶ ${event.name}`);
        break;
      case "mcp.tool.called":
        push(`MCP ${event.tool} [${event.source}]`, "mcp");
        break;
      case "memory.patched":
        push(`Semantic Memory 갱신 — ${event.summary}`, "good");
        break;
      case "view.ready":
        push(`View 완료 — ${event.viewKind}`, "good");
        break;
      case "validation.failed":
        push(`검증 실패 — ${event.tool}`, "bad");
        break;
      case "task.completed":
        setRunning(false);
        push("turn 완료", "good");
        break;
      case "task.interrupted":
        setRunning(false);
        push("turn 중단됨", "bad");
        break;
      case "task.error":
        setRunning(false);
        push(`turn 오류 — ${event.message}`, "bad");
        break;
      default:
        break;
    }
  });

  const selectProject = useCallback(async () => {
    setProjectError(null);
    const selected = await api.selectProject(projectPathInput.trim());
    if ("error" in selected) {
      setProjectError(selected.error);
      return;
    }
    setProjectPath(selected.projectPath);
    setOverview(null);
    setScenario(null);
    setTrace(null);
    setCrumbs([]);

    // Trace는 인덱싱만으로 바로 보인다 (§6.6) — agent turn을 기다리지 않는다.
    const indexed = await api.indexOnly(selected.projectPath);
    if ("error" in indexed) {
      setProjectError(indexed.error);
      return;
    }
    const loaded = await refreshMemory();
    if (!api.isUnavailable(loaded) && loaded.memory.concepts.length > 0) {
      setPanel("overview");
      void loadOverview(selected.projectPath);
    } else {
      setPanel("explorer");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPathInput, refreshMemory]);

  const loadOverview = useCallback(
    async (path = projectPath) => {
      if (!path) return;
      setViewLoading(true);
      setViewError(null);
      const result = await api.requestView({ viewKind: "overview", agent, projectPath: path });
      await resolveViewResult(result, (ir) => {
        setOverview(ir as OverviewIR);
        setPanel("overview");
        setCrumbs([{ label: "Overview", panel: "overview" }]);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [agent, projectPath],
  );

  const loadScenario = useCallback(
    async (anchor: ViewAnchor, label: string) => {
      if (!projectPath) return;
      setViewLoading(true);
      setViewError(null);
      const result = await api.requestView({ viewKind: "scenario", anchor, agent, projectPath });
      await resolveViewResult(result, (ir) => {
        setScenario(ir as ScenarioIR);
        setSelectedStep(null);
        setPanel("scenario");
        setCrumbs((prev) => [...prev.slice(0, 1), { label, panel: "scenario" }]);
      });
    },
    [agent, projectPath],
  );

  const loadTrace = useCallback(
    async (anchor: ViewAnchor, label: string, fromScenario: boolean) => {
      if (!projectPath) return;
      setViewLoading(true);
      setViewError(null);
      const result = await api.requestView({ viewKind: "trace", anchor, projectPath });
      setViewLoading(false);
      if ("error" in result) {
        setViewError(result.error);
        return;
      }
      if (result.viewKind === "trace") {
        setTrace(result.ir);
        setPanel("trace");
        setCrumbs((prev) => [...(fromScenario ? prev : prev.slice(0, 1)), { label, panel: "trace" }]);
      }
    },
    [projectPath],
  );

  /** overview/scenario 공통 — 캐시면 즉시, turn이면 완료까지 기다린다. */
  async function resolveViewResult(
    result: api.ViewsPostResponse,
    onReady: (ir: OverviewIR | ScenarioIR) => void,
  ): Promise<void> {
    if ("error" in result) {
      setViewLoading(false);
      setViewError(result.error);
      return;
    }
    if (result.viewKind === "trace") {
      setViewLoading(false);
      return;
    }
    if ("cached" in result) {
      setViewLoading(false);
      onReady(result.view.ir);
      return;
    }
    setTaskId(result.taskId);
    const final = await api.pollView(result.taskId);
    setViewLoading(false);
    if ("view" in final) {
      onReady(final.view.ir);
    } else if ("error" in final) {
      setViewError(final.error);
    } else {
      setViewError(`turn이 ${final.status} 상태로 끝났습니다.`);
    }
  }

  const runAnalyze = useCallback(async () => {
    if (!projectPath) return;
    setLines([]);
    const result = await api.analyze(agent, projectPath);
    if ("error" in result) {
      setViewError(result.error);
      return;
    }
    setTaskId(result.taskId);
    setRunning(true);
  }, [agent, projectPath]);

  // analyze turn이 끝나면 memory를 다시 읽고 Overview를 새로 청한다.
  useEffect(() => {
    if (running || !taskId) return;
    void (async () => {
      const loaded = await refreshMemory();
      if (!api.isUnavailable(loaded) && loaded.memory.concepts.length > 0 && panel === "explorer") {
        void loadOverview();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const onSelectOverviewItem = useCallback(
    (item: OverviewItemSelection) => {
      // 이 item이 conceptRefs 없이 scenarioRefs만 가리키는 경우가 실제로 있다 — agent가
      // "여기서 시나리오를 보라"는 뜻으로 scenarioRefs만 채우고 자기 conceptRefs는
      // 비워 두는 것도 유효한 OverviewIR이다(schema가 허용한다). 그럴 때는 이미 읽어 둔
      // CanonicalScenarioEntry.anchorConceptIds에서 anchor를 빌려 쓴다 — scenario id 자체는
      // ViewAnchor로 못 쓴다(get_scenario_context가 Concept anchor만 받는다).
      const scenarioId = item.scenarioRefs[0];
      const scenario = scenarioId ? memory?.memory.canonicalScenarios.find((s) => s.id === scenarioId) : undefined;
      const conceptId = item.conceptRefs[0] ?? scenario?.anchorConceptIds[0];
      if (!conceptId) return;
      void loadScenario({ kind: "concept", conceptId }, item.label);
    },
    [loadScenario, memory],
  );

  const onSelectStep = useCallback((step: ScenarioStep) => {
    setSelectedStep(step);
  }, []);

  const onViewTraceFromStep = useCallback(async () => {
    if (!selectedStep) return;
    const conceptId = selectedStep.conceptRefs[0];
    if (conceptId) {
      await loadTrace({ kind: "concept", conceptId }, `Trace: ${selectedStep.label}`, true);
      return;
    }
    // Concept가 없으면 evidence에서 symbol/file을 뽑아 anchor로 쓴다.
    const firstEvidenceId = selectedStep.evidenceRefs[0];
    if (!firstEvidenceId) return;
    const evidence = await api.queryEvidence({ ids: [firstEvidenceId] });
    if (api.isUnavailable(evidence) || evidence.evidence.length === 0) return;
    const item = evidence.evidence[0]!;
    if (item.symbolId) await loadTrace({ kind: "symbol", symbolId: item.symbolId }, `Trace: ${selectedStep.label}`, true);
    else if (item.filePath) await loadTrace({ kind: "file", filePath: item.filePath }, `Trace: ${selectedStep.label}`, true);
  }, [selectedStep, loadTrace]);

  const goToCrumb = (index: number): void => {
    const crumb = crumbs[index];
    if (!crumb) return;
    setCrumbs((prev) => prev.slice(0, index + 1));
    setPanel(crumb.panel);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>onto</h1>
        <span className={`stream-dot stream-${stream}`} title={`이벤트 스트림: ${stream}`} />
      </header>

      <div className="app-toolbar">
        <input
          className="project-input"
          placeholder="프로젝트 경로 (예: tmp/fixture)"
          value={projectPathInput}
          onChange={(e) => setProjectPathInput(e.target.value)}
        />
        <button type="button" onClick={() => void selectProject()} disabled={!projectPathInput.trim()}>
          프로젝트 열기
        </button>
        <select value={agent} onChange={(e) => setAgent(e.target.value as AgentId)}>
          {agents.map((item) => (
            <option key={item.agent} value={item.agent} disabled={!item.installed}>
              {item.agent}
              {!item.installed ? " (설치 안 됨)" : ""}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void runAnalyze()} disabled={!projectPath || running}>
          {running ? "실행 중…" : "Analyze"}
        </button>
        {running && taskId && (
          <button type="button" onClick={() => void api.stopTask(taskId)}>
            중지
          </button>
        )}
      </div>

      {projectError && <p className="error-banner">{projectError}</p>}

      {crumbs.length > 0 && (
        <nav className="breadcrumb">
          {crumbs.map((crumb, index) => (
            <span key={index}>
              {index > 0 && " › "}
              <button type="button" onClick={() => goToCrumb(index)}>
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      <main className="app-main">
        <section className="view-pane">
          {!projectPath && <p className="dim">프로젝트를 먼저 열어 주세요.</p>}
          {projectPath && viewLoading && <p className="dim">View를 만드는 중…</p>}
          {viewError && <p className="error-banner">{viewError}</p>}

          {projectPath && !viewLoading && panel === "explorer" && (
            <EvidenceExplorer
              onSelectFile={(filePath) => void loadTrace({ kind: "file", filePath }, filePath, false)}
              onSelectSymbol={(symbolId) => void loadTrace({ kind: "symbol", symbolId }, symbolId, false)}
            />
          )}
          {!viewLoading && panel === "overview" && overview && (
            <OverviewView ir={overview} onSelectItem={onSelectOverviewItem} />
          )}
          {!viewLoading && panel === "scenario" && scenario && (
            <ScenarioView ir={scenario} onSelectStep={onSelectStep} resolveConceptName={resolveConceptName} />
          )}
          {!viewLoading && panel === "trace" && trace && <TraceView ir={trace} />}
        </section>

        {selectedStep && scenario && (
          <StepDetail
            step={selectedStep}
            ir={scenario}
            resolveConceptName={resolveConceptName}
            resolveClaimPredicate={resolveClaimPredicate}
            onViewTrace={() => void onViewTraceFromStep()}
            onClose={() => setSelectedStep(null)}
          />
        )}
      </main>

      <footer className="app-log">
        {lines.slice(-8).map((line) => (
          <div key={line.seq} className={`log-line log-${line.tone}`}>
            {line.text}
          </div>
        ))}
        {taskId && <div className="log-line dim">task {short(taskId)}</div>}
      </footer>
    </div>
  );
}
