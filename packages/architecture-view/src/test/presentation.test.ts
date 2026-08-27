import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArchitectureViewDocument } from "@vibee/protocol";
import { applyAudiencePresentation, resolveVisibility } from "../presentation.js";

function baseDoc(): ArchitectureViewDocument {
  return {
    schemaVersion: 2,
    title: "Presentation test",
    components: [
      {
        id: "auth",
        type: "security",
        semanticRole: "responsibility",
        semanticRefs: ["resp-auth"],
        label: "Authentication Service",
        sublabel: "JWT · Express",
        pos: [0, 0],
        size: [160, 80],
        presentation: {
          simple: { label: "로그인 처리", sublabel: null },
        },
      },
      {
        id: "cache",
        type: "database",
        semanticRole: "state",
        semanticRefs: ["state-cache"],
        label: "Session Cache",
        pos: [300, 0],
        size: [160, 80],
        presentation: {
          simple: { visibility: "hide" },
        },
      },
    ],
    boundaries: [
      {
        id: "serverRuntime",
        kind: "runtime",
        semanticRefs: ["runtime-server"],
        label: "Server Runtime",
        wraps: ["auth", "cache"],
        presentation: { simple: { label: "서버" } },
      },
    ],
    connections: [
      {
        id: "auth-to-cache",
        from: "auth",
        to: "cache",
        label: "POST /auth/session",
        presentation: { simple: { label: "로그인 요청" } },
      },
    ],
  };
}

test("simple overrides apply: label/sublabel/boundary/connection all resolve to the audience-specific text", () => {
  const projected = applyAudiencePresentation(baseDoc(), "simple");
  const auth = projected.components.find((c) => c.id === "auth")!;
  assert.equal(auth.label, "로그인 처리");
  assert.equal(auth.sublabel, undefined);
  assert.equal(projected.boundaries[0]!.label, "서버");
  assert.equal(projected.connections[0]!.label, "로그인 요청");
});

test("technical audience without an override falls back to canonical label/sublabel untouched", () => {
  const projected = applyAudiencePresentation(baseDoc(), "technical");
  const auth = projected.components.find((c) => c.id === "auth")!;
  assert.equal(auth.label, "Authentication Service");
  assert.equal(auth.sublabel, "JWT · Express");
  assert.equal(projected.boundaries[0]!.label, "Server Runtime");
  assert.equal(projected.connections[0]!.label, "POST /auth/session");
});

test("applyAudiencePresentation never touches id/pos/size/wraps/from/to/semanticRole/semanticRefs", () => {
  const doc = baseDoc();
  const projected = applyAudiencePresentation(doc, "simple");
  for (let i = 0; i < doc.components.length; i++) {
    const original = doc.components[i]!;
    const proj = projected.components[i]!;
    assert.equal(proj.id, original.id);
    assert.deepEqual(proj.pos, original.pos);
    assert.deepEqual(proj.size, original.size);
    assert.equal(proj.semanticRole, original.semanticRole);
    assert.deepEqual(proj.semanticRefs, original.semanticRefs);
  }
  assert.deepEqual(projected.boundaries[0]!.wraps, doc.boundaries[0]!.wraps);
  assert.equal(projected.connections[0]!.from, doc.connections[0]!.from);
  assert.equal(projected.connections[0]!.to, doc.connections[0]!.to);
});

test("visibility=hide is reflected via resolveVisibility but the element is not removed from the array", () => {
  const doc = baseDoc();
  const projected = applyAudiencePresentation(doc, "simple");
  assert.equal(projected.components.length, doc.components.length);
  const cache = projected.components.find((c) => c.id === "cache")!;
  assert.equal(resolveVisibility(cache, "simple"), "hide");
  assert.equal(resolveVisibility(cache, "technical"), "show");
  assert.deepEqual(cache.pos, [300, 0]);
});

test("omitting presentation entirely leaves canonical label/sublabel untouched for both audiences", () => {
  const doc: ArchitectureViewDocument = {
    schemaVersion: 2,
    title: "No overrides",
    components: [
      {
        id: "plain",
        type: "backend",
        semanticRole: "responsibility",
        semanticRefs: ["resp-plain"],
        label: "Order Processing",
        sublabel: "Node.js",
        pos: [0, 0],
        size: [100, 60],
      },
    ],
    boundaries: [],
    connections: [],
  };
  for (const audience of ["simple", "technical"] as const) {
    const projected = applyAudiencePresentation(doc, audience);
    assert.equal(projected.components[0]!.label, "Order Processing");
    assert.equal(projected.components[0]!.sublabel, "Node.js");
    assert.equal(resolveVisibility(projected.components[0]!, audience), "show");
  }
});

test("resolveVisibility defaults to show when presentation is absent", () => {
  assert.equal(resolveVisibility({}, "simple"), "show");
  assert.equal(resolveVisibility({ presentation: {} }, "technical"), "show");
});
