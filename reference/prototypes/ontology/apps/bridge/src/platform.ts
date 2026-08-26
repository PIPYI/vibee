/**
 * Platform 계층 — **OS 차이를 아는 유일한 모듈이다.**
 *
 * bridge의 나머지 코드와 MCP server는 `process.platform`을 보지 않는다. 실행 파일 해석,
 * spawn 옵션, 프로세스 트리 정리가 전부 여기 모여 있고, 바깥은 여기가 돌려준 값을 그대로 쓴다.
 *
 * 이 경계는 `apps/bridge/test/platform-boundary.test.mjs`가 강제한다 — 다른 파일에서
 * `process.platform`을 쓰면 시험이 실패한다.
 *
 * ## 왜 필요한가 (byoa Finding 9)
 *
 * 윈도우에서 `codex`·`claude`는 npm 전역 설치가 만든 `.cmd` 배치 파일이다. Node는 보안상
 * `.cmd`/`.bat`을 shell 없이 실행하지 않으므로 `spawn("codex", [...])`가 EINVAL/ENOENT로
 * 실패한다. 그렇다고 shell을 거치면 우리가 아는 pid는 `cmd.exe`이고 실제 agent는 그 자식이라
 * `child.kill()`이 agent를 고아로 남긴다. 두 문제를 한 곳에서 함께 다뤄야 한다.
 */
import { spawnSync, type SpawnOptions } from "node:child_process";

import type { AgentId } from "@onto/protocol";

const IS_WINDOWS = process.platform === "win32";

/** 이 프로세스가 도는 OS. 바깥은 이 값을 보고 분기하지 않고 로그·진단에만 쓴다. */
export const platformName: NodeJS.Platform = process.platform;

export type ExecutableSpec = {
  /** spawn에 넘길 명령 */
  command: string;
  /** spawn에 넘길 옵션. 윈도우에서만 shell이 켜진다 */
  spawnOptions: SpawnOptions;
  /** 사람이 읽을 설명. 실패 진단에 쓴다 */
  description: string;
};

const AGENT_COMMANDS: Record<AgentId, string> = {
  codex: "codex",
  claude: "claude",
};

/**
 * agent 실행 파일을 해석한다.
 *
 * **인자는 여기서 정하지 않는다** — 호출자가 정한다. 다만 shell을 켜는 플랫폼에서는
 * 인자가 셸 해석을 거치므로, 호출자는 **상수 문자열만** 인자로 넘겨야 한다.
 * 사용자 입력(프로젝트 경로 등)은 argv가 아니라 stdio JSON으로 넘어간다.
 */
export function resolveAgentExecutable(agent: AgentId): ExecutableSpec {
  const command = AGENT_COMMANDS[agent];
  return {
    command,
    spawnOptions: cliSpawnOptions(),
    description: IS_WINDOWS ? `${command} (셸 경유 — .cmd 래퍼)` : command,
  };
}

/**
 * CLI를 띄울 때 쓰는 spawn 옵션.
 *
 * 윈도우에서만 `shell: true`다. 인자가 전부 상수 문자열이고 사용자 입력이 섞이지 않아 안전하다.
 */
export function cliSpawnOptions(extra: SpawnOptions = {}): SpawnOptions {
  return IS_WINDOWS ? { ...extra, shell: true } : { ...extra };
}

/** MCP server를 띄울 때 쓰는 명령. `node`는 실제 실행 파일이라 셸이 필요 없다. */
export function nodeExecutable(): string {
  return process.execPath;
}

export type VersionProbe =
  | { ok: true; version: string }
  | { ok: false; message: string };

/**
 * `<agent> --version`을 물어본다.
 *
 * 설치 여부 판정의 유일한 경로다. 실패 사유를 문자열로 돌려주므로 호출자는 OS를 몰라도
 * 사람에게 보여줄 메시지를 만들 수 있다.
 */
export function probeAgentVersion(agent: AgentId, timeoutMs = 10_000): VersionProbe {
  const spec = resolveAgentExecutable(agent);
  const result = spawnSync(spec.command, ["--version"], {
    ...spec.spawnOptions,
    encoding: "utf8",
    timeout: timeoutMs,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: false, message: `${spec.description} 을 찾을 수 없습니다. 설치되어 있나요?` };
    }
    return { ok: false, message: `${spec.description} 실행에 실패했습니다: ${result.error.message}` };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").toString().trim();
    return {
      ok: false,
      message: `${spec.description} --version 이 ${result.status} 로 끝났습니다${stderr ? `: ${stderr}` : ""}`,
    };
  }
  return { ok: true, version: (result.stdout ?? "").toString().trim() };
}

/**
 * 프로세스 트리를 정리한다.
 *
 * 윈도우에서는 셸을 거쳐 띄우므로 우리가 아는 pid는 `cmd.exe`이고 실제 agent는 그 자식이다.
 * `taskkill /T`로 트리째 정리하지 않으면 **agent가 고아로 남는다.**
 */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // 이미 죽었다.
  }
}

/**
 * 종료 신호를 등록한다.
 *
 * 윈도우에서는 `SIGTERM`이 발생하지 않는다(Node 문서). `SIGINT`(Ctrl+C)는 동작하므로
 * 둘 다 걸어 두고, 그 차이를 바깥이 알 필요 없게 한다.
 */
export function onShutdown(handler: () => void | Promise<void>): void {
  let done = false;
  const once = (): void => {
    if (done) return;
    done = true;
    void handler();
  };
  process.on("SIGINT", once);
  if (!IS_WINDOWS) process.on("SIGTERM", once);
}
