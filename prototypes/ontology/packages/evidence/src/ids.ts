/**
 * Evidence ID (implementation_plan §6.2 R1 · U3).
 *
 * **id는 주소에서 나온다. 관측 시점이나 위치에서 나오지 않는다.**
 *
 * 줄 번호나 ordinal이 id에 들어가면, 파일 위쪽에 한 줄이 늘어나거나 같은 쌍 사이에 호출이
 * 하나 끼어들 때마다 기존 evidence id가 전부 바뀌고 거기 걸린 Grounding이 통째로 끊긴다.
 * 그것이 §46이 실패로 규정한 churn이다.
 */
import { createHash } from "node:crypto";

import type { EntityRef, NormalizationProfile } from "@onto/protocol";
import { entityKey } from "@onto/protocol";

import { normalizedText } from "./normalize.js";

function sha1(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** extent 원문의 exact 바이트 해시. `cosmetic` 판정의 입력이자 UI 신호다. */
export function rawHashOf(text: string): string {
  return sha256(text);
}

/** extent의 정규화 토큰 지문. identity · relocation · 의미 변화 판정의 기준이다. */
export function fingerprintOf(text: string, profile: NormalizationProfile): string {
  return sha1(normalizedText(text, profile));
}

// ---------------------------------------------------------------------------
// Entity evidence — 주소가 위치에 의존하지 않는다
// ---------------------------------------------------------------------------

export function fileEvidenceId(relPath: string): string {
  return `ev:file:${sha1(relPath)}`;
}

/** `symbolId = "<relPath>#<qualifiedName>"` */
export function symbolIdOf(relPath: string, qualifiedName: string): string {
  return `${relPath}#${qualifiedName}`;
}

export function symbolEvidenceId(symbolId: string): string {
  return `ev:symbol:${sha1(symbolId)}`;
}

// ---------------------------------------------------------------------------
// Link evidence — U3
// ---------------------------------------------------------------------------

/**
 * link evidence의 **기본** id.
 *
 * ```text
 * ev:<linkKind>:<sha1( linkKind | fromEntityKey | toEntityKey | localNormalizedFingerprint )>
 * ```
 *
 * `localNormalizedFingerprint`는 그 호출부 extent(호출식 + 감싸는 문장)의 지문이다.
 * 위치가 들어가지 않으므로 **주변에 새로운 호출 하나가 추가되었다는 이유로 기존 call
 * evidence id가 바뀌지 않는다** — 그것이 지켜야 할 invariant다 (acceptance 18c).
 */
export function linkEvidenceBaseId(
  linkKind: string,
  from: EntityRef,
  to: EntityRef,
  localFingerprint: string,
): string {
  const material = [linkKind, entityKey(from), entityKey(to), localFingerprint].join("|");
  return `ev:${linkKind}:${sha1(material)}`;
}

export type LinkIdCandidate = {
  baseId: string;
  /** 충돌 그룹 안에서의 정렬 기준. 그룹 밖에는 영향을 주지 않는다 */
  startLine: number;
  startColumn: number;
};

/**
 * 충돌 처리 (U3).
 *
 * 같은 쌍 사이에 **바이트 수준으로 구별되지 않는** 호출부가 둘 이상이면 지문이 겹친다.
 * 그때만 line 순서로 정한 **그 충돌 그룹 안에서의** ordinal을 덧붙인다. 범위가 중복 그룹으로
 * 한정되므로 다른 곳에 호출을 추가해도 영향이 없다.
 *
 * 동일한 중복을 앞에 하나 더 끼워 넣으면 그룹 안에서는 밀리지만, 그 문장들은 서로 구별할 수
 * 없으므로 실질적 손해가 없다.
 */
export function resolveLinkIds(candidates: LinkIdCandidate[]): string[] {
  const groups = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const bucket = groups.get(candidate.baseId);
    if (bucket) bucket.push(index);
    else groups.set(candidate.baseId, [index]);
  });

  const resolved = new Array<string>(candidates.length);
  for (const [baseId, indices] of groups) {
    if (indices.length === 1) {
      resolved[indices[0]!] = baseId;
      continue;
    }
    const ordered = [...indices].sort((a, b) => {
      const left = candidates[a]!;
      const right = candidates[b]!;
      return left.startLine - right.startLine || left.startColumn - right.startColumn;
    });
    ordered.forEach((index, ordinal) => {
      resolved[index] = `${baseId}#${ordinal}`;
    });
  }
  return resolved;
}
