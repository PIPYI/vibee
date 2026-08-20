#!/usr/bin/env node
/**
 * fixture 경로(`tmp/fixture`)에서 만들어진, 더 이상 쓰지 않는 Codex/Claude 세션 파일을 지운다.
 *
 * 사용자가 Project Path를 자기 실제 프로젝트로 바꿔 실행한 세션은 그 사람의 진짜 작업
 * 이력과 같은 저장소를 공유하므로 건드리지 않는다. 판별 기준은 디렉터리 이름 유추가 아니라
 * 각 세션 파일 첫 줄의 `cwd`가 fixture 경로와 정확히 일치하는지다 (SPIKE_FINDINGS.md §7).
 *
 * Bridge가 떠 있는 동안 지우면 사용 중인 thread/session을 건드릴 수 있으므로, bridge가
 * 응답하면 먼저 종료하라고 안내하고 중단한다.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { bridgeConfig, fixtureDir } from "./_shared.mjs";

/** cwd를 찾기 위해 훑을 최대 줄 수. Claude는 첫 줄에 cwd가 없어 몇 줄 더 봐야 한다. */
const MAX_SCANNED_LINES = 50;

const fixture = await fixtureDir();
const config = await bridgeConfig();

const bridgeAlive = await fetch(`${config.baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) }).then(
  () => true,
  () => false,
);
if (bridgeAlive) {
  console.error(`Bridge가 ${config.baseUrl}에서 실행 중입니다. 먼저 종료한 뒤 다시 실행하세요.`);
  process.exit(1);
}

const roots = [
  { label: "Codex", dir: join(homedir(), ".codex", "sessions") },
  { label: "Claude", dir: join(homedir(), ".claude", "projects") },
];

console.log(`fixture 경로: ${fixture}\n`);

let totalDeleted = 0;

for (const { label, dir } of roots) {
  if (!existsSync(dir)) {
    console.log(`${label}: ${dir} 없음 — 건너뜀`);
    continue;
  }

  const files = walk(dir).filter((file) => file.endsWith(".jsonl"));
  const targets = files.filter((file) => sessionCwd(file) === fixture);

  console.log(`${label}: fixture 세션 ${targets.length}개 (전체 ${files.length}개 중)`);
  for (const file of targets) {
    console.log(`  삭제: ${file}`);
    rmSync(file);
    totalDeleted += 1;
  }
}

console.log(`\n총 ${totalDeleted}개 삭제됨.`);

/**
 * 세션이 어느 디렉터리에서 실행되었는지 읽는다. 두 CLI의 기록 위치가 다르다.
 *
 *   Codex  : 첫 줄 `session_meta`의 `payload.cwd`
 *   Claude : 앞쪽 대화 줄(type: user/assistant)의 `cwd` — 첫 줄에는 없다
 *
 * 어느 쪽도 못 찾으면 null을 반환해 삭제 대상에서 제외한다(모르면 지우지 않는다).
 */
function sessionCwd(file) {
  let lines;
  try {
    lines = readFileSync(file, "utf8").split("\n", MAX_SCANNED_LINES);
  } catch {
    return null;
  }

  for (const line of lines) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const cwd = entry.cwd ?? entry.payload?.cwd;
    if (typeof cwd === "string") return cwd;
  }
  return null;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
