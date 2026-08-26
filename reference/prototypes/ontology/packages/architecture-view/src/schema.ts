/**
 * `packages/core/src/schema.ts`와 같은 ajv 관례를 쓰되, 별도 ajv 인스턴스를 둔다 — 이 패키지가
 * `@onto/core`에 의존하지 않아야 "이 변경이 Workflow 경로를 건드리는가"를 파일 목록만으로
 * 확인할 수 있다(v7/README.md §1).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import { diagnostic, type Diagnostic } from "./diagnostic.js";

const SCHEMA_PATH = fileURLToPath(new URL("../schemas/architecture-view.schema.json", import.meta.url));
const EXAMPLE_PATH = fileURLToPath(new URL("../examples/minimal.architecture-view.json", import.meta.url));

const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
let compiled: ValidateFunction | undefined;
let schemaText: string | undefined;
let exampleText: string | undefined;

/**
 * 스키마 원문. archify SKILL.md의 "Fast authoring path"(스키마 1개 + 예시 1개만 읽고 저작)를
 * 프롬프트 텍스트로 재구현하는 데 쓴다(v7/README.md §5.1) — AI의 Read 도구는 분석 대상
 * 저장소에 묶여 있어 이 패키지 파일을 직접 읽을 수 없으므로, bridge가 대신 읽어 프롬프트에
 * 인라인한다.
 */
export function architectureViewSchemaText(): string {
  schemaText ??= readFileSync(SCHEMA_PATH, "utf8");
  return schemaText;
}

export function architectureViewExampleText(): string {
  exampleText ??= readFileSync(EXAMPLE_PATH, "utf8");
  return exampleText;
}

function validator(): ValidateFunction {
  if (!compiled) {
    const schema = JSON.parse(architectureViewSchemaText()) as object;
    compiled = ajv.compile(schema);
  }
  return compiled;
}

export function checkSchema(doc: unknown): Diagnostic[] {
  const validate = validator();
  if (validate(doc)) return [];
  return (validate.errors ?? []).map((error) =>
    diagnostic("architecture-view/schema", "error", `${error.instancePath || "/"} ${error.message ?? "schema를 만족하지 않습니다"}`.trim(), {
      subject: { path: error.instancePath },
      evidence: { keyword: error.keyword, params: error.params, schemaPath: error.schemaPath },
      supportedFixes: ["schema를 만족하도록 이 위치의 값을 고쳐 다시 제출한다"],
    }),
  );
}
