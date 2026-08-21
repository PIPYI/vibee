export { indexProject, type IndexOptions } from "./indexer.js";
export {
  buildWorkSet,
  carryMissingEvidence,
  diffEvidence,
  summarizeDiff,
} from "./diff.js";
export {
  ADAPTERS,
  isConfigFile,
  modelKeyOf,
  routeKeyOf,
  runAdapters,
  type AdapterContext,
  type AdapterOutput,
  type EvidenceAdapter,
  type PendingLinkSpec,
} from "./adapters.js";
export {
  changedFilesSince,
  dirtyFiles,
  isGitRepository,
  type GitChange,
} from "./git.js";
export {
  fileEvidenceId,
  fingerprintOf,
  linkEvidenceBaseId,
  rawHashOf,
  resolveLinkIds,
  sha256,
  symbolEvidenceId,
  symbolIdOf,
  type LinkIdCandidate,
} from "./ids.js";
export {
  defaultProfileFor,
  isCodeFile,
  normalizeTokens,
  normalizedText,
} from "./normalize.js";
export {
  collectSourceFiles,
  isSourceFile,
  isTestFile,
  toPosix,
  TYPESCRIPT,
  type LanguageConfig,
} from "./lang.js";
export { collectSymbolSites, type SymbolSite } from "./sites.js";
