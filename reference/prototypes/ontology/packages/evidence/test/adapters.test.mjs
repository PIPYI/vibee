/**
 * M2 — P2 framework adapters + P3 git_change (implementation_plan §6.2).
 *
 * P2가 있어야 ScenarioStep과 StateChange에 붙일 **실제 근거**가 생긴다. 그것이 이 단계의
 * 존재 이유이므로, "route가 잡히는가"만이 아니라 **route → handler → model 이 Trace로
 * 이어지는가**까지 본다.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { projectTrace } from "@onto/core";
import { changedFilesSince, dirtyFiles, indexProject } from "@onto/evidence";

const roots = [];
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function scratch(files) {
  const root = mkdtempSync(join(tmpdir(), "onto-ad-"));
  roots.push(root);
  write(root, files);
  return root;
}

function write(root, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = join(root, relPath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
}

const SCHEMA = `datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model FollowRequest {
  id     String @id
  status String
}

model User {
  id   String @id
  name String
}
`;

const SERVICE = `import { prisma } from "./client.js";

export async function requestFollow(fromId, toId) {
  return prisma.followRequest.create({ data: { fromId, toId, status: "pending" } });
}

export async function listRequests(userId) {
  return prisma.followRequest.findMany({ where: { toId: userId } });
}
`;

const CLIENT = `export const prisma = {};
`;

const ROUTE = `import { requestFollow } from "../../../src/services/follow.js";

export async function POST(request) {
  const body = await request.json();
  return requestFollow(body.fromId, body.toId);
}
`;

const COMPONENT = `import { requestFollow } from "../services/follow.js";

export function FollowButton(props) {
  return <button onClick={() => requestFollow(props.from, props.to)}>팔로우</button>;
}
`;

const FIXTURE = {
  "prisma/schema.prisma": SCHEMA,
  "src/services/client.js": CLIENT,
  "src/services/follow.js": SERVICE,
  "app/api/follow/route.js": ROUTE,
  "src/components/FollowButton.jsx": COMPONENT,
  "package.json": '{\n  "name": "fixture"\n}\n',
};

const kindsOf = (index) => {
  const counts = {};
  for (const item of index.evidence) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
};

// ---------------------------------------------------------------------------

test("P2 — route / api_handler 가 Next App Router 에서 잡힌다", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });

  const routes = index.evidence.filter((item) => item.kind === "route");
  assert.deepEqual(
    routes.map((item) => item.graph.entity.routeKey),
    ["POST /api/follow"],
  );

  const handlers = index.evidence.filter((item) => item.kind === "api_handler");
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].graph.from.routeKey, "POST /api/follow");
  assert.equal(handlers[0].graph.to.symbolId, "app/api/follow/route.js#POST");
});

test("P2 — 동적 세그먼트와 route group 이 URL 규칙대로 변환된다", () => {
  const root = scratch({
    ...FIXTURE,
    "app/(marketing)/api/users/[id]/route.js": `export async function GET() {
  return null;
}
`,
  });
  const index = indexProject(root, { analysisVersion: 1 });
  const keys = index.evidence
    .filter((item) => item.kind === "route")
    .map((item) => item.graph.entity.routeKey)
    .sort();

  // route group `(marketing)` 은 URL 에 나타나지 않는다. `[id]` 는 `:id` 가 된다.
  assert.deepEqual(keys, ["GET /api/users/:id", "POST /api/follow"]);
});

test("P2 — prisma 모델과 read/write 가 구별되어 잡힌다", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });

  const models = index.evidence.filter((item) => item.kind === "db_entity");
  assert.deepEqual(
    models.map((item) => item.graph.entity.modelKey).sort(),
    ["prisma:FollowRequest", "prisma:User"],
  );

  const writes = index.evidence.filter((item) => item.kind === "db_write");
  const reads = index.evidence.filter((item) => item.kind === "db_read");

  assert.equal(writes.length, 1, "create 는 쓰기다");
  assert.equal(writes[0].graph.from.symbolId, "src/services/follow.js#requestFollow");
  assert.equal(writes[0].graph.to.modelKey, "prisma:FollowRequest");

  assert.equal(reads.length, 1, "findMany 는 읽기다");
  assert.equal(reads[0].graph.from.symbolId, "src/services/follow.js#listRequests");
});

test("P2 — JSX 이벤트가 컴포넌트에서 핸들러로 이어진다", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });

  const events = index.evidence.filter((item) => item.kind === "ui_event");
  assert.equal(events.length, 1);
  assert.equal(events[0].graph.from.symbolId, "src/components/FollowButton.jsx#FollowButton");
  assert.equal(events[0].graph.to.symbolId, "src/services/follow.js#requestFollow");
});

test("P2 — config evidence 는 graph 가 없어 Trace 에 나오지 않는다 (T2)", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });

  const config = index.evidence.find((item) => item.kind === "config");
  assert.ok(config, "package.json 이 config evidence 가 되어야 한다");
  assert.equal(config.graph, undefined, "가리킬 대상이 없으므로 순회 대상이 아니다");
  // 그래도 grounding 은 된다 — id 가 있고 present 다.
  assert.equal(config.status, "present");
});

test("P2 — adapter 실패는 조용히 사라지지 않는다", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });
  // 이 fixture 는 정상이므로 report 가 비어야 한다. 비지 않으면 무엇이 실패했는지 보인다.
  assert.deepEqual(index.adapterReport, [], JSON.stringify(index.adapterReport, null, 2));
});

test("evidence id 는 중복되지 않는다", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });
  const ids = index.evidence.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort());
});

// ---------------------------------------------------------------------------
// P2 가 실제로 값을 만드는 지점 — Trace 가 route 에서 model 까지 이어진다
// ---------------------------------------------------------------------------

test("Trace 가 route → handler → service → model 로 이어진다", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });

  const ir = projectTrace(index, { kind: "symbol", symbolId: "app/api/follow/route.js#POST" }, {
    hops: 3,
  });

  const ids = ir.codeEntities.map((entity) => entity.id);
  assert.ok(ids.includes("route:POST /api/follow"), "route 가 보여야 한다");
  assert.ok(ids.includes("symbol:src/services/follow.js#requestFollow"), "서비스가 보여야 한다");
  assert.ok(ids.includes("model:prisma:FollowRequest"), "모델이 보여야 한다");

  // 링크의 방향은 코드에 있는 그대로다.
  const dbWrite = ir.links.find((link) => link.kind === "db_write");
  assert.ok(dbWrite, "db_write 링크가 있어야 한다");
  assert.equal(dbWrite.fromId, "symbol:src/services/follow.js#requestFollow");
  assert.equal(dbWrite.toId, "model:prisma:FollowRequest");

  // 같은 모델을 schema.prisma 도 contains 로 가리킨다 — 서로 다른 종류의 근거다.
  const contains = ir.links.find(
    (link) => link.kind === "contains" && link.toId === "model:prisma:FollowRequest",
  );
  assert.equal(contains.fromId, "file:prisma/schema.prisma");

  // 결정론 (acceptance 12) — 실제 인덱스에서도 성립해야 한다.
  const again = projectTrace(index, { kind: "symbol", symbolId: "app/api/follow/route.js#POST" }, {
    hops: 3,
  });
  assert.equal(JSON.stringify(again), JSON.stringify(ir));
});

test("Trace 의 모든 링크 끝점이 실재 entity 다 (acceptance 14, 실제 인덱스)", () => {
  const root = scratch(FIXTURE);
  const index = indexProject(root, { analysisVersion: 1 });
  const ir = projectTrace(index, { kind: "file", filePath: "src/services/follow.js" }, { hops: 4 });

  const ids = new Set(ir.codeEntities.map((entity) => entity.id));
  assert.ok(ids.size > 0);
  for (const link of ir.links) {
    assert.ok(ids.has(link.fromId), `from 이 노드 집합에 없다: ${link.fromId}`);
    assert.ok(ids.has(link.toId), `to 가 노드 집합에 없다: ${link.toId}`);
  }
});

// ---------------------------------------------------------------------------
// P3
// ---------------------------------------------------------------------------

function git(root, ...args) {
  execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
}

test("P3 — git_change 가 변경된 파일에 붙고, dirtyFiles 가 내용 동일 파일을 걸러낸다", () => {
  const root = scratch(FIXTURE);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "first");

  const before = indexProject(root, { analysisVersion: 1 });

  write(root, {
    "src/services/follow.js": SERVICE.replace('status: "pending"', 'status: "accepted"'),
  });

  const after = indexProject(root, { analysisVersion: 2, gitBase: "HEAD" });
  const changes = after.evidence.filter((item) => item.kind === "git_change");

  assert.equal(changes.length, 1);
  assert.equal(changes[0].filePath, "src/services/follow.js");
  assert.equal(changes[0].graph, undefined, "변경 사실은 코드 그래프 상의 위치가 아니다");

  const listed = changedFilesSince(root, "HEAD");
  assert.equal(listed.ok, true);
  assert.deepEqual(
    dirtyFiles(listed.changes, after.fileHashes, before.fileHashes),
    ["src/services/follow.js"],
  );
});

test("P3 — 내용이 같으면 git 이 변경이라 해도 dirty 가 아니다 (C2)", () => {
  const root = scratch(FIXTURE);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "first");

  const before = indexProject(root, { analysisVersion: 1 });
  // 썼다가 되돌린다 — git 은 변경을 보고하지 않지만, 보고하더라도 해시가 같으면 걸러진다.
  const fabricated = [{ path: "src/services/follow.js", status: "M" }];
  const after = indexProject(root, { analysisVersion: 2 });

  assert.deepEqual(dirtyFiles(fabricated, after.fileHashes, before.fileHashes), []);
});

test("P3 — git 이 실패하면 조용히 넘어가지 않고 report 에 남는다", () => {
  const root = scratch(FIXTURE); // git 저장소가 아니다
  const index = indexProject(root, { analysisVersion: 1, gitBase: "HEAD~1" });

  assert.equal(index.evidence.filter((item) => item.kind === "git_change").length, 0);
  const complaint = index.adapterReport.find((entry) => entry.adapterId === "p3-git");
  assert.ok(complaint, "git 실패가 report 에 없다 — 조용한 성공이다");
  assert.equal(complaint.level, "warning");
});

test("P2/P3 를 더해도 인덱싱은 결정론이다", () => {
  const root = scratch(FIXTURE);
  const first = indexProject(root, { analysisVersion: 1 });
  const second = indexProject(root, { analysisVersion: 1 });
  assert.equal(JSON.stringify(second), JSON.stringify(first));

  const counts = kindsOf(first);
  // 이 fixture 가 실제로 P0~P2 를 모두 덮는지 확인한다 — 덮지 않으면 위 시험들이 헛돈다.
  for (const kind of ["file", "symbol", "contains", "call", "route", "api_handler", "ui_event", "db_entity", "db_read", "db_write", "config"]) {
    assert.ok(counts[kind] > 0, `${kind} evidence 가 하나도 없다: ${JSON.stringify(counts)}`);
  }
});
