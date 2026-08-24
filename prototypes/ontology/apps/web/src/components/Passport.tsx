/**
 * Passport — schema3 §7. 아키텍처/워크플로우 블록을 클릭하면 열리는 우측 패널.
 *
 * 데이터 소스는 전부 §7 표대로다: 설명은 `description`, in/out은 `inputs`/`outputs`
 * (+ "더보기"로 `projectReachability`를 그 자리에서 호출), 연관 코드 파일은
 * `evidenceRefs`를 `EvidenceList`(Grounding.tsx)로 렌더 시점에 resolve, 관계 목록은
 * from/to로 필터한 connection/edge다. `WorkflowEdge` 행은 라벨 클릭 시 같은 패널 자리에서
 * Sequence 렌더러로 전환한다(`onOpenSequence`, §3.4).
 */
import { useState } from "react";

import type { ComponentIO, EntityRef, ViewAnchor } from "@onto/protocol";

import { requestView } from "../api.js";
import { EvidenceList } from "./Grounding.js";

/**
 * `ViewAnchor`는 `EntityRef`보다 좁다 — route/model entity는 anchor로 쓸 수 없다
 * (`ViewAnchor`가 concept/scenario/symbol/file/intent만 지원한다). 그런 IO는 drill-down을
 * 제공하지 않는다.
 */
function toViewAnchor(ref: EntityRef): ViewAnchor | null {
  if (ref.kind === "symbol") return { kind: "symbol", symbolId: ref.symbolId };
  if (ref.kind === "file") return { kind: "file", filePath: ref.filePath };
  return null;
}

export type PassportSubject = {
  id: string;
  label: string;
  sublabel?: string;
  presentationType: string;
  description?: string;
  inputs?: ComponentIO[];
  outputs?: ComponentIO[];
  entityRefs: string[];
  evidenceRefs: string[];
  conceptRefs?: string[];
};

export type PassportRelationship = {
  id: string;
  label?: string;
  direction: "in" | "out";
  counterpartId: string;
  counterpartLabel: string;
  /** WorkflowEdge에서만 — 있으면 라벨 클릭으로 시퀀스를 연다 */
  sequenceRef?: string;
};

function ReachabilityDrilldown({
  anchor,
  direction,
  projectPath,
}: {
  anchor: ViewAnchor;
  direction: "upstream" | "downstream";
  projectPath: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (labels !== null || loading) return;
    setLoading(true);
    void requestView({ viewKind: "reachability", anchor, reachDirection: direction, projectPath }).then((result) => {
      setLoading(false);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.viewKind !== "reachability") return;
      setLabels(result.ir.nodes.filter((node) => node.hop > 0).map((node) => node.label));
    });
  };

  return (
    <div className="passport-io-drilldown">
      <button type="button" className="passport-io-more" onClick={toggle}>
        {open ? "접기" : "더보기"} ({direction === "upstream" ? "무엇이 여기로 이어지는가" : "여기서 무엇으로 이어지는가"})
      </button>
      {open && (
        <div className="passport-io-result">
          {loading && <p className="dim">불러오는 중…</p>}
          {error && <p className="evidence-error">{error}</p>}
          {labels && labels.length === 0 && <p className="dim">인덱싱된 관계로 닿는 곳이 없습니다.</p>}
          {labels && labels.length > 0 && (
            <ul className="chip-list">
              {labels.slice(0, 12).map((label, index) => (
                <li key={index} className="chip">
                  {label}
                </li>
              ))}
              {labels.length > 12 && <li className="dim">… 외 {labels.length - 12}개</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function IORow({ io, projectPath }: { io: ComponentIO; projectPath: string }): React.JSX.Element {
  return (
    <li className="passport-io-row">
      <span className={`passport-io-kind passport-io-kind-${io.kind}`}>{io.kind}</span>
      <span>{io.label}</span>
      {io.description && <span className="dim"> — {io.description}</span>}
      {io.entityRef &&
        (() => {
          const anchor = toViewAnchor(io.entityRef);
          return anchor ? (
            <ReachabilityDrilldown anchor={anchor} direction={io.direction === "in" ? "upstream" : "downstream"} projectPath={projectPath} />
          ) : null;
        })()}
    </li>
  );
}

export function Passport({
  subject,
  relationships,
  projectPath,
  onClose,
  onSelectRelated,
  onOpenSequence,
}: {
  subject: PassportSubject;
  relationships: PassportRelationship[];
  projectPath: string;
  onClose: () => void;
  onSelectRelated: (id: string) => void;
  onOpenSequence: (sequenceRef: string) => void;
}): React.JSX.Element {
  return (
    <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="detail-modal passport-modal" role="dialog" aria-modal="true" aria-label={`${subject.label} 상세`}>
        <div className="detail-context-pane passport-context-pane">
          <p className="detail-eyebrow">연결된 부분만 보기</p>
          <div className="passport-context-map">
            <div className={`passport-context-subject passport-context-${subject.presentationType}`}>
              <span className={`pt-dot pt-${subject.presentationType}`} />
              <strong>{subject.label}</strong>
              {subject.sublabel && <small>{subject.sublabel}</small>}
            </div>
            <div className="passport-context-relations">
              {relationships.slice(0, 6).map((rel) => (
                <button type="button" key={rel.id} onClick={() => onSelectRelated(rel.counterpartId)}>
                  <span>{rel.direction === "in" ? "←" : "→"}</span>
                  <span><strong>{rel.counterpartLabel}</strong>{rel.label && <small>{rel.label}</small>}</span>
                </button>
              ))}
              {relationships.length === 0 && <p className="dim">직접 연결된 관계가 없습니다.</p>}
              {relationships.length > 6 && <p className="dim">그 외 {relationships.length - 6}개 관계</p>}
            </div>
          </div>
        </div>

        <div className="detail-info-pane passport-info-pane">
          <div className="step-detail-header">
            <div>
              <p className="detail-eyebrow">{subject.presentationType}</p>
              <h3><span className={`pt-dot pt-${subject.presentationType}`} /> {subject.label}</h3>
            </div>
            <button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button>
          </div>
          {subject.sublabel && <p className="dim passport-subtitle">{subject.sublabel}</p>}

          {subject.description && (
            <section>
              <h4>설명</h4>
              <p>{subject.description}</p>
            </section>
          )}

          {((subject.inputs?.length ?? 0) > 0 || (subject.outputs?.length ?? 0) > 0) && (
            <section>
          <h4>in / out</h4>
          {(subject.inputs?.length ?? 0) > 0 && (
            <>
              <p className="dim passport-io-label">in</p>
              <ul className="passport-io-list">
                {subject.inputs!.map((io, index) => (
                  <IORow key={index} io={io} projectPath={projectPath} />
                ))}
              </ul>
            </>
          )}
          {(subject.outputs?.length ?? 0) > 0 && (
            <>
              <p className="dim passport-io-label">out</p>
              <ul className="passport-io-list">
                {subject.outputs!.map((io, index) => (
                  <IORow key={index} io={io} projectPath={projectPath} />
                ))}
              </ul>
            </>
          )}
            </section>
          )}

          {relationships.length > 0 && (
            <section>
          <h4>관계</h4>
          <ul className="passport-relationship-list">
            {relationships.map((rel) => (
              <li key={rel.id}>
                <button type="button" className="passport-relationship" onClick={() => onSelectRelated(rel.counterpartId)}>
                  <span className="dim">{rel.direction === "in" ? "←" : "→"}</span> {rel.counterpartLabel}
                  {rel.label && <span className="dim"> · {rel.label}</span>}
                </button>
                {rel.sequenceRef && (
                  <button type="button" className="passport-sequence-open" onClick={() => onOpenSequence(rel.sequenceRef!)}>
                    시퀀스 보기 ▶
                  </button>
                )}
              </li>
            ))}
          </ul>
            </section>
          )}

          <section>
            <h4>연관된 코드 파일</h4>
            <EvidenceList ids={subject.evidenceRefs} />
          </section>
        </div>
      </aside>
    </div>
  );
}
