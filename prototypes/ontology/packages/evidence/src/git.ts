/**
 * P3 — git_change (implementation_plan §6.2).
 *
 * `git diff --name-status <base>..HEAD` ∩ contentHash 불일치.
 * git이 modified라고 해도 **바이트가 같으면 제외한다** (C2) — 그러지 않으면 공백 정리
 * 커밋 하나에 dirty 집합이 부풀고, 그것이 §46이 실패로 규정한 churn이다.
 */
import { spawnSync } from "node:child_process";

export type GitChange = {
  path: string;
  /** git의 name-status 코드. A=added, M=modified, D=deleted, R=renamed */
  status: string;
};

function git(projectRoot: string, args: string[]): { ok: boolean; stdout: string; message: string } {
  const result = spawnSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) return { ok: false, stdout: "", message: String(result.error.message) };
  if (result.status !== 0) {
    return { ok: false, stdout: "", message: (result.stderr || "").trim() || `exit ${result.status}` };
  }
  return { ok: true, stdout: result.stdout, message: "" };
}

export function isGitRepository(projectRoot: string): boolean {
  return git(projectRoot, ["rev-parse", "--git-dir"]).ok;
}

/**
 * `base`와 작업 트리 사이에 git이 바뀌었다고 보는 파일들.
 *
 * git이 없거나 base가 없으면 **빈 목록이 아니라 실패를 알린다** — 조용히 "변경 없음"으로
 * 넘어가면 증분 갱신이 아무것도 하지 않는데 성공한 것처럼 보인다.
 */
export function changedFilesSince(
  projectRoot: string,
  base: string,
): { ok: true; changes: GitChange[] } | { ok: false; message: string } {
  const result = git(projectRoot, ["diff", "--name-status", base]);
  if (!result.ok) return { ok: false, message: result.message };

  const changes: GitChange[] = [];
  for (const line of result.stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    // rename은 `R100\told\tnew` 형태다. 새 경로를 쓴다.
    const path = status.startsWith("R") ? parts[2] : parts[1];
    if (path) changes.push({ path, status });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: true, changes };
}

/**
 * git이 바뀌었다고 본 파일 중 **실제로 내용이 달라진** 것만 (C2).
 *
 * `previousHashes`는 이전 인덱스의 `fileHashes`다.
 */
export function dirtyFiles(
  changes: GitChange[],
  currentHashes: Record<string, string>,
  previousHashes: Record<string, string>,
): string[] {
  const dirty: string[] = [];
  for (const change of changes) {
    const before = previousHashes[change.path];
    const after = currentHashes[change.path];
    // 삭제되었거나 새로 생겼으면 그대로 dirty.
    if (before === undefined || after === undefined) {
      dirty.push(change.path);
      continue;
    }
    if (before !== after) dirty.push(change.path);
  }
  return dirty.sort();
}
