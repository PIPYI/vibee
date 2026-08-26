import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { renderArchitectureViewStandaloneHtml, renderArchitectureViewSvg } from "@onto/architecture-view";

const EXAMPLE_PATH = fileURLToPath(new URL("../examples/minimal.architecture-view.json", import.meta.url));

function loadExample() {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));
}

test("renderArchitectureViewSvg — 모든 component/connection/boundary/카드가 SVG에 나타난다", () => {
  const doc = loadExample();
  const svg = renderArchitectureViewSvg(doc);
  assert.ok(svg.startsWith("<svg"));
  for (const component of doc.components) {
    assert.ok(svg.includes(`data-component-id="${component.id}"`));
    assert.ok(svg.includes(component.label));
  }
  for (const boundary of doc.boundaries) assert.ok(svg.includes(boundary.label));
  for (const connection of doc.connections) assert.ok(svg.includes(connection.label));
});

test("renderArchitectureViewSvg — 라벨의 XML 특수문자를 이스케이프한다", () => {
  const doc = loadExample();
  doc.components[0].label = 'A & B <script>"x"</script>';
  const svg = renderArchitectureViewSvg(doc);
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("A &amp; B &lt;script&gt;&quot;x&quot;&lt;/script&gt;"));
});

test("renderArchitectureViewStandaloneHtml — 완전한 문서를 만들고 SVG를 포함한다", () => {
  const doc = loadExample();
  const html = renderArchitectureViewStandaloneHtml(doc);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<svg"));
  assert.ok(html.includes(doc.title));
  for (const card of doc.cards ?? []) assert.ok(html.includes(card.title));
});
