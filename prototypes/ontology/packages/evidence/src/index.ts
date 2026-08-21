export { indexProject, type IndexOptions } from "./indexer.js";
export {
  buildWorkSet,
  carryMissingEvidence,
  diffEvidence,
  summarizeDiff,
} from "./diff.js";
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
