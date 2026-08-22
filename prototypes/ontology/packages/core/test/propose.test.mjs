/**
 * `propose_evidence` 검증 — **acceptance 7** (implementation_plan §6.5 R2 · S1, A4).
 *
 * > 7. propose_evidence 가 지어낸 범위(파일 끝 너머, "../" 경로)를 거절한다
 *
 * 이것이 §2 의 "AI 가 허구의 Grounding 을 만들지 않았는가"를 실제로 막는 자리다. agent 는
 * evidence id 를 직접 쓸 수 없고, **Core 가 디스크를 직접 읽어 검증한 뒤 발급한 id** 에만
 * grounding 할 수 있다.
 */
import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { AnalyzeTransaction, validateProposal } from "@onto/core";
import { fingerprintOf, indexProject, sha1 } from "@onto/evidence";

import { cleanup, codesOf, makeProject } from "./_helpers.mjs";

after(cleanup);

const POLICY = `export function requestFollow(fromId, toId) {
  if (isPrivate(toId)) {
    return createRequest(fromId, toId);
  }
  return createFollow(fromId, toId);
}
`;

function setup() {
  const dir = makeProject({
    "src/policy.js": POLICY,
    "docs/policy.md": "# 팔로우 정책\n\n비공개 계정은 승인을 요구한다.\n",
  });
  const index = indexProject(dir, { analysisVersion: 1 });
  return { dir, index, context: { projectPath: dir, index, observedAtVersion: 1 } };
}

const base = {
  kind: "policy_note",
  filePath: "src/policy.js",
  location: { startLine: 1, endLine: 6 },
  summary: "비공개 계정 팔로우는 승인을 요구한다",
};

// ---------------------------------------------------------------------------
// acceptance 7 — 지어낸 것을 거절한다
// ---------------------------------------------------------------------------

test("acceptance 7 — 파일 끝 너머의 범위를 거절한다", () => {
  const { context } = setup();
  const outcome = validateProposal(context, { ...base, location: { startLine: 1, endLine: 400 } });

  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("proposal/line-out-of-range"));
  const [failure] = outcome.diagnostics.filter((item) => item.severity === "error");
  // 진단은 **고칠 수 있어야** 한다 (A3) — 몇 줄짜리 파일인지 말해 준다.
  assert.equal(failure.evidence.lineCount, 6);
  assert.ok(failure.supportedFixes.length > 0);
});

test('acceptance 7 — "../" 경로를 거절한다', () => {
  const { context } = setup();
  const outcome = validateProposal(context, { ...base, filePath: "../../../etc/passwd" });

  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("proposal/path-escape"));
});

test("acceptance 7 — 절대경로 · .git · 역슬래시도 같은 자리에서 막힌다 (A4)", () => {
  const { context } = setup();
  for (const filePath of ["/etc/passwd", ".git/config", "src\\policy.js"]) {
    const outcome = validateProposal(context, { ...base, filePath });
    assert.equal(outcome.ok, false, `${filePath} 가 통과했다`);
    assert.ok(
      codesOf(outcome.diagnostics).some((code) => code.startsWith("proposal/path-")),
      `${filePath} 의 진단이 경로 문제를 가리키지 않는다`,
    );
  }
});

test("acceptance 7 — 실재하지 않는 파일을 거절한다", () => {
  const { context } = setup();
  const outcome = validateProposal(context, { ...base, filePath: "src/nowhere.js" });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("proposal/file-missing"));
});

test("symlink 로 프로젝트 밖을 가리켜도 막는다 — 경로 문자열 검사만으로는 새어 나간다", () => {
  const { dir, context } = setup();
  const outside = makeProject({ "secret.txt": "secret\n" });
  symlinkSync(join(outside, "secret.txt"), join(dir, "linked.txt"));

  const outcome = validateProposal(context, { ...base, filePath: "linked.txt" });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("proposal/path-escape"));
});

test("endLine 이 startLine 보다 작으면 거절한다", () => {
  const { context } = setup();
  const outcome = validateProposal(context, { ...base, location: { startLine: 4, endLine: 2 } });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("proposal/line-range-invalid"));
});

test("agent 가 id 를 직접 실어 보내면 schema 에서 걸린다 — id 는 Core 가 발급한다", () => {
  const { context } = setup();
  const outcome = validateProposal(context, { ...base, id: "ev:agent:내가지어낸것" });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("proposal/schema"));
});

// ---------------------------------------------------------------------------
// 통과하는 길 — id 는 주소와 지문에서 나온다 (R1 · S1)
// ---------------------------------------------------------------------------

test("유효한 제안은 지문에서 나온 id 를 받는다", () => {
  const { dir, context } = setup();
  const outcome = validateProposal(context, base);

  assert.equal(outcome.ok, true);
  const evidence = outcome.value;
  const extent = POLICY.split("\n").slice(0, 6).join("\n");
  const expected = `ev:agent:${sha1(`src/policy.js:policy_note:${fingerprintOf(extent, "code")}`)}`;

  assert.equal(evidence.id, expected, "id 는 relPath + kind + anchorFingerprint 에서 나온다");
  assert.equal(evidence.origin, "agent");
  assert.equal(evidence.normalizationProfile, "code");
  assert.equal(evidence.excerpt, extent, "relocation 이 창 길이를 되살릴 수 있어야 한다");
  assert.equal(evidence.observedAtVersion, 1, "제안은 새 analysisVersion 을 만들지 않는다 (S2)");
  assert.ok(dir);
});

test("포매팅만 다시 해도 같은 id 가 나온다 — 재제안으로 grounding 을 복구할 수 있다 (S1)", () => {
  const { dir, context } = setup();
  const first = validateProposal(context, base);

  // prettier 가 돈 것처럼 바꾼다. 줄 수는 그대로 두어 같은 범위를 가리키게 한다.
  writeFileSync(
    join(dir, "src/policy.js"),
    `export function requestFollow( fromId, toId ) {
  if ( isPrivate( toId ) ) {
    return createRequest( fromId, toId );
  };
  return createFollow( fromId, toId );
}
`,
    "utf8",
  );
  const second = validateProposal(context, base);

  assert.equal(second.ok, true);
  assert.equal(second.value.id, first.value.id, "바이트 해시를 id 에 넣었다면 여기서 갈렸다");
  assert.notEqual(second.value.rawHash, first.value.rawHash, "원문은 실제로 달라졌다");
});

test("문서·설정 범위는 prose 가 기본이다 — 주석 변경을 놓치지 않아야 하기 때문이다 (T1)", () => {
  const { context } = setup();
  const outcome = validateProposal(context, {
    ...base,
    filePath: "docs/policy.md",
    location: { startLine: 1, endLine: 3 },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value.normalizationProfile, "prose");
});

test("symbolHint 불일치는 **warning** 이다 — 엔진이 못 본 것을 가리키는 것이 이 tool 의 목적이다", () => {
  const { context } = setup();
  const outcome = validateProposal(context, { ...base, symbolHint: "존재하지않는심볼" });

  assert.equal(outcome.ok, true, "warning 은 제안을 막지 않는다");
  assert.deepEqual(codesOf(outcome.diagnostics), ["proposal/symbol-mismatch"]);
  assert.equal(outcome.diagnostics[0].severity, "warning");
});

test("해석되지 않는 graph 힌트는 비순회 evidence 로 저장하고 warning 을 낸다 (S2)", () => {
  const { context } = setup();
  const outcome = validateProposal(context, {
    ...base,
    graph: { role: "entity", entity: { kind: "symbol", symbolId: "src/nowhere.js#ghost" }, label: "유령" },
  });

  assert.equal(outcome.ok, true, "제안 자체를 거절하지는 않는다");
  assert.deepEqual(codesOf(outcome.diagnostics), ["graph/unresolved-entity"]);
  assert.equal(outcome.value.graph, undefined, "Trace 에 나오지 않아야 한다");
});

test("실재하는 entity 를 가리킨 graph 힌트는 그대로 남는다", () => {
  const { context } = setup();
  const outcome = validateProposal(context, {
    ...base,
    graph: {
      role: "entity",
      entity: { kind: "symbol", symbolId: "src/policy.js#requestFollow" },
      label: "팔로우 요청",
    },
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.diagnostics, []);
  assert.equal(outcome.value.graph.role, "entity");
});

test("transaction 이 닫힌 뒤에는 제안을 받지 않는다", () => {
  const { dir, index } = setup();
  const transaction = new AnalyzeTransaction("task-1", dir, 1, index);
  transaction.abort("테스트");

  const outcome = transaction.propose(base);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome.diagnostics).includes("transaction/not-open"));
});
