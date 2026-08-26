/**
 * v7 — Architecture 뷰 전용 archify 패턴 타입.
 *
 * `ArchitectureIR`(schema3 §3.2, index.ts)과 의도적으로 이름과 모양을 다르게 둔다. 저 타입은
 * grounding 파이프라인이 **파생**시키는 것(evidenceRefs/certainty 필수, 좌표 없음 — A7)이고,
 * 이 타입은 AI가 저장소를 직접 읽고 **저작**하는 것(좌표 포함, evidence-grounding 필드 없음)이다.
 * 같은 모양으로 두면 두 파이프라인이 섞인다 — v7/README.md §2 참고.
 *
 * 브라우저 번들이 이 모듈을 import 하므로 Node 내장 모듈을 쓰면 안 된다(index.ts와 같은 제약).
 */

export type ArchitectureViewComponentType =
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "security"
  | "messagebus"
  | "external";

/** git 진위 검증(citation.ts)이 소비하는 인용 포인터. 파일 내용이 아니라 주소만 싣는다. */
export type ArchitectureViewSource = {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
};

export type ArchitectureViewComponent = {
  id: string;
  type: ArchitectureViewComponentType;
  label: string;
  sublabel?: string;
  /** AI가 직접 쓰는 좌표 (v2의 "AI는 좌표를 쓰지 않는다"를 Architecture 뷰에 한해 뒤집는다). */
  pos: [number, number];
  size: [number, number];
  sources?: ArchitectureViewSource[];
};

export type ArchitectureViewBoundary = {
  id?: string;
  kind: string;
  label: string;
  wraps: string[];
  pad?: number;
};

export type ArchitectureViewConnection = {
  id?: string;
  from: string;
  to: string;
  label?: string;
  variant?: "default" | "emphasis" | "security" | "dashed";
};

export type ArchitectureViewCard = {
  dot?: string;
  title: string;
  items: string[];
};

export type ArchitectureViewDocument = {
  schemaVersion: 1;
  title: string;
  viewBox?: [number, number];
  repository?: { url?: string; revision?: string };
  components: ArchitectureViewComponent[];
  boundaries: ArchitectureViewBoundary[];
  connections: ArchitectureViewConnection[];
  cards?: ArchitectureViewCard[];
};
