import type { Diagnostic } from "@onto/protocol";

export type { Diagnostic };

/** `packages/core/src/schema.ts`의 `diagnostic()`과 같은 모양 — 모든 Validator 층이 공유하는 관례. */
export function diagnostic(
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  parts: {
    subject?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    supportedFixes?: string[];
  } = {},
): Diagnostic {
  return {
    code,
    severity,
    message,
    subject: parts.subject ?? {},
    evidence: parts.evidence ?? {},
    supportedFixes: parts.supportedFixes ?? [],
  };
}

export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}
