import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { Diagnostic } from "@vibee/protocol";

// `schemas/` and `examples/` are siblings of `src/` at the package root (not
// inside `src/`), and `outDir` is `dist/` (also a package-root sibling), so
// from compiled `dist/schema.js` the relative path back up to them is
// `../schemas/...` / `../examples/...`.
const SCHEMA_URL = new URL("../schemas/architecture-view.schema.json", import.meta.url);
const EXAMPLE_URL = new URL("../examples/minimal.architecture-view.json", import.meta.url);

let cachedSchemaText: string | undefined;
let cachedExampleText: string | undefined;

/**
 * Raw JSON Schema text for the ArchitectureView document. This is the exact
 * text embedded in AI prompts elsewhere in this project, and the exact text
 * `checkSchema` parses and compiles -- both come from this one function so
 * the prompt-embedded schema and the runtime-validated schema can never
 * drift apart.
 */
export function architectureViewSchemaText(): string {
  if (cachedSchemaText === undefined) {
    cachedSchemaText = readFileSync(SCHEMA_URL, "utf8").trim();
  }
  return cachedSchemaText;
}

/** Raw JSON text of the generic few-shot ArchitectureView example. */
export function architectureViewExampleText(): string {
  if (cachedExampleText === undefined) {
    cachedExampleText = readFileSync(EXAMPLE_URL, "utf8").trim();
  }
  return cachedExampleText;
}

let cachedValidate: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!cachedValidate) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const schema = JSON.parse(architectureViewSchemaText());
    cachedValidate = ajv.compile(schema);
  }
  return cachedValidate;
}

export function checkSchema(doc: unknown): Diagnostic[] {
  const validate = getValidator();
  const valid = validate(doc);
  if (valid) return [];
  const errors = validate.errors ?? [];
  return errors.map((err) => {
    const subject = err.instancePath || "(root)";
    return {
      code: "architecture-view/schema",
      severity: "error" as const,
      message: `${subject} ${err.message ?? "is invalid"}`.trim(),
      subject,
      evidence: { keyword: err.keyword, params: err.params },
      supportedFixes: [`fix "${subject}" so it satisfies: ${err.message ?? "the schema"}`],
    };
  });
}
