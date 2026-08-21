/**
 * 플랫폼 차이를 한 곳에 모은다.
 *
 * 윈도우에서 `codex`, `claude`는 npm 전역 설치가 만든 **`.cmd` 래퍼**다. Node는 보안상
 * `.cmd`/`.bat`을 shell 없이 실행하지 않으므로, `spawn("codex", ...)`이 그대로는 실패한다
 * (EINVAL 또는 ENOENT). 그래서 윈도우에서만 shell을 거쳐 실행한다.
 *
 * 인자는 전부 우리가 정한 상수 문자열(`app-server`, `--version`)이고 사용자 입력이 섞이지
 * 않으므로 shell 사용이 안전하다. 프로젝트 경로 같은 값은 argv가 아니라 stdio JSON으로
 * 넘어간다.
 */
export const isWindows = process.platform === "win32";

/** `.cmd` 래퍼를 실행하려면 윈도우에서는 shell이 필요하다. */
export const cliSpawnOptions: { shell: boolean } = { shell: isWindows };

/**
 * 자식 프로세스를 확실히 끝낸다.
 *
 * 윈도우에서 shell을 거쳐 띄우면 우리가 아는 pid는 `cmd.exe`이고 실제 agent는 그 자식이다.
 * `child.kill()`은 cmd.exe만 죽여서 agent가 고아로 남는다(§19 cleanup 위반). 그래서
 * 윈도우에서는 `taskkill /T`로 프로세스 트리를 통째로 정리한다.
 *
 * POSIX에서는 기존대로 시그널을 보낸다.
 */
export async function killTree(child: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean }): Promise<void> {
  if (!isWindows || child.pid === undefined) {
    child.kill("SIGTERM");
    return;
  }

  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve) => {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => resolve());
  });
}

/**
 * git이 설치되어 있는지.
 *
 * 이 앱은 **원격 저장소를 쓰지 않는다.** git이 필요한 이유는 사용자가 되돌릴 지점을 갖기
 * 위해서다 — 비전공자는 무언가 잘못됐을 때 되돌리는 법을 모른다
 * (docs/requirements_flow.md §6). 그래서 agent와 같은 급의 전제 조건으로 확인한다.
 */
export async function checkGit(): Promise<{ installed: boolean; version?: string; message?: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("git", ["--version"], cliSpawnOptions);
    return { installed: true, version: stdout.trim() };
  } catch {
    return {
      installed: false,
      message: "git이 없습니다. 되돌릴 지점을 남길 수 없으므로 먼저 설치해 주세요.",
    };
  }
}
