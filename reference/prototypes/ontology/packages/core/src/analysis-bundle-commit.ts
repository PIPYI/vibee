/**
 * `submit_analysis_bundle` 커밋 (schema3 §5.2 Stage 4).
 *
 * `validator.ts`의 `commitPatch`와 같은 층위지만 훨씬 단순하다 — `AnalysisBundle`은
 * `propose_evidence`로 새 근거를 만들지 않으므로(Stage 3는 Stage 1 골격 + Stage 2 memory
 * 안에서만 클러스터링·라벨링한다), `AnalyzeTransaction`의 pendingEvidence·race 복구 기계가
 * 필요 없다.
 *
 * **검증은 `store.commit()`의 mutate 클로저 **안에서** 돈다** — `serialized()` lock 안이므로
 * "검증 시점의 EvidenceIndex/SemanticMemory"와 "실제로 커밋되는 EvidenceIndex/SemanticMemory"가
 * 항상 같은 스냅샷이다. `commitPatch`의 ⓪(재확인)처럼 head를 미리 읽어 두고 나중에 다시
 * 비교할 필요가 없다 — 애초에 벌어질 틈이 없다.
 */
import type { AnalysisBundle, Diagnostic, Outcome } from "@onto/protocol";

import { validateAnalysisBundle } from "./analysis-bundle-validator.js";
import { hasError } from "./schema.js";
import type { SemanticStore, StateSnapshot } from "./store.js";

export type CommitAnalysisBundleResult = {
  generation: number;
  analysisVersion: number;
  semanticVersion: number;
};

class PrecommitError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super("precommit");
  }
}

/**
 * `bundle`을 검증하고 통과하면 하나의 generation으로 커밋한다.
 *
 * `analysisVersion`/`semanticVersion`/`freshness`는 agent가 무엇을 보냈든 **여기서
 * 덮어쓴다** — schema3 §3.5가 "Core가 커밋 시점에 찍는다"고 정한 필드다. 커밋 시점의
 * `snapshot.project`가 유일한 출처다.
 */
export async function commitAnalysisBundle(
  store: SemanticStore,
  bundle: unknown,
): Promise<Outcome<CommitAnalysisBundleResult>> {
  let diagnostics: Diagnostic[] = [];

  try {
    const committed = await store.commit("analysis bundle", "bundle", (snapshot: StateSnapshot) => {
      const result = validateAnalysisBundle({
        bundle,
        evidence: snapshot.evidence,
        systemFacts: snapshot.systemFacts,
        memory: snapshot.memory,
        projectPath: store.projectPath,
      });
      diagnostics = result.diagnostics;
      if (hasError(diagnostics) || !result.bundle) {
        throw new PrecommitError(diagnostics);
      }

      const stamped: AnalysisBundle = {
        ...result.bundle,
        analysisVersion: snapshot.project.analysisVersion,
        semanticVersion: snapshot.project.semanticVersion,
        freshness: "current",
        ...(result.repositoryTopology ? { repositoryTopology: result.repositoryTopology } : {}),
      };
      snapshot.analysisBundle = stamped;
      return snapshot;
    });

    return {
      ok: true,
      value: {
        generation: committed.generation,
        analysisVersion: committed.project.analysisVersion,
        semanticVersion: committed.project.semanticVersion,
      },
      diagnostics,
    };
  } catch (error) {
    if (error instanceof PrecommitError) {
      return { ok: false, diagnostics: error.diagnostics };
    }
    throw error;
  }
}
