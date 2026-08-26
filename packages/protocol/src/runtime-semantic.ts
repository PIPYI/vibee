// Hand-written TypeScript types that mirror
// packages/architecture-view/schemas/runtime-semantic.schema.json exactly.
// The JSON Schema is the single source of truth for runtime validation; these
// types exist so TypeScript consumers get compile-time checking of the same
// shape. Keep both in sync by hand.
//
// A RuntimeSemanticDocument has no coordinates and no audience-specific
// presentation -- it is repository evidence only (who uses the system, what
// runtimes/responsibilities/state/external dependencies exist, and how they
// interact). It is authored before, and separately from, the canonical
// ArchitectureViewDocument (see architecture-view.ts), which is composed from
// it in a later step.

export type SourceRef = {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
};

export type ImplementationHint = {
  label: string;
  kind?: "framework" | "library" | "protocol" | "vendor" | "database" | "queue" | "runtime" | "other";
};

export type RuntimeActor = {
  id: string;
  label: string;
  sources?: SourceRef[];
};

export type RuntimeUnitKind =
  | "mobile"
  | "web"
  | "desktop-renderer"
  | "desktop-main"
  | "server"
  | "worker"
  | "cli"
  | "embedded"
  | "other";

export type RuntimeUnit = {
  id: string;
  label: string;
  kind: RuntimeUnitKind;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeResponsibility = {
  id: string;
  runtimeId: string;
  label: string;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeState = {
  id: string;
  runtimeId?: string;
  label: string;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeExternal = {
  id: string;
  label: string;
  kind?: "api" | "auth" | "storage" | "database" | "queue" | "service" | "other";
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeInteractionKind = "user-action" | "request" | "event" | "auth" | "state-read" | "state-write" | "other";

export type RuntimeInteraction = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind?: RuntimeInteractionKind;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeSemanticDocument = {
  schemaVersion: 1;
  title: string;
  repository?: {
    url?: string;
    revision?: string;
  };
  actors: RuntimeActor[];
  runtimes: RuntimeUnit[];
  responsibilities: RuntimeResponsibility[];
  states: RuntimeState[];
  externals: RuntimeExternal[];
  interactions: RuntimeInteraction[];
};
