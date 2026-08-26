/**
 * 프레임워크 전용 AST adapter 없이 명시적인 HTTP 호출을 찾는 보수적 패턴 목록.
 *
 * route 패턴과 같은 원칙을 따른다. 한 줄 안에 URL 리터럴이 있어야만 후보로 만들고,
 * 변수만 전달하는 호출은 추측하지 않는다. 여기서는 호출 사실만 추출한다. 실제 route와의
 * 매칭과 certainty 판정은 indexer가 모든 route entity를 모은 뒤 수행한다.
 */

export type HttpCall = {
  method: string;
  /** route 패턴과 비교할 정규화된 path. 외부 절대 URL은 후보가 되지 않는다. */
  path: string;
  rawPath: string;
  line: number;
  column: number;
  extentText: string;
};

const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "ANY",
]);

// 리터럴 안의 template expression도 잡되, 문자열 전체가 한 줄 안에 있을 때만 허용한다.
const URL_LITERAL_SOURCE = "(?:'([^']*)'|\"([^\"]*)\"|`([^`]*)`)";
const METHOD_PROPERTY = /(?:["']?(?:method|type)["']?)\s*:\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/iu;

function literalValue(match: RegExpMatchArray, firstGroup: number): string | undefined {
  return match[firstGroup] ?? match[firstGroup + 1] ?? match[firstGroup + 2];
}

function normalizedMethod(value: string | undefined, fallback: string): string {
  const method = (value ?? fallback).toUpperCase();
  return HTTP_METHODS.has(method) ? method : fallback;
}

function methodFromObject(text: string, fallback: string): string {
  return normalizedMethod(text.match(METHOD_PROPERTY)?.[1], fallback);
}

/**
 * 호출 path와 route path가 비교 가능한 하나의 형태가 되게 한다.
 *
 * - `${value}`, `{value}`, `:value`, `<value>`는 모두 `*`
 * - `${BASE}/x`처럼 base URL이 템플릿 식으로 빠진 경우 앞의 `*`는 버린다
 * - 절대 URL/프로토콜 상대 URL은 외부 호출로 간주해 local route와 연결하지 않는다
 */
export function normalizeHttpPath(rawPath: string): string | undefined {
  let path = rawPath.trim();
  if (!path || /^(?:[A-Za-z][A-Za-z\d+.-]*:)?\/\//u.test(path)) return undefined;

  path = path
    .replace(/\\\//gu, "/")
    .replace(/\$\{[^}]*\}/gu, "*")
    .replace(/\{[^}]+\}/gu, "*")
    .replace(/<[^>]+>/gu, "*")
    .replace(/(^|\/):[A-Za-z_][\w-]*/gu, "$1*");

  // query/hash는 route 표면의 일부가 아니다.
  path = path.split(/[?#]/u, 1)[0] ?? "";
  // `${BASE_URL}/x` → `*/x`이므로, 경로 앞의 base expression만 제거한다.
  path = path.replace(/^\*+(?=\/)/u, "");
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/gu, "/");
  if (path.length > 1) path = path.replace(/\/+$/u, "");
  return path || "/";
}

function restTemplateMethod(name: string, line: string): string {
  if (name.startsWith("get")) return "GET";
  if (name.startsWith("post")) return "POST";
  if (name === "put") return "PUT";
  if (name === "delete") return "DELETE";
  const exchange = line.match(/\bHttpMethod\s*\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/iu)?.[1];
  return normalizedMethod(exchange, "ANY");
}

/**
 * `fetch`, axios, XHR, jQuery, Python requests/httpx, Java HTTP client, Go net/http의
 * URL 리터럴 호출을 줄 단위로 찾는다. 새 라이브러리는 이 목록만 추가하면 된다.
 */
export function parseHttpCallPatterns(text: string): HttpCall[] {
  const calls: HttpCall[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/u);

  const add = (
    line: string,
    lineNumber: number,
    method: string,
    rawPath: string | undefined,
    column: number,
    extentText: string,
  ): void => {
    if (rawPath === undefined) return;
    const path = normalizeHttpPath(rawPath);
    if (!path) return;
    const normalized = normalizedMethod(method, "ANY");
    const key = `${lineNumber}:${column}:${normalized}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({
      method: normalized,
      path,
      rawPath,
      line: lineNumber,
      column,
      extentText: extentText.trim() || line.trim(),
    });
  };

  const fetchPattern = new RegExp(`\\bfetch\\s*\\(\\s*${URL_LITERAL_SOURCE}`, "giu");
  const axiosVerbPattern = new RegExp(
    `\\baxios\\s*\\.\\s*(get|post|put|patch|delete|head|options)\\s*\\(\\s*${URL_LITERAL_SOURCE}`,
    "giu",
  );
  const xhrOpenPattern = new RegExp(
    `\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*open\\s*\\(\\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\\s*,\\s*${URL_LITERAL_SOURCE}`,
    "giu",
  );
  const pythonClientPattern = new RegExp(
    `\\b(?:requests|httpx)\\s*\\.\\s*(get|post|put|patch|delete|head|options)\\s*\\(\\s*${URL_LITERAL_SOURCE}`,
    "giu",
  );
  const restTemplatePattern = new RegExp(
    `\\b(?:[A-Za-z_$][\\w$]*[Rr]est[Tt]emplate|restTemplate|template)\\s*\\.\\s*` +
      `(getForObject|getForEntity|postForObject|postForEntity|put|delete|exchange)\\s*\\(\\s*${URL_LITERAL_SOURCE}`,
    "giu",
  );
  const webClientPattern = new RegExp(
    `\\b(?:[A-Za-z_$][\\w$]*[Ww]eb[Cc]lient|webClient)\\s*\\.\\s*` +
      `(get|post|put|patch|delete)\\s*\\(\\s*\\)\\s*\\.\\s*uri\\s*\\(\\s*${URL_LITERAL_SOURCE}`,
    "giu",
  );
  const goRequestPattern = new RegExp(
    `\\bhttp\\s*\\.\\s*NewRequest(?:WithContext)?\\s*\\(\\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\\s*,\\s*${URL_LITERAL_SOURCE}`,
    "giu",
  );
  const urlPropertyPattern = new RegExp(`\\burl\\s*:\\s*${URL_LITERAL_SOURCE}`, "iu");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    for (const match of line.matchAll(fetchPattern)) {
      const column = match.index ?? 0;
      add(line, lineNumber, methodFromObject(line.slice(column), "GET"), literalValue(match, 1), column, match[0]);
    }
    for (const match of line.matchAll(axiosVerbPattern)) {
      add(line, lineNumber, normalizedMethod(match[1], "ANY"), literalValue(match, 2), match.index ?? 0, match[0]);
    }

    // axios({ url, method }) / $.ajax({ url, type })는 객체 전체를 AST로 해석하지 않는다.
    // 같은 줄의 명시적인 `url` property만 보수적으로 읽는다.
    for (const pattern of [/\baxios(?:\s*\.\s*request)?\s*\(\s*\{/giu, /\$\s*\.\s*ajax\s*\(\s*\{/giu]) {
      for (const match of line.matchAll(pattern)) {
        const column = match.index ?? 0;
        const objectText = line.slice(column);
        const url = objectText.match(urlPropertyPattern);
        if (!url) continue;
        add(line, lineNumber, methodFromObject(objectText, "ANY"), literalValue(url, 1), column, objectText);
      }
    }

    for (const match of line.matchAll(xhrOpenPattern)) {
      add(line, lineNumber, normalizedMethod(match[1], "ANY"), literalValue(match, 2), match.index ?? 0, match[0]);
    }
    for (const match of line.matchAll(pythonClientPattern)) {
      add(line, lineNumber, normalizedMethod(match[1], "ANY"), literalValue(match, 2), match.index ?? 0, match[0]);
    }
    for (const match of line.matchAll(restTemplatePattern)) {
      const name = match[1]?.toLowerCase() ?? "exchange";
      add(line, lineNumber, restTemplateMethod(name, line), literalValue(match, 2), match.index ?? 0, match[0]);
    }
    for (const match of line.matchAll(webClientPattern)) {
      add(line, lineNumber, normalizedMethod(match[1], "ANY"), literalValue(match, 2), match.index ?? 0, match[0]);
    }
    for (const match of line.matchAll(goRequestPattern)) {
      add(line, lineNumber, normalizedMethod(match[1], "ANY"), literalValue(match, 2), match.index ?? 0, match[0]);
    }
  });

  return calls.sort((left, right) =>
    left.line - right.line || left.column - right.column || left.method.localeCompare(right.method) || left.path.localeCompare(right.path),
  );
}
