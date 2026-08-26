/** Python 전체 의미 분석기가 아니라, 명시적 선언·decorator·직접 호출만 잡는 보수적 adapter다. */
import { symbolIdOf } from "./ids.js";

export type PythonSymbol = {
  name: string;
  qualifiedName: string;
  symbolId: string;
  kind: "class" | "function";
  startLine: number;
  endLine: number;
  indent: number;
  decoratorLines: string[];
  extentText: string;
};

export type PythonRoute = {
  routeKey: string;
  method: string;
  path: string;
  handlerSymbolId: string;
  line: number;
  extentText: string;
};

export type PythonCall = {
  fromSymbolId: string;
  targetName: string;
  line: number;
  column: number;
  extentText: string;
};

const DECLARATION = /^(\s*)(?:(async)\s+)?(class|def)\s+([A-Za-z_]\w*)\b/u;
const ROUTE_DECORATOR = /^\s*@(?:[A-Za-z_]\w*\.)*(get|post|put|patch|delete|options|head|route)\(\s*["']([^"']+)["']/iu;
const DIRECT_CALL = /(?<![.\w])([A-Za-z_]\w*)\s*\(/gu;
const CALL_KEYWORDS = new Set(["if", "for", "while", "return", "yield", "with", "assert", "class", "def", "lambda"]);

export function parsePythonSource(relPath: string, text: string): {
  symbols: PythonSymbol[];
  routes: PythonRoute[];
  calls: PythonCall[];
} {
  const lines = text.split(/\r?\n/u);
  const declarations: Array<Omit<PythonSymbol, "endLine" | "extentText">> = [];
  const parents: Array<{ name: string; indent: number }> = [];
  let decorators: string[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("@")) {
      decorators.push(line);
      return;
    }
    const match = line.match(DECLARATION);
    if (!match) {
      if (trimmed && !trimmed.startsWith("#")) decorators = [];
      return;
    }
    const indent = match[1]!.replace(/\t/gu, "    ").length;
    while (parents.length > 0 && parents[parents.length - 1]!.indent >= indent) parents.pop();
    const name = match[4]!;
    const qualifiedName = [...parents.map((parent) => parent.name), name].join(".");
    const kind = match[3] === "class" ? "class" : "function";
    declarations.push({
      name,
      qualifiedName,
      symbolId: symbolIdOf(relPath, qualifiedName),
      kind,
      startLine: index + 1,
      indent,
      decoratorLines: decorators,
    });
    decorators = [];
    parents.push({ name, indent });
  });

  const symbols: PythonSymbol[] = declarations.map((declaration, index) => {
    let endLine = lines.length;
    for (let next = index + 1; next < declarations.length; next += 1) {
      if (declarations[next]!.indent <= declaration.indent) {
        endLine = declarations[next]!.startLine - 1;
        break;
      }
    }
    return {
      ...declaration,
      endLine,
      extentText: lines.slice(declaration.startLine - 1, endLine).join("\n"),
    };
  });

  const routes: PythonRoute[] = [];
  for (const symbol of symbols.filter((item) => item.kind === "function")) {
    for (const decorator of symbol.decoratorLines) {
      const match = decorator.match(ROUTE_DECORATOR);
      if (!match) continue;
      const method = match[1]!.toUpperCase() === "ROUTE" ? "ANY" : match[1]!.toUpperCase();
      const path = match[2]!;
      routes.push({
        routeKey: `${method} ${path}`,
        method,
        path,
        handlerSymbolId: symbol.symbolId,
        line: symbol.startLine,
        extentText: `${decorator}\n${lines[symbol.startLine - 1] ?? ""}`,
      });
    }
  }

  const calls: PythonCall[] = [];
  for (const symbol of symbols.filter((item) => item.kind === "function")) {
    lines.slice(symbol.startLine, symbol.endLine).forEach((line, offset) => {
      for (const match of line.matchAll(DIRECT_CALL)) {
        const targetName = match[1]!;
        if (CALL_KEYWORDS.has(targetName) || targetName === symbol.name) continue;
        calls.push({
          fromSymbolId: symbol.symbolId,
          targetName,
          line: symbol.startLine + offset + 1,
          column: match.index ?? 0,
          extentText: line.trim(),
        });
      }
    });
  }
  return { symbols, routes, calls };
}
