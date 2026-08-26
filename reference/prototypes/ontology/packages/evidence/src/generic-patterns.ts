/**
 * 프레임워크별 AST adapter 대신, 언어에 상관없이 재사용 가능한 "라우트처럼 생긴 선언" 탐지기.
 *
 * python.ts의 ROUTE_DECORATOR와 같은 정신을 다른 언어로 넓힌다: 같은 줄에 명시적 path
 * 리터럴이 있을 때만 라우트로 본다(전체 semantic 분석이 아니라 보수적인 패턴 매칭). 매 번
 * 새 프레임워크가 나올 때마다 전용 AST adapter를 새로 짜는 대신, 이 패턴 목록에 항목을
 * 추가하는 것으로 확장한다(V5 설계 원칙 1).
 */

export type GenericRoute = {
  routeKey: string;
  method: string;
  path: string;
  line: number;
  extentText: string;
};

type PatternSpec = {
  /** 어떤 프레임워크/언어군에서 온 패턴인지 — adapterReport나 디버깅에서 식별용. */
  label: string;
  regex: RegExp;
  method: (match: RegExpMatchArray) => string;
  path: (match: RegExpMatchArray) => string;
};

const PATTERNS: PatternSpec[] = [
  // Java/Kotlin — Spring @GetMapping/@PostMapping/@PutMapping/@DeleteMapping/@PatchMapping
  {
    label: "spring-verb-mapping",
    regex: /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/u,
    method: (m) => m[1]!.toUpperCase(),
    path: (m) => m[2]!,
  },
  // Java/Kotlin — Spring @RequestMapping(위 verb-specific 애노테이션이 없을 때만 잡힌다)
  {
    label: "spring-request-mapping",
    regex: /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/u,
    method: () => "ANY",
    path: (m) => m[1]!,
  },
  // C# — ASP.NET Core [HttpGet("...")] 류 애노테이션
  {
    label: "aspnet-http-attribute",
    regex: /\[Http(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']\s*\)\]/u,
    method: (m) => m[1]!.toUpperCase(),
    path: (m) => m[2]!,
  },
  // Ruby — Sinatra DSL (`get '/x' do`) / Rails config/routes.rb (`get '/x', to: '...'`)
  {
    label: "ruby-route-dsl",
    regex: /^\s*(get|post|put|delete|patch)\s+["']([^"']+)["']/u,
    method: (m) => m[1]!.toUpperCase(),
    path: (m) => m[2]!,
  },
  // Go — gin/chi류 router.METHOD("path", handler)
  {
    label: "go-router-verb-call",
    regex: /\b\w+\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']+)["']/u,
    method: (m) => m[1]!,
    path: (m) => m[2]!,
  },
];

/** 한 파일 텍스트에서 명시적 path 리터럴을 가진 라우트 선언을 줄 단위로 찾는다. */
export function parseGenericRoutePatterns(text: string): GenericRoute[] {
  const routes: GenericRoute[] = [];
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const spec of PATTERNS) {
      const match = line.match(spec.regex);
      if (!match) continue;
      const method = spec.method(match);
      const path = spec.path(match);
      routes.push({
        routeKey: `${method} ${path}`,
        method,
        path,
        line: index + 1,
        extentText: line.trim(),
      });
      break; // 한 줄에서는 첫 매칭 패턴만 — 같은 선언을 두 번 잡지 않는다.
    }
  });
  return routes;
}
