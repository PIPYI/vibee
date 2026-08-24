/**
 * 비전공자의 기본 진입점. 그래프를 먼저 보여주지 않고 Core가 탐지한 실행 단위와 데이터,
 * Assembly가 고른 주 경로를 함께 보여준다. 이 화면의 개수는 RepositoryTopology에서 오므로
 * AI가 어떤 노드를 생략했는지도 숨지 않는다.
 */
import type { ArchitectureComponent, ArchitectureIR, RepositoryRuntime, RepositoryTopology } from "@onto/protocol";

function entityPath(ref: string): string | undefined {
  if (ref.startsWith("file:")) return ref.slice(5);
  if (ref.startsWith("symbol:")) return ref.slice(7).split("#", 1)[0];
  return undefined;
}

function belongsTo(runtime: RepositoryRuntime, component: ArchitectureComponent): boolean {
  return component.entityRefs.some((ref) => {
    const path = entityPath(ref);
    return path !== undefined && (runtime.rootPath === "" || path === runtime.rootPath || path.startsWith(`${runtime.rootPath}/`));
  });
}

function runtimeComponents(topology: RepositoryTopology, ir: ArchitectureIR, runtime: RepositoryRuntime): ArchitectureComponent[] {
  return ir.components.filter((component) => {
    if (!belongsTo(runtime, component)) return false;
    return !topology.runtimes.some(
      (other) => other.id !== runtime.id && other.rootPath.length > runtime.rootPath.length && belongsTo(other, component),
    );
  });
}

const KIND_LABEL: Record<string, string> = {
  "mobile-app": "모바일 앱",
  "web-app": "웹 앱",
  service: "서버",
  application: "애플리케이션",
};

export function ProjectOverview({
  ir,
  topology,
  onSelectComponent,
}: {
  ir: ArchitectureIR;
  topology?: RepositoryTopology;
  onSelectComponent?: (componentId: string) => void;
}): React.JSX.Element {
  if (!topology) {
    return (
      <div className="project-overview project-overview-legacy">
        <p>이 분석은 저장소 완전성 검사가 도입되기 전에 만들어졌습니다.</p>
        <p className="dim">다시 분석하면 독립 앱과 로컬 데이터의 누락 여부를 확인할 수 있습니다.</p>
      </div>
    );
  }

  const coverage = topology.coverage;
  const complete =
    coverage.missingRuntimeIds.length === 0 &&
    coverage.missingDataStoreIds.length === 0 &&
    coverage.sharedBoundaryRuntimeIds.length === 0;
  const componentById = new Map(ir.components.map((component) => [component.id, component] as const));
  const primary = (ir.viewPlan?.primaryPath ?? []).map((id) => componentById.get(id)).filter((item): item is ArchitectureComponent => Boolean(item));

  return (
    <div className="project-overview">
      <section className={`overview-receipt ${complete ? "overview-receipt-complete" : "overview-receipt-incomplete"}`}>
        <div>
          <span className="overview-eyebrow">분석 범위 확인</span>
          <h3>{complete ? "탐지한 실행 단위와 데이터를 모두 표현했습니다" : "아키텍처에서 빠진 저장소 요소가 있습니다"}</h3>
          <p className="dim">코드에서 직접 탐지한 항목과 vibee가 구성한 지도를 대조한 결과입니다.</p>
        </div>
        <div className="overview-metrics" aria-label="분석 범위 통계">
          <span><strong>{coverage.representedRuntimeCount}/{coverage.detectedRuntimeCount}</strong> 실행 단위</span>
          <span><strong>{coverage.representedDataStoreCount}/{coverage.detectedDataStoreCount}</strong> 로컬 데이터</span>
          <span><strong>{ir.components.length}</strong> 구성요소</span>
        </div>
      </section>

      {primary.length > 0 && (
        <section className="overview-primary-path">
          <div className="overview-section-heading">
            <span className="overview-eyebrow">먼저 읽을 흐름</span>
            <p className="dim">vibee가 고른 설명 순서이며, 박스를 누르면 근거를 확인할 수 있습니다.</p>
          </div>
          <ol>
            {primary.map((component) => (
              <li key={component.id}>
                <button type="button" onClick={() => onSelectComponent?.(component.id)}>
                  <span>{component.label}</span>
                  {component.sublabel && <small>{component.sublabel}</small>}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="overview-runtime-grid" aria-label="독립 실행 단위">
        {topology.runtimes.map((runtime) => {
          const components = runtimeComponents(topology, ir, runtime);
          const stores = topology.dataStores.filter((store) => store.runtimeId === runtime.id);
          const missing = coverage.missingRuntimeIds.includes(runtime.id);
          return (
            <article key={runtime.id} className={`overview-runtime-card${missing ? " overview-runtime-missing" : ""}`}>
              <header>
                <div>
                  <span className="overview-kind">{KIND_LABEL[runtime.kind] ?? runtime.kind}</span>
                  <h3>{runtime.label}</h3>
                  <code>{runtime.rootPath || "."}</code>
                </div>
                <span className={`overview-status ${missing ? "overview-status-missing" : "overview-status-ok"}`}>
                  {missing ? "누락" : "표현됨"}
                </span>
              </header>
              <div className="overview-runtime-section">
                <h4>지도에 표시된 역할</h4>
                {components.length > 0 ? (
                  <div className="overview-component-list">
                    {components.map((component) => (
                      <button key={component.id} type="button" onClick={() => onSelectComponent?.(component.id)}>
                        <span>{component.label}</span>
                        <small>{component.layer ?? component.presentationType}</small>
                      </button>
                    ))}
                  </div>
                ) : <p className="dim">연결된 구성요소 없음</p>}
              </div>
              <div className="overview-runtime-meta">
                <span>진입점 {runtime.entrypointRefs.length}개</span>
                <span>로컬 데이터 {stores.reduce((sum, store) => sum + store.entityRefs.length, 0)}개 파일</span>
              </div>
              {stores.length > 0 && (
                <ul className="overview-store-list">
                  {stores.map((store) => (
                    <li key={store.id} className={coverage.missingDataStoreIds.includes(store.id) ? "is-missing" : undefined}>
                      <span>{store.label}</span><code>{store.rootPath}</code>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </section>

      {topology.runtimes.length === 0 && (
        <p className="overview-empty">실행 가능한 package manifest를 찾지 못했습니다. 구성요소 상세에서 탐지 결과를 확인하세요.</p>
      )}
    </div>
  );
}
