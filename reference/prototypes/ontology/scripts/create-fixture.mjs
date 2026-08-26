#!/usr/bin/env node
/**
 * 검증용 fixture 프로젝트를 만든다.
 *
 * 작고, P0~P2 를 전부 덮고, 도메인 용어가 분명한 것이 목적이다 — agent 가 무엇을 봤는지
 * 사람이 눈으로 채점할 수 있어야 한다.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

/**
 * 같은 fixture 내용을 임의 디렉터리에 써넣는다 (§7.3 — agent-first/index-only 두 arm이
 * **같은 fixture**를 각자 독립된 프로젝트로 받아야 하므로 `FIXTURE_DIR` 하나로는 부족하다).
 */
export function writeFixtureTo(dir) {
  rmSync(dir, { recursive: true, force: true });
  for (const [relPath, content] of Object.entries(FILES)) {
    const absolute = join(dir, relPath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  try {
    execFileSync("git", ["-C", dir, "init", "-q"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "config", "user.email", "fixture@example.com"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "config", "user.name", "onto fixture"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "pipe" });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "fixture"], { stdio: "pipe" });
  } catch (error) {
    console.error(`git 초기화를 건너뜁니다: ${error.message}`);
  }
}

// 이 파일이 스크립트로 직접 실행될 때만 FIXTURE_DIR 에 쓴다 — writeFixtureTo 를 import 만
// 하는 다른 스크립트(§7.3 비교 arm)가 side effect 로 FIXTURE_DIR 을 건드리면 안 된다.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  writeFixtureTo(FIXTURE_DIR);
  console.log(FIXTURE_DIR);
}
