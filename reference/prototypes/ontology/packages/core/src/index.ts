export {
  DEFAULT_RETAIN,
  SemanticStore,
  StoreError,
  generationName,
  initialProjectState,
  type Head,
  type LoadedState,
  type Manifest,
  type StateSnapshot,
} from "./store.js";
export {
  TRACE_NODE_CEILING,
  buildEvidenceGraph,
  projectTrace,
  type EvidenceGraph,
  type TraceOptions,
} from "./trace.js";
export {
  projectReachability,
  type ReachabilityDirection,
  type ReachabilityIR,
  type ReachabilityLink,
  type ReachabilityNode,
  type ReachabilityOptions,
} from "./reachability.js";
export {
  REUSE_SUGGESTION_THRESHOLD,
  claimCandidates,
  claimKeyOf,
  conceptCandidates,
  describeCandidate,
  normalizeName,
  normalizePredicate,
  objectKeyOf,
  scenarioCandidates,
  type ClaimDraft,
  type ConceptDraft,
  type IdentityCandidate,
  type ScenarioDraft,
} from "./identity.js";
export {
  annotatedPath,
  diagnostic,
  hasError,
  validateAgainst,
} from "./schema.js";
export {
  validateProposal,
  verifiedSourcePath,
  type PathVerdict,
  type ProposeContext,
} from "./propose.js";
export {
  MAX_TRANSACTION_RESTARTS,
  AnalyzeSession,
  AnalyzeTransaction,
  raceDiagnostic,
  type DiscardedProposal,
  type ReopenResult,
  type TransactionStatus,
} from "./transaction.js";
export {
  applyPatch,
  evidenceRefSites,
  referencedEvidenceIds,
  type PatchResult,
} from "./patch.js";
export {
  commitPatch,
  semanticDiffSince,
  validatePatch,
  type CommitPatchResult,
  type ValidateInput,
  type ValidateResult,
} from "./validator.js";
export { validateViewIR, type ViewValidateInput, type ViewValidateResult } from "./view-validator.js";
export {
  validateAnalysisBundle,
  type AnalysisBundleValidateInput,
  type AnalysisBundleValidateResult,
} from "./analysis-bundle-validator.js";
export {
  commitAnalysisBundle,
  type CommitAnalysisBundleResult,
} from "./analysis-bundle-commit.js";
export { VIEW_BUDGET } from "./viewBudget.js";
export {
  assessRepositoryCoverage,
  describeRepositoryTopology,
  detectRepositoryTopology,
} from "./repository-topology.js";
export {
  buildEngineSystemFactStore,
  canonicalResourceRef,
  certaintyRank,
  emptySystemFactStore,
  findSystemEntity,
  findSystemLink,
  mergeProposedSystemFacts,
  normalizeSystemMechanism,
  systemEntityId,
  systemLinkId,
  systemLinksForEntity,
} from "./system-facts.js";
export {
  validateSystemFactProposal,
  type SystemFactProposalContext,
  type ValidatedSystemFactBatch,
} from "./system-fact-proposal.js";
export {
  buildIncrementalAnalysisPlan,
  buildSystemImpactSet,
  acknowledgeSystemFactReview,
  isSystemImpactEmpty,
  previousSystemDigest,
  reconcileSystemFactStore,
} from "./system-fact-lifecycle.js";
export {
  buildExternalIntegrationCatalog,
  isExternalLookingImportName,
  localModuleNames,
  planDiscoveryGaps,
} from "./discovery.js";
export { buildV4RolloutReport } from "./rollout.js";
export {
  applyAnalysisBundlePatch,
  validateAnalysisBundlePatchScope,
} from "./analysis-bundle-patch.js";
