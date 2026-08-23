/**
 * Semantic Store — generation commit + atomic HEAD switch (implementation_plan §5 T4).
 *
 * **왜 파일별 rename으로는 안 되는가.** 커밋 하나가 `project.json` + `evidence.json` +
 * `semantic-memory.json` + `grounding.json` + `versions.json`을 함께 바꾼다. 파일별
 * `rename(2)`은 각각에 대해서만 원자적이므로, rename 사이에서 크래시하면 **찢어진 상태**가
 * 남는다 — 없는 evidence를 참조하는 memory, 착지하지 않은 스냅샷을 가리키는 버전 레코드.
 * 프로세스 mutex는 동시 *쓰기*를 막을 뿐 전원 손실·SIGKILL에는 아무 역할도 하지 않는다.
 *
 * 그래서 상태 전체를 `gen/<N>/`에 쓰고 **HEAD 하나만** 원자적으로 넘긴다.
 *
 * ```text
 * 크래시 시점        결과
 * HEAD switch 이전   HEAD는 옛 generation. gen/<N>/은 고아가 되고 다음 실행이 청소한다
 * HEAD switch 이후   rename(2)은 원자적이므로 HEAD는 옛 값 또는 새 값. 중간이 없다
 * ```
 *
 * 읽는 쪽은 HEAD가 가리키는 디렉터리만 본다. 그 디렉터리는 불변이므로 reader가 writer를
 * 막지 않고 그 반대도 아니다.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type {
  AnalysisBundle,
  EvidenceIndex,
  GroundingStore,
  ProjectState,
  SemanticMemory,
  SemanticVersion,
} from "@onto/protocol";
import {
  GEN_DIR,
  MANIFEST_MEMBERS,
  STATE_FILES,
  generationDir,
  generationName,
  generationsRoot,
  headPath,
  intelDir,
  lockPath,
} from "@onto/protocol/node";

/** 기본 보존 개수. generation이 곧 history이므로(C4) 너무 적게 두면 되돌릴 수 없다. */
export const DEFAULT_RETAIN = 20;

export type Head = { generation: number };

export type Manifest = {
  generation: number;
  /** MANIFEST_MEMBERS의 파일별 sha256. 시작 시 검증한다 */
  files: Record<string, string>;
};

/** 하나의 generation이 담고 있는 상태 전체. */
export type StateSnapshot = {
  project: ProjectState;
  evidence: EvidenceIndex;
  memory: SemanticMemory;
  grounding: GroundingStore;
  versions: SemanticVersion[];
  /** schema3 §5.4 — 아직 분석 파이프라인을 돌리지 않은 generation에서는 `null`이다. */
  analysisBundle: AnalysisBundle | null;
};

export type LoadedState = StateSnapshot & { generation: number };

export type CommitOptions = {
  retain?: number;
  diffSummary?: SemanticVersion["diffSummary"];
  /**
   * generation은 다 썼지만 **HEAD는 아직 넘어가지 않은** 지점에서 불린다.
   *
   * 이 지점이 crash-consistency의 전부이므로 시험할 수 있어야 한다 — acceptance 19는
   * 여기서 실제로 SIGKILL을 보낸다. 그것 말고 다른 용도는 없다.
   */
  onBeforeHeadSwitch?: (generation: number) => void;
};

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 파일을 쓰고 fsync 한다. fsync 없이 rename만 하면 내용이 뒤늦게 착지할 수 있다. */
function writeFileSynced(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * 디렉터리 엔트리를 디스크에 확정한다.
 *
 * 파일 내용만 fsync 하고 디렉터리를 fsync 하지 않으면, 크래시 후 파일이 **디렉터리에
 * 나타나지 않을** 수 있다. 일부 플랫폼은 디렉터리 fd에 fsync를 허용하지 않으므로 실패는
 * 삼킨다 — 그런 플랫폼에서는 이 호출이 필요 없다.
 */
function fsyncDir(path: string): void {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch {
    // Windows 등에서는 디렉터리 fsync가 지원되지 않는다.
  } finally {
    closeSync(fd);
  }
}

export class SemanticStore {
  /**
   * 프로세스 내 직렬화. **crash-consistency를 주는 것이 아니다** — 그것은 HEAD switch가
   * 준다. 이것은 한 프로세스 안에서 두 task가 동시에 generation을 만들지 않게 할 뿐이다.
   */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(readonly projectPath: string) {}

  // -------------------------------------------------------------------------
  // 읽기
  // -------------------------------------------------------------------------

  isInitialized(): boolean {
    return existsSync(headPath(this.projectPath));
  }

  readHead(): Head {
    const path = headPath(this.projectPath);
    if (!existsSync(path)) {
      throw new StoreError(
        `${path} 가 없습니다. 이 프로젝트는 아직 초기화되지 않았습니다.`,
        "store/not-initialized",
      );
    }
    const head = JSON.parse(readFileSync(path, "utf8")) as Head;
    if (typeof head.generation !== "number") {
      throw new StoreError(`HEAD 가 손상되었습니다: ${path}`, "store/head-corrupt");
    }
    return head;
  }

  /**
   * HEAD가 가리키는 generation을 읽는다.
   *
   * manifest의 sha256이 어긋나면 **조용히 넘어가지 않고** generation−1로 물러선다.
   * HEAD switch가 끝난 뒤에는 일어나지 않아야 하지만, 디스크는 거짓말을 한다.
   */
  load(): LoadedState {
    const { generation } = this.readHead();
    try {
      return { generation, ...this.readGeneration(generation) };
    } catch (error) {
      if (generation <= 1) throw error;
      const fallback = generation - 1;
      if (!existsSync(generationDir(this.projectPath, fallback))) throw error;
      // 조용한 성공보다 시끄러운 실패. 사용자가 이것을 봐야 한다.
      console.error(
        `[onto/store] generation ${generation} 이 손상되었습니다 (${String(error)}). ` +
          `generation ${fallback} 으로 물러섭니다.`,
      );
      const state = this.readGeneration(fallback);
      this.setHead(fallback);
      return { generation: fallback, ...state };
    }
  }

  readGeneration(generation: number): StateSnapshot {
    const dir = generationDir(this.projectPath, generation);
    if (!existsSync(dir)) {
      throw new StoreError(`generation ${generation} 이 없습니다: ${dir}`, "store/generation-missing");
    }

    const manifestRaw = this.readFileOrThrow(dir, STATE_FILES.manifest);
    const manifest = JSON.parse(manifestRaw) as Manifest;

    const contents: Record<string, string> = {};
    for (const name of MANIFEST_MEMBERS) {
      const raw = this.readFileOrThrow(dir, name);
      const expected = manifest.files[name];
      if (expected === undefined) {
        throw new StoreError(
          `manifest 에 ${name} 의 해시가 없습니다 (generation ${generation})`,
          "store/manifest-incomplete",
        );
      }
      const actual = sha256(raw);
      if (actual !== expected) {
        throw new StoreError(
          `${name} 의 해시가 manifest 와 다릅니다 (generation ${generation}): ` +
            `expected ${expected.slice(0, 12)}, actual ${actual.slice(0, 12)}`,
          "store/hash-mismatch",
        );
      }
      contents[name] = raw;
    }

    return {
      project: JSON.parse(contents[STATE_FILES.project]!) as ProjectState,
      evidence: JSON.parse(contents[STATE_FILES.evidence]!) as EvidenceIndex,
      memory: JSON.parse(contents[STATE_FILES.memory]!) as SemanticMemory,
      grounding: JSON.parse(contents[STATE_FILES.grounding]!) as GroundingStore,
      versions: JSON.parse(contents[STATE_FILES.versions]!) as SemanticVersion[],
      analysisBundle: JSON.parse(contents[STATE_FILES.analysisBundle]!) as AnalysisBundle | null,
    };
  }

  private readFileOrThrow(dir: string, name: string): string {
    const path = join(dir, name);
    if (!existsSync(path)) {
      throw new StoreError(`${name} 이 없습니다: ${path}`, "store/file-missing");
    }
    return readFileSync(path, "utf8");
  }

  // -------------------------------------------------------------------------
  // 쓰기
  // -------------------------------------------------------------------------

  /**
   * 새 generation을 만들고 HEAD를 넘긴다.
   *
   * `mutate`는 현재 상태를 받아 새 상태를 돌려준다. 읽기와 쓰기가 lock 안에서 이어지므로
   * 그 사이에 다른 커밋이 끼어들지 않는다.
   */
  commit(
    message: string,
    source: SemanticVersion["source"],
    mutate: (current: StateSnapshot) => StateSnapshot,
    options: CommitOptions = {},
  ): Promise<LoadedState> {
    return this.serialized(() => {
      const { generation, ...snapshot } = this.load();
      // `generation`을 떼고 넘긴다. 그대로 두면 mutate가 돌려준 객체에 옛 generation이
      // 남아 반환값의 spread에서 새 값을 덮어쓴다.
      const next = mutate(structuredClone(snapshot));
      return this.writeGeneration(generation + 1, next, message, source, options);
    });
  }

  /** 빈 프로젝트에 generation 1을 만든다. 이미 있으면 아무것도 하지 않는다. */
  init(project: ProjectState, options: CommitOptions = {}): Promise<LoadedState> {
    return this.serialized(() => {
      if (this.isInitialized()) return this.load();

      mkdirSync(generationsRoot(this.projectPath), { recursive: true });
      const snapshot: StateSnapshot = {
        project,
        evidence: {
          analysisVersion: project.analysisVersion,
          fileHashes: {},
          evidence: [],
          adapterReport: [],
        },
        memory: {
          semanticVersion: project.semanticVersion,
          concepts: [],
          claims: [],
          canonicalScenarios: [],
        },
        grounding: { conceptGroundings: [], claimGroundings: [] },
        versions: [],
        analysisBundle: null,
      };
      return this.writeGeneration(1, snapshot, "초기화", "init", options);
    });
  }

  private writeGeneration(
    generation: number,
    snapshot: StateSnapshot,
    message: string,
    source: SemanticVersion["source"],
    options: CommitOptions,
  ): LoadedState {
    const record: SemanticVersion = {
      generation,
      analysisVersion: snapshot.project.analysisVersion,
      semanticVersion: snapshot.project.semanticVersion,
      semanticReconciledAnalysisVersion: snapshot.project.semanticReconciledAnalysisVersion,
      at: new Date().toISOString(),
      source,
      message,
      ...(options.diffSummary ? { diffSummary: options.diffSummary } : {}),
    };
    const state: StateSnapshot = { ...snapshot, versions: [...snapshot.versions, record] };

    const dir = generationDir(this.projectPath, generation);
    // 재시도로 남은 고아가 있으면 지우고 새로 만든다. HEAD는 아직 여기를 가리키지 않는다.
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    // --- 2. 상태 파일을 쓴다 (아직 아무도 이 디렉터리를 보지 않는다) ---
    const payloads: Record<string, string> = {
      [STATE_FILES.project]: serialize(state.project),
      [STATE_FILES.evidence]: serialize(state.evidence),
      [STATE_FILES.memory]: serialize(state.memory),
      [STATE_FILES.grounding]: serialize(state.grounding),
      [STATE_FILES.versions]: serialize(state.versions),
      [STATE_FILES.analysisBundle]: serialize(state.analysisBundle),
    };

    const files: Record<string, string> = {};
    for (const name of MANIFEST_MEMBERS) {
      const content = payloads[name]!;
      writeFileSynced(join(dir, name), content);
      files[name] = sha256(content);
    }

    // --- 3. manifest 를 쓰고 fsync ---
    writeFileSynced(join(dir, STATE_FILES.manifest), serialize({ generation, files } satisfies Manifest));

    // --- 4. 디렉터리 fsync ---
    fsyncDir(dir);

    // --- 5. HEAD 를 원자적으로 넘긴다. 여기가 유일한 원자적 지점이다 ---
    options.onBeforeHeadSwitch?.(generation);
    this.setHead(generation);

    // --- 6. 오래된 generation 정리 ---
    this.prune(generation, options.retain ?? DEFAULT_RETAIN);

    // spread를 뒤에 두지 않는다 — state에 stray `generation` 키가 있으면 덮어쓴다.
    return { ...state, generation };
  }

  private setHead(generation: number): void {
    const target = headPath(this.projectPath);
    const temp = `${target}.tmp`;
    writeFileSynced(temp, serialize({ generation } satisfies Head));
    renameSync(temp, target);
    fsyncDir(intelDir(this.projectPath));
  }

  // -------------------------------------------------------------------------
  // 복구 / 정리
  // -------------------------------------------------------------------------

  /**
   * HEAD보다 큰 고아 generation을 지운다.
   *
   * HEAD switch 이전에 크래시하면 `gen/<N>/`이 남는데, 그것은 아무도 가리키지 않는
   * 미완성 상태다. 다음 실행이 청소한다.
   */
  cleanOrphans(): number[] {
    if (!this.isInitialized()) return [];
    const head = this.readHead().generation;
    const removed: number[] = [];
    for (const generation of this.listGenerations()) {
      if (generation > head) {
        rmSync(generationDir(this.projectPath, generation), { recursive: true, force: true });
        removed.push(generation);
      }
    }
    return removed;
  }

  listGenerations(): number[] {
    const root = generationsRoot(this.projectPath);
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .filter((name) => /^\d+$/.test(name))
      .map((name) => Number(name))
      .sort((a, b) => a - b);
  }

  private prune(head: number, retain: number): void {
    if (retain <= 0) return;
    for (const generation of this.listGenerations()) {
      if (generation <= head - retain) {
        rmSync(generationDir(this.projectPath, generation), { recursive: true, force: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 잠금
  // -------------------------------------------------------------------------

  /**
   * 프로세스 간 advisory lock.
   *
   * bridge가 떠 있는 동안 사용자가 CLI를 돌릴 수 있다. 죽은 pid가 남긴 lock은 회수한다.
   */
  private acquireLock(): () => void {
    const path = lockPath(this.projectPath);
    mkdirSync(intelDir(this.projectPath), { recursive: true });

    if (existsSync(path)) {
      const holder = Number(readFileSync(path, "utf8").trim());
      if (Number.isFinite(holder) && holder !== process.pid && isAlive(holder)) {
        throw new StoreError(
          `다른 프로세스(pid ${holder})가 이 프로젝트를 쓰는 중입니다: ${path}`,
          "store/locked",
        );
      }
      // 죽은 프로세스가 남긴 lock. 회수한다.
      unlinkSync(path);
    }

    writeFileSync(path, `${process.pid}\n`, { flag: "w" });
    return () => {
      try {
        if (existsSync(path) && Number(readFileSync(path, "utf8").trim()) === process.pid) {
          unlinkSync(path);
        }
      } catch {
        // 정리 실패는 다음 실행이 죽은 pid로 회수한다.
      }
    };
  }

  private serialized<T>(run: () => T): Promise<T> {
    const next = this.writeChain.then(() => {
      const release = this.acquireLock();
      try {
        return run();
      } finally {
        release();
      }
    });
    // 실패가 체인을 막지 않게 한다. 호출자는 반환된 promise에서 오류를 받는다.
    this.writeChain = next.catch(() => undefined);
    return next;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 새 프로젝트의 초기 버전 상태. */
export function initialProjectState(projectId: string, name: string): ProjectState {
  return {
    projectId,
    name,
    analysisVersion: 0,
    semanticVersion: 0,
    semanticReconciledAnalysisVersion: 0,
  };
}

/** generation 이름 헬퍼를 재수출한다 (테스트·스크립트가 쓴다). */
export { generationName };
