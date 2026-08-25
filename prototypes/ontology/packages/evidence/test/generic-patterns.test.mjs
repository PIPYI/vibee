/**
 * V5 A2 — 언어에 상관없이 재사용 가능한 "라우트처럼 생긴 선언" 탐지기.
 *
 * 전용 AST adapter가 없는 Java/C#/Ruby/Go에서도, 매니페스트나 프레임워크별 파서 없이
 * 명시적 path 리터럴이 있는 라우트 선언은 route Evidence(entity)로 잡혀야 한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { indexProject, parseGenericRoutePatterns } from "@onto/evidence";

const JAVA_SPRING = fileURLToPath(new URL("../../../fixtures/v5/java-spring/", import.meta.url));
const CSHARP_ASPNET = fileURLToPath(new URL("../../../fixtures/v5/csharp-aspnet/", import.meta.url));
const RUBY_SINATRA = fileURLToPath(new URL("../../../fixtures/v5/ruby-sinatra/", import.meta.url));
const GO_GIN = fileURLToPath(new URL("../../../fixtures/v5/go-gin/", import.meta.url));

function routeKeysOf(projectPath) {
  const index = indexProject(projectPath, { analysisVersion: 1 });
  return index.evidence
    .filter((item) => item.kind === "route" && item.graph?.role === "entity")
    .map((item) => item.graph.entity.routeKey)
    .sort();
}

test("V5 A2 — Java Spring 애노테이션(@GetMapping/@PostMapping/@RequestMapping)이 route entity로 잡힌다", () => {
  // 클래스 레벨 @RequestMapping("/api/users")도 명시적 path 리터럴이 있으므로 ANY로 잡힌다.
  assert.deepEqual(routeKeysOf(JAVA_SPRING), ["ANY /api/users", "GET /api/users/{id}", "POST /api/users"]);
});

test("V5 A2 — C# ASP.NET Core [HttpGet]/[HttpPost] 속성이 route entity로 잡힌다", () => {
  assert.deepEqual(routeKeysOf(CSHARP_ASPNET), ["GET /api/users/{id}", "POST /api/users"]);
});

test("V5 A2 — Ruby Sinatra DSL(get/post)이 route entity로 잡힌다", () => {
  assert.deepEqual(routeKeysOf(RUBY_SINATRA), ["GET /api/users/:id", "POST /api/users"]);
});

test("V5 A2 — Go gin 스타일 router.GET/router.POST가 route entity로 잡힌다", () => {
  assert.deepEqual(routeKeysOf(GO_GIN), ["GET /api/users/:id", "POST /api/users"]);
});

test("V5 A2 — path 리터럴이 없는 애노테이션은 보수적으로 잡지 않는다(python.ts와 같은 정책)", () => {
  const routes = parseGenericRoutePatterns([
    "@RestController",
    "@GetMapping",
    "public User getUser() { return null; }",
  ].join("\n"));
  assert.deepEqual(routes, []);
});

test("V5 A2 — 한 줄에서는 첫 패턴만 매칭해 같은 선언을 중복으로 잡지 않는다", () => {
  const routes = parseGenericRoutePatterns('@GetMapping("/x")');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeKey, "GET /x");
});
