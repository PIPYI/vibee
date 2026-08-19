#!/usr/bin/env node
/**
 * acceptance test가 대상으로 삼는 일회용 fixture 프로젝트를 만든다.
 * 첫 실행을 실제 저장소에 대고 하지 않는다 (문서 §18).
 *
 * 기본 위치는 spike 디렉터리 안의 `tmp/fixture`다. `/tmp` 아래가 아니라 여기에 두는 이유는
 * 재부팅으로 사라지지 않고, 프로토타입과 같이 움직이기 때문이다. `tmp/`는 gitignore 되어 있다.
 *
 * fixture는 자체 git 저장소로 초기화한다. 상위 저장소(vibe-coding-assistant)와 분리해야
 * agent가 실행하는 `git status` / `git diff`가 상위 저장소를 건드리지 않고 fixture만 본다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fixtureDir } from "./_shared.mjs";

const dir = process.argv[2] ?? (await fixtureDir());

/**
 * 디렉터리를 지웠다 다시 만들지 않고 **파일 내용만 덮어쓴다.**
 *
 * Bridge는 프로젝트 경로당 thread 하나를 재사용하고, 그 thread의 cwd는 이 디렉터리다.
 * rm -rf 후 재생성하면 같은 경로에 다른 inode가 생기고, 이미 열려 있던 thread는 삭제된
 * 예전 디렉터리를 계속 cwd로 들고 있게 된다. 그 상태에서는 agent의 apply_patch가
 * 성공했다고 보고해도 실제 파일에는 반영되지 않는다.
 */
mkdirSync(dir, { recursive: true });

writeFileSync(join(dir, "README.md"), "# Spike Fixture\n\nOriginal content.\n");
writeFileSync(join(dir, "hello.js"), 'console.log("hello from the byoa spike fixture");\n');

// 상위 저장소로부터 격리한다. 실패해도 fixture 자체는 쓸 수 있으므로 치명적이지 않다.
let gitReady = false;
try {
  const git = (args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  if (!existsSync(join(dir, ".git"))) {
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "spike@example.invalid"]);
    git(["config", "user.name", "BYOA Spike Fixture"]);
  }
  // 초기 상태를 항상 하나의 커밋으로 맞춘다. agent가 실행하는 git diff의 기준점이 된다.
  git(["add", "-A"]);
  git(["commit", "-q", "--allow-empty", "-m", "Initial fixture state"]);
  gitReady = true;
} catch {
  // git이 없거나 실패한 경우: fixture는 그대로 쓰되 격리되지 않았음을 알린다.
}

console.log(`Fixture ready at ${dir}`);
console.log("  README.md");
console.log("  hello.js");
console.log(gitReady ? "  (독립 git 저장소로 초기화됨)" : "  (git 초기화 실패 — 상위 저장소와 분리되지 않음)");
