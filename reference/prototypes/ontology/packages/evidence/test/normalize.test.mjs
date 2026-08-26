/**
 * 정규화 지문의 규칙 (implementation_plan §6.2 T1, §6.5 S1).
 *
 * 이 규칙들이 곧 "무엇이 의미 변화인가"의 정의다. indexer 를 통해서만 시험하면 어떤 규칙이
 * 실제로 도는지 알 수 없으므로 여기서 직접 건다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultProfileFor, normalizedText, resolveLinkIds } from "@onto/evidence";

const same = (a, b, why) =>
  assert.equal(normalizedText(a, "code"), normalizedText(b, "code"), why);
const differs = (a, b, why) =>
  assert.notEqual(normalizedText(a, "code"), normalizedText(b, "code"), why);

test("code 프로파일이 버리는 것 — 포매팅은 의미가 아니다", () => {
  same(`f(1)`, `f( 1 )`, "공백");
  same("f(1)\n", "f(1)", "줄바꿈");
  same(`f(1);`, `f(1)`, "세미콜론은 ASI 때문에 스타일이다");
  same(`f('x')`, `f("x")`, "따옴표 스타일");
  same(`[1, 2,]`, `[1, 2]`, "후행 콤마");
  same(`f({a: 1,})`, `f({a: 1})`, "객체의 후행 콤마");
  same(`// 설명\nf(1)`, `f(1)`, "한 줄 주석");
  same(`/* 설명 */ f(1)`, `f(1)`, "블록 주석");
  same(`function g() {\n    return 1;\n}`, `function g(){return 1}`, "들여쓰기 전체");
});

test("code 프로파일이 남기는 것 — 코드가 바뀌면 지문이 바뀐다", () => {
  differs(`f(1)`, `f(2)`, "리터럴 값");
  differs(`f("a")`, `f("b")`, "문자열 값");
  differs(`f(a)`, `f(b)`, "식별자");
  differs(`a + b`, `a - b`, "연산자");
  differs(`f(a, b)`, `f(a)`, "인자 개수");
  differs(`[a, b]`, `[a]`, "구조를 나르는 콤마");
  differs(`return 1`, `return -1`, "부호");
});

test("code 프로파일의 거짓 음성 — 주석만 바뀌면 놓친다. 그래서 prose 가 있다", () => {
  const before = `// 승인이 필요하다\nf(1)`;
  const after = `// 승인이 필요 없다\nf(1)`;

  same(before, after, "code 는 주석을 버리므로 같다고 본다 (알려진 거짓 음성)");
  assert.notEqual(
    normalizedText(before, "prose"),
    normalizedText(after, "prose"),
    "prose 는 주석 변경을 잡아야 한다 — 이것이 그 프로파일이 있는 이유다",
  );
});

test("prose 프로파일은 공백만 압축한다", () => {
  assert.equal(normalizedText("  a   b \n c ", "prose"), "a b c");
  assert.notEqual(normalizedText("a b", "prose"), normalizedText("a c", "prose"));
});

test("기본 프로파일은 extent 의 성격에서 나온다", () => {
  assert.equal(defaultProfileFor("src/a.ts"), "code");
  assert.equal(defaultProfileFor("src/a.tsx"), "code");
  assert.equal(defaultProfileFor("src/a.mjs"), "code");
  assert.equal(defaultProfileFor("README.md"), "prose");
  assert.equal(defaultProfileFor("prisma/schema.prisma"), "prose");
  assert.equal(defaultProfileFor(".env.example"), "prose");
});

test("resolveLinkIds — 구별되는 링크는 suffix 없이 그대로 간다", () => {
  const ids = resolveLinkIds([
    { baseId: "ev:call:aaa", startLine: 10, startColumn: 2 },
    { baseId: "ev:call:bbb", startLine: 11, startColumn: 2 },
  ]);
  assert.deepEqual(ids, ["ev:call:aaa", "ev:call:bbb"]);
});

test("resolveLinkIds — 무관한 링크가 늘어도 기존 id 는 흔들리지 않는다 (U3 의 invariant)", () => {
  const existing = [
    { baseId: "ev:call:aaa", startLine: 10, startColumn: 2 },
    { baseId: "ev:call:bbb", startLine: 11, startColumn: 2 },
  ];
  const before = resolveLinkIds(existing);
  const after = resolveLinkIds([
    { baseId: "ev:call:zzz", startLine: 9, startColumn: 2 },
    ...existing,
  ]);
  assert.deepEqual(after.slice(1), before, "앞에 하나가 끼어들어도 뒤의 id 가 그대로여야 한다");
});

test("resolveLinkIds — 구별되지 않는 중복만 그룹 안에서 ordinal 을 받는다", () => {
  const ids = resolveLinkIds([
    { baseId: "ev:call:dup", startLine: 20, startColumn: 2 },
    { baseId: "ev:call:solo", startLine: 21, startColumn: 2 },
    { baseId: "ev:call:dup", startLine: 12, startColumn: 4 },
  ]);
  // 정렬은 line 기준 — 배열 순서가 아니다.
  assert.deepEqual(ids, ["ev:call:dup#1", "ev:call:solo", "ev:call:dup#0"]);
});

test("알려진 한계 — 바이트로 구별되지 않는 중복을 앞에 끼우면 그룹 안에서 밀린다", () => {
  const before = resolveLinkIds([
    { baseId: "ev:call:dup", startLine: 10, startColumn: 2 },
    { baseId: "ev:call:dup", startLine: 11, startColumn: 2 },
  ]);
  const after = resolveLinkIds([
    { baseId: "ev:call:dup", startLine: 9, startColumn: 2 },
    { baseId: "ev:call:dup", startLine: 10, startColumn: 2 },
    { baseId: "ev:call:dup", startLine: 11, startColumn: 2 },
  ]);
  assert.deepEqual(before, ["ev:call:dup#0", "ev:call:dup#1"]);
  assert.deepEqual(after, ["ev:call:dup#0", "ev:call:dup#1", "ev:call:dup#2"]);
  // 계획이 받아들인 한계다 — 그 문장들은 서로 구별할 수 없으므로 실질적 손해가 없다.
  // 다른 곳의 링크는 이것에 전혀 영향받지 않는다는 점이 중요하다 (위 시험).
});
