/**
 * Node 전용 헬퍼. `.project-intel/` 레이아웃의 경로를 **한 곳에서만** 정의한다.
 *
 * 브라우저 번들은 이 모듈을 import 하지 않는다.
 */
import { join } from "node:path";

/** §49. 프로젝트 안에 둔다 — 커밋해서 팀이 공유하고 git으로 되돌릴 수 있어야 한다 (C11). */
export const INTEL_DIR = ".project-intel";

export const GEN_DIR = "gen";
export const HEAD_FILE = "HEAD";
export const LOCK_FILE = "gen.lock";

/** generation 안에 사는 파일들. */
export const STATE_FILES = {
  project: "project.json",
  evidence: "evidence.json",
  memory: "semantic-memory.json",
  grounding: "grounding.json",
  versions: "versions.json",
  /** V4 — 검증된 런타임·외부 서비스·저장소·호출 관계의 증분 상태. */
  systemFacts: "system-facts.json",
  /** schema3 §5.4 — AnalysisBundle. 아직 분석하지 않은 generation에서는 `null`이다. */
  analysisBundle: "analysis-bundle.json",
  /**
   * v7 — Architecture 뷰 전용 archify 패턴 산출물. `AnalysisBundle.architecture`와는 완전히
   * 별도 경로다(AI가 좌표까지 저작하고 grounding을 거치지 않는다). 아직 저작하지 않은
   * generation에서는 `null`이다.
   */
  architectureView: "architecture-view.json",
  manifest: "manifest.json",
} as const;

export type StateFileName = (typeof STATE_FILES)[keyof typeof STATE_FILES];

/** manifest에 해시를 기록하는 파일들 (manifest 자신은 제외). */
export const MANIFEST_MEMBERS: StateFileName[] = [
  STATE_FILES.project,
  STATE_FILES.evidence,
  STATE_FILES.memory,
  STATE_FILES.grounding,
  STATE_FILES.versions,
  STATE_FILES.systemFacts,
  STATE_FILES.analysisBundle,
  STATE_FILES.architectureView,
];

export function intelDir(projectPath: string): string {
  return join(projectPath, INTEL_DIR);
}

export function headPath(projectPath: string): string {
  return join(intelDir(projectPath), HEAD_FILE);
}

export function lockPath(projectPath: string): string {
  return join(intelDir(projectPath), LOCK_FILE);
}

/** generation 디렉터리 이름은 6자리 zero-pad — 파일 목록이 사전순으로 정렬된다. */
export function generationName(generation: number): string {
  return String(generation).padStart(6, "0");
}

export function generationDir(projectPath: string, generation: number): string {
  return join(intelDir(projectPath), GEN_DIR, generationName(generation));
}

export function generationsRoot(projectPath: string): string {
  return join(intelDir(projectPath), GEN_DIR);
}

/**
 * generation **밖**에 사는 것들.
 *
 * `intent.json`은 기능1이 쓰는 **입력**이지 우리 산출물이 아니다.
 * `events.ndjson`은 append-only 로그, `views/`는 cache다 (§49, I11).
 */
export function intentPath(projectPath: string): string {
  return join(intelDir(projectPath), "intent.json");
}

export function eventsPath(projectPath: string): string {
  return join(intelDir(projectPath), "events.ndjson");
}

export function viewsDir(projectPath: string): string {
  return join(intelDir(projectPath), "views");
}

export {
  findProtoRoot,
  loadBridgeConfig,
  protoRootFromModule,
  type BridgeConfig,
} from "./bridge-config.js";
