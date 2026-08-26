export { indexProject, isDataAssetFile, type IndexOptions } from "./indexer.js";
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
  sha1,
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
  isGenericPatternSourceFile,
  isPythonSourceFile,
  isSourceFile,
  isTestFile,
  isTypeScriptSourceFile,
  toPosix,
  GENERIC_PATTERN_LANGUAGES,
  PYTHON,
  TYPESCRIPT,
  type LanguageConfig,
} from "./lang.js";
export { collectSymbolSites, type SymbolSite } from "./sites.js";
export { parsePythonSource, type PythonCall, type PythonRoute, type PythonSymbol } from "./python.js";
export { parseGenericRoutePatterns, type GenericRoute } from "./generic-patterns.js";
export { normalizeHttpPath, parseHttpCallPatterns, type HttpCall } from "./http-calls.js";
export {
  DEGRADED_SIMILARITY_THRESHOLD,
  carryAgentEvidence,
  lineCountOf,
  relocateExtent,
  relocationTokens,
  sliceLines,
  type AgentCarryReport,
  type PositionedToken,
  type RelocationResult,
} from "./relocate.js";
