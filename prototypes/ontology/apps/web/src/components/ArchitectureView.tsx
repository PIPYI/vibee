/**
 * 프로젝트 지도. 요약/구성요소는 읽기용 DOM 뷰이고, 관계 상세는 런타임 행 × 의미 레이어 열로
 * 구성한 별도 DOM 관계 지도다. 관계 상세에서는 컴포넌트를 합치지 않으며 좌표형 boundary도
 * 사용하지 않는다.
 */
import { useState } from "react";

import type { ArchitectureIR, RepositoryTopology, SequenceIR } from "@onto/protocol";

import { ArchitectureComposition } from "./ArchitectureComposition.js";
import { ArchitectureRelationshipMap } from "./ArchitectureRelationshipMap.js";
import { ProjectOverview } from "./ProjectOverview.js";

type ArchitectureSubtab = "overview" | "composition" | "structure";

export function ArchitectureView({
  ir,
  topology,
  sequences,
  onSelectComponent,
}: {
  ir: ArchitectureIR;
  topology?: RepositoryTopology;
  sequences?: SequenceIR[];
  viewKey: string;
  onSelectComponent?: (componentId: string) => void;
}): React.JSX.Element {
  const [subtab, setSubtab] = useState<ArchitectureSubtab>("overview");

  return (
    <div className="architecture-view">
      <div className="architecture-view-head">
        <h2>{ir.title}</h2>
        <nav className="arch-subtab-switch" role="tablist" aria-label="아키텍처 보기 방식">
          <button type="button" role="tab" aria-selected={subtab === "overview"} onClick={() => setSubtab("overview")}>
            프로젝트 한눈에
          </button>
          <button type="button" role="tab" aria-selected={subtab === "composition"} onClick={() => setSubtab("composition")}>
            구성요소
          </button>
          <button type="button" role="tab" aria-selected={subtab === "structure"} onClick={() => setSubtab("structure")}>
            관계 상세
          </button>
        </nav>
      </div>

      {subtab === "overview" ? (
        <ProjectOverview ir={ir} topology={topology} onSelectComponent={onSelectComponent} />
      ) : subtab === "composition" ? (
        <ArchitectureComposition ir={ir} onSelectComponent={onSelectComponent} />
      ) : (
        <ArchitectureRelationshipMap ir={ir} topology={topology} sequences={sequences} onSelectComponent={onSelectComponent} />
      )}
    </div>
  );
}
