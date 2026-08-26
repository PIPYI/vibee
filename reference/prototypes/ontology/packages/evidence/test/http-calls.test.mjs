import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { buildEngineSystemFactStore } from "@onto/core";
import { indexProject, normalizeHttpPath, parseHttpCallPatterns } from "@onto/evidence";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/v5/http-call-routing/", import.meta.url));

test("V8 §4.1 — HTTP 호출 패턴은 명시적 URL과 method를 보수적으로 정규화한다", () => {
  const calls = parseHttpCallPatterns(`
fetch(\`${"${BASE}"}/orders/${"${id}"}\`);
axios.post("/orders");
axios({ url: "/search", method: "PUT" });
xhr.open("DELETE", "/orders/1");
$.ajax({ url: "/legacy", type: "PATCH" });
requests.get("/python");
httpx.post("/python/write");
restTemplate.getForObject("/java", String.class);
webClient.post().uri("/web");
http.NewRequest("OPTIONS", "/go", nil);
fetch("https://example.com/remote");
`);

  assert.deepEqual(
    calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/orders/*"],
      ["POST", "/orders"],
      ["PUT", "/search"],
      ["DELETE", "/orders/1"],
      ["PATCH", "/legacy"],
      ["GET", "/python"],
      ["POST", "/python/write"],
      ["GET", "/java"],
      ["POST", "/web"],
      ["OPTIONS", "/go"],
    ],
  );
  assert.equal(normalizeHttpPath("/x/:id?verbose=1"), "/x/*");
  assert.equal(normalizeHttpPath("https://example.com/x"), undefined);
});

test("V8 §4.1 — template fetch와 Flask route를 하나의 grounded http_call로 연결하고 외부 URL은 제외한다", () => {
  const index = indexProject(FIXTURE, { analysisVersion: 1 });
  const links = index.evidence.filter((item) => item.kind === "http_call");

  assert.equal(links.length, 1);
  const link = links[0];
  assert.equal(link?.graph?.role, "link");
  assert.deepEqual(link?.graph?.from, { kind: "symbol", symbolId: "frontend/client.js#loadItem" });
  assert.deepEqual(link?.graph?.to, { kind: "route", routeKey: "ANY /x/<id>" });
  assert.equal(link?.graph?.linkKind, "http_call");
  assert.equal(link?.graph?.mechanism, "HTTP GET /x/*");
  assert.equal(link?.graph?.certainty, "grounded");

  const facts = buildEngineSystemFactStore(index);
  const fact = facts.links.find((item) => item.kind === "http_call");
  assert.ok(fact, "http_call evidence가 System Link로 승격되어야 한다");
  assert.equal(fact.certainty, "grounded");
  assert.equal(fact.mechanism, "HTTP GET /x/*");
  assert.equal(fact.evidenceRefs.length, 1);
});
