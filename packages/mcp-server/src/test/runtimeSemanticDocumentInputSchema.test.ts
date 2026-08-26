import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceJsonStrings, runtimeSemanticDocumentInputSchema } from "../index.js";

function sampleDocument() {
  return {
    schemaVersion: 1,
    title: "Sample App",
    repository: { url: "https://example.com/repo", revision: "deadbeef" },
    actors: [{ id: "actor-traveler", label: "Traveler", sources: [{ path: "src/app.ts", line: 1 }] }],
    runtimes: [
      {
        id: "runtime-server",
        label: "Server",
        kind: "server",
        implementationHints: [{ label: "Express", kind: "framework" }],
        sources: [{ path: "src/server.ts" }],
      },
    ],
    responsibilities: [
      {
        id: "resp-order-processing",
        runtimeId: "runtime-server",
        label: "Order Processing",
        implementationHints: [{ label: "PostgreSQL", kind: "database" }],
        sources: [{ path: "src/orders.ts", line: 10, endLine: 40 }],
      },
    ],
    states: [{ id: "state-orders", runtimeId: "runtime-server", label: "Order History", sources: [{ path: "src/db.ts" }] }],
    externals: [{ id: "ext-payments", label: "Payments API", kind: "api", sources: [{ path: "src/payments.ts" }] }],
    interactions: [
      {
        id: "int-place-order",
        from: "actor-traveler",
        to: "resp-order-processing",
        label: "place order",
        kind: "request",
        sources: [{ path: "src/orders.ts", line: 12 }],
      },
    ],
  };
}

test("runtimeSemanticDocumentInputSchema accepts a fully-populated RuntimeSemanticDocument shape", () => {
  const parsed = runtimeSemanticDocumentInputSchema.parse(sampleDocument());
  assert.equal(parsed.title, "Sample App");
  assert.equal(parsed.actors?.length, 1);
  assert.equal(parsed.interactions?.length, 1);
});

test("runtimeSemanticDocumentInputSchema accepts an empty object (every field optional)", () => {
  assert.doesNotThrow(() => runtimeSemanticDocumentInputSchema.parse({}));
});

test("runtimeSemanticDocumentInputSchema passes through unknown fields instead of stripping them", () => {
  const parsed = runtimeSemanticDocumentInputSchema.parse({ title: "x", futureField: "kept" });
  assert.equal((parsed as Record<string, unknown>)["futureField"], "kept");
});

test("coerceJsonStrings repairs a JSON-encoded actors array before it reaches the schema (live SDK serialization bug)", () => {
  const raw = {
    title: "Sample App",
    actors: JSON.stringify([{ id: "actor-traveler", label: "Traveler" }]),
  };
  const coerced = coerceJsonStrings(raw) as Record<string, unknown>;
  assert.ok(Array.isArray(coerced["actors"]));

  const parsed = runtimeSemanticDocumentInputSchema.parse(coerced);
  assert.equal(parsed.actors?.[0]?.id, "actor-traveler");
});

test("coerceJsonStrings repairs a JSON-encoded implementationHints array nested inside a responsibility", () => {
  const raw = {
    responsibilities: [
      {
        id: "resp-order-processing",
        runtimeId: "runtime-server",
        label: "Order Processing",
        implementationHints: JSON.stringify([{ label: "PostgreSQL", kind: "database" }]),
        sources: [{ path: "src/orders.ts" }],
      },
    ],
  };
  const coerced = coerceJsonStrings(raw);
  const parsed = runtimeSemanticDocumentInputSchema.parse(coerced);
  assert.deepEqual(parsed.responsibilities?.[0]?.implementationHints, [{ label: "PostgreSQL", kind: "database" }]);
});
