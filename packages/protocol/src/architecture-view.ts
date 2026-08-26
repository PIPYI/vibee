// Hand-written TypeScript types that mirror
// packages/architecture-view/schemas/architecture-view.schema.json exactly.
// The JSON Schema is the single source of truth for runtime validation; these
// types exist so TypeScript consumers get compile-time checking of the same
// shape. Keep both in sync by hand.

export type ArchitectureViewComponentType =
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "security"
  | "messagebus"
  | "external";

export type ArchitectureViewSource = {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
};

// V2: which kind of RuntimeSemanticDocument entity a component stands for.
export type ArchitectureSemanticRole = "actor" | "responsibility" | "state" | "external";

export type ArchitectureAudience = "simple" | "technical";

// A per-audience override of display fields. Applying this must never change
// semantic identity, topology, or geometry -- see presentation.ts.
export type PresentationOverride = {
  label?: string;
  sublabel?: string | null;
  visibility?: "show" | "hide";
};

export type AudiencePresentation = {
  simple?: PresentationOverride;
  technical?: PresentationOverride;
};

export type ArchitectureViewComponent = {
  id: string;
  type: ArchitectureViewComponentType;
  semanticRole: ArchitectureSemanticRole;
  // V2 MVP authoring convention is exactly one ref (see docs/v2_plan.md §10);
  // typed as an array for forward compatibility with future grouping.
  semanticRefs: string[];
  label: string;
  sublabel?: string;
  presentation?: AudiencePresentation;
  pos: [number, number];
  size: [number, number];
  sources?: ArchitectureViewSource[];
};

export type ArchitectureViewBoundary = {
  id?: string;
  kind: "runtime" | "region" | "security-group";
  semanticRefs?: string[];
  label: string;
  presentation?: AudiencePresentation;
  wraps: string[];
  pad?: number;
};

export type ArchitectureViewConnection = {
  id?: string;
  from: string;
  to: string;
  semanticRefs?: string[];
  label?: string;
  presentation?: AudiencePresentation;
  variant?: "default" | "emphasis" | "security" | "dashed";
};

export type ArchitectureViewCard = {
  dot?: string;
  title: string;
  items: string[];
};

export type ArchitectureViewDocument = {
  schemaVersion: 2;
  title: string;
  viewBox?: [number, number];
  repository?: { url?: string; revision?: string };
  presentation?: {
    defaultAudience: "simple";
    availableAudiences: ArchitectureAudience[];
  };
  components: ArchitectureViewComponent[];
  boundaries: ArchitectureViewBoundary[];
  connections: ArchitectureViewConnection[];
  cards?: ArchitectureViewCard[];
};
