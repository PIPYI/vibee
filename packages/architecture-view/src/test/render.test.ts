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

test("legend labels are bilingual (English name + Korean word)", () => {
  const doc: ArchitectureViewDocument = {
    schemaVersion: 2,
    title: "Legend bilingual",
    components: [
      { id: "fe", type: "frontend", semanticRole: "responsibility", semanticRefs: ["resp-fe"], label: "Frontend", pos: [40, 40], size: [160, 80] },
    ],
    boundaries: [],
    connections: [],
  };
  const svg = renderArchitectureViewSvg(doc);
  assert.ok(svg.includes("Frontend · 프론트엔드"));
});

const sampleDoc: ArchitectureViewDocument = {
  schemaVersion: 2,
  title: "Sample doc",
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
    },
    {
      id: "internalMetrics",
      type: "cloud",
      semanticRole: "external",
      semanticRefs: ["ext-metrics"],
      label: "Metrics Pipeline",
      pos: [560, 140],
      size: [170, 80],
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

test("every component's canonical sublabel is rendered directly", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(svg.includes("Express"), "expected the canonical sublabel to render (no audience projection)");
});

test("every component in the document is drawn, unconditionally", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(svg.includes('data-component-id="internalMetrics"'));
  assert.ok(svg.includes('data-component-id="traveler"'));
  assert.ok(svg.includes('data-component-id="orderProcessing"'));
});

test("actor components get a visually distinct treatment from plain responsibility nodes", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(svg.includes('class="av-component av-component--external av-component--actor"'));
  assert.ok(!svg.match(/av-component--backend av-component--actor/));
});

test("runtime boundaries get a numbered '실행 그룹N' badge instead of the old RUNTIME literal", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(svg.includes("실행 그룹1"));
  assert.ok(!svg.includes("RUNTIME"));
  assert.ok(svg.includes("kind-runtime"));
});

test("multiple runtime boundaries are numbered in array order", () => {
  const doc: ArchitectureViewDocument = {
    schemaVersion: 2,
    title: "Multiple runtimes",
    components: [
      { id: "a", type: "backend", semanticRole: "responsibility", semanticRefs: ["resp-a"], label: "A", pos: [40, 40], size: [100, 60] },
      { id: "b", type: "backend", semanticRole: "responsibility", semanticRefs: ["resp-b"], label: "B", pos: [300, 40], size: [100, 60] },
    ],
    boundaries: [
      { kind: "runtime", label: "Runtime A", wraps: ["a"] },
      { kind: "region", label: "Just a region", wraps: ["a"] },
      { kind: "runtime", label: "Runtime B", wraps: ["b"] },
    ],
    connections: [{ from: "a", to: "b" }],
  };
  const svg = renderArchitectureViewSvg(doc);
  assert.ok(svg.includes("실행 그룹1"));
  assert.ok(svg.includes("실행 그룹2"));
  assert.ok(!svg.includes("실행 그룹3"));
});

test("data-semantic-refs is present on components/boundaries/connections that have semanticRefs", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(svg.includes('data-semantic-refs="actor-traveler"'));
  assert.ok(svg.includes('data-semantic-refs="runtime-server"'));
});

test("connections get an invisible wide hit-area path in addition to the visible stroke", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(svg.includes('class="av-connection-hitarea"'));
  assert.ok(svg.includes('class="av-connection-path"'));
});

test("no dark-mode CSS or theme toggle machinery is emitted", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(!svg.includes("prefers-color-scheme"));
  assert.ok(!svg.includes("data-theme"));
});

test("short connection labels render as a single text element, unchanged", () => {
  const svg = renderArchitectureViewSvg(sampleDoc);
  assert.ok(svg.includes(">place order<"));
  assert.ok(!svg.includes('class="av-connection-label-short"'));
  assert.ok(!svg.includes('class="av-connection-label-full"'));
});

test("long connection labels render both a truncated and a full text element", () => {
  const doc: ArchitectureViewDocument = {
    schemaVersion: 2,
    title: "Long label",
    viewBox: [800, 400],
    components: [
      { id: "a", type: "backend", semanticRole: "responsibility", semanticRefs: ["resp-a"], label: "A", pos: [40, 140], size: [140, 70] },
      { id: "b", type: "backend", semanticRole: "responsibility", semanticRefs: ["resp-b"], label: "B", pos: [500, 140], size: [140, 70] },
    ],
    boundaries: [],
    connections: [
      {
        id: "a-b",
        from: "a",
        to: "b",
        label: "a very long connection label that definitely exceeds the maximum display width",
      },
    ],
  };
  const svg = renderArchitectureViewSvg(doc);
  assert.ok(svg.includes('class="av-connection-label-short"'));
  assert.ok(svg.includes('class="av-connection-label-full"'));
  assert.ok(svg.includes("…"));
  assert.ok(svg.includes("av-connection-label-bg--truncatable"));
});
