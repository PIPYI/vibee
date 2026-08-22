/**
 * AnalyzeTransaction (implementation_plan §6.5 S2 · §6.3 T3).
 *
 * ## S2 — 제안은 `analysisVersion`을 올리지 않는다
 *
 * 초안은 제안 시점에 새 `observedAtVersion`을 주었다. 두 가지가 깨진다.
 *
 * 1. 제안이 `analysisVersion`을 올리면, `baseAnalysisVersion = N`으로 계산 중이던 patch가
 *    **agent 자신의 tool 호출 때문에** stale-base로 거절된다 — 제안 → 거절 → 재조회 →
 *    제안의 **self-deadlock**이다.
 * 2. `analysisVersion`은 Trace cache의 staleness 키인데, 근거 하나를 더했다고 모든 캐시가
 *    무효가 될 이유가 없다.
 *
 * 그래서 **`analysisVersion`의 뜻을 하나로 고정한다: "결정론적 저장소 인덱스의 상태."**
 * Evidence Engine이 (재)인덱싱할 때만 오른다. 검증된 제안은 transaction 안에 머물다가
 * patch와 **하나의 generation으로 함께** 커밋된다 (§5 T4).
 *
 * ## T3 — race가 나면 transaction을 버리고 같은 session에서 새로 연다
 *
 * `pendingEvidence`를 새 인덱스로 자동으로 옮겨 주지 않는다. "여전히 유효한가"를 알려면 새
 * 파일 내용에 대해 검증을 다시 돌려야 하는데, 그럴 거면 agent가 다시 주장하게 하는 편이
 * 옳다 — 코드가 실제로 바뀐 뒤에는 agent가 **그 범위가 여전히 그 주장의 근거라는 데
 * 동의하지 않을 수도** 있다. 조용히 옮기면 재검토되지 않은 주장을 코드 변경 너머로 밀수하는
 * 셈이다. 규칙도 단순해진다: **하나의 transaction은 언제나 정확히 하나의 analysisVersion에
 * 묶인다.**
 */
import type { Diagnostic, Evidence, EvidenceIndex, EvidenceProposal, Outcome } from "@onto/protocol";

import { validateProposal } from "./propose.js";
import { diagnostic } from "./schema.js";

/**
 * 한 task에서 허용하는 재시작 횟수 (T3).
 *
 * format-on-save가 켜진 dev server가 돌고 있으면 실제로 계속 바뀐다. 무한 재시작보다
 * "파일이 계속 바뀌고 있습니다"라고 말해 주는 편이 낫다.
 */
export const MAX_TRANSACTION_RESTARTS = 3;

/**
 * **`"committed"`은 없다.** transaction은 "하나의 patch"가 아니라 "하나의 analysisVersion"에
 * 묶인다 (S2) — 성공한 커밋 뒤에도 같은 turn 안에서 agent가 더 제안하고 더 제출할 수 있어야
 * 한다. 유일한 종결 상태는 `"aborted"`다: T3의 race, 또는 turn 종료 시의 정리.
 */
export type TransactionStatus = "open" | "aborted";

export type DiscardedProposal = {
  id: string;
  kind: string;
  filePath?: string;
  summary?: string;
};

export class AnalyzeTransaction {
  readonly pendingEvidence: Evidence[] = [];
  status: TransactionStatus = "open";
  abortReason?: string;
  /** 이 transaction 안에서 성공한 커밋들의 generation. 진단·시험용이며 상태를 바꾸지 않는다 */
  readonly committedGenerations: number[] = [];

  constructor(
    readonly taskId: string,
    readonly projectPath: string,
    /** 이 turn이 작업하는 인덱스 상태. **turn 내내 불변이다** */
    readonly baseAnalysisVersion: number,
    /** base 시점의 인덱스. symbolHint 대조와 graph 해석의 기준 */
    readonly index: EvidenceIndex,
  ) {}

  /**
   * 검증된 제안을 transaction에 넣는다.
   *
   * 같은 근거를 두 번 제안하면 id가 같으므로 **덮어쓰지 않고 그대로 둔다** — id가 주소이자
   * 지문이므로 두 번째 제안은 첫 번째와 같은 것이다.
   */
  propose(proposal: EvidenceProposal): Outcome<Evidence> {
    if (this.status !== "open") {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "transaction/not-open",
            "error",
            `이 transaction 은 ${this.status} 상태입니다. 새 transaction 에서 다시 제안하세요.`,
            { subject: { taskId: this.taskId }, evidence: { status: this.status } },
          ),
        ],
      };
    }

    const outcome = validateProposal(
      {
        projectPath: this.projectPath,
        index: this.index,
        // **새 버전이 아니다** (S2).
        observedAtVersion: this.baseAnalysisVersion,
      },
      proposal,
    );
    if (!outcome.ok) return outcome;

    const existing = this.pendingEvidence.find((item) => item.id === outcome.value.id);
    if (!existing) this.pendingEvidence.push(outcome.value);
    return { ok: true, value: existing ?? outcome.value, diagnostics: outcome.diagnostics };
  }

  /** transaction 안에서만 보이는 근거를 포함해 조회한다 (§6.5 `get_evidence`). */
  visibleEvidence(): Evidence[] {
    const byId = new Map(this.index.evidence.map((item) => [item.id, item]));
    for (const item of this.pendingEvidence) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  findEvidence(id: string): Evidence | undefined {
    return (
      this.pendingEvidence.find((item) => item.id === id) ??
      this.index.evidence.find((item) => item.id === id)
    );
  }

  /** patch가 끝내 참조하지 않은 제안. 조용히 버리지 않고 로그로 남긴다 (S2). */
  unusedProposals(referenced: ReadonlySet<string>): DiscardedProposal[] {
    return this.pendingEvidence
      .filter((item) => !referenced.has(item.id))
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        ...(item.filePath ? { filePath: item.filePath } : {}),
        ...(item.summary ? { summary: item.summary } : {}),
      }));
  }

  abort(reason: string): DiscardedProposal[] {
    const discarded = this.unusedProposals(new Set());
    this.status = "aborted";
    this.abortReason = reason;
    // **반쯤 쓰인 evidence는 없다.** 전부 버린다.
    this.pendingEvidence.length = 0;
    return discarded;
  }
}

export type ReopenResult = { baseAnalysisVersion: number; index: EvidenceIndex };

/**
 * 하나의 agent session이 여는 transaction들 (T3).
 *
 * session은 유지되므로(Codex thread / Claude `session_id`, B2) 재시작 비용은 turn 하나뿐이다.
 * agent는 대화 문맥을 그대로 갖고 있어 **처음부터 탐색하지 않는다.**
 */
export class AnalyzeSession {
  private current: AnalyzeTransaction;
  private restarts = 0;
  /** 마지막 재시작에서 버린 제안들. agent에게 요약만 넘긴다 (T3 4단계) */
  lastDiscarded: DiscardedProposal[] = [];

  constructor(
    readonly taskId: string,
    readonly projectPath: string,
    opened: ReopenResult,
  ) {
    this.current = new AnalyzeTransaction(
      taskId,
      projectPath,
      opened.baseAnalysisVersion,
      opened.index,
    );
  }

  get transaction(): AnalyzeTransaction {
    return this.current;
  }

  get restartCount(): number {
    return this.restarts;
  }

  /**
   * `evidence/file-changed-during-turn` 이 났을 때 (T3).
   *
   * ```text
   * 1. 현재 transaction 을 abort. pendingEvidence 를 전부 버린다
   * 2. (호출자) 바뀐 파일을 재인덱싱 → analysisVersion N+1
   * 3. **같은 session 안에서** 새 transaction 을 연다 (baseAnalysisVersion = N+1)
   * 4. agent 에게 diagnostic · 새 base · dirty set · 버려진 제안 목록을 넘긴다
   * ```
   *
   * 상한을 넘으면 새로 열지 않고 진단만 돌려준다 — 무한 재시작보다 말해 주는 편이 낫다.
   */
  restartAfterRace(changedFiles: string[], reopen: () => ReopenResult): Outcome<AnalyzeTransaction> {
    const discarded = this.current.abort("evidence/file-changed-during-turn");
    this.lastDiscarded = discarded;

    if (this.restarts >= MAX_TRANSACTION_RESTARTS) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "transaction/restart-limit",
            "error",
            `파일이 계속 바뀌고 있습니다 (${MAX_TRANSACTION_RESTARTS}회 재시작). ` +
              "저장을 멈추고 다시 시도해 주세요.",
            {
              subject: { taskId: this.taskId },
              evidence: { restarts: this.restarts, changedFiles },
              supportedFixes: [
                "format-on-save 나 dev server 를 잠시 멈춘다",
                "분석을 다시 시작한다",
              ],
            },
          ),
        ],
      };
    }

    this.restarts += 1;
    const opened = reopen();
    this.current = new AnalyzeTransaction(
      this.taskId,
      this.projectPath,
      opened.baseAnalysisVersion,
      opened.index,
    );
    return { ok: true, value: this.current, diagnostics: [raceDiagnostic(changedFiles, opened)] };
  }

  /** `POST /api/tasks/:id/stop` 과 turn 종료가 부른다. */
  dispose(reason: string): void {
    if (this.current.status === "open") this.current.abort(reason);
  }
}

export function raceDiagnostic(changedFiles: string[], opened?: ReopenResult): Diagnostic {
  return diagnostic(
    "evidence/file-changed-during-turn",
    "error",
    `분석 중에 참조 파일이 바뀌었습니다: ${changedFiles.join(", ")}. ` +
      "이 transaction 은 버려졌습니다" +
      (opened ? `. 새 baseAnalysisVersion 은 ${opened.baseAnalysisVersion} 입니다.` : "."),
    {
      subject: { changedFiles },
      evidence: {
        changedFiles,
        ...(opened ? { baseAnalysisVersion: opened.baseAnalysisVersion } : {}),
      },
      supportedFixes: [
        "새 baseAnalysisVersion 으로 patch 를 다시 만든다",
        "여전히 유효하다고 판단하는 제안은 propose_evidence 로 다시 제안한다",
      ],
    },
  );
}
