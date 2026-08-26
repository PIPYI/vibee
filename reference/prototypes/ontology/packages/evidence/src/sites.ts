/**
 * 심볼 사이트와 AST 헬퍼.
 *
 * `indexer`와 `adapters`가 함께 쓰므로 여기에 둔다 — 한쪽에 두면 import 순환이 생긴다.
 */
import ts from "typescript";

import type { SourceRange } from "@onto/protocol";

import { symbolIdOf } from "./ids.js";
import { toPosix } from "./lang.js";

export type SymbolSite = {
  symbolId: string;
  qualifiedName: string;
  relPath: string;
  node: ts.Node;
  nameNode: ts.Node;
};

export function rangeOf(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { startLine: start.line + 1, endLine: end.line + 1 };
}

export function startColumnOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).character;
}

export function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

export function shortName(symbolId: string): string {
  return symbolId.split("#")[1] ?? symbolId;
}

/**
 * 최상위 선언과 클래스 멤버를 모은다.
 *
 * 완전한 심볼 표를 만드는 것이 목적이 아니다 — Concept가 grounding할 수 있는 **주소**를
 * 만드는 것이 목적이다 (I4).
 */
export function collectSymbolSites(sourceFile: ts.SourceFile, relPath: string): SymbolSite[] {
  const sites: SymbolSite[] = [];
  const add = (qualifiedName: string, node: ts.Node, nameNode: ts.Node): void => {
    sites.push({ symbolId: symbolIdOf(relPath, qualifiedName), qualifiedName, relPath, node, nameNode });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      add(statement.name.text, statement, statement.name);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      const className = statement.name.text;
      add(className, statement, statement.name);
      for (const member of statement.members) {
        const memberName = member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
        if (!memberName) continue;
        if (
          ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member) ||
          ts.isPropertyDeclaration(member)
        ) {
          add(`${className}.${memberName}`, member, member.name!);
        }
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      add(statement.name.text, statement, statement.name);
    } else if (ts.isEnumDeclaration(statement)) {
      add(statement.name.text, statement, statement.name);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text, declaration, declaration.name);
      }
    }
  }
  return sites;
}

/** 선언부의 이름 노드인가. 그렇다면 참조가 아니라 정의다. */
export function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return (
    ((ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isExportSpecifier(parent)) &&
      (parent as { name?: ts.Node }).name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node)
  );
}

/** 이 식별자가 호출식의 피호출자인가. */
export function isCalleeOf(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isCallExpression(parent) && parent.expression === node) return true;
  if (ts.isNewExpression(parent) && parent.expression === node) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    const grand = parent.parent;
    return (
      (!!grand && ts.isCallExpression(grand) && grand.expression === parent) ||
      (!!grand && ts.isNewExpression(grand) && grand.expression === parent)
    );
  }
  return false;
}

/** 이 노드를 감싸는 문장. link의 `localNormalizedFingerprint`가 이 범위로 계산된다 (U3). */
export function enclosingStatement(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isStatement(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** 이 노드를 담고 있는 심볼 사이트 중 가장 안쪽 것. link의 `from`이 된다. */
export function enclosingSymbol(node: ts.Node, sites: SymbolSite[]): SymbolSite | undefined {
  const position = node.getStart();
  let best: SymbolSite | undefined;
  for (const site of sites) {
    const start = site.node.getStart();
    const end = site.node.getEnd();
    if (position >= start && position < end) {
      if (!best || start > best.node.getStart()) best = site;
    }
  }
  return best;
}

/** 선언 노드에서 `collectSymbolSites`가 붙인 것과 **같은** qualified name을 되돌린다. */
export function qualifiedNameOf(declaration: ts.Declaration): string | undefined {
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isClassDeclaration(declaration) ||
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    ts.isEnumDeclaration(declaration)
  ) {
    return declaration.name?.text;
  }
  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    return declaration.name.text;
  }
  if (
    ts.isMethodDeclaration(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isGetAccessorDeclaration(declaration) ||
    ts.isSetAccessorDeclaration(declaration)
  ) {
    const owner = declaration.parent;
    if (owner && ts.isClassDeclaration(owner) && owner.name && ts.isIdentifier(declaration.name)) {
      return `${owner.name.text}.${declaration.name.text}`;
    }
  }
  return undefined;
}

function relativeTo(root: string, absolute: string): string {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return absolute.startsWith(normalizedRoot) ? absolute.slice(normalizedRoot.length) : absolute;
}

/**
 * 이 식별자가 가리키는 **우리 프로젝트 안의** 심볼 id.
 *
 * import alias는 풀어서 원래 선언까지 따라간다. lib.d.ts나 node_modules로 나가면
 * `undefined`를 돌려준다 — 우리는 프로젝트 안의 근거만 다룬다.
 */
export function resolveTargetSymbolId(
  node: ts.Identifier,
  checker: ts.TypeChecker,
  projectRoot: string,
  inScope: Set<string>,
): string | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      return undefined;
    }
  }
  for (const declaration of symbol.declarations ?? []) {
    const declFile = declaration.getSourceFile();
    if (declFile.isDeclarationFile) continue;
    const relPath = toPosix(relativeTo(projectRoot, declFile.fileName));
    if (!inScope.has(relPath)) continue;
    const qualifiedName = qualifiedNameOf(declaration);
    if (!qualifiedName) continue;
    return symbolIdOf(relPath, qualifiedName);
  }
  return undefined;
}
