/**
 * 두 surface (schema2 §3) — Project Reader(사용자 저장소)와 Runtime Console(onto 자신).
 *
 * **I17**: 화면을 공유하지 않는다. 한쪽이 마운트되면 다른 쪽은 언마운트된다 — 상태도,
 * WebSocket 연결도 섞이지 않는다.
 */
import { useState } from "react";

import { App } from "./App.js";
import { RuntimeConsole } from "./RuntimeConsole.js";

type Surface = "reader" | "console";

export function Shell(): React.JSX.Element {
  const [surface, setSurface] = useState<Surface>("reader");

  return (
    <div className="shell">
      <nav className="surface-switch" role="tablist" aria-label="화면 전환">
        <button type="button" role="tab" aria-selected={surface === "reader"} onClick={() => setSurface("reader")}>
          Project Reader
        </button>
        <button type="button" role="tab" aria-selected={surface === "console"} onClick={() => setSurface("console")}>
          Runtime Console
        </button>
      </nav>
      {surface === "reader" ? <App /> : <RuntimeConsole />}
    </div>
  );
}
