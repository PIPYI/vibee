#!/usr/bin/env node
/**
 * 검증용 fixture 프로젝트를 만든다.
 *
 * 작고, P0~P2 를 전부 덮고, 도메인 용어가 분명한 것이 목적이다 — agent 가 무엇을 봤는지
 * 사람이 눈으로 채점할 수 있어야 한다.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURE_DIR } from "./_shared.mjs";

const FILES = {
  "package.json": JSON.stringify({ name: "onto-fixture", private: true, type: "module" }, null, 2) + "\n",
  "prisma/schema.prisma": `datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model User {
  id      String @id
  name    String
  private Boolean @default(false)
}

model FollowRequest {
  id     String @id
  fromId String
  toId   String
  status String
}

model Follow {
  id     String @id
  fromId String
  toId   String
}
`,
  "src/db.js": `export const prisma = {};
`,
  "src/services/follow.js": `import { prisma } from "../db.js";

/** 비공개 계정을 팔로우하면 바로 관계가 생기지 않고 승인을 기다린다. */
export async function requestFollow(fromId, toId) {
  const target = await prisma.user.findUnique({ where: { id: toId } });
  if (target.private) {
    return prisma.followRequest.create({
      data: { fromId, toId, status: "pending" },
    });
  }
  return prisma.follow.create({ data: { fromId, toId } });
}

export async function approveFollowRequest(requestId) {
  const request = await prisma.followRequest.update({
    where: { id: requestId },
    data: { status: "approved" },
  });
  return prisma.follow.create({ data: { fromId: request.fromId, toId: request.toId } });
}

export async function listPendingRequests(userId) {
  return prisma.followRequest.findMany({ where: { toId: userId, status: "pending" } });
}
`,
  "app/api/follow/route.js": `import { requestFollow } from "../../../src/services/follow.js";

export async function POST(request) {
  const body = await request.json();
  return requestFollow(body.fromId, body.toId);
}
`,
  "app/api/follow/requests/[id]/route.js": `import { approveFollowRequest } from "../../../../../src/services/follow.js";

export async function PATCH(request, context) {
  return approveFollowRequest(context.params.id);
}
`,
  "src/components/FollowButton.jsx": `import { requestFollow } from "../services/follow.js";

export function FollowButton(props) {
  return <button onClick={() => requestFollow(props.fromId, props.toId)}>팔로우</button>;
}
`,
  "src/components/RequestList.jsx": `import { approveFollowRequest } from "../services/follow.js";

export function RequestList(props) {
  return (
    <ul>
      {props.requests.map((request) => (
        <li key={request.id}>
          <button onClick={() => approveFollowRequest(request.id)}>수락</button>
        </li>
      ))}
    </ul>
  );
}
`,
};

rmSync(FIXTURE_DIR, { recursive: true, force: true });
for (const [relPath, content] of Object.entries(FILES)) {
  const absolute = join(FIXTURE_DIR, relPath);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

// git 저장소로 만들어 둔다 — P3(git_change)와 증분 경로를 시험할 수 있어야 한다.
try {
  execFileSync("git", ["-C", FIXTURE_DIR, "init", "-q"], { stdio: "pipe" });
  execFileSync("git", ["-C", FIXTURE_DIR, "config", "user.email", "fixture@example.com"], { stdio: "pipe" });
  execFileSync("git", ["-C", FIXTURE_DIR, "config", "user.name", "onto fixture"], { stdio: "pipe" });
  execFileSync("git", ["-C", FIXTURE_DIR, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", FIXTURE_DIR, "commit", "-q", "-m", "fixture"], { stdio: "pipe" });
} catch (error) {
  console.error(`git 초기화를 건너뜁니다: ${error.message}`);
}

console.log(FIXTURE_DIR);
