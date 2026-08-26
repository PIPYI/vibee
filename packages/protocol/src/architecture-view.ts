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

export type ArchitectureViewComponent = {
  id: string;
  type: ArchitectureViewComponentType;
  label: string;
  sublabel?: string;
  pos: [number, number];
  size: [number, number];
  sources?: ArchitectureViewSource[];
};

export type ArchitectureViewBoundary = {
  kind: "region" | "security-group";
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
