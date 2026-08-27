import { homedir, release } from "node:os";
import { access, readdir } from "node:fs/promises";
import { delimiter, dirname, join, sep } from "node:path";
import { constants } from "node:fs";

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
export type RuntimePlatform = "macos" | "windows" | "wsl" | "linux";

export const isWindows = process.platform === "win32";
export const isWsl =
  process.platform === "linux" &&
  (Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) || /microsoft/i.test(release()));

export const runtimePlatform: RuntimePlatform = isWsl
  ? "wsl"
  : process.platform === "darwin"
    ? "macos"
    : isWindows
      ? "windows"
      : "linux";

/** 브라우저가 OS별 경로 형식을 올바르게 안내할 때 쓰는 비민감 런타임 정보. */
export function runtimeEnvironment() {
  return {
    platform: runtimePlatform,
    architecture: process.arch,
    nodeVersion: process.versions.node,
    pathSeparator: sep,
    pathExample: join(homedir(), "Projects", "my-app"),
  };
}

/** `.cmd` 래퍼를 실행하려면 윈도우에서는 shell이 필요하다. */
export const cliSpawnOptions: { shell: boolean } = { shell: isWindows };

/**
 * 현재 셸의 PATH뿐 아니라 Node 버전 매니저의 다른 설치에도 있는 CLI를 찾는다.
 *
 * nvm/fnm은 Node 버전마다 전역 npm 패키지를 따로 둔다. 그래서 macOS에서 `nvm use 22`로
 * 앱을 실행하고 Codex는 Node 24에 설치한 경우, 터미널에서는 앱이 정상 기동되어도
 * `spawn("codex")`만 ENOENT가 난다. 사용자가 앱 실행용 Node를 바꿀 때마다 Codex를 다시
 * 설치하도록 요구하지 않고, 이미 설치된 실행 파일을 찾아 절대 경로로 실행한다.
 */
export async function resolveCliExecutable(name: "codex" | "claude"): Promise<string | null> {
  const executableNames = isWindows ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  const candidates: string[] = [];

  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const executable of executableNames) candidates.push(join(dir, executable));
  }

  const home = homedir();
  const commonDirs = isWindows
    ? [process.env.APPDATA ? join(process.env.APPDATA, "npm") : ""]
    : [
        dirname(process.execPath),
        join(home, ".local", "bin"),
        join(home, ".npm-global", "bin"),
        join(home, ".volta", "bin"),
        join(home, ".asdf", "shims"),
        join(home, ".local", "share", "mise", "shims"),
        join(home, "Library", "pnpm"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
      ];
  for (const dir of commonDirs.filter(Boolean)) {
    for (const executable of executableNames) candidates.push(join(dir, executable));
  }

  if (!isWindows) {
    const versionManagerRoots = [
      join(home, ".nvm", "versions", "node"),
      join(home, "Library", "Application Support", "fnm", "node-versions"),
      join(home, ".local", "share", "fnm", "node-versions"),
    ];
    for (const root of versionManagerRoots) {
      let versions: string[];
      try {
        versions = await readdir(root);
      } catch {
        continue;
      }
      // 최신 버전부터 확인하면 여러 곳에 설치된 경우 보통 가장 최근 CLI를 선택한다.
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const version of versions) {
        const binDirs = root.includes("fnm")
          ? [join(root, version, "installation", "bin")]
          : [join(root, version, "bin")];
        for (const dir of binDirs) {
          for (const executable of executableNames) candidates.push(join(dir, executable));
        }
      }
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, isWindows ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // 다음 후보를 확인한다.
    }
  }
  return null;
}

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
