import { useState } from "react";
import type { Diagnostic } from "@vibee/protocol";

type Props = {
  diagnostics: Diagnostic[];
  heading?: string;
};

/**
 * Renders a list of Diagnostic objects, dismissible per-item.
 *
 * Judgment call (see the task's own framing): the bridge's happy-path
 * response, `GET /api/architecture-view`, does not carry any leftover
 * warnings from the successful submit that produced the committed document
 * -- its response shape is only `{ document, svg, meta }` (confirmed
 * against apps/bridge/src/index.ts). There is no post-commit "warnings from the last
 * submit" data anywhere in the bridge's API for this component to display in
 * the happy path, and fabricating that data would misrepresent what the
 * backend actually tracks.
 *
 * What the bridge *does* produce, on the unhappy paths, is real Diagnostic[]
 * data or a raw error string:
 *   - `task.error` WS events carry a raw `message` string.
 *   - the internal validate/submit round-trip-limit responses carry real
 *     `Diagnostic[]` (e.g. `architecture-view/validate-limit`), but those
 *     never reach the browser directly -- only the agent sees them over MCP.
 *     When the agent gives up after hitting that cap, the browser only ever
 *     observes a bare `task.completed` with no prior
 *     `architecture-view.committed`.
 *
 * So this component is used for exactly one thing in this MVP: rendering
 * whatever it's given as a prop, honestly, on App.tsx's error/no-commit
 * paths (a `task.error` message, or a synthetic diagnostic explaining that
 * the agent's turn ended without a successful submit) -- see App.tsx's
 * `errorDiagnostics` state. It is intentionally *not* wired to the viewing
 * screen's happy path, since there is nothing real to show there.
 */
export function DiagnosticsPanel({ diagnostics, heading }: Props) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const visible = diagnostics.filter((_, i) => !dismissed.has(i));
  if (visible.length === 0) return null;

  return (
    <div className="diagnostics-panel">
      {heading && <h2>{heading}</h2>}
      <ul>
        {diagnostics.map((d, i) => {
          if (dismissed.has(i)) return null;
          return (
            <li key={i} className={`diagnostic diagnostic--${d.severity}`}>
              <div className="diagnostic-body">
                <span className="diagnostic-severity">{d.severity === "error" ? "오류" : "경고"}</span>
                <span className="diagnostic-code">{d.code}</span>
                <p className="diagnostic-message">{d.message}</p>
                {d.subject && <p className="diagnostic-subject">대상: {d.subject}</p>}
                {d.supportedFixes && d.supportedFixes.length > 0 && (
                  <ul className="diagnostic-fixes">
                    {d.supportedFixes.map((fix, fi) => (
                      <li key={fi}>{fix}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                className="diagnostic-dismiss"
                aria-label="닫기"
                onClick={() => setDismissed((prev) => new Set(prev).add(i))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
