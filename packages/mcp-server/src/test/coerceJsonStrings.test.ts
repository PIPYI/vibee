import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceJsonStrings } from "../index.js";

test("coerceJsonStrings parses a JSON-encoded array string into a real array", () => {
  const input = { pos: "[100, 200]" };
  assert.deepEqual(coerceJsonStrings(input), { pos: [100, 200] });
});

test("coerceJsonStrings parses a JSON-encoded object string into a real object", () => {
  const input = { repository: '{"url":"x","revision":"abc"}' };
  assert.deepEqual(coerceJsonStrings(input), { repository: { url: "x", revision: "abc" } });
});

test("coerceJsonStrings recurses into nested arrays/objects", () => {
  const input = {
    components: [{ id: "a", pos: "[1, 2]", size: "[3, 4]" }],
  };
  assert.deepEqual(coerceJsonStrings(input), {
    components: [{ id: "a", pos: [1, 2], size: [3, 4] }],
  });
});

test("coerceJsonStrings leaves a genuine plain-text string field alone", () => {
  const input = { label: "Frontend App" };
  assert.deepEqual(coerceJsonStrings(input), { label: "Frontend App" });
});

test("coerceJsonStrings leaves an unparsable string that merely starts/ends with brackets alone", () => {
  const input = { label: "[not actually json" };
  assert.deepEqual(coerceJsonStrings(input), { label: "[not actually json" });
});

test("coerceJsonStrings is a no-op on an already-well-typed document", () => {
  const input = { components: [{ id: "a", pos: [1, 2], size: [3, 4] }], title: "x" };
  assert.deepEqual(coerceJsonStrings(input), input);
});
