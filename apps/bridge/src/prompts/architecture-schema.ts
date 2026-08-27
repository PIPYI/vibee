import { architectureViewSchemaText, runtimeSemanticSchemaText } from "@vci/system-map";

// The fenced markers below are load-bearing: prompt.test.ts finds the text
// between them and re-parses it to assert it deep-equals the real schema
// text (JSON.parse(architectureViewSchemaText()) / JSON.parse(runtimeSemanticSchemaText())).
// Never hand-write a description of either schema in prose anywhere in this
// prompt -- that is exactly the drift this fence/test pair exists to catch
// (see docs/v1_plan.md 4.2, docs/v2_plan.md §12.4). The "architecture-view-schema"
// fence name/shape is unchanged from V1 for minimal blast radius; the
// "runtime-semantic-schema" fence is new in V2.
export const ARCHITECTURE_VIEW_SCHEMA_FENCE_START = "```json architecture-view-schema";
export const RUNTIME_SEMANTIC_SCHEMA_FENCE_START = "```json runtime-semantic-schema";
export const SCHEMA_FENCE_END = "```";

/** The SystemMapDocument JSON Schema, embedded in its own fenced block. */
export function architectureViewSchemaBlock(): string {
  return `${ARCHITECTURE_VIEW_SCHEMA_FENCE_START}\n${architectureViewSchemaText()}\n${SCHEMA_FENCE_END}`;
}

/** The RuntimeSemanticDocument JSON Schema, embedded in its own fenced block. */
export function runtimeSemanticSchemaBlock(): string {
  return `${RUNTIME_SEMANTIC_SCHEMA_FENCE_START}\n${runtimeSemanticSchemaText()}\n${SCHEMA_FENCE_END}`;
}
