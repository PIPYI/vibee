/**
 * 분석 중 실시간 상황판 (schema3 §2.2~§2.3) — Phase Stepper(기본 노출) + Diagnostics
 * Drawer(기본 접힘). `RuntimeConsole.tsx`의 이벤트 서술(`describeEvent`)과 같은 재료를
 * 쓰지만, 최상위 tablist 대신 이 자리로 이식했다(§2.3 — I17을 다시 열되 "화면을 언제나
 * 공유하지 않는다"는 경계는 지킨다: Analyzing 동안은 애초에 제품 캔버스가 없고, Analyzed
 * 이후에는 접힌 보조 패널일 뿐 아키텍처/워크플로우 노드와 섞이지 않는다).
 */
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

export type LogLine = { seq: number; text: string; tone: "info" | "good" | "bad" | "mcp" };

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
