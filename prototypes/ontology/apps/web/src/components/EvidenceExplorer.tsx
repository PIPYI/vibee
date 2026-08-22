/**
 * 분석 전에도 Trace는 바로 보인다(§6.6, §7.4) — Semantic Memory가 없어도 Evidence만
 * 있으면 file/symbol을 anchor로 Trace를 그릴 수 있다. 아직 Concept가 없을 때 보여준다.
 */
import { useEffect, useState } from "react";

import { isUnavailable, queryEvidence, type EvidenceView } from "../api.js";

export function EvidenceExplorer({
  onSelectFile,
  onSelectSymbol,
}: {
  onSelectFile: (filePath: string) => void;
  onSelectSymbol: (symbolId: string) => void;
}): React.JSX.Element {
  const [files, setFiles] = useState<EvidenceView[] | null>(null);
  const [symbols, setSymbols] = useState<EvidenceView[] | null>(null);

  useEffect(() => {
    void queryEvidence({ kind: "file", limit: 50 }).then((r) => !isUnavailable(r) && setFiles(r.evidence));
    void queryEvidence({ kind: "symbol", limit: 50 }).then((r) => !isUnavailable(r) && setSymbols(r.evidence));
  }, []);

  return (
    <div className="evidence-explorer">
      <p className="dim">
        아직 의미 분석 전입니다 — 코드 구조(Trace)는 Evidence만으로 바로 볼 수 있습니다. 파일이나
        심볼을 하나 골라 시작하세요.
      </p>
      <div className="explorer-columns">
        <div>
          <h4>파일</h4>
          <ul className="explorer-list">
            {(files ?? []).map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => item.filePath && onSelectFile(item.filePath)}>
                  {item.filePath}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>심볼</h4>
          <ul className="explorer-list">
            {(symbols ?? []).map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => item.symbolId && onSelectSymbol(item.symbolId)}>
                  {item.symbolId}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
