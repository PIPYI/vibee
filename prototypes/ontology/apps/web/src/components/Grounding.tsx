/**
 * Grounding을 항상 만질 수 있게 한다 (§6.10).
 *
 * 모든 label이 자기 evidenceRefs를 들고 있고, hover하면 file:line, 클릭하면 소스 발췌가
 * 열린다. **그 위치와 발췌는 View IR에 굳어 있지 않고 렌더 시점에 Evidence Store에서
 * resolve된다** — 코드가 옮겨져도 View를 다시 만들지 않는다.
 */
import { useEffect, useState } from "react";

import { isUnavailable, queryEvidence, type EvidenceView } from "../api.js";

const CONTENT_CHANGE_LABEL: Record<string, string> = {
  modified: "이 근거의 코드가 수정되었습니다",
  appeared: "새로 나타난 근거입니다",
  missing: "이 근거를 잃었습니다",
  cosmetic: "포매팅만 바뀌었습니다",
  unchanged: "바뀌지 않았습니다",
};

function EvidenceBadges({ item }: { item: EvidenceView }): React.JSX.Element {
  return (
    <span className="ev-badges">
      {item.origin === "agent" && <span className="badge badge-agent" title="엔진이 아니라 agent가 주장한 근거입니다">agent</span>}
      {item.status === "missing" && (
        <span className="badge badge-warn" title={`analysisVersion ${item.missingSinceVersion ?? "?"} 부터 사라졌습니다`}>
          missing
        </span>
      )}
      {item.relocationConfidence === "degraded" && (
        <span className="badge badge-warn" title="코드가 바뀌어 위치를 추정했습니다">위치 추정</span>
      )}
      {item.relocated === true && <span className="badge badge-info" title="이 근거의 코드가 옮겨졌습니다">이동됨</span>}
      {item.contentChange && item.contentChange !== "unchanged" && item.contentChange !== "cosmetic" && (
        <span className="badge badge-info" title={CONTENT_CHANGE_LABEL[item.contentChange]}>
          {item.contentChange === "modified" ? "수정됨" : item.contentChange === "appeared" ? "새 근거" : item.contentChange}
        </span>
      )}
      {item.confidence !== undefined && item.confidence < 0.6 && (
        <span className="badge badge-dim" title={`confidence ${item.confidence.toFixed(2)} — 낮음`}>?</span>
      )}
    </span>
  );
}

function EvidenceRow({ item }: { item: EvidenceView }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const location = item.location ? `${item.location.startLine}${item.location.endLine && item.location.endLine !== item.location.startLine ? `-${item.location.endLine}` : ""}` : undefined;

  return (
    <div className={`evidence-row ${item.status === "missing" ? "evidence-missing" : ""}`}>
      <button
        type="button"
        className="evidence-row-header"
        onClick={() => setOpen((prev) => !prev)}
        title={item.filePath ? `${item.filePath}${location ? `:${location}` : ""}` : item.kind}
      >
        <span className="evidence-kind">{item.kind}</span>
        <span className="evidence-path">
          {item.filePath ?? item.symbolId ?? "(파일 없음)"}
          {location ? `:${location}` : ""}
        </span>
        <EvidenceBadges item={item} />
      </button>
      {open && (
        <div className="evidence-detail">
          {item.summary && <p className="evidence-summary">{item.summary}</p>}
          {item.source ? (
            <pre className="evidence-source">{item.source}</pre>
          ) : item.sourceError ? (
            <p className="evidence-error">소스를 읽지 못했습니다: {item.sourceError}</p>
          ) : (
            <p className="evidence-error">이 근거에는 소스 위치가 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** evidenceRefs 목록을 받아 렌더 시점에 resolve해 보여준다. */
export function EvidenceList({ ids }: { ids: readonly string[] }): React.JSX.Element | null {
  const [items, setItems] = useState<EvidenceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void queryEvidence({ ids: [...ids], includeSource: true }).then((result) => {
      if (cancelled) return;
      if (isUnavailable(result)) {
        setError(result.next_step);
        return;
      }
      // 요청한 순서를 유지한다 — id 정렬 순서가 아니라 view가 의도한 순서다.
      const byId = new Map(result.evidence.map((item) => [item.id, item] as const));
      setItems(ids.map((id) => byId.get(id)).filter((item): item is EvidenceView => Boolean(item)));
    });
    return () => {
      cancelled = true;
    };
  }, [ids.join(",")]);

  if (ids.length === 0) return null;
  if (error) return <p className="evidence-error">{error}</p>;
  if (!items) return <p className="evidence-loading">근거를 불러오는 중…</p>;

  return (
    <div className="evidence-list">
      {items.map((item) => (
        <EvidenceRow key={item.id} item={item} />
      ))}
    </div>
  );
}
