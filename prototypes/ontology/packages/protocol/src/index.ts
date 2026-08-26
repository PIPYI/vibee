export * from "./agent.js";
export * from "./schemas.js";
export * from "./architecture-view.js";

/**
 * Evidence Engine · Core · MCP server · bridge · 브라우저가 공유하는 타입.
 *
 * 브라우저 번들이 이 모듈을 import 하므로 **Node 내장 모듈을 쓰면 안 된다.**
 * 파일시스템 관련 헬퍼는 `@onto/protocol/node`에 둔다.
 *
 * 근거는 docs/ontology/ontology_schema.md(아키텍처)와
 * docs/ontology/implementation_plan.md(구현 결정)다. 주석의 §는 전자, R/S/T/U/V는 후자다.
 */

// ---------------------------------------------------------------------------
// 진단 (implementation_plan A3)
// ---------------------------------------------------------------------------

/**
 * Validator 실패는 **전부** 이 모양으로 agent에게 되돌아간다.
 *
 * §17이 "AI 자유도를 높이는 대신 Validator를 강화한다"고 했다. 그러려면 실패가
 * 되돌아가 **고쳐질 수 있어야** 한다. 그래서 위치(`subject.path`)와 수리 방법
 * (`supportedFixes`)이 메시지와 함께 실린다.
 */
export type Diagnostic = {
  /** 기계가 분기할 수 있는 코드. 예: "evidence/not-present" */
  code: string;
  severity: "error" | "warning";
  /** 위치가 주석된 사람이 읽는 문장. 예: `/addedClaims/2 (id: "clm-7") /evidenceRefs/0 ...` */
  message: string;
  /** 어디가 문제인가. JSON pointer와 관련 id */
  subject: Record<string, unknown>;
  /** 무엇을 보고 그렇게 판단했는가 */
  evidence: Record<string, unknown>;
  /** agent가 고를 수 있는 수리 방법 */
  supportedFixes: string[];
};

/** Validator·tool 호출의 공통 결과 모양. 실패해도 예외를 던지지 않는다 (C5). */
export type Outcome<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };

// ---------------------------------------------------------------------------
// 버전
// ---------------------------------------------------------------------------

/**
 * `project.json`. generation 안에 산다 (T4).
 *
 * 세 버전은 서로 다른 것을 센다 — 섞으면 §45 증분 갱신이 깨진다.
 */
export type ProjectState = {
  projectId: string;
  name: string;

  /**
   * 결정론적 저장소 인덱스의 상태. **Evidence Engine이 (재)인덱싱할 때만 오른다** (S2).
   * `propose_evidence`도, Semantic Patch도 이것을 올리지 않는다.
   */
  analysisVersion: number;

  /** Semantic Memory의 상태. Semantic Patch가 커밋될 때 오른다. */
  semanticVersion: number;

  /**
   * 이 프로젝트에서 전체 discovery가 **한 번이라도 완료된 analysisVersion**. 0이면
   * 아직 한 번도 없었다는 뜻이다.
   *
   * `semanticVersion`/`memory.concepts`로 "첫 분석 여부"를 유추하지 마라 — 그 둘은
   * Semantic Patch(AI turn)가 커밋돼야 오르는데, `/api/index`(재색인만) 뒤에 바로
   * `/api/analyze`가 오면 AI turn이 아직 한 번도 없었으므로 두 번째 호출도 "첫 분석"
   * 으로 잘못 보여서 불필요한 전체 재색인이 중복 실행된다. 이 필드는 Core가 재색인
   * 완료 시점에 직접 스탬프하는 사실이라 그 문제가 없다.
   */
  discoveryBaselineVersion: number;

  /**
   * 현재 Semantic Memory가 **어느 시점의 코드와 맞춰진 것인지** (V1 / plan §6.9).
   *
   * ```text
   * === analysisVersion  → 의미가 현재 코드와 맞춰져 있다 (reconcile current)
   * <   analysisVersion  → 코드는 앞서 갔고 의미는 아직 따라가지 못했다 (reconcile stale)
   * ```
   *
   * 재인덱싱 후 SemanticWorkSet이 비어 있으면(= 포매팅만 바뀐 경우) Core가 agent를
   * 부르지 않고 여기를 advance한다. 그것이 `cosmetic` 분류가 값을 만들어 내는 지점이다.
   */
  semanticReconciledAnalysisVersion: number;
};

/** reconcile이 현재 코드와 맞춰져 있는가 (V2에서 Overview/Scenario freshness에 쓴다). */
export function isReconcileCurrent(project: ProjectState): boolean {
  return project.semanticReconciledAnalysisVersion >= project.analysisVersion;
}

/** 한 generation이 무엇이었는지 사람이 읽을 기록 (§14 versions). */
export type SemanticVersion = {
  generation: number;
  analysisVersion: number;
  semanticVersion: number;
  semanticReconciledAnalysisVersion: number;
  at: string;
  /**
   * 무엇 때문에 만들어진 generation인가. `bundle`은 schema3 §5.2 Stage 4(AnalysisBundle 커밋).
   * `architecture-view`는 v7 — archify 패턴 Architecture 뷰 저작 커밋으로, `bundle`과 달리
   * `analysis-bundle-commit.ts`/I20-v4 검증을 거치지 않는다(별도 경로, v7/README.md §6).
   */
  source: "index" | "patch" | "init" | "bundle" | "rollback" | "architecture-view";
  message: string;
  /** patch generation일 때만 */
  diffSummary?: SemanticDiffSummary;
};

// ---------------------------------------------------------------------------
// Evidence (§10, §11 / R1 · S1 · T1 · T2 · U3)
// ---------------------------------------------------------------------------

/**
 * Trace가 순회할 수 있는 주소 (T2).
 *
 * 모든 evidence가 entity인 것은 아니다. entity는 **링크가 가리킬 수 있는 것**이다.
 */
export type EntityRef =
  | { kind: "file"; filePath: string }
  | { kind: "symbol"; symbolId: string }
  | { kind: "route"; routeKey: string }
  | { kind: "model"; modelKey: string }
  | ResourceEntityRef;

/**
 * Core adapter가 미리 알지 못한 런타임·외부 서비스·저장소도 주소를 잃지 않게 하는 V4 주소.
 *
 * `namespace`는 확장 가능한 문자열이다. `external`, `runtime`, `storage` 등이 권장값이지만
 * 닫힌 enum이 아니다. `key`에는 표시 label이 아니라 provider/resource의 안정적인 식별자를
 * 넣는다. 예: `resource:external:openai-responses`.
 */
export type ResourceEntityRef = {
  kind: "resource";
  namespace: string;
  key: string;
};

/** entity의 정규 문자열. **그 자체로 전순서**라 Trace 정렬의 tie-break이 단순해진다 (U2). */
export function entityKey(ref: EntityRef): string {
  switch (ref.kind) {
    case "file":
      return `file:${ref.filePath}`;
    case "symbol":
      return `symbol:${ref.symbolId}`;
    case "route":
      return `route:${ref.routeKey}`;
    case "model":
      return `model:${ref.modelKey}`;
    case "resource":
      return `resource:${ref.namespace}:${ref.key}`;
  }
}

// ---------------------------------------------------------------------------
// System Fact Store (V4)
// ---------------------------------------------------------------------------

/** 누가 fact를 발견했는지와, 어느 수준까지 사실로 승인됐는지는 서로 다른 축이다. */
export type FactOrigin = "engine" | "vibee";
export type FactCertainty = "confirmed" | "grounded" | "inferred";
export type SystemFactStatus = "valid" | "relocated" | "stale" | "missing" | "needs_review";

export type SystemEntity = {
  id: string;
  ref: EntityRef;
  kind: string;
  origin: FactOrigin;
  certainty: FactCertainty;
  evidenceRefs: string[];
  dependsOnEvidenceRefs: string[];
  status: SystemFactStatus;
  firstSeenVersion: number;
  lastValidatedVersion: number;
};

export type SystemLink = {
  id: string;
  from: EntityRef;
  to: EntityRef;
  kind: string;
  mechanism?: string;
  origin: FactOrigin;
  certainty: FactCertainty;
  evidenceRefs: string[];
  dependsOnEvidenceRefs: string[];
  status: SystemFactStatus;
  firstSeenVersion: number;
  lastValidatedVersion: number;
};

/** generation 안의 `system-facts.json`. */
export type SystemFactStore = {
  schemaVersion: 4;
  analysisVersion: number;
  entities: SystemEntity[];
  links: SystemLink[];
  /** migration·adapter·무결성 진단. fact를 조용히 버리지 않는다. */
  diagnostics: Diagnostic[];
};

/** Evidence diff에서 최종 지도 조각까지 닫힌 증분 영향 범위(V4 Phase 4). */
export type SystemImpactSet = {
  evidenceIds: string[];
  systemEntityIds: string[];
  systemLinkIds: string[];
  conceptIds: string[];
  claimIds: string[];
  scenarioIds: string[];
  architectureComponentIds: string[];
  architectureConnectionIds: string[];
  workflowNodeIds: string[];
  workflowEdgeIds: string[];
  sequenceIds: string[];
  discoveryRoots: string[];
  requiresFullDiscovery: boolean;
  requiresFullAssembly: boolean;
  reasons: string[];
};

export type DiscoveryGapKind =
  | "manifest-dependency"
  | "unresolved-import-call"
  | "config-consumer"
  | "runtime-boundary"
  | "adapter-degraded"
  | "semantic-coverage"
  /**
   * `isSourceFile`의 닫힌 언어 허용목록 밖에 있어 evidence가 전혀 안 생긴 파일들
   * (`EvidenceIndex.unindexedFiles`)에서 나온다. 특정 프레임워크 이름을 하드코딩하지
   * 않는 catch-all이다 — 새 언어가 추가돼도 이 kind는 코드 변경 없이 계속 잡는다.
   */
  | "unrecognized-source-language";

/** Vibee가 저장소 전체 대신 조사할 결정론적 open-world root. */
export type DiscoveryGap = {
  id: string;
  kind: DiscoveryGapKind;
  reason: string;
  filePaths: string[];
  evidenceRefs: string[];
  packageName?: string;
  configKeys?: string[];
  priority: "high" | "medium" | "low";
};

/** 특정 provider를 hard-code하지 않고 import/call/config를 묶은 외부 연동 후보. */
export type ExternalIntegrationCandidate = {
  id: string;
  packageName: string;
  providerKey: string;
  manifestPaths: string[];
  importPaths: string[];
  callPaths: string[];
  configKeys: string[];
  coveredBySystemFactIds: string[];
  status: "covered" | "discovery-gap";
};

/** 증분 turn에 전체 이전 상태 대신 전달하는 작은 digest. */
export type PreviousSystemDigest = {
  analysisVersion: number;
  entityCount: number;
  linkCount: number;
  reusableEntityIds: string[];
  reusableLinkIds: string[];
  reviewEntityIds: string[];
  reviewLinkIds: string[];
  impact: SystemImpactSet;
};

export type IncrementalAnalysisMode = "full" | "incremental" | "fast-path";

export type IncrementalAnalysisPlan = {
  mode: IncrementalAnalysisMode;
  semanticTurnRequired: boolean;
  assemblyTurnRequired: boolean;
  fullDiscovery: boolean;
  fullAssembly: boolean;
  reason: string;
  impact: SystemImpactSet;
  previousSystemDigest: PreviousSystemDigest;
  discoveryGaps: DiscoveryGap[];
  integrationCatalog: ExternalIntegrationCandidate[];
};

/** V4 rollout 상태. shadow는 V4를 제공하면서 같은 snapshot의 V3 호환 투영도 계측한다. */
export type SystemIntelligenceV4Mode = "off" | "shadow" | "on";

export type RolloutCoverage = {
  systemFacts: number;
  architectureConnections: number;
  externalIntegrations: number;
  journeySteps: number;
  journeyBranches: number;
  journeyLoops: number;
};

/**
 * Phase 8 비교 단위. `v3Projection`은 별도 provider 재실행이 아니라 동일 snapshot을
 * V3의 Trace-link 계약으로 읽은 결정론적 기준선이다.
 */
export type V4RolloutReport = {
  schemaVersion: 1;
  taskId: string;
  projectPath: string;
  at: string;
  featureMode: SystemIntelligenceV4Mode;
  analysisMode: IncrementalAnalysisMode;
  analysisReason: string;
  analysisVersion: number;
  semanticVersion: number;
  generation: number;
  providerTurns: number;
  tokenUsage?: number;
  durationMs: number;
  reusableFacts: number;
  reanalyzedFacts: number;
  reviewFacts: number;
  v4: RolloutCoverage & { ungroundedConnections: number };
  v3Projection?: RolloutCoverage;
  deltas?: RolloutCoverage;
  transitionReady: boolean;
  transitionBlockers: string[];
};

/**
 * 이 evidence가 Trace 그래프에서 무엇인가 (T2).
 *
 * `graph`가 없는 evidence는 **순회 대상이 아니다.** Concept를 grounding하는 데는 그대로
 * 쓰이지만 Trace에는 나오지 않는다 — "근거는 있지만 코드 그래프 상의 위치로는 표현되지
 * 않는다"가 실제로 있는 상태다.
 */
export type EvidenceGraphRole =
  | { role: "entity"; entity: EntityRef; label: string }
  | { role: "link"; from: EntityRef; to: EntityRef; linkKind: string };

/**
 * extent를 정규화하는 방식 (T1).
 *
 * `code` — 주석을 버린다. 코드 변경만 의미 변화로 본다.
 * `prose` — 주석·문서·설정 텍스트를 **보존**하고 공백만 압축한다.
 *
 * 왜 나누는가: `code`는 "불변식을 설명하는 주석만 바뀐" 경우를 `cosmetic`으로 분류해
 * **놓친다**(거짓 음성). 엔진이 모델링 못 하는 정책이 주석·설정에 있는 경우가 많고,
 * `propose_evidence`가 정확히 그런 곳을 가리키므로 그때는 `prose`를 쓴다.
 */
export type NormalizationProfile = "code" | "prose";

export type EvidenceStatus = "present" | "missing";

/** 이 근거가 차지하는 범위. 두 해시는 **이 extent에 대해** 계산된다. */
export type SourceRange = {
  startLine: number;
  endLine?: number;
};

/**
 * 하나의 근거.
 *
 * **id는 주소에서 나온다. 관측 시점이나 위치에서 나오지 않는다** (R1 · U3).
 * 줄 번호가 id에 들어가면 위쪽 코드가 한 줄 늘어날 때마다 Grounding이 전부 끊긴다.
 */
export type Evidence = {
  id: string;
  kind: string;
  /** 엔진이 인덱싱한 것인가, agent가 제안해 Core가 검증한 것인가 (R2) */
  origin: "engine" | "agent";

  filePath?: string;
  symbolId?: string;
  location?: SourceRange;

  /** exact 바이트 해시. `cosmetic` 판정의 입력이자 "코드가 수정되었다"는 UI 신호 */
  rawHash: string;
  /** 정규화 토큰 지문. **identity · relocation · 의미 변화 판정의 기준** (S1 · T1) */
  normalizedFingerprint: string;
  normalizationProfile: NormalizationProfile;

  /** 사람이 확인할 원문. **identity 기준이 아니다** */
  excerpt?: string;
  /** relocation이 정확했는가, 추정이었는가 (S1) */
  relocationConfidence?: "exact" | "degraded";

  graph?: EvidenceGraphRole;

  summary?: string;
  confidence?: number;

  /**
   * 관측 당시 그 **파일 전체**의 sha256.
   *
   * freshness 판정은 이것 하나다:
   * `present ⟺ fileContentHash === index.fileHashes[filePath]`
   *
   * "최신 실행에서 재관측되었는가"가 아니라 "이 근거가 사는 파일이 관측 이후
   * 바뀌었는가"가 기준이다. 증분 갱신과 모순되지 않는 유일한 정의다 (R1).
   */
  fileContentHash: string;
  observedAtVersion: number;
  status: EvidenceStatus;
  missingSinceVersion?: number;
};

/**
 * 두 analysisVersion 사이에서 이 evidence에 무슨 일이 있었는가 (T1 · V3).
 *
 * **두 축은 독립이다.** 내용은 그대로인데 위쪽에 줄만 늘어나면 `unchanged`이면서 동시에
 * 위치가 바뀐 것이고, 이동하면서 prettier까지 돌면 `cosmetic`이면서 이동한 것이다.
 * 하나의 enum으로는 표현되지 않는다.
 */
export type EvidenceDiff = {
  evidenceId: string;
  contentChange: EvidenceContentChange;
  /** 위치 변화 metadata. **dirty 판정에 쓰이지 않는다.** */
  relocated: boolean;
};

export type EvidenceContentChange =
  /** rawHash 동일 */
  | "unchanged"
  /** rawHash 다름, normalizedFingerprint 동일 — 포매팅·따옴표·주석·후행 콤마 */
  | "cosmetic"
  /** normalizedFingerprint 다름 */
  | "modified"
  /** 이전 generation에 이 id가 없음 */
  | "appeared"
  /** 주소가 더 이상 해석되지 않음 */
  | "missing";

/** Semantic Dirty 여부는 오직 `contentChange`로 판단한다 (V3). */
export function isSemanticDirty(diff: EvidenceDiff): boolean {
  return (
    diff.contentChange === "modified" ||
    diff.contentChange === "appeared" ||
    diff.contentChange === "missing"
  );
}

/**
 * 증분 analyze turn에서 agent에게 넘기는 할 일 (U1).
 *
 * 두 목록은 **뜻이 다르고 지시도 다르다.** 섞으면 안 된다.
 *
 * - `affected*` — 기존 의미 중 재검토할 것. 근거가 바뀌었거나 사라졌다.
 * - `ungroundedAppearedEvidenceIds` — 새로 나타났지만 아직 아무 의미와도 연결되지 않은 근거.
 *   **이것이 없으면 새 기능이 통째로 추가되어도 할 일 목록이 비어 agent가 그 존재조차
 *   모른다.**
 */
export type SemanticWorkSet = {
  dirtyEvidence: EvidenceDiff[];
  affectedConceptIds: string[];
  affectedClaimIds: string[];
  affectedScenarioIds: string[];
  ungroundedAppearedEvidenceIds: string[];
};

export function isWorkSetEmpty(work: SemanticWorkSet): boolean {
  return (
    work.dirtyEvidence.length === 0 &&
    work.affectedConceptIds.length === 0 &&
    work.affectedClaimIds.length === 0 &&
    work.affectedScenarioIds.length === 0 &&
    work.ungroundedAppearedEvidenceIds.length === 0
  );
}

/** Evidence Index 전체. generation 안의 `evidence.json`. */
export type EvidenceIndex = {
  analysisVersion: number;
  /** 파일별 sha256. freshness 판정의 기준값 (R1) */
  fileHashes: Record<string, string>;
  evidence: Evidence[];
  /** 어떤 adapter가 무엇에 실패했는가. **조용히 사라지지 않는다** (C1) */
  adapterReport: AdapterReportEntry[];
  /**
   * 언어를 몰라 `kind:"file"` evidence조차 못 만든 파일들 — `isSourceFile`의 닫힌
   * 허용목록 밖 확장자다(Rust·Elixir·PHP·Kotlin 등). 여기 있다고 코드가 아니라는 뜻이
   * 아니다 — Core가 아직 아무 신호도 못 얻었다는 뜻이다. `planDiscoveryGaps`가 이 목록을
   * 확장자별로 묶어 gap으로 드러낸다.
   */
  unindexedFiles: readonly { filePath: string; extension: string }[];
};

export type AdapterReportEntry = {
  adapterId: string;
  filePath?: string;
  level: "info" | "warning" | "error";
  message: string;
};

/**
 * agent가 발견한 근거의 등록 요청 (R2).
 *
 * agent는 evidence id를 직접 쓰지 않는다. Core가 검증한 뒤 발급한 id에만 grounding할 수 있다.
 */
export type EvidenceProposal = {
  kind: string;
  /** repo-relative POSIX. ".." / 절대경로 / ".git" 은 거절된다 (A4) */
  filePath: string;
  location: SourceRange;
  /** agent가 이것이라고 믿는 qualified name. 불일치는 error가 아니라 warning이다 */
  symbolHint?: string;
  summary: string;
  confidence?: number;
  normalizationProfile?: NormalizationProfile;
  /** 선택. EntityRef가 인덱스에서 해석되지 않으면 비순회 evidence로 저장하고 warning */
  graph?: EvidenceGraphRole;
};

// ---------------------------------------------------------------------------
// V4 Vibee System Fact Proposal
// ---------------------------------------------------------------------------

/** 한 batch 안에서 Core가 검증하고 Evidence ID를 발급할 source anchor. */
export type SourceAnchorProposal = {
  localId: string;
  kind: string;
  filePath: string;
  location: SourceRange;
  symbolHint?: string;
  summary: string;
  normalizationProfile?: NormalizationProfile;
};

/** Link endpoint는 이미 발급된 entity 또는 같은 batch의 local entity를 가리킨다. */
export type ProposedSystemEntityEndpoint =
  | { entityId: string }
  | { localId: string };

export type ProposedSystemEntity = {
  localId: string;
  ref: EntityRef;
  kind: string;
  anchorLocalIds: string[];
  certainty: "grounded" | "inferred";
};

export type ProposedSystemLink = {
  localId: string;
  from: ProposedSystemEntityEndpoint;
  to: ProposedSystemEntityEndpoint;
  kind: string;
  mechanism?: string;
  anchorLocalIds: string[];
  dependencyAnchorLocalIds?: string[];
  certainty: "grounded" | "inferred";
};

/**
 * 신규 entity와 그것을 사용하는 link를 원자적으로 제안한다.
 * localId는 batch 내부 주소일 뿐 generation에 저장되는 identity가 아니다.
 */
export type SystemFactProposal = {
  baseAnalysisVersion: number;
  anchors: SourceAnchorProposal[];
  entities: ProposedSystemEntity[];
  links: ProposedSystemLink[];
};

export type SystemFactProposalResult = {
  anchorIds: Record<string, string>;
  entityIds: Record<string, string>;
  linkIds: Record<string, string>;
  downgradedFactLocalIds: string[];
  unusedLocalIds: string[];
};

// ---------------------------------------------------------------------------
// Semantic Memory (§5, §7, §12, §13, §14)
// ---------------------------------------------------------------------------

export type SemanticStatus = "active" | "uncertain" | "deprecated" | "needs_review";

/**
 * 독립적으로 이름 붙이고 다시 참조할 가치가 있는 의미 단위 (§5).
 *
 * **전역 `type` 필드가 없다** (§6, I3). Core는 "이 Concept는 어떤 종류인가"를 먼저 묻지
 * 않는다. `hints`는 검색·레이아웃 보조일 뿐이고, 틀리거나 없어도 의미와 Grounding은 유효하다.
 */
export type SemanticConcept = {
  id: string;
  name: string;
  description?: string;
  aliases?: string[];
  hints?: string[];

  evidenceRefs: string[];
  intentRefs?: string[];

  confidence?: number;
  status: SemanticStatus;

  createdAtVersion: number;
  updatedAtVersion: number;
};

/**
 * Concept 사이 또는 Concept와 값 사이의 의미 있는 주장 (§7).
 *
 * **`predicate`는 자유 문자열이다** (§8, I3). 미리 정한 관계 종류로 normalize하도록
 * 강제하지 않는다 — AI가 이해한 의미를 손실 없이 보존하는 것이 우선이다.
 */
export type SemanticClaim = {
  id: string;

  subjectConceptId: string;
  predicate: string;
  object: { conceptId: string } | { value: string };

  description?: string;
  /** 기계 처리 보조. 선택이며 원문 의미를 대체하지 않는다 */
  semanticHint?: string;

  evidenceRefs: string[];
  intentRefs?: string[];

  confidence?: number;
  status: "active" | "uncertain" | "contradicted" | "needs_review";

  createdAtVersion: number;
  updatedAtVersion: number;
};

/**
 * 대표 사용자/시스템 목적의 **얇은** 영속 포인터 (§26 / plan §6.4).
 *
 * `ScenarioIR`은 View이고 cache다 — 영속하지 않는다. 영속하는 것은 이름·anchor·목표까지다.
 * 영속해야 하는 이유는 `OverviewIR.items[].scenarioRefs`가 이것을 가리키고(§22),
 * §50이 `Area → Canonical Scenario`를 기본 네비게이션으로 삼기 때문이다. id가 매번 바뀌면
 * Overview가 분석마다 링크를 다시 맺는다.
 *
 * **얇게 유지한다** — 두 번째 ontology가 되지 않게 하는 선이다.
 */
export type CanonicalScenarioEntry = {
  id: string;
  name: string;
  type: "user" | "system";
  goal?: string;
  anchorConceptIds: string[];
  status: "active" | "uncertain" | "deprecated";
  createdAtVersion: number;
  updatedAtVersion: number;
};

/** generation 안의 `semantic-memory.json`. */
export type SemanticMemory = {
  semanticVersion: number;
  concepts: SemanticConcept[];
  claims: SemanticClaim[];
  canonicalScenarios: CanonicalScenarioEntry[];
};

/**
 * Grounding (§12).
 *
 * **Concept 존재 근거와 Claim 관계 근거를 분리한다** — "이 Concept가 존재하는 근거"와
 * "이 관계가 성립하는 근거"는 다른 것이다.
 */
export type ConceptGrounding = {
  conceptId: string;
  evidenceRefs: string[];
  confidence?: number;
};

export type ClaimGrounding = {
  claimId: string;
  evidenceRefs: string[];
  confidence?: number;
};

export type GroundingStore = {
  conceptGroundings: ConceptGrounding[];
  claimGroundings: ClaimGrounding[];
};

/** 사용자가 원래 만들고 싶었던 것 (§13). 현재 구현과 **같은 truth가 아니다** (I6). */
export type IntentRecord = {
  id: string;
  kind: "requirement" | "decision" | "constraint" | "blueprint";
  title: string;
  content: string;
  status?: string;
  relatedConceptIds?: string[];
  relatedClaimIds?: string[];
};

// ---------------------------------------------------------------------------
// Semantic Patch (§16 / R3 · U1)
// ---------------------------------------------------------------------------

/**
 * 코드 변경 때 Semantic Memory 전체를 재생성하지 않는다 (§16, I8).
 *
 * `base*Version`은 stale write를 막는다 (R3). analyze turn은 길고 그 사이에 증분
 * 재인덱싱이나 다른 turn이 끼어들 수 있다 — base가 없으면 v3 기준으로 계산한 patch가
 * v4를 조용히 덮어쓴다.
 */
export type SemanticPatch = {
  baseAnalysisVersion: number;
  baseSemanticVersion: number;

  addedConcepts?: SemanticConcept[];
  updatedConcepts?: SemanticConcept[];
  removedConceptIds?: string[];

  addedClaims?: SemanticClaim[];
  updatedClaims?: SemanticClaim[];
  removedClaimIds?: string[];

  addedScenarios?: CanonicalScenarioEntry[];
  updatedScenarios?: CanonicalScenarioEntry[];
  removedScenarioIds?: string[];

  groundingUpdates?: GroundingUpdate[];
};

export type GroundingUpdate =
  | { target: "concept"; conceptId: string; evidenceRefs: string[]; confidence?: number }
  | { target: "claim"; claimId: string; evidenceRefs: string[]; confidence?: number };

/** 실제로 무엇이 바뀌었는가 (§47). Impact와 분리된다. */
export type SemanticDiffSummary = {
  conceptsAdded: string[];
  conceptsRemoved: string[];
  conceptsMeaningChanged: string[];
  claimsAdded: string[];
  claimsRemoved: string[];
  claimsContradicted: string[];
  groundingChanged: string[];
  scenariosAdded: string[];
  scenariosRemoved: string[];
};

// ---------------------------------------------------------------------------
// View (§18~§39 / A7 · S4 · U2 · V2)
// ---------------------------------------------------------------------------

export type ViewKind = "overview" | "scenario" | "trace" | "reachability";

/** 시작점을 미리 고정하지 않는다 (§19, I13). */
export type ViewAnchor =
  | { kind: "concept"; conceptId: string }
  | { kind: "scenario"; scenarioId: string }
  | { kind: "symbol"; symbolId: string }
  | { kind: "file"; filePath: string }
  | { kind: "intent"; intentId: string };

export type ViewScope = {
  /** Trace·Reachability 공통. entity hop 수 */
  hops?: number;
  /** Trace 전용. 기본은 양방향이되 **link의 실제 방향은 보존한다** (V-clarify) */
  direction?: "both" | "outgoing" | "incoming";
};

export type ViewRequest = {
  viewKind: ViewKind;
  anchor?: ViewAnchor;
  question?: string;
  scope?: ViewScope;
  /**
   * schema2 §6. Reachability 전용 — Trace의 `scope.direction`("both"|"outgoing"|"incoming")과는
   * 다른 축이다. Reachability는 항상 한 방향만 걷는다: upstream(무엇이 여기로 이어지는가) /
   * downstream(여기서 무엇으로 이어지는가). 두 방향을 섞지 않는다.
   */
  reachDirection?: "upstream" | "downstream";
};

/**
 * View cache의 freshness 키. **View 종류마다 다르다** (V2).
 *
 * 모든 View를 `(analysisVersion, semanticVersion)`으로 판정하면, 포매팅만 바꾼 커밋도
 * analysisVersion을 올리므로 **의미가 전혀 바뀌지 않았는데 Overview/Scenario를 AI로 다시
 * 생성하게 된다.**
 */
export type ViewCacheKey =
  | {
      viewKind: "overview" | "scenario";
      semanticVersion: number;
      plannerVersion: string;
      requestHash: string;
    }
  | {
      viewKind: "trace";
      analysisVersion: number;
      requestHash: string;
    };

/**
 * 캐시된 View의 신뢰 상태.
 *
 * `needs_review` — 코드가 바뀌었는데 의미가 아직 따라가지 못했다
 * (`semanticReconciledAnalysisVersion < analysisVersion`). **View를 지우지 않는다** —
 * 여전히 읽을 수 있고, 코드가 바뀌었다는 이유로 화면을 비우면 사용자는 아무것도 얻지 못한다.
 */
export type ViewFreshness = "current" | "needs_review";

export type CachedView<T> = {
  key: ViewCacheKey;
  freshness: ViewFreshness;
  builtAt: string;
  ir: T;
};

/** §22. Area는 **presentation hierarchy이지 Core ontology가 아니다**. */
export type OverviewIR = {
  title: string;
  areas: Array<{
    id: string;
    label: string;
    items: Array<{
      id: string;
      label: string;
      conceptRefs?: string[];
      scenarioRefs?: string[];
    }>;
  }>;
  importantConnections?: Array<{ from: string; to: string; label?: string }>;
};

/**
 * §28~§33. 비전공자 관점의 핵심 View.
 *
 * **좌표 필드가 없다** (A7) — layout은 Renderer가 결정론적으로 계산한다.
 * **DAG를 요구하지 않는다** (R5) — 재시도·재신청 루프는 실제로 흔하다. 대신 흐름의
 * 시작(`entryStepId`)과 끝(`outcomeStepIds`)을 요구한다.
 */
export type ScenarioIR = {
  id: string;
  name: string;
  type: "user" | "system";
  goal?: string;
  outcome?: string;

  participants: ScenarioParticipant[];
  steps: ScenarioStep[];
  transitions: ScenarioTransition[];
  branches?: ScenarioBranch[];
  stateChanges?: ScenarioStateChange[];
  /** schema2 §5. 세 필드(activations/phases/transition.kind) 모두 선택이다 — 없는 기존 IR도 그대로 유효하다. */
  activations?: ScenarioActivation[];
  phases?: ScenarioPhase[];

  entryStepId: string;
  outcomeStepIds: string[];

  evidenceRefs?: string[];
  confidence?: number;
};

/**
 * §29. 중요한 것은 `label`이고, 그것은 고정 vocabulary가 아니라
 * Repository + Semantic Memory + Intent에서 프로젝트에 맞게 생성된다 (I12).
 */
export type ScenarioParticipant = {
  id: string;
  label: string;
  conceptRefs?: string[];
  /** Renderer가 lane 배치에 참고할 뿐. **semantic correctness가 이것에 의존하지 않는다** */
  layoutHint?: string;
};

/** §30. Step은 Concept 하나와 1:1일 필요가 없다. 여러 개를 하나로 압축할 수 있다. */
export type ScenarioStep = {
  id: string;
  label: string;
  participantId?: string;
  conceptRefs: string[];
  claimRefs?: string[];
  evidenceRefs: string[];
  confidence?: number;
};

/** §31. Transition은 흐름상 다음 단계이고 Claim은 의미적 주장이다 — 같은 것이 아니다. */
export type ScenarioTransition = {
  fromStepId: string;
  toStepId: string;
  condition?: string;
  /**
   * back edge인가 (R5). 합법이지만 `condition`을 **반드시** 갖는다.
   * 렌더는 옆 레일의 회귀 호로 그리고 step 순서를 재배치하지 않는다.
   */
  loop?: boolean;
  /**
   * schema2 §5 — 없으면 "call"과 동일하게 다룬다 (하위호환). `loop`와는 다른 축이다:
   * `loop`는 되돌아가는 흐름이고, `return`은 응답이다. 렌더에서만 다르게 그린다.
   */
  kind?: "call" | "return";
  evidenceRefs: string[];
  confidence?: number;
};

/** §32. Activity Diagram의 Decision / Guard. */
export type ScenarioBranch = {
  sourceStepId: string;
  conditionLabel: string;
  conceptRefs?: string[];
  claimRefs?: string[];
  evidenceRefs: string[];
  paths: Array<{ label: string; nextStepId: string }>;
};

/** §33. State 개념을 차용하되 State를 Core Node Type으로 만들지 않는다. */
export type ScenarioStateChange = {
  subjectConceptId: string;
  from?: string;
  to?: string;
  changeKind?: "create" | "update" | "delete" | "state_transition";
  causedByStepId: string;
  evidenceRefs: string[];
};

/**
 * schema2 §5 — 참여자가 어느 step 구간 동안 활성인가. archify sequence의 activation bar에서
 * 표현 문법만 빌린다 (A11) — 좌표는 없고 항상 step id 참조다 (A7·A12).
 */
export type ScenarioActivation = {
  participantId: string;
  fromStepId: string;
  toStepId: string;
  evidenceRefs: string[];
};

/**
 * schema2 §5 — 흐름의 국면에 이름을 붙인다. archify sequence의 phase segment에서 표현
 * 문법만 빌린다 (A11). Reading Depth(§2)가 접을 자연스러운 단위이기도 하다.
 */
export type ScenarioPhase = {
  id: string;
  label: string;
  fromStepId: string;
  toStepId: string;
  evidenceRefs: string[];
};

/**
 * §37. **AI가 만들지 않는다** — Core가 Grounding/Evidence에서 결정론적으로 투영한다 (R4).
 * 그 안의 모든 것이 이미 Evidence에 존재하므로 AI에 맡기면 지연과 환각 표면만 는다.
 */
export type TraceIR = {
  anchorConceptIds?: string[];
  codeEntities: TraceEntity[];
  links: TraceLink[];
  /** hop 경계에서 잘렸다면 그 hop. 뷰어가 화면에 말한다 */
  truncatedAtHop?: number;
};

export type TraceEntity = {
  /** entityKey */
  id: string;
  kind: EntityRef["kind"];
  label: string;
  /** BFS 최단 거리. 순회 순서와 무관하다 (U2) */
  hop: number;
  /** 크기 > 1 인 SCC에 속하면 그 컴포넌트의 최소 entityKey */
  sccId?: string;
  filePath?: string;
  symbolId?: string;
};

/**
 * `cycle`과 `nonForward`는 **다른 것을 뜻한다** (U2).
 *
 * `hop(to) <= hop(from)`은 cycle 판정이 아니다 — `A→B, A→C, B→C`에서 `B→C`가 그것을
 * 만족하지만 이 그래프는 DAG다. 진짜 순환은 SCC로만 판정된다.
 */
export type TraceLink = {
  /** entityKey. **코드에 있는 실제 방향 그대로** — 역방향으로 도달했다고 뒤집지 않는다 */
  fromId: string;
  toId: string;
  kind: string;
  /** 이 엣지를 정당화하는 link-evidence들. 같은 쌍의 호출부 여러 개가 여기 모인다 */
  evidenceRefs: string[];
  /** SCC 판정 — 실제 순환 */
  cycle?: boolean;
  /** hop 비교 — **레이아웃 전용** */
  nonForward?: boolean;
  selfLoop?: boolean;
};

// ---------------------------------------------------------------------------
// Reachability (schema2 §6, M12) — **Impact가 아니다.**
// ---------------------------------------------------------------------------

/**
 * archify가 스스로 그은 경계를 그대로 따른다: "call it authored reachability, not impact,
 * blast radius, breakage, or runtime causality." 이 IR이 보장하는 것은 **"인덱싱된 관계를
 * 따라 여기서 저기에 닿는다"**뿐이다. Trace(§37)처럼 **AI가 만들지 않는다** — Core가
 * `buildEvidenceGraph`에서 결정론적으로 투영한다(R4와 같은 이유).
 */
export type ReachabilityDirection = "upstream" | "downstream";

export type ReachabilityNode = {
  /** entityKey */
  id: string;
  kind: EntityRef["kind"];
  label: string;
  /** anchor로부터의 최단 hop. 0은 anchor 자신이다 */
  hop: number;
  filePath?: string;
  symbolId?: string;
  /** 역 grounding으로 닿은 의미. 계산 시 memory를 안 넘기면 항상 빈 배열이다 */
  conceptRefs: string[];
};

export type ReachabilityLink = {
  fromId: string;
  toId: string;
  kind: string;
  evidenceRefs: string[];
};

export type ReachabilityIR = {
  /** 요청한 anchor를 사람이 읽을 문자열로. BFS가 우연히 처음 찾은 entity가 아니다 */
  anchor: string;
  direction: ReachabilityDirection;
  nodes: ReachabilityNode[];
  links: ReachabilityLink[];
  /** hop 경계에서 잘렸다면 그 hop. Trace의 truncatedAtHop과 같은 의미다 */
  truncatedAtHop?: number;
};

// ---------------------------------------------------------------------------
// Architecture / Workflow / Sequence Bundle (schema3 §1~§5)
// ---------------------------------------------------------------------------

/**
 * schema3 §4 — I16/A13을 다시 여는 절충안. **View IR에만** 존재한다.
 *
 * `SemanticConcept`/`SemanticClaim`에는 전역 `type`을 두지 않는다는 결정(I3, I16)은 그대로
 * 유지된다 — 이것은 Core identity의 전역 taxonomy가 아니라 Architecture/Workflow가 archify
 * 형태의 결과물을 내기 위해 쓰는 표시용 분류다 (I18).
 */
export type PresentationType =
  | "external"
  | "frontend"
  | "backend"
  | "database"
  | "queue"
  | "security"
  | "job"
  | "cloud"
  | "unknown";

/**
 * Architecture에서의 설명 역할. 배치 결과인 rank와 의미 역할을 분리한다.
 * `presentationType`은 시각적 기술 분류, `layer`는 독자가 읽는 구조적 층이다.
 */
export type ArchitectureLayer = "actor" | "interface" | "service" | "state" | "data" | "external";

/**
 * schema3 §3.1 — Architecture/Workflow 컴포넌트의 in/out 요소.
 *
 * 예: `{ label: "GET /api/bookings", kind: "route", direction: "in" }`.
 */
export type ComponentIO = {
  label: string;
  kind: "route" | "event" | "db" | "call" | "config" | "other";
  direction: "in" | "out";
  /** 있으면 Stage 1 골격 그래프 노드로 역참조 가능 (schema3 §5.2) */
  entityRef?: EntityRef;
  /** 빈 배열 금지 — validator가 거부한다 (I9 재확인) */
  evidenceRefs: string[];
  description?: string;
};

/** schema3 §3.2. */
export type ArchitectureComponent = {
  id: string;
  label: string;
  sublabel?: string;
  presentationType: PresentationType;
  /** 저장소 지도에서의 의미적 층. 없으면 레거시 번들로 취급해 렌더러가 안전하게 추정한다. */
  layer?: ArchitectureLayer;
  presentationTypeConfidence?: number;
  boundaryId?: string;
  /** SemanticConcept.id (있으면) */
  conceptRefs?: string[];
  /** 이 컴포넌트가 요약하는 실제 골격 노드들 (entityKey[]) */
  entityRefs: string[];
  /** entityRefs가 근거로 삼는 Evidence.id 합집합 */
  evidenceRefs: string[];
  /** evidenceRefs가 비었으면 validator가 거부 (I9) */
  description?: string;
  inputs?: ComponentIO[];
  outputs?: ComponentIO[];
  confidence?: number;
  /**
   * entityRefs가 가리키는 System Entity들의 최저 certainty(V5 A4) — Core가 채운다. LLM이
   * 보내도 Core가 실제 System Fact 기준으로 덮어쓴다. "확정(confirmed로 표시)"과 "화면에
   * 나타남"을 분리하는 축이다 — inferred여도 component 자체는 거부되지 않는다.
   */
  certainty?: FactCertainty;
};

/** schema3 §3.2. 시각적 그룹. `kind`는 자유 문자열이다 (I3와 같은 이유). */
export type ArchitectureBoundary = {
  id: string;
  label: string;
  kind: string;
  /** 포함하는 component id */
  wraps: string[];
};

/** schema3 §3.2. */
export type ArchitectureConnection = {
  id: string;
  from: string;
  to: string;
  label?: string;
  role?: "sync" | "async" | "data" | "control";
  /** V4 I20의 source of truth. 현재 generation의 검증된 SystemLink.id 목록. */
  systemLinkRefs?: string[];
  /** V3 읽기 호환. 제출 시 Core가 가능한 경우 systemLinkRefs로 migration한다. */
  traceLinkRefs?: string[];
  evidenceRefs: string[];
  /**
   * systemLinkRefs가 가리키는 System Link들의 최저 certainty(V5 A4) — Core가 채운다.
   * "confirmed"|"grounded"인 Link만으로 이어지면 그대로, 하나라도 "inferred"면
   * connection.certainty도 "inferred"가 된다. I20-v4는 inferred link를 더 이상 hard
   * reject하지 않지만, "확정 연결"과 동등하게 취급하지도 않는다 — 렌더러가 이 필드로
   * 시각적으로 구분해야 한다. status(valid/relocated가 아님)는 여전히 hard error다.
   */
  certainty?: FactCertainty;
};

export type ArchitectureViewGroup = {
  id: string;
  label: string;
  componentIds: string[];
  /** 프로젝트 지도에서는 접고, 상세 관계에서만 펼칠 그룹인가. */
  collapsedByDefault?: boolean;
};

/** Vibee는 픽셀이 아니라 이야기의 우선순위와 의미 그룹만 구성한다. */
export type ArchitectureViewPlan = {
  primaryPath: string[];
  groups: ArchitectureViewGroup[];
};

export type ArchitectureIR = {
  title: string;
  components: ArchitectureComponent[];
  boundaries: ArchitectureBoundary[];
  connections: ArchitectureConnection[];
  viewPlan?: ArchitectureViewPlan;
};

// ---------------------------------------------------------------------------
// Repository Topology — Core가 결정론적으로 만들고 AnalysisBundle에 찍는 저장소 골격
// ---------------------------------------------------------------------------

export type RepositoryRuntimeKind = "mobile-app" | "web-app" | "service" | "application";

export type RepositoryRuntime = {
  id: string;
  label: string;
  rootPath: string;
  /** manifest 기반으로 탐지됐을 때만 있다. route-cluster 기원 런타임은 없다(V5 B1). */
  manifestPath?: string;
  kind: RepositoryRuntimeKind;
  entrypointRefs: string[];
  evidenceRefs: string[];
  /**
   * "manifest"는 package.json 등에서 확정적으로 탐지된 런타임이고, "route-cluster"는
   * manifest 없이 route-surface 파일들의 공통 조상 디렉터리로만 추정된 런타임이다(V5 B1 —
   * 원래 탐지가 package.json에만 의존해 manifest 없는 Flask/Rails/Go 서비스가 통째로
   * 보이지 않던 문제). 후자는 entrypoint를 모르므로 "확정된 실행 단위"라고 과장하지 않고
   * 구분해 표시한다.
   */
  origin: "manifest" | "route-cluster";
};

export type RepositoryDataStore = {
  id: string;
  label: string;
  rootPath: string;
  runtimeId?: string;
  format: string;
  /**
   * "declared"는 사람이 선언한 데이터 자산, "generated-artifact"는 파이프라인이 실행마다
   * 스스로 만들어낸 산출물 폴더로 추정된다(V5 C1) — 타임스탬프형 하위 디렉터리가 반복되고
   * 그 안에서 같은 파일명이 되풀이될 때. 삭제하지 않고 표시만 하며, 커버리지 게이트의
   * missingDataStoreIds 집계에서 제외한다.
   */
  origin: "declared" | "generated-artifact";
  entityRefs: string[];
  evidenceRefs: string[];
};

/**
 * "이 파일이 HTTP 라우트를 선언한다"는 결정론적 신호(V5 A3) — 프레임워크 adapter든
 * generic-patterns.ts의 언어 비종속 탐지기든, route kind Evidence가 나온 파일마다 하나씩
 * 묶는다. RepositoryDataStore와 같은 자리에서 커버리지 검증기가 소비한다.
 */
export type RepositoryRouteSurface = {
  id: string;
  label: string;
  filePath: string;
  runtimeId?: string;
  routeKeys: string[];
  entityRefs: string[];
  evidenceRefs: string[];
};

export type RepositoryCoverage = {
  detectedRuntimeCount: number;
  representedRuntimeCount: number;
  detectedDataStoreCount: number;
  representedDataStoreCount: number;
  detectedRouteSurfaceCount: number;
  representedRouteSurfaceCount: number;
  missingRuntimeIds: string[];
  missingDataStoreIds: string[];
  missingRouteSurfaceIds: string[];
  sharedBoundaryRuntimeIds: string[];
};

export type RepositoryTopology = {
  runtimes: RepositoryRuntime[];
  dataStores: RepositoryDataStore[];
  routeSurfaces: RepositoryRouteSurface[];
  coverage: RepositoryCoverage;
};

/** schema3 §3.3. */
export type WorkflowLane = { id: string; label: string; kind: "actor" | "system" };

/** schema3 §3.3. */
export type WorkflowNode = {
  id: string;
  laneId: string;
  label: string;
  sublabel?: string;
  presentationType: PresentationType;
  conceptRefs?: string[];
  entityRefs: string[];
  evidenceRefs: string[];
  description?: string;
  inputs?: ComponentIO[];
  outputs?: ComponentIO[];
};

/**
 * schema3 §3.3~§3.4. `sequenceRef → SequenceIR.id`, 역방향은
 * `SequenceIR.triggeredByEdgeId → WorkflowEdge.id` — 1엣지-1시퀀스로 고정한다.
 */
export type WorkflowEdge = {
  id: string;
  from: string;
  to: string;
  /** 화면에 보이는 문자열. 예: "위치 · 추천 조회" — 가운데점으로 여러 용어를 잇는다 */
  label?: string;
  /** ["위치", "추천 조회"] — 구조화된 형태. SequenceIR.phases[]와 1:1 매핑된다 */
  labelTerms?: string[];
  role: "main" | "error" | "async" | "return";
  /** 클릭 시 열릴 시퀀스. 분석 시점에 이미 생성되어 있다 — 클릭은 조회일 뿐 요청이 아니다 */
  sequenceRef?: string;
  evidenceRefs: string[];
};

export type WorkflowIR = {
  title: string;
  lanes: WorkflowLane[];
  /** 해피패스 node id 순서 */
  mainPath: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

/**
 * 비전공자가 프로젝트의 여러 사용자/시스템 목적을 탐색하는 상위 지도.
 *
 * `WorkflowIR`처럼 서로 다른 목적을 한 그래프에 합치지 않는다. 각 journey는 기존
 * `ScenarioIR`을 그대로 사용해 목표·결과·분기·상태 변화를 보존한다. 좌표는 없으며
 * Renderer가 결정론적으로 계산한다.
 */
export type UserMapIR = {
  title: string;
  journeys: ScenarioIR[];
};

/** schema3 §3.5. */
export type SequenceMessage = {
  id: string;
  fromParticipantId: string;
  toParticipantId: string;
  /** 좌표가 아니다. 정수 전순서 — 렌더러가 y를 계산한다 (schema A7·A12, schema2 I14 재확인) */
  order: number;
  label: string;
  kind: "call" | "return" | "event";
  evidenceRefs: string[];
};

export type SequenceIR = {
  id: string;
  title: string;
  /** WorkflowEdge.id 역참조 (breadcrumb) */
  triggeredByEdgeId: string;
  /** 기존 타입 재사용 */
  participants: ScenarioParticipant[];
  messages: SequenceMessage[];
  /** 기존 타입 재사용 (schema2 §5) */
  activations?: ScenarioActivation[];
  /** 기존 타입 재사용, labelTerms 분절에 쓴다 */
  phases?: ScenarioPhase[];
  evidenceRefs: string[];
  confidence?: number;
};

/**
 * schema3 §3.5, §5.4 — 분석 시점에 한 번에 생성되고 generation에 원자적으로 커밋되는 단위.
 *
 * `sequences`는 `WorkflowEdge.sequenceRef`가 가리키는 전체 집합이다 — 해석 가치가 있다고
 * 판단된 엣지에만 생성되므로 `workflow.edges`보다 적을 수 있다.
 */
export type AnalysisBundle = {
  analysisVersion: number;
  semanticVersion: number;
  architecture: ArchitectureIR;
  workflow: WorkflowIR;
  /** schema4. 없는 레거시 bundle은 Web이 WorkflowIR에서 읽기 전용 호환 지도를 투영한다. */
  userMap?: UserMapIR;
  sequences: SequenceIR[];
  /** agent 입력이 아니라 Core가 저장소와 최종 Architecture를 대조해 커밋 시점에 만든다. */
  repositoryTopology?: RepositoryTopology;
  freshness: ViewFreshness;
};

export type AnalysisBundlePatchOperation = {
  op: "add" | "remove" | "replace";
  /** RFC 6902 JSON pointer. Core가 ImpactSet의 section/ID 범위로 제한한다. */
  path: string;
  value?: unknown;
};

export type AnalysisBundlePatch = {
  baseAnalysisVersion: number;
  baseSemanticVersion: number;
  operations: AnalysisBundlePatchOperation[];
};
