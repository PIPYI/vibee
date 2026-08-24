/**
 * 메인 화면 (schema3 §1~§2). 상태 전이:
 *
 * ```text
 * NoProject → (프로젝트 열기) → Indexing → Ready(분석 시작 CTA, 이미 분석된 적 있으면 바로 Analyzed)
 * Ready → (분석 시작) → Analyzing(실시간 상황판) → Analyzed(시스템 구조+사용자 여정 통합 지도)
 * Analyzed → 블록 클릭 → Passport 우측 패널 / 엣지 라벨 클릭 → 같은 자리에 Sequence
 * ```
 *
 * **탭 전환·블록 클릭·엣지 클릭은 재요청을 만들지 않는다** — 전부 이미 받아온
 * `AnalysisBundle`(§5.4)에 대한 로컬 상태 변경이다. `POST /api/analyze` 한 번만 호출한다.
 */
import { useCallback, useEffect, useState } from "react";

import type {
  AgentId,
  AnalysisBundle,
  ArchitectureComponent,
  SequenceIR,
  StageUsage,
} from "@onto/protocol";

import * as api from "./api.js";
import { DiagnosticsDrawer, PhaseStepper, type LogLine, type PipelinePhase } from "./components/AnalyzingConsole.js";
import { Passport, type PassportRelationship, type PassportSubject } from "./components/Passport.js";
import { SequenceView } from "./components/SequenceView.js";
import { UnifiedMapView } from "./components/UnifiedMapView.js";
import { useAgentEvents } from "./ws.js";

type Screen = "no-project" | "indexing" | "ready" | "analyzing" | "analyzed";
type PassportTarget = { id: string };

function short(id: string): string {
  return id.slice(0, 8);
}

function compactTokens(value: number | undefined): string {
  if (value === undefined) return "집계 대기";
  return value >= 1_000 ? `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

const STAGE_USAGE_LABEL: Record<StageUsage["stage"], string> = {
  semantic: "의미 이해",
  assembly: "지도 조립",
  view: "상세 보기",
  chat: "대화",
};

export function App(): React.JSX.Element {
  const [agents, setAgents] = useState<api.AgentReadiness[]>([]);
  const [agent, setAgent] = useState<AgentId>("codex");

  const [projectPathInput, setProjectPathInput] = useState("");
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [indexStats, setIndexStats] = useState<api.IndexResponse | null>(null);

  const [screen, setScreen] = useState<Screen>("no-project");
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>("indexing");
  const [pipelineFailed, setPipelineFailed] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const [bundle, setBundle] = useState<AnalysisBundle | null>(null);
  const [passportTarget, setPassportTarget] = useState<PassportTarget | null>(null);
  const [sequenceView, setSequenceView] = useState<SequenceIR | null>(null);
  const [stageUsages, setStageUsages] = useState<StageUsage[]>([]);

  useEffect(() => {
    void api.health().then((h) => setAgents(h.agents));
    void api.bridgeState().then((s) => {
      if (s.projectPath) {
        setProjectPath(s.projectPath);
        setProjectPathInput(s.projectPath);
        setScreen("indexing");
        void api.fetchAnalysisBundle(s.projectPath).then((result) => {
          if ("error" in result) {
            setBundle(null);
            setScreen("ready");
            return;
          }
          setBundle(result.bundle);
          setScreen("analyzed");
        });
      }
    });
  }, []);

  const push = useCallback((seq: number, text: string, tone: LogLine["tone"] = "info") => {
    setLines((prev) => (prev.some((line) => line.seq === seq) ? prev : [...prev, { seq, text, tone }]));
  }, []);

  const loadBundle = useCallback(async (path: string): Promise<boolean> => {
    const result = await api.fetchAnalysisBundle(path);
    if ("error" in result) {
      setBundle(null);
      return false;
    }
    setBundle(result.bundle);
    return true;
  }, []);

  const stream = useAgentEvents((event, envelope) => {
    switch (event.type) {
      case "task.started":
        setPipelinePhase("semantic-memory");
        push(envelope.seq, `turn 시작 — ${event.mode}`, "good");
        break;
      case "analysis.progress":
        if (event.phase === "assembly") setPipelinePhase("assembly");
        push(envelope.seq, event.message);
        break;
      case "agent.action.started":
        if (!event.name.startsWith("mcp__") && !event.name.startsWith("mcp:")) push(envelope.seq, `▶ ${event.name}`);
        break;
      case "mcp.tool.called":
        if (event.source === "bridge-endpoint") push(envelope.seq, `${event.tool} 조회 완료`, "mcp");
        break;
      case "agent.usage":
        setStageUsages((previous) => {
          const usage: StageUsage = {
            stage: event.stage,
            ...(event.turnId ? { turnId: event.turnId } : {}),
            ...(event.inputTokens !== undefined ? { inputTokens: event.inputTokens } : {}),
            ...(event.outputTokens !== undefined ? { outputTokens: event.outputTokens } : {}),
            ...(event.cacheReadTokens !== undefined ? { cacheReadTokens: event.cacheReadTokens } : {}),
            ...(event.cacheWriteTokens !== undefined ? { cacheWriteTokens: event.cacheWriteTokens } : {}),
            ...(event.totalTokens !== undefined ? { totalTokens: event.totalTokens } : {}),
            ...(event.model ? { model: event.model } : {}),
          };
          const index = previous.findIndex((item) => item.stage === usage.stage && item.turnId === usage.turnId);
          return index < 0 ? [...previous, usage] : previous.map((item, itemIndex) => itemIndex === index ? usage : item);
        });
        break;
      case "memory.patched":
        push(envelope.seq, `Semantic Memory 갱신 — ${event.summary}`, "good");
        break;
      case "bundle.ready":
        push(envelope.seq, `${event.correctedAttempts ? `${event.correctedAttempts}회 자동 보정 후 ` : ""}지도 커밋 — generation ${event.generation}`, "good");
        break;
      case "validation.retrying": {
        const diagnostic = event.diagnostics[0] as { code?: string; message?: string; reason?: string } | undefined;
        push(
          envelope.seq,
          `자동 보정 ${event.attempt}/${event.maxAttempts} · ${diagnostic?.code ?? event.tool}${diagnostic?.message || diagnostic?.reason ? ` — ${diagnostic.message ?? diagnostic.reason}` : ""}`,
          "info",
        );
        break;
      }
      case "validation.failed":
        push(envelope.seq, `검증 실패 — ${event.tool}`, "bad");
        break;
      case "task.completed":
        setPipelinePhase("done");
        push(envelope.seq, "분석 완료", "good");
        void (async () => {
          const path = projectPath;
          if (!path) return;
          const ok = await loadBundle(path);
          setScreen(ok ? "analyzed" : "ready");
          if (!ok) setAnalyzeError("분석은 끝났지만 AnalysisBundle을 읽지 못했습니다.");
        })();
        break;
      case "task.interrupted":
        setPipelineFailed(true);
        push(envelope.seq, "분석이 중단되었습니다", "bad");
        setAnalyzeError("분석이 중단되었습니다.");
        setScreen("ready");
        break;
      case "task.error":
        setPipelineFailed(true);
        push(envelope.seq, `분석 오류 — ${event.message}`, "bad");
        setAnalyzeError(event.message);
        setScreen("ready");
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const selectProject = useCallback(async () => {
    setProjectError(null);
    setAnalyzeError(null);
    const selected = await api.selectProject(projectPathInput.trim());
    if ("error" in selected) {
      setProjectError(selected.error);
      return;
    }
    setProjectPath(selected.projectPath);
    setBundle(null);
    setPassportTarget(null);
    setSequenceView(null);
    setScreen("indexing");

    const indexed = await api.indexOnly(selected.projectPath);
    if ("error" in indexed) {
      setProjectError(indexed.error);
      setScreen("no-project");
      return;
    }
    setIndexStats(indexed);

    const hasBundle = await loadBundle(selected.projectPath);
    setScreen(hasBundle ? "analyzed" : "ready");
  }, [projectPathInput, loadBundle]);

  const runAnalyze = useCallback(async () => {
    if (!projectPath) return;
    setAnalyzeError(null);
    setPipelineFailed(false);
    setPipelinePhase("indexing");
    setLines([]);
    setStageUsages([]);
    setDiagnosticsOpen(false);
    const result = await api.analyze(agent, projectPath);
    if ("error" in result) {
      setAnalyzeError(result.error);
      return;
    }
    setTaskId(result.taskId);
    setScreen("analyzing");
  }, [agent, projectPath]);

  const componentById = new Map<string, ArchitectureComponent>((bundle?.architecture.components ?? []).map((c) => [c.id, c]));

  const passportData = ((): { subject: PassportSubject; relationships: PassportRelationship[] } | null => {
    if (!passportTarget || !bundle) return null;
    const component = componentById.get(passportTarget.id);
    if (!component) return null;
    const relationships: PassportRelationship[] = bundle.architecture.connections
      .filter((connection) => connection.from === passportTarget.id || connection.to === passportTarget.id)
      .map((connection) => {
        const outgoing = connection.from === passportTarget.id;
        const counterpartId = outgoing ? connection.to : connection.from;
        return {
          id: connection.id,
          label: connection.label,
          direction: outgoing ? "out" : "in",
          counterpartId,
          counterpartLabel: componentById.get(counterpartId)?.label ?? counterpartId,
        };
      });
    return { subject: component, relationships };
  })();

  const openSequence = useCallback(
    (sequenceRef: string) => {
      const sequence = bundle?.sequences.find((s) => s.id === sequenceRef);
      if (!sequence) return;
      setSequenceView(sequence);
      setPassportTarget(null);
    },
    [bundle],
  );

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
        {(screen === "ready" || screen === "analyzed") && (
          <button type="button" onClick={() => void runAnalyze()}>
            {screen === "analyzed" ? "다시 분석" : "분석 시작"}
          </button>
        )}
        {screen === "analyzing" && taskId && (
          <button type="button" onClick={() => void api.stopTask(taskId)}>
            중지
          </button>
        )}
      </div>

      {projectError && <p className="error-banner">{projectError}</p>}

      <main className="app-main">
        {screen === "no-project" && (
          <section className="view-pane">
            <p className="dim">프로젝트를 먼저 열어 주세요.</p>
          </section>
        )}

        {screen === "indexing" && (
          <section className="view-pane">
            <p className="dim">인덱싱하는 중…</p>
          </section>
        )}

        {screen === "ready" && (
          <section className="view-pane ready-pane">
            {analyzeError && <p className="error-banner">{analyzeError}</p>}
            {indexStats && (
              <p className="dim">
                analysisVersion {indexStats.analysisVersion} · 새 근거 {indexStats.workSetSize.ungroundedAppearedEvidence}개 ·
                재검토 대상 {indexStats.workSetSize.dirtyEvidence}개
              </p>
            )}
            <button type="button" className="primary-button analyze-cta" onClick={() => void runAnalyze()}>
              {analyzeError ? "다시 시도" : "분석 시작"} →
            </button>
          </section>
        )}

        {screen === "analyzing" && (
          <section className="view-pane analyzing-pane">
            <PhaseStepper phase={pipelinePhase} failed={pipelineFailed} />
            <div className="analysis-usage" aria-label="분석 토큰 사용량">
              <strong>분석 사용량</strong>
              {(["semantic", "assembly"] as const).map((stage) => {
                const usages = stageUsages.filter((usage) => usage.stage === stage);
                const known = usages.map((usage) => usage.totalTokens).filter((value): value is number => value !== undefined);
                return <span key={stage}>{STAGE_USAGE_LABEL[stage]} <b>{compactTokens(known.length ? known.reduce((sum, value) => sum + value, 0) : undefined)}</b></span>;
              })}
              <span>총 <b>{compactTokens(stageUsages.some((usage) => usage.totalTokens !== undefined) ? stageUsages.reduce((sum, usage) => sum + (usage.totalTokens ?? 0), 0) : undefined)}</b></span>
            </div>
            <DiagnosticsDrawer open={diagnosticsOpen} onToggle={() => setDiagnosticsOpen((v) => !v)} lines={lines} />
          </section>
        )}

        {screen === "analyzed" && bundle && (
          <>
            <section className="view-pane analyzed-pane">
              {bundle.freshness === "needs_review" && (
                <p className="freshness-banner">
                  코드가 바뀌었지만 이 화면은 아직 최신이 아닙니다 — 여전히 읽을 수 있습니다. "다시 분석"으로 갱신하세요.
                </p>
              )}
              <UnifiedMapView
                bundle={bundle}
                onSelectComponent={(id) => { setSequenceView(null); setPassportTarget({ id }); }}
                onOpenSequence={(sequence) => { setPassportTarget(null); setSequenceView(sequence); }}
              />

              <DiagnosticsDrawer open={diagnosticsOpen} onToggle={() => setDiagnosticsOpen((v) => !v)} lines={lines} />
            </section>

            {sequenceView && (
              <div
                className="detail-modal-backdrop"
                role="presentation"
                onMouseDown={(event) => { if (event.target === event.currentTarget) setSequenceView(null); }}
              >
                <section className="detail-modal sequence-modal" role="dialog" aria-modal="true" aria-label={sequenceView.title}>
                  <div className="sequence-modal-head">
                    <div><p className="detail-eyebrow">통합 지도 · 코드 호출</p><h3>{sequenceView.title}</h3></div>
                    <button type="button" className="close-button" onClick={() => setSequenceView(null)} aria-label="닫기">×</button>
                  </div>
                  <SequenceView ir={sequenceView} />
                </section>
              </div>
            )}

            {!sequenceView && passportData && projectPath && (
              <Passport
                subject={passportData.subject}
                relationships={passportData.relationships}
                projectPath={projectPath}
                onClose={() => setPassportTarget(null)}
                onSelectRelated={(id) => setPassportTarget({ id })}
                onOpenSequence={openSequence}
              />
            )}
          </>
        )}
      </main>

      {taskId && <div className="app-footer dim">task {short(taskId)}</div>}
    </div>
  );
}
