/**
 * "구성 개요" 탭 (v2 §2~§3) — `AnalysisBundle.architecture.components`를 전부 한 그래프에
 * 펼치는 대신, 화면/중간 로직/핵심 서비스로 큐레이션한 카드 그리드로 보여준다.
 *
 * ViewerShell(SVG pan/zoom) 안에 넣지 않는다 — 스크롤 가능한 일반 DOM 카드 리스트가 이
 * 매체에 맞다. 분석 시점에 이미 만들어진 `AnalysisBundle`만 읽으므로 렌더링은 재요청을
 * 만들지 않는다.
 */
import type { ArchitectureComponent, ArchitectureIR } from "@onto/protocol";

import { computeArchitectureComposition } from "../layout/architectureComposition.js";

const PT_LABEL: Record<string, string> = {
  frontend: "화면(frontend)",
  backend: "백엔드",
  database: "데이터",
  unknown: "로직/서비스",
  external: "외부",
  queue: "큐",
  security: "보안",
  job: "작업",
  cloud: "클라우드",
};

function CompositionCard({
  component,
  onSelect,
}: {
  component: ArchitectureComponent;
  onSelect?: (componentId: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="composition-card"
      onClick={() => onSelect?.(component.id)}
      title={component.sublabel ?? component.label}
    >
      <span className={`pt-chip pt-${component.presentationType}`}>{PT_LABEL[component.presentationType] ?? component.presentationType}</span>
      <h4 className="composition-card-title">{component.label}</h4>
      {component.sublabel && <p className="composition-card-sub">{component.sublabel}</p>}
    </button>
  );
}

export function ArchitectureComposition({
  ir,
  onSelectComponent,
}: {
  ir: ArchitectureIR;
  onSelectComponent?: (componentId: string) => void;
}): React.JSX.Element {
  const groups = computeArchitectureComposition(ir);

  return (
    <div className="architecture-composition">
      {groups.map((group, groupIndex) => {
        const total = group.tiers.reduce((sum, tier) => sum + tier.components.length, 0);
        return (
          <section key={group.boundaryId ?? `group-${groupIndex}`} className="composition-group">
            {group.boundaryLabel && (
              <p className="composition-group-label">
                {group.boundaryLabel} <span className="dim">— 컴포넌트 {total}개를 감싸는 경계</span>
              </p>
            )}
            <div className="composition-columns">
              {group.tiers.map((tier) => (
                <div key={tier.tier} className="composition-col">
                  <div className="composition-col-head">
                    {tier.label}
                    <span className="count">{tier.components.length}</span>
                  </div>
                  <div className="composition-col-body">
                    {tier.components.map((component) => (
                      <CompositionCard key={component.id} component={component} onSelect={onSelectComponent} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
