/**
 * Validator ① — ajv + **고칠 수 있는 위치로 주석된 경로** (implementation_plan §6.3, A3·A6).
 *
 * Archify가 확인한 것: schema 오류를 `/addedClaims/2/evidenceRefs/0`처럼 그대로 돌려주면
 * agent는 그것이 **어느 Claim인지** 모른다. 배열 인덱스는 patch를 다시 만들 때마다 바뀌므로
 * 다음 시도에서 엉뚱한 곳을 고친다. 그래서 지나온 노드의 `id`를 경로에 붙인다.
 *
 * ```text
 * /addedClaims/2 (id: "clm-7") /evidenceRefs/0
 * ```
 *
 * schema는 `@onto/protocol`에 **한 벌만** 있고 여기서는 컴파일만 한다 (A6).
 */
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

import type { Diagnostic } from "@onto/protocol";
import { EVIDENCE_PROPOSAL_SCHEMA, SEMANTIC_PATCH_SCHEMA } from "@onto/protocol";

/**
 * `allErrors` — 첫 오류에서 멈추지 않는다. agent가 한 번에 다 고칠 수 있어야 왕복이 줄어든다.
 * `strict: false` — schema 자체의 엄격 검사는 우리 목적이 아니다.
 */
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

const validators = new Map<string, ValidateFunction>();

function compile(key: string, schema: object): ValidateFunction {
  const existing = validators.get(key);
  if (existing) return existing;
  const compiled = ajv.compile(schema);
  validators.set(key, compiled);
  return compiled;
}

/**
 * JSON pointer를 **고칠 수 있는 위치**로 바꾼다 (A3).
 *
 * 지나온 객체에 `id`가 있으면 그 세그먼트 뒤에 붙인다. 인덱스만으로는 다음 시도에서
 * 같은 곳을 가리키지 못한다.
 */
export function annotatedPath(pointer: string, root: unknown): string {
  if (pointer === "") return "/";
  const segments = pointer.split("/").slice(1);
  let cursor: unknown = root;
  let output = "";

  for (const segment of segments) {
    const key = segment.replace(/~1/gu, "/").replace(/~0/gu, "~");
    output += `/${key}`;
    if (cursor !== null && typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[key];
      if (cursor !== null && typeof cursor === "object" && !Array.isArray(cursor)) {
        const id = (cursor as { id?: unknown }).id;
        if (typeof id === "string") output += ` (id: "${id}") `;
      }
    } else {
      cursor = undefined;
    }
  }
  return output.trimEnd();
}

function toDiagnostic(error: ErrorObject, root: unknown, code: string): Diagnostic {
  const where = annotatedPath(error.instancePath, root);
  return {
    code,
    severity: "error",
    message: `${where} ${error.message ?? "schema 를 만족하지 않습니다"}`.trim(),
    subject: { path: error.instancePath, annotatedPath: where },
    evidence: { keyword: error.keyword, params: error.params, schemaPath: error.schemaPath },
    supportedFixes: ["schema 를 만족하도록 이 위치의 값을 고쳐 다시 제출하라"],
  };
}

/** schema 검사. 통과하면 빈 배열이다. */
export function validateAgainst(
  key: "semantic-patch" | "evidence-proposal",
  payload: unknown,
): Diagnostic[] {
  const schema = key === "semantic-patch" ? SEMANTIC_PATCH_SCHEMA : EVIDENCE_PROPOSAL_SCHEMA;
  const code = key === "semantic-patch" ? "patch/schema" : "proposal/schema";
  const validate = compile(key, schema as object);
  if (validate(payload)) return [];
  return (validate.errors ?? []).map((error) => toDiagnostic(error, payload, code));
}

/** 진단 하나를 만드는 공통 헬퍼. 모든 Validator 단계가 같은 모양을 쓴다 (A3). */
export function diagnostic(
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  parts: {
    subject?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    supportedFixes?: string[];
  } = {},
): Diagnostic {
  return {
    code,
    severity,
    message,
    subject: parts.subject ?? {},
    evidence: parts.evidence ?? {},
    supportedFixes: parts.supportedFixes ?? [],
  };
}

export function hasError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}
