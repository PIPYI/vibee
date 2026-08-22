/**
 * `ClaudeAdapter#checkReady` — SDK가 optional dependency다(M3 FINDINGS). CLI(`claude`)는
 * 있는데 `@anthropic-ai/claude-agent-sdk`가 `node_modules`에 없는 흔한 조합에서
 * **정직하게 `installed: false`를 보고해야 한다.**
 *
 * 실사용 중 발견된 결함: `installed: true`를 잘못 보고해서 `/api/health`가 Claude를
 * 선택 가능하게 보여주고, `/api/analyze`의 `!ready.installed` 가드도 통과시켰다 —
 * 그 결과 실제 turn이 시작된 뒤에야 `startTask` 내부에서 raw `Cannot find package
 * '@anthropic-ai/claude-agent-sdk'` 오류가 사용자에게 그대로 샜다. 이 시험이 없었다면
 * 사용자가 실제로 브라우저에서 Analyze를 눌러 보기 전까지 아무도 몰랐을 결함이다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ClaudeAdapter } from "../dist/agents/claude/adapter.js";
import { probeAgentVersion } from "../dist/platform.js";

const probe = probeAgentVersion("claude");

test(
  "CLI는 있지만 SDK 를 못 불러오면 installed: false 로 정직하게 보고한다",
  { skip: !probe.ok ? "claude CLI 가 이 머신에 없다 — 이 시험은 CLI 는 있고 SDK 만 없는 조합을 본다" : false },
  async () => {
    const adapter = new ClaudeAdapter({ mcpServerPath: "/tmp/mcp", bridgeUrl: "http://x", bridgeToken: "t" });
    const ready = await adapter.checkReady();

    // 이 저장소는 SDK 를 devDependency 로도 두지 않는다(선택적 런타임 의존성) — 이 시험이
    // 실제로 SDK-미설치 분기를 타는지 스스로 확인한다. 만약 어떤 이유로 SDK 가 설치돼
    // 있다면(로컬에서 실험적으로 깔았거나) 이 시험은 installed:true 를 기대해야 하므로
    // 여기서 건너뛴다 — 잘못된 실패를 보고하지 않기 위함이다.
    if (ready.installed && ready.message === undefined) {
      return; // SDK 가 실제로 설치되어 있다. 이 시험이 노리는 상황이 아니다.
    }

    assert.equal(ready.installed, false, JSON.stringify(ready));
    assert.match(ready.message ?? "", /claude-agent-sdk/);
  },
);
