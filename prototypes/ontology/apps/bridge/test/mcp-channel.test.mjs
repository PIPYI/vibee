/**
 * MCP ↔ bridge 채널을 **실제 두 프로세스로** 검증한다 (B1 · B4).
 *
 * ## 이 시험이 증명하는 것과 증명하지 못하는 것
 *
 * acceptance 2·3 은 MCP 호출에 **독립적인 두 증거원**을 요구한다.
 *
 * - `bridge-endpoint` — agent 가 spawn 한 별도 프로세스가 실제로 bridge 에 도달했다.
 *   **이 시험이 증명한다.** MCP server 를 진짜 자식 프로세스로 띄우고 stdio 로 MCP 프로토콜을
 *   주고받으며, 그 호출이 loopback HTTP 로 bridge 에 닿는지 본다.
 * - `agent-stream` — Codex/Claude 가 그 호출을 스스로 보고했다.
 *   **이 시험은 증명하지 못한다.** 진짜 agent CLI 가 필요하다.
 *
 * 두 증거원을 분리해 두는 이유가 이것이다 — 한쪽만 보고 "MCP 는 돌았다"고 판단하면 안 된다.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SemanticStore, initialProjectState } from "@onto/core";
import { indexProject } from "@onto/evidence";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PROTO_ROOT = join(HERE, "..", "..", "..");
const BRIDGE_ENTRY = join(PROTO_ROOT, "apps", "bridge", "dist", "index.js");
const MCP_ENTRY = join(PROTO_ROOT, "packages", "mcp-server", "dist", "index.js");

const PORT = 43871;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TOKEN = "test-token-0123456789abcdef";

let bridge;
let project;
const scratches = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridge(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/state`);
      if (response.ok) return;
    } catch {
      // 아직 안 떴다.
    }
    await sleep(150);
  }
  throw new Error("bridge 가 뜨지 않았습니다");
}

before(async () => {
  // --- 분석된 fixture 프로젝트를 만든다 ---
  project = mkdtempSync(join(tmpdir(), "onto-mcp-"));
  scratches.push(project);
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(
    join(project, "src", "follow.js"),
    'export function requestFollow(userId) {\n  return { userId, status: "pending" };\n}\n',
    "utf8",
  );

  const store = new SemanticStore(project);
  await store.init(initialProjectState("fixture", "mcp-fixture"));
  const index = indexProject(project, { analysisVersion: 1 });
  await store.commit("index", "index", (snapshot) => {
    snapshot.project.analysisVersion = 1;
    snapshot.evidence = index;
    return snapshot;
  });

  // --- bridge 를 별도 프로세스로 띄운다 ---
  bridge = spawn(process.execPath, [BRIDGE_ENTRY], {
    env: { ...process.env, ONTO_BRIDGE_PORT: String(PORT), ONTO_BRIDGE_TOKEN: TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridge.stderr.on("data", () => undefined);
  await waitForBridge();

  const selected = await fetch(`${BASE_URL}/api/project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: project }),
  });
  assert.equal(selected.ok, true, "프로젝트 선택에 실패했습니다");
});

after(async () => {
  bridge?.kill("SIGKILL");
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

async function withMcpClient(run) {
  // **진짜 자식 프로세스다.** bridge 의 메모리에 닿을 수 없고 loopback HTTP 로만 통한다.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_ENTRY],
    env: { ...process.env, ONTO_BRIDGE_URL: BASE_URL, ONTO_BRIDGE_TOKEN: TOKEN },
  });
  const client = new Client({ name: "onto-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function payloadOf(result) {
  const text = result.content?.[0]?.text ?? "{}";
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------

test("MCP server 가 §48 의 tool 들을 노출한다", async () => {
  const tools = await withMcpClient((client) => client.listTools());
  const names = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "get_concept_context",
    "get_evidence",
    "get_impact_context",
    "get_impact_context_batch",
    "get_project_semantic_memory",
    "get_scenario_context",
    "get_system_facts",
    "patch_analysis_bundle",
    "propose_evidence",
    "propose_system_facts",
    "search_claims",
    "submit_analysis_bundle",
    "submit_semantic_patch",
    "submit_view_ir",
  ]);
});

test("acceptance 3 (절반) — get_evidence 호출이 bridge 에 실제로 도달한다", async () => {
  const before = await (await fetch(`${BASE_URL}/api/mcp-arrivals`)).json();

  const payload = await withMcpClient(async (client) =>
    payloadOf(await client.callTool({ name: "get_evidence", arguments: { kind: "symbol" } })),
  );

  // 1. tool 이 실제 데이터를 돌려줬다 — mock 이 아니다.
  assert.ok(payload.total > 0, `evidence 가 없다: ${JSON.stringify(payload)}`);
  assert.ok(
    payload.evidence.some((item) => item.symbolId === "src/follow.js#requestFollow"),
    "fixture 의 심볼이 보이지 않는다",
  );

  // 2. **bridge-endpoint 증거원** — 별도 프로세스에서 들어온 실제 요청이 기록되었다.
  const after = await (await fetch(`${BASE_URL}/api/mcp-arrivals`)).json();
  const added = after.arrivals.slice(before.arrivals.length);
  assert.deepEqual(
    added.map((item) => item.tool),
    ["get_evidence"],
  );
});

test("digest 가 기본이고 full 은 명시적으로 요청할 때만 온다 (B6)", async () => {
  const [digest, full] = await withMcpClient(async (client) => [
    payloadOf(await client.callTool({ name: "get_project_semantic_memory", arguments: {} })),
    payloadOf(
      await client.callTool({
        name: "get_project_semantic_memory",
        arguments: { detail: "full" },
      }),
    ),
  ]);

  assert.ok(digest.counts, "digest 에 counts 가 있어야 한다");
  assert.equal(digest.evidence, undefined, "digest 에 evidence 전체가 실리면 안 된다");
  assert.ok(full.evidence, "full 에는 evidence 가 실린다");
  assert.ok(
    JSON.stringify(full).length > JSON.stringify(digest).length * 2,
    "full 이 digest 보다 훨씬 커야 한다 — 그래서 기본이 digest 다",
  );
});

test("reconcile 상태가 digest 에 실린다 (V1)", async () => {
  const digest = await withMcpClient(async (client) =>
    payloadOf(await client.callTool({ name: "get_project_semantic_memory", arguments: {} })),
  );
  assert.equal(digest.analysisVersion, 1);
  assert.equal(digest.semanticVersion, 0);
  // 코드는 인덱싱됐고 의미는 아직 없다 → 따라가지 못한 상태다.
  assert.equal(digest.reconcileCurrent, false);
});

test("get_impact_context 는 M12(schema2 §6)에서 활성화된 authored reachability다", async () => {
  const payload = await withMcpClient(async (client) =>
    payloadOf(
      await client.callTool({
        name: "get_impact_context",
        arguments: { anchor: "src/follow.js#requestFollow", direction: "downstream" },
      }),
    ),
  );
  assert.equal(payload.found, true);
  assert.equal(payload.anchor, "symbol:src/follow.js#requestFollow");
  assert.equal(payload.direction, "downstream");
  assert.ok(
    payload.nodes.some((node) => node.id === "symbol:src/follow.js#requestFollow" && node.hop === 0),
    `anchor 자신이 hop 0으로 나와야 한다: ${JSON.stringify(payload.nodes)}`,
  );
  // impact/인과가 아니라 authored reachability임을 응답 자체가 밝힌다.
  assert.match(payload.note, /authored reachability/);
});

test("get_impact_context 는 찾을 수 없는 anchor에 대해 found:false를 준다 (아무것도 안 지어낸다)", async () => {
  const payload = await withMcpClient(async (client) =>
    payloadOf(
      await client.callTool({
        name: "get_impact_context",
        arguments: { anchor: "src/없음.js#없음", direction: "downstream" },
      }),
    ),
  );
  assert.equal(payload.found, false);
});

test("토큰이 없으면 bridge 가 거부한다", async () => {
  const response = await fetch(`${BASE_URL}/internal/memory`);
  assert.equal(response.status, 401);
});

test("아직 분석하지 않은 프로젝트에서도 tool 이 죽지 않고 next_step 을 준다 (C5)", async () => {
  const empty = mkdtempSync(join(tmpdir(), "onto-empty-"));
  scratches.push(empty);
  await fetch(`${BASE_URL}/api/project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: empty }),
  });

  const payload = await withMcpClient(async (client) =>
    payloadOf(await client.callTool({ name: "get_project_semantic_memory", arguments: {} })),
  );
  assert.equal(payload.error, "memory_unavailable");
  assert.equal(payload.reason, "not_indexed");
  assert.ok(payload.next_step.includes("분석"), "사용자가 무엇을 해야 하는지 말해야 한다");

  // 원래 프로젝트로 되돌린다.
  await fetch(`${BASE_URL}/api/project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: project }),
  });
});

test("bridge 가 죽어 있으면 tool 이 throw 하지 않고 읽을 수 있는 오류를 준다 (C5)", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_ENTRY],
    env: { ...process.env, ONTO_BRIDGE_URL: "http://127.0.0.1:1", ONTO_BRIDGE_TOKEN: TOKEN },
  });
  const client = new Client({ name: "onto-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    const payload = payloadOf(
      await client.callTool({ name: "get_project_semantic_memory", arguments: {} }),
    );
    // throw 하면 transport 가 닫히고 클라이언트에는 -32000 만 남는다. 그래서 payload 로 준다.
    assert.equal(payload.error, "bridge_unreachable");
    assert.ok(payload.next_step.includes("bridge"));
  } finally {
    await client.close();
  }
});
