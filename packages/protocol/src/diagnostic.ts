// Shared diagnostic shape used by validation everywhere in this project
// (schema checks, geometry checks, citation checks, and downstream
// consumers such as the MCP server / bridge).

export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** e.g. a component/connection id this diagnostic is about */
  subject?: string;
  /** structured detail (e.g. overlap amount, offending rect) */
  evidence?: unknown;
  /** short human-readable hint strings, e.g. "increase pos[1] by at least 40" */
  supportedFixes?: string[];
};

export function hasError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
