/**
 * M4 시험이 공유하는 발판.
 *
 * **실제 파일시스템과 실제 store 를 쓴다.** propose/Validator 가 막으려는 것이 전부
 * "디스크의 현실과 어긋난 주장"이므로, 디스크를 mock 하면 시험이 증명하는 것이 없어진다.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SemanticStore, initialProjectState } from "@onto/core";
import { buildWorkSet, carryAgentEvidence, carryMissingEvidence, diffEvidence, indexProject } from "@onto/evidence";
import { readFileSync, existsSync } from "node:fs";

const scratches = [];

export function makeProject(files) {
  const dir = mkdtempSync(join(tmpdir(), "onto-m4-"));
  scratches.push(dir);
  writeFiles(dir, files);
  return dir;
}

export function writeFiles(dir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = join(dir, relPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
}

export function cleanup() {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** 커밋 1 — 재인덱싱 (§6.9). agent evidence 를 이어 붙이고 work set 을 만든다. */
export async function reindex(dir) {
  const store = new SemanticStore(dir);
  if (!store.isInitialized()) await store.init(initialProjectState("test", dir));
  const before = store.load();
  const version = before.project.analysisVersion + 1;

  const fresh = indexProject(dir, { analysisVersion: version });
  const readFile = (relPath) => {
    const absolute = join(dir, relPath);
    return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
  };
  const { index: withAgent, report } = carryAgentEvidence(before.evidence, fresh, readFile);
  // **순서가 중요하다** — diff 는 "지금 실제로 있는 것"과 비교해야 한다. missing 을 채워
  // 넣은 인덱스와 비교하면 사라진 근거가 unchanged 로 분류된다.
  const diffs = diffEvidence(before.evidence, withAgent);
  const withMissing = carryMissingEvidence(before.evidence, withAgent);
  const work = buildWorkSet(diffs, before.memory, before.grounding);
  const workEmpty = work.dirtyEvidence.length === 0 && work.ungroundedAppearedEvidenceIds.length === 0;

  await store.commit("re-index", "index", (snapshot) => {
    snapshot.project.analysisVersion = version;
    if (workEmpty) snapshot.project.semanticReconciledAnalysisVersion = version;
    snapshot.evidence = withMissing;
    return snapshot;
  });

  return { store, version, diffs, work, report, head: store.load() };
}

export function diffOf(diffs, id) {
  return diffs.find((item) => item.evidenceId === id);
}

/** 최소한의 유효한 patch. 시험마다 필요한 부분만 덮어쓴다. */
export function patchWith(head, overrides = {}) {
  return {
    baseAnalysisVersion: head.project.analysisVersion,
    baseSemanticVersion: head.project.semanticVersion,
    ...overrides,
  };
}

export function concept(id, name, evidenceRefs, extra = {}) {
  return { id, name, evidenceRefs, status: "active", ...extra };
}

export function claim(id, subjectConceptId, predicate, object, evidenceRefs, extra = {}) {
  return { id, subjectConceptId, predicate, object, evidenceRefs, status: "active", ...extra };
}

export function codesOf(diagnostics) {
  return diagnostics.map((item) => item.code).sort();
}
