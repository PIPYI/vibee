#!/usr/bin/env node
/**
 * 아키텍처·기술부채 검증용 fixture (docs/product_flow_decisions.md 질문 5).
 *
 * 세 검출 대상을 각각 하나씩, 근거를 명확히 확인할 수 있는 형태로 심는다.
 *
 *   1. 파일 비대화       — src/app.js 하나가 회원·책·대출 세 책임을 전부 처리한다
 *   2. 의미가 같은 로직 중복 — normalizeMemberName(member.js) / cleanBorrowerLabel(borrower.js)
 *   3. 방치된 임시 조치   — store.js의 TODO가 첫 커밋에 있고, 그 뒤로 커밋이 계속 쌓인다
 *
 * 설계 단위 이름을 영문(Member/Book/Loan)으로 둔 이유는 `matchedDesignIds`가 파일
 * 경로·본문에서 그 이름을 그대로 찾는 substring match이기 때문이다 — 한글 ENTITY 이름은
 * 영문 식별자(registerMember 등) 안에서 찾을 수 없어 매핑이 비게 된다.
 *
 * 인계가 끝난 프로젝트를 흉내내므로 `.project-intel/design.json`이 이미 있다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { spikeRoot } from "./_shared.mjs";

export const architectureFixtureDir = join(spikeRoot, "tmp", "architecture-fixture");
/** design.json 없이 "기존 코드베이스를 여는" 진입 경로를 흉내내는 변형. */
export const architectureNoDesignFixtureDir = join(spikeRoot, "tmp", "architecture-fixture-no-design");

const DESIGN = {
  title: "Neighborhood Library",
  summary: "Neighbors list books and lend them to one another.",
  actors: [{ id: "ACTOR-1", name: "Member" }],
  reqs: [
    { id: "REQ-1", name: "Register member", source: "user" },
    { id: "REQ-2", name: "List book", source: "user" },
    { id: "REQ-3", name: "Borrow book", source: "user" },
  ],
  surfaces: [],
  entities: [
    { id: "ENT-1", name: "Member", relations: [], states: [], source: "user" },
    { id: "ENT-2", name: "Book", relations: ["ENT-1이 소유한다"], states: ["available", "borrowed"], source: "user" },
    { id: "ENT-3", name: "Loan", relations: ["ENT-1과 ENT-2를 연결한다"], states: ["open", "returned"], source: "user" },
  ],
  flows: [],
  rules: [],
  decisions: [],
};

const BASE_FILES = {
  "package.json": JSON.stringify(
    { name: "neighborhood-library-fixture", private: true, type: "module", scripts: { test: "node --test" } },
    null,
    2,
  ) + "\n",
  // 임시 조치 마커. 첫 커밋에 넣어 두고 그 뒤에 다른 커밋을 쌓아 "방치됐다"는 근거를 만든다.
  "src/store.js": `// TODO: temporary in-memory store; replace after the first validation round.
export const members = new Map();
export const books = new Map();
export const loans = new Map();

export const nextIds = {
  member: 1,
  book: 1,
  loan: 1,
};
`,
  // 의미가 같은 정규화 로직을 서로 다른 이름·파일로 중복시킨다.
  "src/member.js": `import { members, nextIds } from "./store.js";

export function normalizeMemberName(name) {
  return name.trim().toLowerCase().replace(/\\s+/g, " ");
}

export function registerMember(name) {
  const member = { id: nextIds.member++, name, key: normalizeMemberName(name) };
  members.set(member.id, member);
  return member;
}
`,
  "src/borrower.js": `import { members } from "./store.js";

export function cleanBorrowerLabel(label) {
  return label.trim().toLowerCase().replace(/\\s+/g, " ");
}

export function findBorrower(label) {
  const key = cleanBorrowerLabel(label);
  return [...members.values()].find((member) => member.key === key) ?? null;
}
`,
  // 회원·책·대출 세 책임이 전부 한 파일에 쌓인 상태. ENTITY 이름이 그대로 등장해야
  // matchedDesignIds가 채워진다.
  "src/app.js": `import { books, loans, members, nextIds } from "./store.js";

export function registerMember(name) {
  const member = { id: nextIds.member++, name };
  members.set(member.id, member);
  return member;
}

export function removeMember(memberId) {
  if ([...loans.values()].some((loan) => loan.memberId === memberId && loan.state === "open")) {
    throw new Error("Member has an open Loan");
  }
  return members.delete(memberId);
}

export function listBook(ownerId, title) {
  if (!members.has(ownerId)) throw new Error("Member not found");
  const book = { id: nextIds.book++, ownerId, title, state: "available" };
  books.set(book.id, book);
  return book;
}

export function renameBook(ownerId, bookId, title) {
  const book = books.get(bookId);
  if (!book || book.ownerId !== ownerId) throw new Error("Book not found");
  book.title = title;
  return book;
}

export function removeBook(ownerId, bookId) {
  const book = books.get(bookId);
  if (!book || book.ownerId !== ownerId || book.state !== "available") return false;
  return books.delete(bookId);
}

export function searchBooks(term) {
  const keyword = term.trim().toLowerCase();
  return [...books.values()].filter((book) => book.title.toLowerCase().includes(keyword));
}

export function borrowBook(memberId, bookId) {
  const member = members.get(memberId);
  const book = books.get(bookId);
  if (!member || !book || book.state !== "available") throw new Error("Borrow unavailable");
  const loan = { id: nextIds.loan++, memberId, bookId, state: "open" };
  loans.set(loan.id, loan);
  book.state = "borrowed";
  return loan;
}

export function returnBook(memberId, loanId) {
  const loan = loans.get(loanId);
  if (!loan || loan.memberId !== memberId || loan.state !== "open") return false;
  loan.state = "returned";
  const book = books.get(loan.bookId);
  if (book) book.state = "available";
  return true;
}

export function memberDashboard(memberId) {
  return {
    member: members.get(memberId) ?? null,
    ownedBooks: [...books.values()].filter((book) => book.ownerId === memberId),
    openLoans: [...loans.values()].filter((loan) => loan.memberId === memberId && loan.state === "open"),
  };
}
`,
  "src/app.test.js": `import assert from "node:assert/strict";
import test from "node:test";

import { listBook, registerMember, searchBooks } from "./app.js";

test("a member can list and find a book", () => {
  const member = registerMember("Kim");
  listBook(member.id, "Refactoring");
  assert.equal(searchBooks("factor").length, 1);
});
`,
  ".project-intel/design.json": JSON.stringify(DESIGN, null, 2) + "\n",
};

export function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(dir, path, content) {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

/**
 * 세 증상을 심은 프로젝트를 만든다. 첫 커밋에 TODO를 포함해 두고, 그 뒤로 다섯 커밋을
 * 더 쌓아 "방치됐다"의 근거(`commitsSince`)를 만든다. 각 후속 커밋은 검출 대상과
 * 무관한 노트 파일만 건드려 findings 개수에 영향을 주지 않는다.
 *
 * `withDesign: false`면 `.project-intel/design.json`을 빼서, 인터뷰를 거치지 않고
 * "기존 코드베이스를 여는" 진입 경로(`docs/product_flow_decisions.md` "프로젝트 진입
 * 경로")를 흉내낸다 — oversized-module이 REQ/ENTITY 없이 코드만 보고도 판단되는지 보는
 * 데 쓴다.
 */
export function createArchitectureFixture(dir = architectureFixtureDir, { withDesign = true } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  for (const [path, content] of Object.entries(BASE_FILES)) {
    if (!withDesign && path === ".project-intel/design.json") continue;
    write(dir, path, content);
  }

  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "spike@example.invalid"]);
  git(dir, ["config", "user.name", "BYOA Architecture Fixture"]);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "Seed temporary store and core flows"]);

  const notes = ["Add book search", "Add borrowing", "Add returns", "Add member dashboard", "Polish validation"];
  for (const message of notes) {
    write(dir, "NOTES.md", `${message}\n`);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", message]);
  }

  return dir;
}

/**
 * 구조 점검이 **소스나 설계를** 건드렸는지. `.project-intel/architecture.{json,md}`에
 * 결과를 쓰는 것은 bridge가 하는 정상 동작이지 agent가 파일을 고친 것이 아니다.
 *
 * `--untracked-files=all`을 쓴다 — design.json이 없는 변형에서는 `.project-intel/`
 * 자체가 처음 생기는 디렉터리라, 기본 옵션이면 git이 그 안을 펼치지 않고
 * `?? .project-intel/` 한 줄로 뭉뚱그려 실제로 무엇이 생겼는지 가려 버린다.
 */
export function isSourceClean(dir) {
  return git(dir, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
    .every((path) => path.startsWith(".project-intel/architecture."));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = createArchitectureFixture();
  console.log(`Architecture fixture ready at ${dir}`);
  if (!existsSync(join(dir, ".project-intel", "design.json"))) throw new Error("design.json이 만들어지지 않았습니다");
}
