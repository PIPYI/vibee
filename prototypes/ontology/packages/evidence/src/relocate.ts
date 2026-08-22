/**
 * Agent evidence의 relocation — **바이트 검색이 아니라 지문 검색** (implementation_plan §6.5 S1).
 *
 * ## 왜 이것이 따로 필요한가
 *
 * engine evidence의 id는 **주소**에서 나오므로(R1 · U3) 재인덱싱이 알아서 같은 id를 다시
 * 만들어 낸다. 위치가 바뀌어도 새 위치가 그대로 관측된다. 그런데 agent evidence는 엔진이
 * 만들지 않으므로 **재인덱싱이 그것을 다시 만들어 주지 않는다.** 아무것도 하지 않으면
 * `carryMissingEvidence`가 전부 `missing`으로 밀어 버리고, prettier 한 번에 agent가 발견한
 * 근거가 통째로 끊긴다.
 *
 * ## 세 가지를 분리한다 (S1)
 *
 * - `normalizedFingerprint` — identity와 relocation의 **유일한** 기준
 * - `location` · `fileContentHash` — relocation이 갱신하는 것
 * - `excerpt` · `rawHash` — 사람 확인용. **identity가 아니다**
 *
 * ## excerpt를 agent evidence에 대해 extent 전체로 저장하는 이유
 *
 * 창을 밀려면 **원래 extent가 토큰 몇 개짜리였는지**를 알아야 한다. 지문은 sha1이라 길이를
 * 돌려주지 않고, 옛 파일 내용은 어디에도 남아 있지 않다. `excerpt`는 계획이 "사람이 확인할
 * 원문"으로 정의한 필드이고 identity에 쓰이지 않으므로, 여기에 extent 전체를 담아 두면
 * 창 길이를 결정론적으로 되살릴 수 있다. engine evidence는 relocation이 필요 없으므로
 * 지금처럼 첫 줄만 담는다.
 */
import ts from "typescript";

import type { Evidence, EvidenceIndex, NormalizationProfile, SourceRange } from "@onto/protocol";

import { fingerprintOf, rawHashOf, sha256 } from "./ids.js";
import { positionedTokens, type NormalizedToken } from "./normalize.js";

/** degraded 매칭이 요구하는 식별자 일치 비율. 이 아래는 "같은 것"이라고 부르지 않는다. */
export const DEGRADED_SIMILARITY_THRESHOLD = 0.6;

/**
 * 창을 밀기 위한 위치 있는 토큰.
 *
 * **지문 파이프라인과 같은 함수에서 나온다** (`normalize.ts`의 `positionedTokens`). 여기서만
 * 세미콜론이나 후행 콤마를 남기면 창 길이가 지문의 토큰 수와 어긋나 relocation 이 조용히
 * 실패한다 — 처음 구현에서 실제로 그렇게 틀렸고, acceptance 16 이 그것을 잡았다.
 */
export type PositionedToken = NormalizedToken;

export function relocationTokens(text: string, profile: NormalizationProfile): PositionedToken[] {
  return positionedTokens(text, profile);
}

// ---------------------------------------------------------------------------
// 줄 경계
// ---------------------------------------------------------------------------

/** 각 줄의 시작 offset. 1-based 줄 번호와 offset을 오간다. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** 1-based 줄 범위의 원문. extent는 언제나 **줄 단위**다. */
export function sliceLines(text: string, range: SourceRange): string {
  const lines = text.split(/\r?\n/u);
  const start = Math.max(0, range.startLine - 1);
  const end = Math.min(lines.length, range.endLine ?? range.startLine);
  return lines.slice(start, end).join("\n");
}

export function lineCountOf(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/u);
  return lines.length - (text.endsWith("\n") ? 1 : 0);
}

// ---------------------------------------------------------------------------
// 지문 검색
// ---------------------------------------------------------------------------

export type RelocationResult =
  | {
      status: "relocated";
      location: SourceRange;
      extent: string;
      confidence: "exact" | "degraded";
    }
  | { status: "missing"; reason: "no-match" | "ambiguous" | "no-anchor" };

/**
 * 바뀐 파일 안에서 같은 지문의 창을 찾는다 (S1 ②).
 *
 * ```text
 * a. 같은 토큰 길이의 창을 밀며 지문이 일치하는 창을 찾는다
 *      정확히 1개 → relocate (exact)
 *      0개        → b 로
 *      2개 이상   → missing (모호하므로 재제안 필요)
 * b. degraded — 식별자 부분수열의 유사도가 임계값 이상이고 **유일**한 후보
 *      유일     → relocate (degraded)
 *      그 외    → missing
 * ```
 *
 * **유일성을 요구하므로 스캔 순서가 결과에 영향을 주지 않는다** — 결정론이다.
 */
export function relocateExtent(
  fileText: string,
  target: { fingerprint: string; extent: string; profile: NormalizationProfile },
): RelocationResult {
  const wanted = relocationTokens(target.extent, target.profile);
  if (wanted.length === 0) return { status: "missing", reason: "no-anchor" };

  const haystack = relocationTokens(fileText, target.profile);
  const starts = lineStarts(fileText);

  const exact = findExactWindows(fileText, haystack, wanted, target);
  if (exact.length > 1) return { status: "missing", reason: "ambiguous" };
  if (exact.length === 1) {
    return finish(fileText, starts, exact[0]!.start, exact[0]!.end, target);
  }

  const degraded = findDegradedWindow(haystack, wanted);
  if (!degraded) return { status: "missing", reason: "no-match" };
  return finish(fileText, starts, degraded.start, degraded.end, target, "degraded");
}

/**
 * 후보 창을 줄 단위 extent로 넓히고 결과를 만든다.
 *
 * **넓힌 뒤에 지문을 다시 계산한다.** 창의 앞뒤로 다른 토큰이 같은 줄에 끼어들 수 있고,
 * 그러면 그것은 더 이상 같은 extent가 아니다. 그때는 `exact`라고 부르지 않고 `degraded`로
 * 낮춘다 — 틀린 쪽으로 관대해지느니 재검토를 한 번 더 시키는 편이 안전하다.
 */
function finish(
  fileText: string,
  starts: number[],
  startOffset: number,
  endOffset: number,
  target: { fingerprint: string; profile: NormalizationProfile },
  force?: "degraded",
): RelocationResult {
  const location: SourceRange = {
    startLine: lineOf(starts, startOffset),
    endLine: lineOf(starts, Math.max(startOffset, endOffset - 1)),
  };
  const extent = sliceLines(fileText, location);
  const matches = fingerprintOf(extent, target.profile) === target.fingerprint;
  return {
    status: "relocated",
    location,
    extent,
    confidence: force === "degraded" || !matches ? "degraded" : "exact",
  };
}

function findExactWindows(
  fileText: string,
  haystack: PositionedToken[],
  wanted: PositionedToken[],
  target: { fingerprint: string; profile: NormalizationProfile },
): Array<{ start: number; end: number }> {
  const size = wanted.length;
  const first = wanted[0]!.norm;
  const last = wanted[size - 1]!.norm;
  const found: Array<{ start: number; end: number }> = [];

  for (let index = 0; index + size <= haystack.length; index += 1) {
    // 값싼 사전 검사. 결정론적이며, 통과한 창만 진짜 파이프라인으로 확인한다.
    if (haystack[index]!.norm !== first) continue;
    if (haystack[index + size - 1]!.norm !== last) continue;
    const startOffset = haystack[index]!.start;
    const endOffset = haystack[index + size - 1]!.end;
    const slice = fileText.slice(startOffset, endOffset);
    if (fingerprintOf(slice, target.profile) !== target.fingerprint) continue;
    found.push({ start: startOffset, end: endOffset });
    // 2개를 넘으면 결과가 달라지지 않는다 (모호 → missing).
    if (found.length > 1) break;
  }
  return found;
}

/**
 * degraded 매칭 — 블록이 편집됐지만 같은 것으로 알아볼 수 있는 경우 (S1 ② b).
 *
 * 식별자만 남긴 열을 같은 길이의 창으로 밀며 **얼마나 겹치는가**를 센다.
 *
 * ## 왜 자리별 일치가 아니라 겹침인가
 *
 * 처음에는 자리별로 비교했는데, 식별자 **하나가 지워지면 그 뒤가 전부 한 칸씩 밀려서** 점수가
 * 무너졌다. 실제 편집은 거의 항상 삽입·삭제를 포함하므로 그 방식은 "본문이 조금 바뀐 블록"을
 * 알아보지 못한다 — acceptance 17 이 정확히 그 경우다.
 *
 * 그래서 다중집합(bag) 겹침을 쓴다. 순서를 보지 않으므로 **순서만 뒤바꾼 무관한 블록을
 * 같은 것으로 볼 수 있다**는 것이 이 선택의 오차 방향이고, 그래서 (a) 임계값을 두고
 * (b) **유일한 후보**만 받아들이며 (c) 결과에 `relocationConfidence: "degraded"`를 달아
 * 화면이 "위치를 추정했습니다"라고 말하게 한다.
 *
 * 최고 점수를 내는 창이 **겹치는 덩어리 하나뿐일 때만** 옮긴다. 겹치는 창들은 같은 곳을
 * 가리키므로 하나로 묶고, 서로 떨어진 두 곳이 같은 점수라면 그것은 모호한 것이다.
 */
function findDegradedWindow(
  haystack: PositionedToken[],
  wanted: PositionedToken[],
): { start: number; end: number } | null {
  const targetIds = wanted.filter((token) => token.isIdentifier);
  const fileIds = haystack.filter((token) => token.isIdentifier);
  const size = targetIds.length;
  if (size === 0 || fileIds.length < size) return null;

  /** 목표 다중집합. 창을 밀며 남은 개수를 세면 겹침이 O(1)로 갱신된다. */
  const need = new Map<string, number>();
  for (const token of targetIds) need.set(token.norm, (need.get(token.norm) ?? 0) + 1);

  const remaining = new Map(need);
  let overlap = 0;
  const enter = (token: PositionedToken): void => {
    const left = remaining.get(token.norm) ?? 0;
    if (left > 0) {
      remaining.set(token.norm, left - 1);
      overlap += 1;
    }
  };
  const leave = (token: PositionedToken): void => {
    const left = remaining.get(token.norm);
    if (left === undefined) return;
    // 목표에 없던 식별자는 겹침에 기여하지 않았으므로 되돌릴 것도 없다.
    if (left < (need.get(token.norm) ?? 0)) {
      remaining.set(token.norm, left + 1);
      overlap -= 1;
    }
  };

  for (let index = 0; index < size; index += 1) enter(fileIds[index]!);

  let best = 0;
  let candidates: number[] = [];
  for (let index = 0; index + size <= fileIds.length; index += 1) {
    if (index > 0) {
      leave(fileIds[index - 1]!);
      enter(fileIds[index + size - 1]!);
    }
    const score = overlap / size;
    if (score > best) {
      best = score;
      candidates = [index];
    } else if (score === best && score > 0) {
      candidates.push(index);
    }
  }
  if (best < DEGRADED_SIMILARITY_THRESHOLD || candidates.length === 0) return null;

  // 겹치는 창은 같은 곳이다. 떨어진 덩어리가 둘 이상이면 모호하다.
  let groups = 1;
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index]! - candidates[index - 1]! >= size) groups += 1;
  }
  if (groups !== 1) return null;

  const start = candidates[0]!;
  return { start: fileIds[start]!.start, end: fileIds[start + size - 1]!.end };
}

// ---------------------------------------------------------------------------
// 인덱스 병합
// ---------------------------------------------------------------------------

export type AgentCarryReport = {
  relocated: Array<{ id: string; confidence: "exact" | "degraded" }>;
  missing: Array<{ id: string; reason: string }>;
};

/**
 * 재인덱싱 결과에 agent evidence를 이어 붙인다 (커밋 1, §6.9).
 *
 * ```text
 * 파일이 그대로다        → 그대로 옮긴다 (freshness는 fileContentHash 하나로 정의된다)
 * 파일이 바뀌었다        → 지문으로 relocate. 실패하면 missing
 * 파일을 읽을 수 없다     → missing
 * ```
 *
 * **agent evidence가 사는 파일의 해시를 `fileHashes`에 넣는다.** 엔진이 수집하지 않는
 * 파일(문서·주석 정책 등)을 agent가 가리키는 것이 `propose_evidence`의 목적인데, 그 파일이
 * `fileHashes`에 없으면 `present ⟺ fileContentHash === fileHashes[filePath]` 가 영원히
 * 거짓이 되어 방금 등록한 근거가 즉시 죽는다.
 */
export function carryAgentEvidence(
  previous: EvidenceIndex | undefined,
  next: EvidenceIndex,
  readFile: (relPath: string) => string | null,
): { index: EvidenceIndex; report: AgentCarryReport } {
  const report: AgentCarryReport = { relocated: [], missing: [] };
  if (!previous) return { index: next, report };

  const agentEvidence = previous.evidence.filter(
    (item) => item.origin === "agent" && item.status === "present",
  );
  if (agentEvidence.length === 0) return { index: next, report };

  const fileHashes = { ...next.fileHashes };
  const carried: Evidence[] = [];
  const cache = new Map<string, string | null>();

  for (const item of agentEvidence) {
    const relPath = item.filePath;
    if (!relPath) continue;
    if (!cache.has(relPath)) cache.set(relPath, readFile(relPath));
    const text = cache.get(relPath) ?? null;
    if (text === null) {
      report.missing.push({ id: item.id, reason: "file-unreadable" });
      continue;
    }

    const currentHash = sha256(text);
    fileHashes[relPath] = currentHash;

    if (item.fileContentHash === currentHash) {
      carried.push(item);
      continue;
    }

    const result = relocateExtent(text, {
      fingerprint: item.normalizedFingerprint,
      extent: item.excerpt ?? "",
      profile: item.normalizationProfile,
    });
    if (result.status === "missing") {
      report.missing.push({ id: item.id, reason: result.reason });
      continue;
    }

    report.relocated.push({ id: item.id, confidence: result.confidence });
    carried.push({
      ...item,
      location: result.location,
      excerpt: result.extent,
      rawHash: rawHashOf(result.extent),
      // **id는 그대로다.** 지문이 달라졌더라도 이 근거의 정체는 유지된다 —
      // 달라진 지문은 `contentChange = modified`로 나타나 재검토 대상이 된다.
      normalizedFingerprint: fingerprintOf(result.extent, item.normalizationProfile),
      relocationConfidence: result.confidence,
      fileContentHash: currentHash,
      observedAtVersion: next.analysisVersion,
      status: "present",
    });
  }

  const evidence = [...next.evidence, ...carried].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  return { index: { ...next, fileHashes, evidence }, report };
}
