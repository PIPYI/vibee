/**
 * v7 §5.2(c) — Archify `repository-evidence.mjs` 패턴의 네이티브 재구현.
 *
 * `sources[]`가 있을 때만 동작하는 선택적 체크다. `doc.repository.revision`이 있으면 git으로
 * 그 커밋 시점의 파일을, 없으면 작업 트리를 본다. LLM 왕복 없이 결정론적으로 끝난다.
 *
 * 다른 모든 파이프라인이 지키는 "허구 grounding 0"(I9와 같은 원칙)을 이 저작 경로에도 적용한다
 * — sources가 가리키는 파일·줄 범위가 실재하지 않으면 hard error다.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ArchitectureViewDocument } from "@onto/protocol";

import { diagnostic, type Diagnostic } from "./diagnostic.js";

export type CitationContext = { projectPath: string; revision?: string };

function git(projectPath: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", ["-C", projectPath, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) return { ok: false, stdout: "" };
  return { ok: true, stdout: result.stdout };
}

function readAtRevision(projectPath: string, revision: string, path: string): string | null {
  const result = git(projectPath, ["show", `${revision}:${path}`]);
  return result.ok ? result.stdout : null;
}

function readFromWorkingTree(projectPath: string, path: string): string | null {
  const absolute = join(projectPath, path);
  if (!existsSync(absolute)) return null;
  try {
    return readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}

export function checkCitations(doc: ArchitectureViewDocument, ctx: CitationContext): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const revision = doc.repository?.revision ?? ctx.revision;

  for (const component of doc.components) {
    for (const source of component.sources ?? []) {
      const content = revision ? readAtRevision(ctx.projectPath, revision, source.path) : readFromWorkingTree(ctx.projectPath, source.path);
      if (content === null) {
        diagnostics.push(
          diagnostic(
            "architecture-view/citation-missing-file",
            "error",
            `component "${component.id}"가 인용한 "${source.path}"${revision ? ` (${revision})` : ""}가 실재하지 않습니다.`,
            {
              subject: { componentId: component.id, path: source.path, revision },
              supportedFixes: ["실재하는 파일 경로로 고치거나 이 source를 제거한다"],
            },
          ),
        );
        continue;
      }
      const lineCount = content.split("\n").length;
      for (const [field, value] of [["line", source.line] as const, ["endLine", source.endLine] as const]) {
        if (value === undefined) continue;
        if (value < 1 || value > lineCount) {
          diagnostics.push(
            diagnostic(
              "architecture-view/citation-out-of-range",
              "error",
              `component "${component.id}"가 인용한 "${source.path}"의 ${field}=${value}가 파일 범위(1..${lineCount}) 밖입니다.`,
              {
                subject: { componentId: component.id, path: source.path, field, value, lineCount },
                supportedFixes: ["실제 파일 줄 범위 안의 값으로 고친다"],
              },
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}
