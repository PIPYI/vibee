import { test } from "node:test";
import assert from "node:assert/strict";
import type { ArchitectureViewDocument } from "@vibee/protocol";
import { renderArchitectureViewSvg } from "../render.js";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const convergingDoc: ArchitectureViewDocument = {
  schemaVersion: 1,
  title: "Converging edges",
  viewBox: [800, 600],
  components: [
    { id: "hub", type: "backend", label: "Hub", pos: [350, 260], size: [120, 100] },
    { id: "a", type: "frontend", label: "A", pos: [50, 60], size: [100, 60] },
    { id: "b", type: "frontend", label: "B", pos: [600, 60], size: [100, 60] },
    { id: "c", type: "frontend", label: "C", pos: [600, 460], size: [100, 60] },
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
    schemaVersion: 1,
    title: "Two types only",
    components: [
      { id: "fe", type: "frontend", label: "Frontend", pos: [40, 40], size: [160, 80] },
      { id: "be", type: "backend", label: "Backend", pos: [320, 40], size: [160, 80] },
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
