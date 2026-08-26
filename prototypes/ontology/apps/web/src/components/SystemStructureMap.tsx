/**
 * "시스템 구조" 섹션(UnifiedMapView)이 그리는 지도. AI가 저장소를 직접 읽고 좌표까지 저작한
 * 문서를 그대로 그린 SVG를 받아 임베드한다 — 기존 결정론적 레이아웃 기반 지도(구성/관계
 * 지도)를 이 화면에서는 대체한다. pan/zoom은 아직 없다(1단계 — 정적 embed).
 */
export function SystemStructureMap({ svg }: { svg: string }): React.JSX.Element {
  return (
    <div className="system-structure-map" style={{ overflow: "auto", border: "1px solid var(--border, #e2e8f0)", borderRadius: 12 }}>
      {/* 서버가 결정론적으로 만든 SVG 문자열이다 — 사용자 입력이 아니다. */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
