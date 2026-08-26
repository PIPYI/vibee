import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  ArchitectureComponent,
  ArchitectureConnection,
  ArchitectureIR,
  RepositoryTopology,
  SequenceIR,
  SystemFactStore,
} from "@onto/protocol";
import { entityKey } from "@onto/protocol";

import {
  backendReplacementSeams,
  computeRelationshipLanes,
  matchArchitectureSequences,
  primaryConnectionIds,
  RELATIONSHIP_LAYER_LABEL,
  type ArchitectureSequenceMatch,
  type BackendReplacementSeam,
} from "../layout/architectureRelationships.js";
import { EvidenceList } from "./Grounding.js";
import { SequenceView } from "./SequenceView.js";
import { FACT_ORIGIN_LABEL, FACT_STATUS_LABEL, summarizeFactTrust, type FactTrustSummary } from "../factTrust.js";

const PT_SHORT: Record<string, string> = {
  external: "EXT", frontend: "UI", backend: "SRV", database: "DB", queue: "Q",
  security: "SEC", job: "JOB", cloud: "CLD", unknown: "?",
};

const ROLE_LABEL: Record<string, string> = { sync: "동기 호출", async: "비동기", data: "데이터 전달", control: "제어" };

type EdgeGeometry = {
  id: string;
  path: string;
  labelX: number;
  labelY: number;
};

function portOffset(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index - (count - 1) / 2) * Math.min(22, 44 / (count - 1));
}

function RelationshipCard({
  component,
  replacementSeam,
  highlighted,
  dimmed,
  readingOrder,
  onSelect,
  trust,
}: {
  component: ArchitectureComponent;
  replacementSeam?: BackendReplacementSeam;
  highlighted?: boolean;
  dimmed?: boolean;
  readingOrder?: number;
  onSelect?: (id: string) => void;
  trust?: FactTrustSummary;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`relationship-card relationship-card-${component.presentationType}${replacementSeam ? " relationship-card-replacement" : ""}${highlighted ? " relationship-card-highlighted" : ""}${dimmed ? " relationship-card-dimmed" : ""}`}
      data-relationship-node={component.id}
      onClick={() => onSelect?.(component.id)}
      title={component.description ?? component.sublabel ?? component.label}
    >
      <span className="relationship-card-meta">
        <span className={`pt-chip-mini pt-${component.presentationType}`}>{PT_SHORT[component.presentationType] ?? "?"}</span>
        {component.sublabel && <span>{component.sublabel}</span>}
      </span>
      <strong>{component.label}</strong>
      {readingOrder !== undefined && (
        <span className="relationship-reading-order" aria-label={`추천 탐색 순서 ${readingOrder}`}>
          <small>추천</small>{String(readingOrder).padStart(2, "0")}
        </span>
      )}
      {replacementSeam && <span className="relationship-replacement-badge">⇄ API 교체 지점</span>}
      {trust?.level === "review" && <span className="relationship-review-badge">! 확인 필요</span>}
    </button>
  );
}

function ConnectionDetail({
  connection,
  componentById,
  sequenceMatch,
  replacementSeam,
  onClose,
  onSelectComponent,
  factStore,
}: {
  connection: ArchitectureConnection;
  componentById: Map<string, ArchitectureComponent>;
  sequenceMatch?: ArchitectureSequenceMatch;
  replacementSeam?: BackendReplacementSeam;
  onClose: () => void;
  onSelectComponent?: (id: string) => void;
  factStore?: SystemFactStore | null;
}): React.JSX.Element {
  const from = componentById.get(connection.from);
  const to = componentById.get(connection.to);
  const relatedFacts = (connection.systemLinkRefs ?? []).map((id) => factStore?.links.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const trust = summarizeFactTrust(relatedFacts);
  if (sequenceMatch) {
    return (
      <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section className="detail-modal sequence-modal relationship-sequence-modal" role="dialog" aria-modal="true" aria-label={sequenceMatch.sequence.title}>
          <div className="sequence-modal-head">
            <div>
              <p className="detail-eyebrow">코드 근거로 복원한 호출 흐름</p>
              <h3>{sequenceMatch.sequence.title}</h3>
            </div>
            <button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button>
          </div>
          <div className="relationship-sequence-proof">
            <span><strong>{from?.label ?? connection.from}</strong> → <strong>{to?.label ?? connection.to}</strong></span>
            <span>정확히 일치한 호출 근거 {sequenceMatch.sharedEvidenceRefs.length}개</span>
            <span>참여 구성요소 {sequenceMatch.sequence.participants.length}개 · 메시지 {sequenceMatch.sequence.messages.length}개</span>
            {trust && <span className={`fact-trust-inline fact-trust-inline-${trust.level}`}>● {trust.label}</span>}
          </div>
          <SequenceView ir={sequenceMatch.sequence} />
        </section>
      </div>
    );
  }
  return (
    <div className="detail-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="detail-modal relationship-detail-modal" role="dialog" aria-modal="true" aria-label="관계 상세">
        <div className="detail-context-pane">
          <p className="detail-eyebrow">선택한 관계만 보기</p>
          <div className="relationship-focus-flow">
            <button type="button" onClick={() => from && onSelectComponent?.(from.id)}>
              {from && <span className={`pt-dot pt-${from.presentationType}`} />}
              <strong>{from?.label ?? connection.from}</strong>
              {from?.sublabel && <small>{from.sublabel}</small>}
            </button>
            <div className={`relationship-focus-arrow relationship-focus-${connection.role ?? "sync"}`}>
              <span>{connection.label ?? ROLE_LABEL[connection.role ?? "sync"]}</span>
              <i>→</i>
            </div>
            <button type="button" onClick={() => to && onSelectComponent?.(to.id)}>
              {to && <span className={`pt-dot pt-${to.presentationType}`} />}
              <strong>{to?.label ?? connection.to}</strong>
              {to?.sublabel && <small>{to.sublabel}</small>}
            </button>
          </div>
        </div>
        <div className="detail-info-pane">
          <div className="step-detail-header">
            <div>
              <p className="detail-eyebrow">{ROLE_LABEL[connection.role ?? "sync"]}</p>
              <h3>{connection.label ?? `${from?.label ?? connection.from} → ${to?.label ?? connection.to}`}</h3>
            </div>
            <button type="button" className="close-button" onClick={onClose} aria-label="닫기">×</button>
          </div>
          <p className="detail-relation-summary">
            <strong>{from?.label ?? connection.from}</strong>에서 <strong>{to?.label ?? connection.to}</strong>로 이어지는 관계입니다.
          </p>
          {trust && (
            <section className={`fact-trust fact-trust-${trust.level}`}>
              <div><span className="fact-trust-dot" /><strong>{trust.label}</strong><small>{trust.factCount}개 연결 사실</small></div>
              <p>{trust.description}</p>
              <ul className="fact-trust-meta">
                {trust.origin.map((origin) => <li key={origin}>{FACT_ORIGIN_LABEL[origin]}</li>)}
                {trust.statuses.map((status) => <li key={status}>{FACT_STATUS_LABEL[status]}</li>)}
              </ul>
            </section>
          )}
          {replacementSeam && (
            <section className="relationship-replacement-note">
              <h4>백엔드 교체 지점</h4>
              <p>{replacementSeam.reason}입니다. 현재는 로컬 데이터에 직접 연결되어 있지만, 이 경계를 API/DB 호출로 바꾸면 화면과 서비스의 나머지 구조를 유지할 수 있습니다.</p>
            </section>
          )}
          {(connection.systemLinkRefs?.length ?? 0) > 0 && (
            <section>
              <h4>검증된 시스템 연결</h4>
              <ul className="chip-list">
                {connection.systemLinkRefs!.map((ref) => <li key={ref} className="chip">{ref}</li>)}
              </ul>
            </section>
          )}
          {(connection.systemLinkRefs?.length ?? 0) === 0 && (connection.traceLinkRefs?.length ?? 0) > 0 && (
            <section>
              <h4>코드에서 확인된 연결</h4>
              <ul className="chip-list">
                {connection.traceLinkRefs!.map((ref) => <li key={ref} className="chip">{ref}</li>)}
              </ul>
            </section>
          )}
          <section>
            <h4>관계 근거</h4>
            <EvidenceList ids={connection.evidenceRefs} />
          </section>
        </div>
      </section>
    </div>
  );
}

export function ArchitectureRelationshipMap({
  ir,
  topology,
  sequences = [],
  highlightedComponentIds = new Set<string>(),
  hasExternalFocus = false,
  hasFocus = false,
  focusMessage,
  onClearFocus,
  onSelectComponent,
  systemFacts,
}: {
  ir: ArchitectureIR;
  topology?: RepositoryTopology;
  sequences?: SequenceIR[];
  highlightedComponentIds?: ReadonlySet<string>;
  hasExternalFocus?: boolean;
  hasFocus?: boolean;
  focusMessage?: string;
  onClearFocus?: () => void;
  onSelectComponent?: (componentId: string) => void;
  systemFacts?: SystemFactStore | null;
}): React.JSX.Element {
  const { lanes, layers } = useMemo(() => computeRelationshipLanes(ir), [ir]);
  const primaryIds = useMemo(() => primaryConnectionIds(ir), [ir]);
  const hasPrimaryPath = primaryIds.size > 0;
  const [mode, setMode] = useState<"primary" | "all">("all");
  const [geometries, setGeometries] = useState<EdgeGeometry[]>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<ArchitectureConnection | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const componentById = useMemo(() => new Map(ir.components.map((component) => [component.id, component])), [ir.components]);
  const entityFactsByKey = useMemo(() => {
    const result = new Map<string, SystemFactStore["entities"]>();
    for (const fact of systemFacts?.entities ?? []) {
      for (const key of [fact.id, entityKey(fact.ref)]) {
        const values = result.get(key) ?? [];
        values.push(fact);
        result.set(key, values);
      }
    }
    return result;
  }, [systemFacts]);
  const replacementSeams = useMemo(() => backendReplacementSeams(ir, topology), [ir, topology]);
  const sequenceMatches = useMemo(() => matchArchitectureSequences(ir, sequences), [ir, sequences]);
  const replacementConnectionIds = useMemo(
    () => new Set([...replacementSeams.values()].flatMap((seam) => seam.connectionIds)),
    [replacementSeams],
  );
  const replacementSeamByConnection = useMemo(() => {
    const result = new Map<string, BackendReplacementSeam>();
    for (const seam of replacementSeams.values()) {
      for (const connectionId of seam.connectionIds) result.set(connectionId, seam);
    }
    return result;
  }, [replacementSeams]);
  const visibleConnections = useMemo(
    () => mode === "primary" && hasPrimaryPath
      ? ir.connections.filter((connection) => primaryIds.has(connection.id))
      : ir.connections,
    [hasPrimaryPath, ir.connections, mode, primaryIds],
  );

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const outgoing = new Map<string, ArchitectureConnection[]>();
    const incoming = new Map<string, ArchitectureConnection[]>();
    for (const connection of visibleConnections) {
      if (!outgoing.has(connection.from)) outgoing.set(connection.from, []);
      if (!incoming.has(connection.to)) incoming.set(connection.to, []);
      outgoing.get(connection.from)!.push(connection);
      incoming.get(connection.to)!.push(connection);
    }
    const next: EdgeGeometry[] = [];
    for (const connection of visibleConnections) {
      const fromElement = stage.querySelector<HTMLElement>(`[data-relationship-node="${CSS.escape(connection.from)}"]`);
      const toElement = stage.querySelector<HTMLElement>(`[data-relationship-node="${CSS.escape(connection.to)}"]`);
      if (!fromElement || !toElement) continue;
      const from = fromElement.getBoundingClientRect();
      const to = toElement.getBoundingClientRect();
      const outList = outgoing.get(connection.from) ?? [connection];
      const inList = incoming.get(connection.to) ?? [connection];
      const startY = from.top - stageRect.top + from.height / 2 + portOffset(outList.indexOf(connection), outList.length);
      const endY = to.top - stageRect.top + to.height / 2 + portOffset(inList.indexOf(connection), inList.length);
      const goesRight = to.left >= from.right;
      const goesLeft = to.right <= from.left;
      const startX = goesLeft ? from.left - stageRect.left : from.right - stageRect.left;
      // 화살촉이 카드 뒤로 들어가지 않도록 목표 카드에서 10px 앞에 멈춘다.
      const endX = goesRight
        ? to.left - stageRect.left - 10
        : to.right - stageRect.left + 10;
      let path: string;
      let labelX: number;
      if (connection.from === connection.to) {
        const loopX = startX + 36;
        // 자기 호출도 화살촉이 카드 안으로 파묻히지 않게 오른쪽 10px 밖에서 끝낸다.
        path = `M ${startX} ${startY} H ${loopX} V ${startY + 34} H ${startX + 10}`;
        labelX = loopX;
      } else if (goesRight && endX > startX + 36) {
        const middleX = startX + (endX - startX) / 2;
        path = `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`;
        // 여러 열을 건너뛰어도 라벨은 중간 컴포넌트 위가 아니라 출발 직후 거터에 둔다.
        labelX = startX + Math.min(54, (endX - startX) / 2);
      } else {
        // 같은 열/역방향 연결은 카드 바로 옆이 아니라 열 사이 전용 거터 중앙으로 보낸다.
        const gutterX = goesLeft
          ? Math.min(startX, to.left - stageRect.left) - 54
          : Math.max(startX, to.right - stageRect.left) + 54;
        path = `M ${startX} ${startY} H ${gutterX} V ${endY} H ${endX}`;
        labelX = gutterX;
      }
      next.push({ id: connection.id, path, labelX, labelY: startY - 16 });
    }

    // 전체 관계 모드에서도 라벨끼리 덮이지 않게 거터 안에서만 위아래 후보를 탐색한다.
    const nodeBoxes = [...stage.querySelectorAll<HTMLElement>("[data-relationship-node]")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left - stageRect.left, right: rect.right - stageRect.left, top: rect.top - stageRect.top, bottom: rect.bottom - stageRect.top };
    });
    const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
    const overlaps = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }): boolean =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    for (const geometry of next) {
      const connection = visibleConnections.find((item) => item.id === geometry.id);
      const textLength = (connection?.label ?? ROLE_LABEL[connection?.role ?? "sync"] ?? "관계").length + 2;
      const width = Math.min(92, Math.max(42, textLength * 5.4));
      const candidates = [0, -24, 24, -48, 48, -72, 72];
      for (const offset of candidates) {
        const cy = geometry.labelY + offset;
        const box = { left: geometry.labelX - width / 2, right: geometry.labelX + width / 2, top: cy - 10, bottom: cy + 10 };
        if (nodeBoxes.some((node) => overlaps(box, node)) || placed.some((label) => overlaps(box, label))) continue;
        geometry.labelY = cy;
        placed.push(box);
        break;
      }
    }
    setGeometries(next);
  }, [visibleConnections]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    stage.querySelectorAll("[data-relationship-node]").forEach((node) => observer.observe(node));
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, layers.length, lanes.length]);

  const geometryById = new Map(geometries.map((geometry) => [geometry.id, geometry]));
  const primaryNodeIds = new Set(ir.viewPlan?.primaryPath ?? []);
  const stageMinWidth = 180 + Math.max(1, layers.length) * 280;

  return (
    <div className="relationship-map">
      <div className="relationship-toolbar">
        <div>
          <strong>런타임별 관계 지도</strong>
          <p>블록을 합치지 않고, 의미 레이어를 고정해 모든 구성요소의 위치를 유지합니다.</p>
        </div>
        <div className="relationship-toolbar-actions">
          {hasFocus && (
            <button type="button" className="relationship-clear-focus" onClick={onClearFocus} title="Esc 키로도 해제할 수 있습니다">
              강조 해제 ×
            </button>
          )}
          <div className="relationship-mode" role="group" aria-label="표시할 관계">
            {hasPrimaryPath && (
              <button type="button" aria-pressed={mode === "primary"} onClick={() => setMode("primary")}>
                핵심 관계 {primaryIds.size}
              </button>
            )}
            <button type="button" aria-pressed={mode === "all"} onClick={() => setMode("all")}>전체 관계 {ir.connections.length}</button>
          </div>
        </div>
      </div>

      {(mode === "primary" || hasFocus) && (
        <div className="relationship-context-note" aria-live="polite">
          {mode === "primary" && <span><b>추천 01</b>은 Vibee가 고른 탐색 순서이며 실제 실행 순서가 아닙니다.</span>}
          {hasFocus && <span className="relationship-focus-message">● {focusMessage ?? "관련 항목 강조 중"}</span>}
        </div>
      )}

      {replacementSeams.size > 0 && (
        <div className="relationship-replacement-summary">
          <span className="relationship-replacement-icon">⇄</span>
          <div>
            <strong>백엔드 교체 후보 {replacementSeams.size}곳</strong>
            <p>Core가 확인한 로컬 데이터 경계입니다. 초록색 카드는 현재 서버가 아니라 향후 API/DB로 치환하기 좋은 접점이며, "전체 관계"에서 영향 연결선도 볼 수 있습니다.</p>
          </div>
        </div>
      )}

      <div className="relationship-scroll">
        <div
          className="relationship-stage"
          ref={stageRef}
          style={{ minWidth: stageMinWidth, gridTemplateColumns: `160px repeat(${layers.length}, minmax(250px, 1fr))` }}
        >
          <div className="relationship-corner">실행 영역</div>
          {layers.map((layer, index) => (
            <div key={layer} className="relationship-layer-head">
              <span>{String(index + 1).padStart(2, "0")}</span>{RELATIONSHIP_LAYER_LABEL[layer]}
            </div>
          ))}

          {lanes.map((lane) => (
            <div key={lane.id} className="relationship-lane" style={{ gridColumn: `1 / span ${layers.length + 1}` }}>
              <div className="relationship-lane-grid" style={{ gridTemplateColumns: `160px repeat(${layers.length}, minmax(250px, 1fr))` }}>
                <div className="relationship-lane-title">
                  <strong>{lane.label}</strong>
                  {lane.kind && <span>{lane.kind}</span>}
                </div>
                {layers.map((layer) => (
                  <div key={layer} className="relationship-cell">
                    {(lane.componentsByLayer.get(layer) ?? []).map((component) => (
                      <div key={component.id} className={mode === "primary" && hasPrimaryPath && !primaryNodeIds.has(component.id) ? "relationship-node-secondary" : undefined}>
                        <RelationshipCard
                          component={component}
                          replacementSeam={replacementSeams.get(component.id)}
                          highlighted={highlightedComponentIds.has(component.id)}
                          dimmed={hasExternalFocus && !highlightedComponentIds.has(component.id)}
                          readingOrder={mode === "primary" ? (ir.viewPlan?.primaryPath.indexOf(component.id) ?? -1) + 1 || undefined : undefined}
                          onSelect={onSelectComponent}
                          trust={summarizeFactTrust(component.entityRefs.flatMap((ref) => entityFactsByKey.get(ref) ?? []))}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <svg className="relationship-edge-layer" aria-hidden="true">
            <defs>
              <marker id="relationship-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" />
              </marker>
              <marker id="relationship-arrow-data" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" />
              </marker>
              <marker id="relationship-arrow-control" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" />
              </marker>
              <marker id="relationship-arrow-replacement" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" />
              </marker>
            </defs>
            {visibleConnections.map((connection) => {
              const geometry = geometryById.get(connection.id);
              if (!geometry) return null;
              const muted = hoveredEdgeId !== null && hoveredEdgeId !== connection.id;
              const isReplacement = replacementConnectionIds.has(connection.id);
              const marker = isReplacement
                ? "url(#relationship-arrow-replacement)"
                : connection.role === "data"
                  ? "url(#relationship-arrow-data)"
                  : connection.role === "control"
                    ? "url(#relationship-arrow-control)"
                    : "url(#relationship-arrow)";
              return (
                <path
                  key={connection.id}
                  d={geometry.path}
                  className={`relationship-edge relationship-edge-${connection.role ?? "sync"}${isReplacement ? " relationship-edge-replacement" : ""}${muted ? " relationship-edge-muted" : ""}`}
                  markerEnd={marker}
                />
              );
            })}
          </svg>

          <div className="relationship-label-layer">
            {visibleConnections.map((connection) => {
              const geometry = geometryById.get(connection.id);
              if (!geometry) return null;
              const sequenceMatch = sequenceMatches.get(connection.id);
              const isReplacement = replacementConnectionIds.has(connection.id);
              return (
                <button
                  type="button"
                  key={connection.id}
                  className={`relationship-edge-label relationship-edge-label-${connection.role ?? "sync"}${isReplacement ? " relationship-edge-label-replacement" : ""}${sequenceMatch ? " relationship-edge-label-sequence" : ""}`}
                  style={{ left: geometry.labelX, top: geometry.labelY }}
                  onMouseEnter={() => setHoveredEdgeId(connection.id)}
                  onMouseLeave={() => setHoveredEdgeId(null)}
                  onFocus={() => setHoveredEdgeId(connection.id)}
                  onBlur={() => setHoveredEdgeId(null)}
                  onClick={() => setSelectedConnection(connection)}
                  title={sequenceMatch ? "코드 근거로 복원한 시퀀스 보기" : "관계 근거 보기"}
                >
                  {connection.label ?? ROLE_LABEL[connection.role ?? "sync"]}
                  {sequenceMatch ? <span className="relationship-sequence-hint">▶ SEQ</span> : <span className="relationship-detail-hint">↗</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="relationship-legend" aria-label="관계선 범례">
        <span><i className="relationship-legend-line relationship-legend-sync" />동기 호출 — 즉시 응답을 기다림</span>
        <span><i className="relationship-legend-line relationship-legend-async" />비동기 전달 — 나중에 처리</span>
        <span className="relationship-legend-data"><i className="relationship-legend-line" />데이터 읽기·쓰기</span>
        <span className="relationship-legend-control"><i className="relationship-legend-line" />조건·제어 흐름</span>
        <em>모든 선의 화살촉은 출발 → 도착 방향입니다.</em>
      </div>

      {selectedConnection && (
        <ConnectionDetail
          connection={selectedConnection}
          componentById={componentById}
          sequenceMatch={sequenceMatches.get(selectedConnection.id)}
          replacementSeam={replacementSeamByConnection.get(selectedConnection.id)}
          onClose={() => setSelectedConnection(null)}
          onSelectComponent={(id) => {
            setSelectedConnection(null);
            onSelectComponent?.(id);
          }}
          factStore={systemFacts}
        />
      )}
    </div>
  );
}
