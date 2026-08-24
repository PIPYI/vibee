import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  buildEngineSystemFactStore,
  canonicalResourceRef,
  findSystemEntity,
  findSystemLink,
  systemEntityId,
  systemLinkId,
  systemLinksForEntity,
} from "@onto/core";
import { indexProject } from "@onto/evidence";

import { cleanup, makeProject, writeFiles } from "./_helpers.mjs";

after(cleanup);

test("ResourceEntityRef는 namespace를 정규화하되 case-sensitive key를 보존한다", () => {
  const canonical = canonicalResourceRef({
    kind: "resource",
    namespace: " External Service ",
    key: "OpenAI/Responses-v1",
  });

  assert.deepEqual(canonical, {
    kind: "resource",
    namespace: "external-service",
    key: "OpenAI/Responses-v1",
  });
  assert.equal(
    systemEntityId(canonical),
    "resource:external-service:OpenAI/Responses-v1",
  );
});

test("System Link ID는 label·줄 번호와 무관하고 mechanism 공백만 정규화한다", () => {
  const from = { kind: "symbol", symbolId: "src/answer.py#generate_answer" };
  const to = { kind: "resource", namespace: "external", key: "openai-responses" };
  const first = systemLinkId({ kind: "external_call", from, to, mechanism: "responses.  create" });
  const moved = systemLinkId({ kind: "external_call", from, to, mechanism: "responses. create" });

  assert.equal(first, moved);
  assert.match(first, /^system-link:[a-f0-9]{40}$/u);
});

test("Evidence Graph를 engine-confirmed System Fact로 만들고 firstSeenVersion을 유지한다", () => {
  const root = makeProject({
    "src/app.ts": `export function save(value: string) { return value; }
export function submit(value: string) { return save(value); }
`,
  });

  const firstIndex = indexProject(root, { analysisVersion: 1 });
  const first = buildEngineSystemFactStore(firstIndex);
  const call = first.links.find((item) => item.kind === "call");
  assert.ok(call, "직접 호출이 System Link로 승격되어야 한다");
  assert.equal(call.origin, "engine");
  assert.equal(call.certainty, "confirmed");
  assert.equal(call.status, "valid");
  assert.ok(call.evidenceRefs.length >= 1);
  assert.ok(call.dependsOnEvidenceRefs.length >= 3, "link와 양 endpoint 근거가 dependency여야 한다");

  writeFiles(root, {
    "src/app.ts": `// 위에 설명을 추가해 줄 번호만 이동한다.

export function save(value: string) { return value; }
export function submit(value: string) { return save(value); }
`,
  });
  const second = buildEngineSystemFactStore(indexProject(root, { analysisVersion: 2 }), first);
  const carried = findSystemLink(second, call.id);

  assert.ok(carried, "줄 이동으로 System Link ID가 바뀌면 안 된다");
  assert.equal(carried.firstSeenVersion, 1);
  assert.equal(carried.lastValidatedVersion, 2);
});

test("같은 endpoint·kind의 여러 호출은 Link 하나와 여러 evidenceRefs로 접힌다", () => {
  const root = makeProject({
    "src/app.ts": `export function save(value: string) { return value; }
export function submit(a: string, b: string) {
  save(a);
  return save(b);
}
`,
  });
  const facts = buildEngineSystemFactStore(indexProject(root, { analysisVersion: 1 }));
  const calls = facts.links.filter((item) => item.kind === "call");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].evidenceRefs.length, 2);
});

test("System Fact 조회 API는 ID와 EntityRef 양쪽을 받는다", () => {
  const root = makeProject({
    "src/app.ts": `export function save(value: string) { return value; }
export function submit(value: string) { return save(value); }
`,
  });
  const facts = buildEngineSystemFactStore(indexProject(root, { analysisVersion: 1 }));
  const entity = facts.entities.find((item) => item.ref.kind === "symbol");
  assert.ok(entity);

  assert.equal(findSystemEntity(facts, entity.id)?.id, entity.id);
  assert.equal(findSystemEntity(facts, entity.ref)?.id, entity.id);
  assert.ok(systemLinksForEntity(facts, entity.ref).length >= 1);
});

test("기존 agent Evidence를 engine-confirmed fact로 잘못 승격하지 않는다", () => {
  const root = makeProject({ "src/app.ts": "export const value = 1;\n" });
  const index = indexProject(root, { analysisVersion: 1 });
  index.evidence.push({
    id: "ev:agent:external",
    kind: "external_call",
    origin: "agent",
    filePath: "src/app.ts",
    location: { startLine: 1, endLine: 1 },
    rawHash: "raw",
    normalizedFingerprint: "fingerprint",
    normalizationProfile: "code",
    graph: {
      role: "entity",
      entity: { kind: "resource", namespace: "external", key: "invented-service" },
      label: "표시 이름",
    },
    fileContentHash: index.fileHashes["src/app.ts"],
    observedAtVersion: 1,
    status: "present",
  });

  const facts = buildEngineSystemFactStore(index);
  assert.equal(
    facts.entities.some((item) => item.ref.kind === "resource"),
    false,
    "Phase 2 source contract를 통과하지 않은 agent evidence는 confirmed가 될 수 없다",
  );
});
