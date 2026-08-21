/**
 * Evidence Engine — P0 (file / symbol) + P1 (contains / call / reference).
 *
 * **AST는 Semantic Classifier가 아니라 Evidence Indexer다** (ontology_schema §11, I4).
 * 여기서 하는 일은 "이 Symbol은 어디에 있는가 / 무엇을 reference하는가"뿐이고,
 * 의미 분류는 하지 않는다. 완전한 runtime call graph 복원도 목표가 아니다.
 *
 * 모델을 부르지 않는다. 전부 결정론이고, 출력은 id로 정렬된다.
 */
import ts from "typescript";

import type {
  AdapterReportEntry,
  EntityRef,
  Evidence,
  EvidenceIndex,
  SourceRange,
} from "@onto/protocol";

import {
  fileEvidenceId,
  fingerprintOf,
  linkEvidenceBaseId,
  rawHashOf,
  resolveLinkIds,
  sha256,
  symbolEvidenceId,
  symbolIdOf,
  type LinkIdCandidate,
} from "./ids.js";
import { collectSourceFiles, isTestFile, readSource, toPosix } from "./lang.js";
import { defaultProfileFor } from "./normalize.js";

export type IndexOptions = {
  /** 이 인덱스 실행이 만드는 analysisVersion. 호출자가 정한다 */
  analysisVersion: number;
  /** 테스트 파일도 인덱싱할지. 기본은 포함한다 — 테스트는 도메인 용어의 좋은 출처다 (§50.1) */
  includeTests?: boolean;
};

type SymbolSite = {
  symbolId: string;
  qualifiedName: string;
  relPath: string;
  node: ts.Node;
  /** 이름 노드. 참조 해석의 앵커다 */
  nameNode: ts.Node;
};

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  allowNonTsExtensions: true,
  noResolve: false,
};

/**
 * 프로젝트 전체를 인덱싱한다.
 *
 * 증분 갱신(`updateFiles`)은 M5에서 붙인다. 그때까지는 두 번 전체 인덱싱하고
 * `diffEvidence`로 비교하면 EvidenceDiff가 그대로 나온다.
 */
export function indexProject(projectRoot: string, options: IndexOptions): EvidenceIndex {
  const report: AdapterReportEntry[] = [];
  const relPaths = collectSourceFiles(projectRoot).filter(
    (relPath) => options.includeTests !== false || !isTestFile(relPath),
  );

  const fileHashes: Record<string, string> = {};
  const sources = new Map<string, string>();
  for (const relPath of relPaths) {
    try {
      const text = readSource(projectRoot, relPath);
      sources.set(relPath, text);
      fileHashes[relPath] = sha256(text);
    } catch (error) {
      // 읽지 못한 파일을 **조용히 건너뛰지 않는다** (C1).
      report.push({
        adapterId: "p0-file",
        filePath: relPath,
        level: "error",
        message: `읽을 수 없습니다: ${String(error)}`,
      });
    }
  }

  const indexed = [...sources.keys()].sort();
  const program = ts.createProgram({
    rootNames: indexed.map((relPath) => `${projectRoot}/${relPath}`),
    options: COMPILER_OPTIONS,
  });
  const checker = program.getTypeChecker();

  const evidence: Evidence[] = [];
  const push = (item: Evidence): void => {
    evidence.push(item);
  };

  // 이 실행에서 인덱싱한 파일만 대상으로 삼는다. lib.d.ts와 node_modules는 제외된다.
  const inScope = new Set(indexed);
  const bySymbolId = new Map<string, SymbolSite>();
  const sitesByFile = new Map<string, SymbolSite[]>();

  // ---- P0: file / symbol -------------------------------------------------

  for (const relPath of indexed) {
    const text = sources.get(relPath)!;
    const fileHash = fileHashes[relPath]!;
    const profile = defaultProfileFor(relPath);
    const entity: EntityRef = { kind: "file", filePath: relPath };

    push({
      id: fileEvidenceId(relPath),
      kind: "file",
      origin: "engine",
      filePath: relPath,
      rawHash: rawHashOf(text),
      normalizedFingerprint: fingerprintOf(text, profile),
      normalizationProfile: profile,
      graph: { role: "entity", entity, label: relPath },
      summary: `파일 ${relPath}`,
      fileContentHash: fileHash,
      observedAtVersion: options.analysisVersion,
      status: "present",
    });

    const sourceFile = program.getSourceFile(`${projectRoot}/${relPath}`);
    if (!sourceFile) {
      report.push({
        adapterId: "p0-symbol",
        filePath: relPath,
        level: "warning",
        message: "TypeScript program이 이 파일을 열지 못했습니다. file evidence만 만들어집니다.",
      });
      continue;
    }

    const sites = collectSymbolSites(sourceFile, relPath);
    sitesByFile.set(relPath, sites);

    for (const site of sites) {
      bySymbolId.set(site.symbolId, site);
      const extent = site.node.getText(sourceFile);
      const range = rangeOf(sourceFile, site.node);
      push({
        id: symbolEvidenceId(site.symbolId),
        kind: "symbol",
        origin: "engine",
        filePath: relPath,
        symbolId: site.symbolId,
        location: range,
        rawHash: rawHashOf(extent),
        normalizedFingerprint: fingerprintOf(extent, "code"),
        normalizationProfile: "code",
        excerpt: firstLine(extent),
        graph: {
          role: "entity",
          entity: { kind: "symbol", symbolId: site.symbolId },
          label: site.qualifiedName,
        },
        summary: `${site.qualifiedName} (${relPath})`,
        fileContentHash: fileHash,
        observedAtVersion: options.analysisVersion,
        status: "present",
      });

      // contains: file -> symbol. Trace가 파일에서 심볼로 내려가는 경로다 (T2).
      const containsExtent = `${relPath}#${site.qualifiedName}`;
      push({
        id: `ev:contains:${symbolEvidenceId(site.symbolId).slice("ev:symbol:".length)}`,
        kind: "contains",
        origin: "engine",
        filePath: relPath,
        symbolId: site.symbolId,
        location: range,
        rawHash: rawHashOf(containsExtent),
        normalizedFingerprint: fingerprintOf(containsExtent, "prose"),
        normalizationProfile: "prose",
        graph: {
          role: "link",
          from: entity,
          to: { kind: "symbol", symbolId: site.symbolId },
          linkKind: "contains",
        },
        summary: `${relPath} 이 ${site.qualifiedName} 를 담고 있다`,
        fileContentHash: fileHash,
        observedAtVersion: options.analysisVersion,
        status: "present",
      });
    }
  }

  // ---- P1: call / reference ----------------------------------------------

  type PendingLink = {
    candidate: LinkIdCandidate;
    build: (id: string) => Evidence;
  };
  const pending: PendingLink[] = [];

  for (const relPath of indexed) {
    const sourceFile = program.getSourceFile(`${projectRoot}/${relPath}`);
    if (!sourceFile) continue;
    const fileHash = fileHashes[relPath]!;
    const sites = sitesByFile.get(relPath) ?? [];

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !isDeclarationName(node)) {
        const target = resolveTargetSymbolId(node, checker, projectRoot, inScope);
        if (target && bySymbolId.has(target)) {
          const owner = enclosingSymbol(node, sites);
          // 자기 자신을 가리키는 참조(선언부의 이름)는 이미 symbol evidence가 덮는다.
          if (owner && owner.symbolId !== target) {
            const isCall = isCalleeOf(node);
            const linkKind = isCall ? "call" : "reference";
            const statement = enclosingStatement(node) ?? node;
            const extent = statement.getText(sourceFile);
            const localFingerprint = fingerprintOf(extent, "code");
            const from: EntityRef = { kind: "symbol", symbolId: owner.symbolId };
            const to: EntityRef = { kind: "symbol", symbolId: target };
            const range = rangeOf(sourceFile, statement);
            const baseId = linkEvidenceBaseId(linkKind, from, to, localFingerprint);

            pending.push({
              candidate: {
                baseId,
                startLine: range.startLine,
                startColumn: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
                  .character,
              },
              build: (id) => ({
                id,
                kind: linkKind,
                origin: "engine",
                filePath: relPath,
                symbolId: owner.symbolId,
                location: range,
                rawHash: rawHashOf(extent),
                normalizedFingerprint: localFingerprint,
                normalizationProfile: "code",
                excerpt: firstLine(extent),
                graph: { role: "link", from, to, linkKind },
                summary:
                  linkKind === "call"
                    ? `${owner.qualifiedName} 이 ${shortName(target)} 를 호출한다`
                    : `${owner.qualifiedName} 이 ${shortName(target)} 를 참조한다`,
                fileContentHash: fileHash,
                observedAtVersion: options.analysisVersion,
                status: "present",
              }),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    try {
      visit(sourceFile);
    } catch (error) {
      report.push({
        adapterId: "p1-reference",
        filePath: relPath,
        level: "error",
        message: `참조 해석에 실패했습니다: ${String(error)}`,
      });
    }
  }

  const linkIds = resolveLinkIds(pending.map((item) => item.candidate));
  pending.forEach((item, index) => push(item.build(linkIds[index]!)));

  evidence.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    analysisVersion: options.analysisVersion,
    fileHashes,
    evidence,
    adapterReport: report,
  };
}

// ---------------------------------------------------------------------------
// AST 헬퍼
// ---------------------------------------------------------------------------

function rangeOf(sourceFile: ts.SourceFile, node: ts.Node): SourceRange {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { startLine: start.line + 1, endLine: end.line + 1 };
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

function shortName(symbolId: string): string {
  return symbolId.split("#")[1] ?? symbolId;
}

/**
 * 최상위 선언과 클래스 멤버를 모은다.
 *
 * 완전한 심볼 표를 만드는 것이 목적이 아니다 — Concept가 grounding할 수 있는 **주소**를
 * 만드는 것이 목적이다 (I4).
 */
function collectSymbolSites(sourceFile: ts.SourceFile, relPath: string): SymbolSite[] {
  const sites: SymbolSite[] = [];

  const add = (qualifiedName: string, node: ts.Node, nameNode: ts.Node): void => {
    sites.push({
      symbolId: symbolIdOf(relPath, qualifiedName),
      qualifiedName,
      relPath,
      node,
      nameNode,
    });
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
        if (ts.isIdentifier(declaration.name)) {
          add(declaration.name.text, declaration, declaration.name);
        }
      }
    }
  }

  return sites;
}

/** 선언부의 이름 노드인가. 그렇다면 참조가 아니라 정의다. */
function isDeclarationName(node: ts.Identifier): boolean {
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

/** 이 식별자가 호출식의 피호출자인가. `f()`의 `f`, `a.f()`의 `f`. */
function isCalleeOf(node: ts.Identifier): boolean {
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
function enclosingStatement(node: ts.Node): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isStatement(current)) return current;
    current = current.parent;
  }
  return undefined;
}

/** 이 노드를 담고 있는 심볼 사이트 중 가장 안쪽 것. link의 `from`이 된다. */
function enclosingSymbol(node: ts.Node, sites: SymbolSite[]): SymbolSite | undefined {
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

/**
 * 이 식별자가 가리키는 **우리 프로젝트 안의** 심볼 id.
 *
 * import alias는 풀어서 원래 선언까지 따라간다. lib.d.ts나 node_modules로 나가면
 * `undefined`를 돌려준다 — 우리는 프로젝트 안의 근거만 다룬다.
 */
function resolveTargetSymbolId(
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

  const declarations = symbol.declarations ?? [];
  for (const declaration of declarations) {
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

function relativeTo(root: string, absolute: string): string {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`;
  return absolute.startsWith(normalizedRoot) ? absolute.slice(normalizedRoot.length) : absolute;
}

/** 선언 노드에서 `collectSymbolSites`가 붙인 것과 **같은** qualified name을 되돌린다. */
function qualifiedNameOf(declaration: ts.Declaration): string | undefined {
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
