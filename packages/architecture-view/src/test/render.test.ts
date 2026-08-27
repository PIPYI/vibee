import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArchitectureViewDocument } from "@vibee/protocol";
import { renderArchitectureViewSvg } from "../render.js";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const convergingDoc: ArchitectureViewDocument = {
  schemaVersion: 2,
  title: "Converging edges",
  viewBox: [800, 600],
  components: [
    { id: "hub", type: "backend", semanticRole: "responsibility", semanticRefs: ["resp-hub"], label: "Hub", pos: [350, 260], size: [120, 100] },
    { id: "a", type: "frontend", semanticRole: "responsibility", semanticRefs: ["resp-a"], label: "A", pos: [50, 60], size: [100, 60] },
    { id: "b", type: "frontend", semanticRole: "responsibility", semanticRefs: ["resp-b"], label: "B", pos: [600, 60], size: [100, 60] },
    { id: "c", type: "frontend", semanticRole: "responsibility", semanticRefs: ["resp-c"], label: "C", pos: [600, 460], size: [100, 60] },
  ],
  boundaries: [],
  connections: [
    { id: "a-hub", from: "a", to: "hub" },
    { id: "b-hub", from: "b", to: "hub" },
    { id: "c-hub", from: "c", to: "hub" },
  ],
};

test("rendered SVG contains exactly one <defs> block", () => {
  const svg = renderArchitectureViewSvg(convergingDoc);
  assert.equal(countOccurrences(svg, "<defs>"), 1);
});

test("connection labels include an opaque background mask over their own route", () => {
  const doc: ArchitectureViewDocument = {
    ...convergingDoc,
    connections: [{ id: "a-hub", from: "a", to: "hub", label: "request" }],
  };
  const svg = renderArchitectureViewSvg(doc);
  assert.ok(svg.includes('class="av-connection-label-bg"'));
});

test("component groups are drawn after connection groups (z-order)", () => {
  const svg = renderArchitectureViewSvg(convergingDoc);
  const lastComponentGroup = svg.lastIndexOf('<g class="av-component');
  const lastConnectionGroup = svg.lastIndexOf('<g class="av-connection');
  assert.ok(lastComponentGroup > -1 && lastConnectionGroup > -1);
  assert.ok(lastComponentGroup > lastConnectionGroup);
});

test("legend only lists types actually present in the document", () => {
  const doc: ArchitectureViewDocument = {
    schemaVersion: 2,
    title: "Two types only",
    components: [
      { id: "fe", type: "frontend", semanticRole: "responsibility", semanticRefs: ["resp-fe"], label: "Frontend", pos: [40, 40], size: [160, 80] },
      { id: "be", type: "backend", semanticRole: "responsibility", semanticRefs: ["resp-be"], label: "Backend", pos: [320, 40], size: [160, 80] },
    ],
    boundaries: [],
    connections: [{ from: "fe", to: "be" }],
  };
  const svg = renderArchitectureViewSvg(doc);
  const legendMatch = svg.match(/<g class="av-legend">([\s\S]*?)<\/g>/);
  assert.ok(legendMatch, "expected a legend group in the output");
  const legendSection = legendMatch![1]!;
  const unusedTypeNames = ["database", "cloud", "security", "messagebus", "external"];
  for (const name of unusedTypeNames) {
    assert.ok(!legendSection.toLowerCase().includes(name), `legend should not mention unused type "${name}"`);
  }
});

const audienceDoc: ArchitectureViewDocument = {
  schemaVersion: 2,
  title: "Audience doc",
  viewBox: [800, 400],
  components: [
    {
      id: "traveler",
      type: "external",
      semanticRole: "actor",
      semanticRefs: ["actor-traveler"],
      label: "Traveler",
      pos: [40, 140],
      size: [140, 70],
    },
    {
      id: "orderProcessing",
      type: "backend",
      semanticRole: "responsibility",
      semanticRefs: ["resp-order-processing"],
      label: "Order Processing",
      sublabel: "Express · PostgreSQL",
      pos: [300, 140],
      size: [180, 80],
      presentation: {
        simple: { sublabel: null },
      },
    },
    {
      id: "internalMetrics",
      type: "cloud",
      semanticRole: "external",
      semanticRefs: ["ext-metrics"],
      label: "Metrics Pipeline",
      pos: [560, 140],
      size: [170, 80],
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
      wraps: ["orderProcessing"],
      pad: 20,
    },
  ],
  connections: [
    { id: "traveler-to-order", from: "traveler", to: "orderProcessing", label: "place order" },
  ],
};

test("default audience is simple: technical-only sublabel is hidden", () => {
  const svg = renderArchitectureViewSvg(audienceDoc);
  assert.ok(!svg.includes("Express"), "expected the technical sublabel to be suppressed under the default (simple) audience");
});

test("technical audience without an override shows the canonical sublabel", () => {
  const svg = renderArchitectureViewSvg(audienceDoc, { audience: "technical" });
  assert.ok(svg.includes("Express"));
});

test("a component hidden for simple is not drawn, but is drawn (and overridden to show) for technical", () => {
  const simpleSvg = renderArchitectureViewSvg(audienceDoc, { audience: "simple" });
  const technicalSvg = renderArchitectureViewSvg(audienceDoc, { audience: "technical" });
  assert.ok(!simpleSvg.includes('data-component-id="internalMetrics"'));
  assert.ok(technicalSvg.includes('data-component-id="internalMetrics"'));
});

test("actor components get a visually distinct treatment from plain responsibility nodes", () => {
  const svg = renderArchitectureViewSvg(audienceDoc);
  assert.ok(svg.includes('class="av-component av-component--external av-component--actor"'));
  assert.ok(!svg.match(/av-component--backend av-component--actor/));
});

test("runtime boundaries get a visually distinct treatment (badge) from region/security-group boundaries", () => {
  const svg = renderArchitectureViewSvg(audienceDoc, { audience: "technical" });
  assert.ok(svg.includes("av-boundary-badge"));
  assert.ok(svg.includes("kind-runtime"));
});

test("data-semantic-refs is present on components/boundaries/connections that have semanticRefs", () => {
  const svg = renderArchitectureViewSvg(audienceDoc, { audience: "technical" });
  assert.ok(svg.includes('data-semantic-refs="actor-traveler"'));
  assert.ok(svg.includes('data-semantic-refs="runtime-server"'));
});
