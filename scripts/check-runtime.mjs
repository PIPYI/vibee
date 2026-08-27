import { assertSupportedNode, detectRuntime } from "./runtime.mjs";

try {
  assertSupportedNode();
  const runtime = detectRuntime();
  console.log(`[vci-runtime] ${runtime.platform}, Node ${runtime.nodeVersion}`);
} catch (error) {
  console.error(`[vci-runtime] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
