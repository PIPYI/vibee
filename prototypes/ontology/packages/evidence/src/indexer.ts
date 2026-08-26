/**
 * Evidence Engine — P0 (file / symbol) · P1 (contains / call / reference) · P2 (adapters) · P3 (git).
 *
 * **AST는 Semantic Classifier가 아니라 Evidence Indexer다** (ontology_schema §11, I4).
 * 여기서 하는 일은 "이 Symbol은 어디에 있는가 / 무엇을 reference하는가 / 어떤 Route인가"뿐이고,
 * 의미 분류는 하지 않는다. 완전한 runtime call graph 복원도 목표가 아니다.
 *
 * 모델을 부르지 않는다. 전부 결정론이고, 출력은 id로 정렬된다.
 */
import { posix } from "node:path";
import ts from "typescript";

import type {
  AdapterReportEntry,
  EntityRef,
  Evidence,
  EvidenceIndex,
} from "@onto/protocol";

import { runAdapters, isConfigFile, type PendingLinkSpec } from "./adapters.js";
import { changedFilesSince } from "./git.js";
import {
  fileEvidenceId,
  fingerprintOf,
  linkEvidenceBaseId,
  rawHashOf,
  resolveLinkIds,
  sha1,
  sha256,
  symbolEvidenceId,
  type LinkIdCandidate,
} from "./ids.js";
import { parseGenericRoutePatterns } from "./generic-patterns.js";
import {
  collectAllRepositoryFiles,
  collectSourceFiles,
  isGenericPatternSourceFile,
  isPythonSourceFile,
  isTestFile,
  isTypeScriptSourceFile,
  readSource,
} from "./lang.js";
import { defaultProfileFor } from "./normalize.js";
import { parsePythonSource, type PythonSymbol } from "./python.js";
import {
  collectSymbolSites,
  enclosingStatement,
  enclosingSymbol,
  firstLine,
  isCalleeOf,
  isDeclarationName,
  rangeOf,
  resolveTargetSymbolId,
  shortName,
  startColumnOf,
  type SymbolSite,
} from "./sites.js";

export type IndexOptions = {
  /** 이 인덱스 실행이 만드는 analysisVersion. 호출자가 정한다 */
  analysisVersion: number;
  /** 테스트 파일도 인덱싱할지. 기본은 포함한다 — 테스트는 도메인 용어의 좋은 출처다 (§50.1) */
  includeTests?: boolean;
  /**
   * 주면 P3 git_change evidence를 만든다. 없으면 만들지 않는다.
   * 실패는 `adapterReport`에 남는다 — 조용히 "변경 없음"으로 넘어가지 않는다.
   */
  gitBase?: string;
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
};

/** TS 파서를 태우지 않지만 evidence는 만들어야 하는 파일들. */
const EXTRA_FILE_PATTERNS = [/(?:^|\/)schema\.prisma$/u, /(?:^|\/)\.env\.example$/u];
const DATA_ASSET_EXTENSION = /\.(?:json|ya?ml|csv|sql|prisma)$/iu;
const DATA_ASSET_DIRECTORY = /(?:^|\/)(?:data|fixtures?|mocks?|seeds?)(?:\/|$)/iu;

/** package/tsconfig 같은 설정 JSON과 실제 런타임 데이터 자산을 구분한다. */
export function isDataAssetFile(relPath: string): boolean {
  if (!DATA_ASSET_EXTENSION.test(relPath)) return false;
  if (/(?:^|\/)(?:package-lock|package|tsconfig(?:\.[^/]+)?)\.json$/iu.test(relPath)) return false;
  return DATA_ASSET_DIRECTORY.test(relPath) || /(?:^|\/)[^/]+\.(?:data|fixture|seed)\.json$/iu.test(relPath);
}

function isExtraFile(relPath: string): boolean {
  return isConfigFile(relPath) || isDataAssetFile(relPath) || EXTRA_FILE_PATTERNS.some((pattern) => pattern.test(relPath));
}

function resolveImportedDataPath(fromPath: string, specifier: string, indexed: Set<string>): string | undefined {
  if (!specifier.startsWith(".") || !DATA_ASSET_EXTENSION.test(specifier)) return undefined;
  const candidate = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (candidate.startsWith("../") || !indexed.has(candidate) || !isDataAssetFile(candidate)) return undefined;
  return candidate;
}

export function indexProject(projectRoot: string, options: IndexOptions): EvidenceIndex {
  const report: AdapterReportEntry[] = [];
  const version = options.analysisVersion;

  // ---- 파일 수집 ---------------------------------------------------------
  const sourcePaths = collectSourceFiles(projectRoot).filter(
    (relPath) => options.includeTests !== false || !isTestFile(relPath),
  );
  const extraPaths = collectSourceFiles(projectRoot, { predicate: isExtraFile });
  const allPaths = [...new Set([...sourcePaths, ...extraPaths])].sort();
  // isSourceFile/isExtraFile 허용목록 밖에 있어 evidence가 전혀 안 생기는 파일 — 완전히
  // 사라지지 않고 unindexedFiles로 관측 가능해야 discovery gap으로 이어질 수 있다.
  const allPathsSet = new Set(allPaths);
  const unindexedFiles = collectAllRepositoryFiles(projectRoot)
    .filter((relPath) => !allPathsSet.has(relPath))
    .map((filePath) => {
      const dot = filePath.lastIndexOf(".");
      const slash = filePath.lastIndexOf("/");
      return { filePath, extension: dot > slash ? filePath.slice(dot).toLowerCase() : "" };
    });

  const fileHashes: Record<string, string> = {};
  const sources = new Map<string, string>();
  for (const relPath of allPaths) {
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
  const indexedSet = new Set(indexed);
  const parsed = indexed.filter((relPath) => sourcePaths.includes(relPath) && isTypeScriptSourceFile(relPath));
  const pythonPaths = indexed.filter((relPath) => sourcePaths.includes(relPath) && isPythonSourceFile(relPath));
  const genericPatternPaths = indexed.filter(
    (relPath) => sourcePaths.includes(relPath) && isGenericPatternSourceFile(relPath),
  );

  const program = ts.createProgram({
    rootNames: parsed.map((relPath) => `${projectRoot}/${relPath}`),
    options: COMPILER_OPTIONS,
  });
  const checker = program.getTypeChecker();
  const inScope = new Set(parsed);

  const evidence: Evidence[] = [];
  const pending: Array<{ candidate: LinkIdCandidate; build: (id: string) => Evidence }> = [];
  const bySymbolId = new Map<string, SymbolSite>();
  const sitesByFile = new Map<string, SymbolSite[]>();
  const pythonByFile = new Map(pythonPaths.map((relPath) => [relPath, parsePythonSource(relPath, sources.get(relPath)!)]));
  const genericRoutesByFile = new Map(
    genericPatternPaths.map((relPath) => [relPath, parseGenericRoutePatterns(sources.get(relPath)!)]),
  );

  const queueLink = (spec: PendingLinkSpec): void => {
    const localFingerprint = fingerprintOf(spec.extentText, "code");
    const baseId = linkEvidenceBaseId(spec.linkKind, spec.from, spec.to, localFingerprint);
    pending.push({
      candidate: { baseId, startLine: spec.location.startLine, startColumn: spec.startColumn },
      build: (id) => ({
        id,
        kind: spec.linkKind,
        origin: "engine",
        filePath: spec.filePath,
        location: spec.location,
        rawHash: rawHashOf(spec.extentText),
        normalizedFingerprint: localFingerprint,
        normalizationProfile: "code",
        excerpt: firstLine(spec.extentText),
        graph: { role: "link", from: spec.from, to: spec.to, linkKind: spec.linkKind },
        summary: spec.summary,
        fileContentHash: spec.fileContentHash,
        observedAtVersion: version,
        status: "present",
      }),
    });
  };

  // ---- P0: file / symbol -------------------------------------------------

  for (const relPath of indexed) {
    const text = sources.get(relPath)!;
    const fileHash = fileHashes[relPath]!;
    const profile = defaultProfileFor(relPath);
    const fileEntity: EntityRef = { kind: "file", filePath: relPath };

    evidence.push({
      id: fileEvidenceId(relPath),
      kind: "file",
      origin: "engine",
      filePath: relPath,
      rawHash: rawHashOf(text),
      normalizedFingerprint: fingerprintOf(text, profile),
      normalizationProfile: profile,
      graph: { role: "entity", entity: fileEntity, label: relPath },
      summary: `파일 ${relPath}`,
      fileContentHash: fileHash,
      observedAtVersion: version,
      status: "present",
    });

    const python = pythonByFile.get(relPath);
    if (python) {
      for (const symbol of python.symbols) {
        const extent = symbol.extentText;
        const location = { startLine: symbol.startLine, endLine: symbol.endLine };
        evidence.push({
          id: symbolEvidenceId(symbol.symbolId),
          kind: "symbol",
          origin: "engine",
          filePath: relPath,
          symbolId: symbol.symbolId,
          location,
          rawHash: rawHashOf(extent),
          normalizedFingerprint: fingerprintOf(extent, "code"),
          normalizationProfile: "code",
          excerpt: extent.split(/\r?\n/u)[0]?.trim() ?? "",
          graph: { role: "entity", entity: { kind: "symbol", symbolId: symbol.symbolId }, label: symbol.qualifiedName },
          summary: `${symbol.qualifiedName} (${relPath})`,
          fileContentHash: fileHash,
          observedAtVersion: version,
          status: "present",
        });
        queueLink({
          linkKind: "contains",
          from: fileEntity,
          to: { kind: "symbol", symbolId: symbol.symbolId },
          extentText: `${relPath}#${symbol.qualifiedName}`,
          location,
          startColumn: symbol.indent,
          filePath: relPath,
          fileContentHash: fileHash,
          summary: `${relPath} 이 ${symbol.qualifiedName} 를 담고 있다`,
        });
      }
      for (const route of python.routes) {
        const routeEntity: EntityRef = { kind: "route", routeKey: route.routeKey };
        const location = { startLine: route.line, endLine: route.line };
        evidence.push({
          id: `ev:route:${sha1(route.routeKey)}`,
          kind: "route",
          origin: "engine",
          filePath: relPath,
          location,
          rawHash: rawHashOf(route.extentText),
          normalizedFingerprint: fingerprintOf(route.extentText, "code"),
          normalizationProfile: "code",
          excerpt: route.extentText.split(/\r?\n/u)[0]?.trim() ?? "",
          graph: { role: "entity", entity: routeEntity, label: route.routeKey },
          summary: `${route.routeKey} (${relPath})`,
          fileContentHash: fileHash,
          observedAtVersion: version,
          status: "present",
        });
        queueLink({
          linkKind: "api_handler",
          from: routeEntity,
          to: { kind: "symbol", symbolId: route.handlerSymbolId },
          extentText: route.extentText,
          location,
          startColumn: 0,
          filePath: relPath,
          fileContentHash: fileHash,
          summary: `${route.routeKey} 를 ${route.handlerSymbolId} 가 처리한다`,
        });
      }
      continue;
    }

    const genericRoutes = genericRoutesByFile.get(relPath);
    if (genericRoutes) {
      for (const route of genericRoutes) {
        const routeEntity: EntityRef = { kind: "route", routeKey: route.routeKey };
        const location = { startLine: route.line, endLine: route.line };
        evidence.push({
          id: `ev:route:${sha1(route.routeKey)}`,
          kind: "route",
          origin: "engine",
          filePath: relPath,
          location,
          rawHash: rawHashOf(route.extentText),
          normalizedFingerprint: fingerprintOf(route.extentText, "code"),
          normalizationProfile: "code",
          excerpt: route.extentText,
          graph: { role: "entity", entity: routeEntity, label: route.routeKey },
          summary: `${route.routeKey} (${relPath})`,
          fileContentHash: fileHash,
          observedAtVersion: version,
          status: "present",
        });
        // 전용 심볼 파서가 없는 언어라 handler symbol로는 못 내려간다 — file이 라우트를
        // 담고 있다는 사실만 근거 있게 남긴다(file→symbol contains와 같은 패턴).
        queueLink({
          linkKind: "contains",
          from: fileEntity,
          to: routeEntity,
          extentText: `${relPath}#${route.routeKey}`,
          location,
          startColumn: 0,
          filePath: relPath,
          fileContentHash: fileHash,
          summary: `${relPath} 이 ${route.routeKey} 를 담고 있다`,
        });
      }
      continue;
    }

    if (!parsed.includes(relPath)) continue;

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
      const location = rangeOf(sourceFile, site.node);

      evidence.push({
        id: symbolEvidenceId(site.symbolId),
        kind: "symbol",
        origin: "engine",
        filePath: relPath,
        symbolId: site.symbolId,
        location,
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
        observedAtVersion: version,
        status: "present",
      });

      // contains: file -> symbol. Trace가 파일에서 심볼로 내려가는 경로다 (T2).
      queueLink({
        linkKind: "contains",
        from: fileEntity,
        to: { kind: "symbol", symbolId: site.symbolId },
        extentText: `${relPath}#${site.qualifiedName}`,
        location,
        startColumn: startColumnOf(sourceFile, site.node),
        filePath: relPath,
        fileContentHash: fileHash,
        summary: `${relPath} 이 ${site.qualifiedName} 를 담고 있다`,
      });
    }
  }

  // ---- P1: call / reference ----------------------------------------------

  for (const relPath of parsed) {
    const sourceFile = program.getSourceFile(`${projectRoot}/${relPath}`);
    if (!sourceFile) continue;
    const fileHash = fileHashes[relPath]!;
    const sites = sitesByFile.get(relPath) ?? [];

    // 데이터 자산에는 TS symbol이 없으므로 checker만으로는 연결이 생기지 않는다.
    // import 선언을 file→file 골격 링크로 남겨 로컬 저장소를 Architecture에서 근거 있게
    // 표현할 수 있도록 한다.
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const targetPath = resolveImportedDataPath(relPath, statement.moduleSpecifier.text, indexedSet);
      if (!targetPath) continue;
      queueLink({
        linkKind: "data_import",
        from: { kind: "file", filePath: relPath },
        to: { kind: "file", filePath: targetPath },
        extentText: statement.getText(sourceFile),
        location: rangeOf(sourceFile, statement),
        startColumn: startColumnOf(sourceFile, statement),
        filePath: relPath,
        fileContentHash: fileHash,
        summary: `${relPath} 이 로컬 데이터 ${targetPath} 를 읽는다`,
      });
    }

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !isDeclarationName(node)) {
        const target = resolveTargetSymbolId(node, checker, projectRoot, inScope);
        if (target && bySymbolId.has(target)) {
          const owner = enclosingSymbol(node, sites);
          // 자기 자신을 가리키는 참조는 이미 symbol evidence가 덮는다.
          if (owner && owner.symbolId !== target) {
            const linkKind = isCalleeOf(node) ? "call" : "reference";
            const statement = enclosingStatement(node) ?? node;
            queueLink({
              linkKind,
              from: { kind: "symbol", symbolId: owner.symbolId },
              to: { kind: "symbol", symbolId: target },
              extentText: statement.getText(sourceFile),
              location: rangeOf(sourceFile, statement),
              startColumn: startColumnOf(sourceFile, statement),
              filePath: relPath,
              fileContentHash: fileHash,
              summary:
                linkKind === "call"
                  ? `${owner.qualifiedName} 이 ${shortName(target)} 를 호출한다`
                  : `${owner.qualifiedName} 이 ${shortName(target)} 를 참조한다`,
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

  // Python은 이름이 프로젝트 안에서 유일한 직접 호출만 연결한다. attribute·동적 dispatch는 추정하지 않는다.
  const pythonNames = new Map<string, PythonSymbol[]>();
  for (const parsedPython of pythonByFile.values()) {
    for (const symbol of parsedPython.symbols.filter((item) => item.kind === "function")) {
      const bucket = pythonNames.get(symbol.name) ?? [];
      bucket.push(symbol);
      pythonNames.set(symbol.name, bucket);
    }
  }
  for (const [relPath, parsedPython] of pythonByFile) {
    const fileHash = fileHashes[relPath]!;
    for (const call of parsedPython.calls) {
      const targets = pythonNames.get(call.targetName) ?? [];
      if (targets.length !== 1) continue;
      queueLink({
        linkKind: "call",
        from: { kind: "symbol", symbolId: call.fromSymbolId },
        to: { kind: "symbol", symbolId: targets[0]!.symbolId },
        extentText: call.extentText,
        location: { startLine: call.line, endLine: call.line },
        startColumn: call.column,
        filePath: relPath,
        fileContentHash: fileHash,
        summary: `${call.fromSymbolId} 이 ${targets[0]!.symbolId} 를 호출한다`,
      });
    }
  }

  // ---- P2: framework adapters --------------------------------------------

  for (const relPath of indexed) {
    const sourceFile = parsed.includes(relPath)
      ? program.getSourceFile(`${projectRoot}/${relPath}`)
      : undefined;

    const output = runAdapters(
      {
        projectRoot,
        analysisVersion: version,
        relPath,
        text: sources.get(relPath)!,
        fileHash: fileHashes[relPath]!,
        ...(sourceFile ? { sourceFile } : {}),
        sites: sitesByFile.get(relPath) ?? [],
        resolve: (node) => resolveTargetSymbolId(node, checker, projectRoot, inScope),
        report: () => undefined,
      },
      report,
    );

    evidence.push(...output.entities);
    for (const link of output.links) queueLink(link);
  }

  // ---- P3: git_change ----------------------------------------------------

  if (options.gitBase) {
    const result = changedFilesSince(projectRoot, options.gitBase);
    if (!result.ok) {
      // 조용히 "변경 없음"으로 넘어가지 않는다.
      report.push({
        adapterId: "p3-git",
        level: "warning",
        message: `git diff 실패 (base ${options.gitBase}): ${result.message}`,
      });
    } else {
      for (const change of result.changes) {
        const text = sources.get(change.path);
        const material = `${change.status} ${change.path}`;
        evidence.push({
          id: `ev:gitchange:${sha256(`${options.gitBase}|${material}`).slice(0, 40)}`,
          kind: "git_change",
          origin: "engine",
          filePath: change.path,
          rawHash: rawHashOf(material),
          normalizedFingerprint: fingerprintOf(material, "prose"),
          normalizationProfile: "prose",
          excerpt: material,
          // graph 없음 — 코드 그래프 상의 위치가 아니라 "변경되었다"는 사실이다 (T2).
          summary: `${change.path} 이 ${options.gitBase} 이후 변경되었다 (${change.status})`,
          fileContentHash: text === undefined ? "" : fileHashes[change.path]!,
          observedAtVersion: version,
          status: "present",
        });
      }
    }
  }

  // ---- 링크 id 해소 + 정렬 -----------------------------------------------

  const linkIds = resolveLinkIds(pending.map((item) => item.candidate));
  pending.forEach((item, index) => evidence.push(item.build(linkIds[index]!)));

  // 같은 id가 두 번 나오지 않아야 한다. 나오면 id 규칙에 결함이 있다는 뜻이다.
  const seen = new Set<string>();
  const unique: Evidence[] = [];
  for (const item of evidence) {
    if (seen.has(item.id)) {
      report.push({
        adapterId: "indexer",
        filePath: item.filePath ?? "",
        level: "warning",
        message: `evidence id 가 중복되었습니다: ${item.id} (${item.kind})`,
      });
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }

  unique.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  report.sort((a, b) =>
    a.adapterId < b.adapterId
      ? -1
      : a.adapterId > b.adapterId
        ? 1
        : (a.filePath ?? "") < (b.filePath ?? "")
          ? -1
          : (a.filePath ?? "") > (b.filePath ?? "")
            ? 1
            : 0,
  );

  return {
    analysisVersion: version,
    fileHashes,
    evidence: unique,
    adapterReport: report,
    unindexedFiles: unindexedFiles.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0)),
  };
}
