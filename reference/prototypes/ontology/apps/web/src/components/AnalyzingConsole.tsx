/**
 * 분석 중 실시간 상황판 (schema3 §2.2~§2.3) — Phase Stepper(기본 노출) + Diagnostics
 * Drawer(기본 접힘). `RuntimeConsole.tsx`의 이벤트 서술(`describeEvent`)과 같은 재료를
 * 쓰지만, 최상위 tablist 대신 이 자리로 이식했다(§2.3 — I17을 다시 열되 "화면을 언제나
 * 공유하지 않는다"는 경계는 지킨다: Analyzing 동안은 애초에 제품 캔버스가 없고, Analyzed
 * 이후에는 접힌 보조 패널일 뿐 아키텍처/워크플로우 노드와 섞이지 않는다).
 */
import type { AnalysisPipelineStage, AnalysisStageState } from "@onto/protocol";

export type PipelinePhase = "indexing" | "semantic-memory" | "assembly" | "done";

const PHASE_ORDER: PipelinePhase[] = ["indexing", "semantic-memory", "assembly", "done"];
const PHASE_LABEL: Record<PipelinePhase, string> = {
  indexing: "인덱싱",
  "semantic-memory": "의미 이해",
  assembly: "아키텍처 · 워크플로우 · 시퀀스 조립",
  done: "완료",
};

export function PhaseStepper({ phase, failed }: { phase: PipelinePhase; failed?: boolean }): React.JSX.Element {
  const currentIndex = PHASE_ORDER.indexOf(phase);
  return (
    <ol className="phase-stepper">
      {PHASE_ORDER.map((key, index) => {
        const state =
          failed && index === currentIndex
            ? "failed"
            : index < currentIndex
              ? "done"
              : index === currentIndex
                ? "active"
                : "pending";
        return (
          <li key={key} className={`phase-step phase-step-${state}`}>
            {PHASE_LABEL[key]}
          </li>
        );
      })}
    </ol>
  );
}

export const STAGE_LABEL: Record<AnalysisPipelineStage, string> = {
  indexing: "근거 인덱싱",
  semantic: "의미 이해",
  retrieval: "조립 근거 준비",
  assembly: "지도 조립",
  validation: "계약 검증",
  commit: "결과 저장",
};

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}분 ${remainder}초` : `${minutes}분`;
}

function elapsedSince(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 1_000)) : undefined;
}

function currentStage(states: readonly AnalysisStageState[]): AnalysisStageState | undefined {
  return [...states].reverse().find((state) => state.status === "running" || state.status === "correcting");
}

export function AnalysisRunHeader({
  projectPath,
  provider,
  model,
  states,
  now,
  onStop,
}: {
  projectPath: string | null;
  provider: string;
  model?: string;
  states: AnalysisStageState[];
  now: number;
  onStop?: () => void;
}): React.JSX.Element {
  const active = currentStage(states);
  const elapsed = elapsedSince(active?.startedAt, now) ?? elapsedSince(states[0]?.startedAt, now);
  const projectName = projectPath?.split(/[\\/]/u).filter(Boolean).at(-1) ?? "프로젝트";
  return (
    <header className="analysis-run-header" aria-label="현재 분석 실행">
      <div className="analysis-run-primary">
        <p className="detail-eyebrow">분석 실행 중</p>
        <strong title={projectPath ?? undefined}>{projectName}</strong>
      </div>
      <dl className="analysis-run-meta">
        <div><dt>에이전트</dt><dd>{provider}{model ? ` · ${model}` : ""}</dd></div>
        <div><dt>경과</dt><dd>{elapsed !== undefined ? formatDuration(elapsed) : "시작 준비 중"}</dd></div>
        <div><dt>현재 단계</dt><dd>{active ? STAGE_LABEL[active.stage] : "완료 처리 중"}</dd></div>
      </dl>
      {onStop && <button type="button" className="analysis-stop-button" onClick={onStop}>중지</button>}
    </header>
  );
}

export function StageLedger({
  states,
  heartbeat,
  now = Date.now(),
}: {
  states: AnalysisStageState[];
  heartbeat: { stage: AnalysisPipelineStage; elapsedSeconds: number; idleSeconds: number } | null;
  /** heartbeat 15초 사이를 브라우저 1초 tick으로 보간한다. */
  now?: number;
}): React.JSX.Element {
  const active = currentStage(states);
  const activeHeartbeat = active && heartbeat?.stage === active.stage ? heartbeat : null;
  const elapsed = elapsedSince(active?.startedAt, now) ?? activeHeartbeat?.elapsedSeconds;
  const idle = elapsedSince(active?.lastActivityAt ?? active?.startedAt, now) ?? activeHeartbeat?.idleSeconds;
  const dotState = active ? "running" : states.some((state) => state.status === "failed") ? "failed" : "idle";
  return (
    <section className="stage-ledger" aria-label="분석 단계별 진행 상태">
      <div className="stage-ledger-head">
        <div>
          <span className={`stage-live-dot stage-live-dot-${dotState}`} aria-hidden="true" />
          <strong>{active ? STAGE_LABEL[active.stage] : "분석 상태"}</strong>
        </div>
        {elapsed !== undefined && <span>{formatDuration(elapsed)} 경과</span>}
      </div>
      <p className="stage-current-message">
        {active?.message ?? states.find((state) => state.status === "failed")?.message ?? "분석 준비 중"}
      </p>
      {idle !== undefined && active && (
        <p className="stage-activity">
          {idle >= 90
            ? `모델 응답을 기다리는 중 · 마지막 활동 ${formatDuration(idle)} 전`
            : `작업이 계속 진행 중 · 마지막 활동 ${formatDuration(idle)} 전`}
        </p>
      )}
      <ol className="stage-ledger-list">
        {states.map((state) => (
          <li key={state.stage} className={`stage-ledger-${state.status}`}>
            <div>
              <span>{STAGE_LABEL[state.stage]}</span>
              <b>{
                state.status === "pending" ? "대기" :
                state.status === "running" ? "진행 중" :
                state.status === "correcting" ? "자동 보정" :
                state.status === "completed" ? "완료" : "실패"
              }</b>
            </div>
            {state.totalUnits !== undefined && (
              <div className="stage-progress" aria-label={`${STAGE_LABEL[state.stage]} ${state.completedUnits ?? 0}/${state.totalUnits}`}>
                <i style={{ width: `${Math.min(100, Math.max(0, ((state.completedUnits ?? 0) / Math.max(1, state.totalUnits)) * 100))}%` }} />
                <small>{state.completedUnits ?? 0}/{state.totalUnits}</small>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export type LogLine = { seq: number; text: string; tone: "info" | "good" | "bad" | "mcp" | "activity" };

/** 분석 중에는 raw 로그 대신 실제 활동과 모델 출력 두 흐름을 기본 노출한다. */
export function LiveActivity({
  lines,
  modelOutput,
}: {
  lines: LogLine[];
  modelOutput: string;
}): React.JSX.Element {
  const activities = lines.slice(-24);
  return (
    <section className="analysis-live" aria-label="실시간 분석 활동">
      <div className="analysis-live-track">
        <header><p className="detail-eyebrow">활동</p><strong>도구와 파일 탐색</strong></header>
        <ol>
          {activities.length === 0 && <li className="dim">아직 수신한 활동이 없습니다.</li>}
          {activities.map((line) => <li key={line.seq} className={`log-${line.tone}`}>{line.text}</li>)}
        </ol>
      </div>
      <div className="analysis-live-track analysis-live-model">
        <header><p className="detail-eyebrow">모델 출력</p><strong>진행 중인 응답</strong></header>
        <pre>{modelOutput || "모델 응답을 기다리는 중입니다…"}</pre>
      </div>
    </section>
  );
}

export function DiagnosticsDrawer({
  open,
  onToggle,
  lines,
}: {
  open: boolean;
  onToggle: () => void;
  lines: LogLine[];
}): React.JSX.Element {
  return (
    <div className="diagnostics-drawer">
      <button type="button" className="diagnostics-drawer-toggle" onClick={onToggle}>
        {open ? "진단 정보 숨기기 ▲" : "진단 정보 보기 ▼ — 이 분석이 무엇을 봤는지"}
      </button>
      {open && (
        <div className="diagnostics-drawer-body">
          {lines.length === 0 && <p className="dim">아직 이벤트가 없습니다.</p>}
          {lines.slice(-150).map((line) => (
            <div key={line.seq} className={`log-line log-${line.tone}`}>
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
