/**
 * v7 §5.2 — 세 층을 순서대로 돌리는 진입점. 각 층은 독립적으로 테스트 가능하다.
 *
 * (a) 스키마+geometry는 항상 돈다. (b) 완전성 체크는 `ctx.repositoryTopology`가 있을 때만
 * 돈다(server가 AI 턴 전에 조용히 만들어 넘긴다 — AI에게 노출하지 않는다). (c) 인용 체크는
 * 어떤 component든 `sources[]`를 하나라도 쓴 경우에만 돈다 — 아무도 인용하지 않으면 git을
 * 부르지 않는다(archify 패턴과 동일하게 선택적이고 저렴하다).
 *
 * 스키마 검사에서 실패하면 geometry 등 나머지 층은 건너뛴다 — 모양이 안 맞는 문서에 좌표
 * 산수를 적용하면 의미 없는 진단만 늘어난다.
 */
import type { ArchitectureViewDocument, RepositoryTopology, SystemFactStore } from "@onto/protocol";

import { checkCitations } from "./citation.js";
import { checkCompleteness } from "./completeness.js";
import type { Diagnostic } from "./diagnostic.js";
import { checkGeometry } from "./geometry.js";
import { checkSchema } from "./schema.js";

export type ArchitectureViewValidationContext = {
  projectPath: string;
  repositoryTopology?: RepositoryTopology;
  /** Architecture 저작 turn 시작 시 만든 현재 fact. completeness warning 전용이다. */
  systemFacts?: SystemFactStore;
  gitRevision?: string;
};

function hasAnySource(doc: ArchitectureViewDocument): boolean {
  return doc.components.some((component) => (component.sources?.length ?? 0) > 0);
}

export function validateArchitectureView(doc: unknown, ctx: ArchitectureViewValidationContext): Diagnostic[] {
  const schemaDiagnostics = checkSchema(doc);
  if (schemaDiagnostics.length > 0) return schemaDiagnostics;

  const document = doc as ArchitectureViewDocument;
  const diagnostics: Diagnostic[] = [...checkGeometry(document)];

  if (ctx.repositoryTopology) diagnostics.push(...checkCompleteness(document, ctx.repositoryTopology, ctx.systemFacts));
  if (hasAnySource(document)) {
    diagnostics.push(
      ...checkCitations(document, { projectPath: ctx.projectPath, ...(ctx.gitRevision ? { revision: ctx.gitRevision } : {}) }),
    );
  }

  return diagnostics;
}

export { checkCitations, checkCompleteness, checkGeometry, checkSchema };
export { hasError } from "./diagnostic.js";
export type { Diagnostic } from "./diagnostic.js";
