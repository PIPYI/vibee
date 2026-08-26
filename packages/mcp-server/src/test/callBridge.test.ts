import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { VIBEE_BRIDGE_TOKEN_ENV, VIBEE_BRIDGE_URL_ENV } from "@vibee/protocol";
import { callBridge } from "../index.js";

const originalFetch = globalThis.fetch;
const originalUrl = process.env[VIBEE_BRIDGE_URL_ENV];
const originalToken = process.env[VIBEE_BRIDGE_TOKEN_ENV];

beforeEach(() => {
  process.env[VIBEE_BRIDGE_URL_ENV] = "http://127.0.0.1:4310";
  process.env[VIBEE_BRIDGE_TOKEN_ENV] = "test-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env[VIBEE_BRIDGE_URL_ENV];
  else process.env[VIBEE_BRIDGE_URL_ENV] = originalUrl;
  if (originalToken === undefined) delete process.env[VIBEE_BRIDGE_TOKEN_ENV];
  else process.env[VIBEE_BRIDGE_TOKEN_ENV] = originalToken;
});

test("callBridge resolves to ok:false when fetch rejects (network failure), never throws", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;

  const result = await callBridge("/internal/validate-architecture-view", { hello: "world" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /ECONNREFUSED/);
    assert.ok(result.next_step.length > 0);
  }
});

test("callBridge resolves to ok:false on a non-2xx HTTP response", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: "bad request" }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await callBridge("/internal/submit-architecture-view", {});
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /400/);
    assert.match(result.error, /bad request/);
  }
});

test("callBridge resolves to ok:true with parsed JSON on a normal 200 response", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ diagnostics: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await callBridge("/internal/validate-architecture-view", { schemaVersion: 1 });
  assert.deepEqual(result, { ok: true, data: { diagnostics: [] } });
});

test("callBridge resolves to ok:false (never throws) when bridge env vars are missing", async () => {
  delete process.env[VIBEE_BRIDGE_URL_ENV];
  delete process.env[VIBEE_BRIDGE_TOKEN_ENV];
  const result = await callBridge("/internal/validate-architecture-view", {});
  assert.equal(result.ok, false);
});
