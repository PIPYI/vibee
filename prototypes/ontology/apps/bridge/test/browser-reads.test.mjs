/**
 * `GET /api/memory` · `GET /api/evidence` — 브라우저용 읽기 (implementation_plan §6.10, M7).
 *
 * `/internal/*`와 같은 데이터를 쓰지만 **토큰이 필요 없다** — 그 가드는 MCP server 전용
 * 경계(B1)이지 브라우저를 막으려는 것이 아니다. 여기서는 토큰 헤더 없이 진짜 HTTP로
 * 확인한다.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ONTO_BUILD_ID, ONTO_PROTOCOL_VERSION } from "@onto/protocol";

const PORT = 43924;
process.env.ONTO_BRIDGE_PORT = String(PORT);
process.env.ONTO_BRIDGE_TOKEN = "browser-reads-token-0123456789abcdef";

const BASE_URL = `http://127.0.0.1:${PORT}`;

const { app, state } = await import("../dist/index.js");
const server = createServer(app);

const scratches = [];

before(async () => {
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

function freshProject() {
  const dir = mkdtempSync(join(tmpdir(), "onto-browser-reads-"));
  scratches.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "follow.js"),
    'export async function requestFollow(fromId, toId) {\n  return { fromId, toId, status: "pending" };\n}\n',
    "utf8",
  );
  return dir;
}

async function get(path) {
  // 의도적으로 토큰 헤더를 붙이지 않는다 — 브라우저는 이 헤더를 모른다.
  const response = await fetch(`${BASE_URL}${path}`);
  return { status: response.status, body: await response.json() };
}

async function post(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// ---------------------------------------------------------------------------

test("V3.2 health handshake가 실행 identity를 공개하고 오래된 Web 요청을 차단한다", async () => {
  const health = await get("/api/health");
  assert.equal(health.body.runtime.protocolVersion, ONTO_PROTOCOL_VERSION);
  assert.equal(health.body.runtime.buildId, ONTO_BUILD_ID);
  assert.ok(health.body.runtime.serverStartedAt);

  const incompatible = await post("/api/analyze", { agent: "claude", projectPath: "/tmp" });
  assert.equal(incompatible.status, 409);
  assert.equal(incompatible.body.code, "runtime/incompatible-client");
});

test("GET /api/memory — 아직 인덱싱하지 않은 프로젝트는 memory_unavailable을 돌려준다 (C5)", async () => {
  const dir = freshProject();
  state.setProjectPath(dir);
  const { body } = await get("/api/memory");
  assert.equal(body.error, "memory_unavailable");
  assert.equal(body.reason, "not_indexed");
});

test("GET /api/memory · GET /api/evidence — 토큰 없이도 인덱싱된 프로젝트를 읽을 수 있다", async () => {
  const dir = freshProject();
  await post("/api/index", { projectPath: dir });

  const digest = await get("/api/memory");
  assert.equal(digest.status, 200);
  assert.ok(digest.body.counts, JSON.stringify(digest.body));

  const full = await get("/api/memory?detail=full");
  assert.equal(full.status, 200);
  assert.ok(Array.isArray(full.body.memory.concepts));

  const evidence = await get("/api/evidence?kind=symbol");
  assert.equal(evidence.status, 200);
  assert.ok(evidence.body.total > 0, JSON.stringify(evidence.body));
  const symbol = evidence.body.evidence.find((item) => item.symbolId === "src/follow.js#requestFollow");
  assert.ok(symbol, "requestFollow 심볼이 보여야 한다");
  // 엔진이 만든 evidence다 — relocationConfidence는 agent evidence에만 붙는다.
  assert.equal(symbol.origin, "engine");
});

test("GET /api/evidence — includeSource=true면 실제 소스 발췌를 함께 준다", async () => {
  const dir = freshProject();
  await post("/api/index", { projectPath: dir });
  const { body } = await get("/api/evidence?kind=symbol&includeSource=true");
  const symbol = body.evidence.find((item) => item.symbolId === "src/follow.js#requestFollow");
  assert.match(symbol.source, /requestFollow/u);
});

test("GET /api/evidence — 두 번째 재인덱싱에서 relocated/contentChange가 최근 diff로 채워진다", async () => {
  const dir = freshProject();
  await post("/api/index", { projectPath: dir });
  const before = await get("/api/evidence?kind=symbol");
  const evidenceId = before.body.evidence.find((item) => item.symbolId === "src/follow.js#requestFollow").id;

  // 본문 의미를 바꾼다 — modified로 잡혀야 한다 (T1).
  writeFileSync(
    join(dir, "src", "follow.js"),
    'export async function requestFollow(fromId, toId) {\n  return { fromId, toId, status: "accepted" };\n}\n',
    "utf8",
  );
  await post("/api/index", { projectPath: dir });

  const after = await get(`/api/evidence?ids=${evidenceId}`);
  const item = after.body.evidence[0];
  assert.equal(item.id, evidenceId);
  assert.equal(item.contentChange, "modified");
  assert.equal(item.relocated, false);
});
