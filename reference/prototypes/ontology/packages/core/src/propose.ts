/**
 * `propose_evidence` — **agent가 발견한 근거를 Core가 검증해 등록한다** (§6.5 R2 · S1).
 *
 * ## 왜 이 tool이 있는가
 *
 * §2는 AI가 Repository를 직접 탐색한다고 했고 §11은 Evidence Engine을 "우선순위"로 두었지
 * **완전한 인덱스**로 두지 않았다. 엔진이 모델링하지 못한 근거(switch로 짜인 상태 기계,
 * 설정이 결정하는 정책, 템플릿 리터럴 route, 주석의 불변식)를 agent가 발견했을 때,
 * 이 tool이 없으면 할 수 있는 일은 **의미를 버리거나 refs를 지어내는 것**뿐이다.
 *
 * ## 검증은 전부 결정론이고, id 발급 **전에** 끝난다
 *
 * ```text
 * 1. 경로 안전성   repo-relative POSIX, ".." / 절대경로 / ".git" 차단  ← Archify A4
 * 2. 파일 실재     프로젝트 루트 안에 realpath로 존재하는가
 * 3. 범위 유효     endLine >= startLine, endLine <= 실제 줄 수
 * 4. 지문 계산     Core가 그 범위를 **직접 읽어** anchorFingerprint를 만든다   ← S1
 * 5. 심볼 대조     symbolHint 불일치는 **warning** — 엔진이 못 본 것을 가리키는 게 목적이므로
 * 6. id 발급       ev:agent:<sha1(relPath + ":" + kind + ":" + anchorFingerprint)>
 * ```
 *
 * **agent는 evidence id를 직접 쓰지 않는다.** 발급받은 id에만 grounding할 수 있다.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import {
  defaultProfileFor,
  fingerprintOf,
  lineCountOf,
  rawHashOf,
  sha1,
  sha256,
  sliceLines,
} from "@onto/evidence";
import type {
  Diagnostic,
  Evidence,
  EvidenceIndex,
  EvidenceProposal,
  Outcome,
} from "@onto/protocol";
import { entityKey } from "@onto/protocol";

import { diagnostic, hasError, validateAgainst } from "./schema.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export type ProposeContext = {
  projectPath: string;
  /** 현재 인덱스. symbolHint 대조와 graph 힌트 해석에 쓴다 */
  index: EvidenceIndex;
  /** transaction의 baseAnalysisVersion. **새 버전을 만들지 않는다** (S2) */
  observedAtVersion: number;
};

export type PathVerdict = { ok: true; path: string } | { ok: false; code: string; reason: string };

/**
 * Archify `verifiedSourcePath()`를 그대로 (A4).
 *
 * `..`·절대경로·`.git`·역슬래시·제어문자를 막는다. 여기서 한 번 막지 않으면 agent가
 * `../../../etc/passwd`를 근거라고 등록할 수 있다.
 */
export function verifiedSourcePath(value: string): PathVerdict {
  const sourcePath = String(value ?? "");
  if (
    !sourcePath ||
    sourcePath.startsWith("/") ||
    isAbsolute(sourcePath) ||
    sourcePath.includes("\\") ||
    CONTROL_CHARACTERS.test(sourcePath)
  ) {
    return {
      ok: false,
      code: "proposal/path-invalid",
      reason: "repo-relative POSIX 경로여야 합니다",
    };
  }
  const segments = sourcePath.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    segments[0] === ".git"
  ) {
    return {
      ok: false,
      code: "proposal/path-escape",
      reason: "저장소 밖으로 나가거나 .git 을 가리킬 수 없습니다",
    };
  }
  return { ok: true, path: segments.join("/") };
}

/** 심볼 인덱스의 symbolId 집합. 대조는 하되 **거절하지 않는다** (5). */
function symbolIdsOf(index: EvidenceIndex, relPath: string): Set<string> {
  const ids = new Set<string>();
  for (const item of index.evidence) {
    if (item.kind === "symbol" && item.filePath === relPath && item.symbolId) ids.add(item.symbolId);
  }
  return ids;
}

function entityExists(index: EvidenceIndex, key: string): boolean {
  for (const item of index.evidence) {
    const graph = item.graph;
    if (!graph) continue;
    if (graph.role === "entity" && entityKey(graph.entity) === key) return true;
  }
  return false;
}

/**
 * 제안 하나를 검증하고 Evidence를 만든다. **저장하지는 않는다** — transaction이 들고 있는다.
 */
export function validateProposal(
  context: ProposeContext,
  proposal: EvidenceProposal,
): Outcome<Evidence> {
  const diagnostics: Diagnostic[] = validateAgainst("evidence-proposal", proposal);
  if (hasError(diagnostics)) return { ok: false, diagnostics };

  // --- 1. 경로 안전성 -------------------------------------------------------
  const safe = verifiedSourcePath(proposal.filePath);
  if (!safe.ok) {
    diagnostics.push(
      diagnostic(safe.code, "error", `filePath 를 받아들일 수 없습니다: ${safe.reason}`, {
        subject: { path: "/filePath" },
        evidence: { filePath: proposal.filePath },
        supportedFixes: ["프로젝트 루트 기준의 상대 경로를 슬래시로 쓴다"],
      }),
    );
    return { ok: false, diagnostics };
  }
  const relPath = safe.path;

  // --- 2. 파일 실재 ---------------------------------------------------------
  const absolute = join(context.projectPath, relPath);
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = realpathSync(resolve(context.projectPath));
    if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error("not a file");
    realFile = realpathSync(absolute);
  } catch {
    diagnostics.push(
      diagnostic("proposal/file-missing", "error", `${relPath} 가 프로젝트 안에 없습니다.`, {
        subject: { path: "/filePath" },
        evidence: { filePath: relPath },
        supportedFixes: ["실재하는 파일을 가리킨다", "get_evidence 로 인덱싱된 파일을 확인한다"],
      }),
    );
    return { ok: false, diagnostics };
  }
  // symlink 로 루트 밖을 가리키는 경로도 막는다 — 경로 문자열 검사만으로는 새어 나간다.
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}/`)) {
    diagnostics.push(
      diagnostic("proposal/path-escape", "error", `${relPath} 가 프로젝트 밖을 가리킵니다.`, {
        subject: { path: "/filePath" },
        evidence: { filePath: relPath, resolved: realFile },
        supportedFixes: ["프로젝트 안의 파일을 가리킨다"],
      }),
    );
    return { ok: false, diagnostics };
  }

  // --- 3. 범위 유효 ---------------------------------------------------------
  const text = readFileSync(realFile, "utf8");
  const lines = lineCountOf(text);
  const startLine = proposal.location.startLine;
  const endLine = proposal.location.endLine ?? startLine;
  if (endLine < startLine) {
    diagnostics.push(
      diagnostic(
        "proposal/line-range-invalid",
        "error",
        `endLine(${endLine}) 이 startLine(${startLine}) 보다 작습니다.`,
        {
          subject: { path: "/location" },
          evidence: { startLine, endLine },
          supportedFixes: ["endLine 을 startLine 이상으로 고친다"],
        },
      ),
    );
    return { ok: false, diagnostics };
  }
  if (startLine > lines || endLine > lines) {
    // **지어낸 범위를 여기서 막는다** (acceptance 7).
    diagnostics.push(
      diagnostic(
        "proposal/line-out-of-range",
        "error",
        `${relPath} 는 ${lines} 줄인데 ${endLine} 줄을 가리켰습니다.`,
        {
          subject: { path: "/location" },
          evidence: { filePath: relPath, startLine, endLine, lineCount: lines },
          supportedFixes: [
            "파일에 실재하는 줄 범위를 쓴다",
            "get_evidence 로 실제 범위를 확인한다",
          ],
        },
      ),
    );
    return { ok: false, diagnostics };
  }

  // --- 4. 지문 계산 — **Core가 직접 읽는다** (S1) ---------------------------
  const profile = proposal.normalizationProfile ?? defaultProfileFor(relPath);
  const extent = sliceLines(text, { startLine, endLine });
  const anchorFingerprint = fingerprintOf(extent, profile);

  // --- 5. 심볼 대조 — 불일치는 **warning** ----------------------------------
  if (proposal.symbolHint) {
    const known = symbolIdsOf(context.index, relPath);
    const hinted = proposal.symbolHint.includes("#")
      ? proposal.symbolHint
      : `${relPath}#${proposal.symbolHint}`;
    if (!known.has(hinted)) {
      diagnostics.push(
        diagnostic(
          "proposal/symbol-mismatch",
          "warning",
          `symbolHint "${proposal.symbolHint}" 가 P0 인덱스에 없습니다. 제안은 그대로 받습니다.`,
          {
            subject: { path: "/symbolHint" },
            evidence: { symbolHint: proposal.symbolHint, resolved: hinted, filePath: relPath },
            supportedFixes: ["symbolHint 를 지운다", "인덱싱된 symbolId 로 고친다"],
          },
        ),
      );
    }
  }

  // --- graph 힌트 — 해석되지 않으면 **비순회 evidence로 저장하고 warning** (S2) ---
  let graph = proposal.graph;
  if (graph) {
    const refs = graph.role === "entity" ? [graph.entity] : [graph.from, graph.to];
    const unresolved = refs.map(entityKey).filter((key) => !entityExists(context.index, key));
    if (unresolved.length > 0) {
      diagnostics.push(
        diagnostic(
          "graph/unresolved-entity",
          "warning",
          `graph 의 EntityRef 가 인덱스에서 해석되지 않습니다: ${unresolved.join(", ")}. ` +
            "근거로는 등록하되 Trace 에는 나오지 않습니다.",
          {
            subject: { path: "/graph" },
            evidence: { unresolved },
            supportedFixes: ["실재하는 entity 를 가리킨다", "graph 를 빼고 제안한다"],
          },
        ),
      );
      graph = undefined;
    }
  }

  // --- 6. id 발급 -----------------------------------------------------------
  const id = `ev:agent:${sha1(`${relPath}:${proposal.kind}:${anchorFingerprint}`)}`;

  const evidence: Evidence = {
    id,
    kind: proposal.kind,
    origin: "agent",
    filePath: relPath,
    ...(proposal.symbolHint ? { symbolId: proposal.symbolHint } : {}),
    location: { startLine, endLine },
    rawHash: rawHashOf(extent),
    normalizedFingerprint: anchorFingerprint,
    normalizationProfile: profile,
    // relocation 이 창 길이를 되살릴 수 있도록 extent 전체를 담는다 (§6.5 S1).
    excerpt: extent,
    ...(graph ? { graph } : {}),
    summary: proposal.summary,
    ...(proposal.confidence !== undefined ? { confidence: proposal.confidence } : {}),
    fileContentHash: sha256(text),
    // **새 버전을 만들지 않는다** (S2). transaction 의 baseAnalysisVersion 그대로다.
    observedAtVersion: context.observedAtVersion,
    status: "present",
  };

  return { ok: true, value: evidence, diagnostics };
}
