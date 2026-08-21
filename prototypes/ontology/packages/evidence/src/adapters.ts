/**
 * P2 framework adapters (implementation_plan §6.2).
 *
 * 각 adapter는 `{ id, detect(ctx) }`이고 **절대 throw 하지 않는다** (C1).
 * 실패는 `adapterReport`에 남고 **조용히 사라지지 않는다.**
 *
 * 여기서 만드는 것은 route · api_handler · ui_event · db_* · config Evidence이고,
 * 그 목적은 ScenarioStep과 StateChange가 붙일 **실제 근거**를 만드는 것이다.
 * 프레임워크 탐지는 일부러 얕다 — §11이 완전성을 성공 조건으로 두지 않는다.
 */
import { createHash } from "node:crypto";

import ts from "typescript";

import type { AdapterReportEntry, EntityRef, Evidence, SourceRange } from "@onto/protocol";

import { fingerprintOf, rawHashOf } from "./ids.js";
import {
  enclosingStatement,
  enclosingSymbol,
  firstLine,
  rangeOf,
  startColumnOf,
  type SymbolSite,
} from "./sites.js";

/** id 해소가 필요한 링크. indexer가 충돌 그룹까지 보고 최종 id를 붙인다 (U3). */
export type PendingLinkSpec = {
  linkKind: string;
  from: EntityRef;
  to: EntityRef;
  /** `localNormalizedFingerprint`를 계산할 extent 원문 */
  extentText: string;
  location: SourceRange;
  startColumn: number;
  filePath: string;
  fileContentHash: string;
  summary: string;
};

export type AdapterOutput = {
  entities: Evidence[];
  links: PendingLinkSpec[];
};

export type AdapterContext = {
  projectRoot: string;
  analysisVersion: number;
  relPath: string;
  text: string;
  fileHash: string;
  /** TS로 파싱된 파일일 때만 */
  sourceFile?: ts.SourceFile;
  sites: SymbolSite[];
  /** 프로젝트 안의 심볼로 해석. 못 하면 undefined */
  resolve: (node: ts.Identifier) => string | undefined;
  report: (entry: Omit<AdapterReportEntry, "adapterId">) => void;
};

export type EvidenceAdapter = {
  id: string;
  detect: (ctx: AdapterContext) => AdapterOutput;
};

const EMPTY: AdapterOutput = { entities: [], links: [] };

function entityEvidence(
  ctx: AdapterContext,
  args: {
    id: string;
    kind: string;
    entity: EntityRef;
    label: string;
    extentText: string;
    summary: string;
    location?: SourceRange;
  },
): Evidence {
  return {
    id: args.id,
    kind: args.kind,
    origin: "engine",
    filePath: ctx.relPath,
    ...(args.location ? { location: args.location } : {}),
    rawHash: rawHashOf(args.extentText),
    normalizedFingerprint: fingerprintOf(args.extentText, "prose"),
    normalizationProfile: "prose",
    excerpt: firstLine(args.extentText),
    graph: { role: "entity", entity: args.entity, label: args.label },
    summary: args.summary,
    fileContentHash: ctx.fileHash,
    observedAtVersion: ctx.analysisVersion,
    status: "present",
  };
}

/** entity id는 주소에서 나온다 (R1). 위치가 들어가지 않으므로 여기서 바로 만들 수 있다. */
function sha1Hex(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// route / api_handler
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function routeKeyOf(method: string, pathPattern: string): string {
  return `${method} ${pathPattern}`;
}

function routeEntityId(routeKey: string): string {
  return `ev:route:${sha1Hex(routeKey)}`;
}

/**
 * `app/api/follow/[id]/route.ts` → `/api/follow/:id`
 *
 * route group `(marketing)`은 URL에 나타나지 않으므로 버린다.
 */
function nextAppRoutePath(relPath: string): string | undefined {
  const match = relPath.match(/(?:^|\/)app\/(.*)\/route\.[cm]?[jt]sx?$/u);
  if (!match) return undefined;
  const segments = (match[1] ?? "")
    .split("/")
    .filter((segment) => segment.length > 0 && !/^\(.*\)$/u.test(segment))
    .map((segment) => {
      const dynamic = segment.match(/^\[\.{3}(.+)\]$/u);
      if (dynamic) return `*${dynamic[1]}`;
      const param = segment.match(/^\[(.+)\]$/u);
      return param ? `:${param[1]}` : segment;
    });
  return `/${segments.join("/")}`;
}

function nextPagesApiPath(relPath: string): string | undefined {
  const match = relPath.match(/(?:^|\/)pages\/api\/(.*)\.[cm]?[jt]sx?$/u);
  if (!match) return undefined;
  const raw = match[1] ?? "";
  const trimmed = raw.endsWith("/index") ? raw.slice(0, -"/index".length) : raw === "index" ? "" : raw;
  const segments = trimmed
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const param = segment.match(/^\[(.+)\]$/u);
      return param ? `:${param[1]}` : segment;
    });
  return `/api/${segments.join("/")}`.replace(/\/$/u, "") || "/api";
}

/** Next.js App Router — `route.ts`의 `export function GET/POST/...` */
const nextAppRouter: EvidenceAdapter = {
  id: "next-app-router",
  detect(ctx) {
    const pathPattern = nextAppRoutePath(ctx.relPath);
    if (!pathPattern || !ctx.sourceFile) return EMPTY;

    const entities: Evidence[] = [];
    const links: PendingLinkSpec[] = [];
    for (const site of ctx.sites) {
      if (!HTTP_METHODS.has(site.qualifiedName)) continue;
      const routeKey = routeKeyOf(site.qualifiedName, pathPattern);
      const entity: EntityRef = { kind: "route", routeKey };
      const location = rangeOf(ctx.sourceFile, site.node);

      entities.push(
        entityEvidence(ctx, {
          id: routeEntityId(routeKey),
          kind: "route",
          entity,
          label: routeKey,
          extentText: routeKey,
          summary: `${routeKey} (${ctx.relPath})`,
          location,
        }),
      );
      links.push({
        linkKind: "api_handler",
        from: entity,
        to: { kind: "symbol", symbolId: site.symbolId },
        extentText: `${routeKey} -> ${site.symbolId}`,
        location,
        startColumn: startColumnOf(ctx.sourceFile, site.node),
        filePath: ctx.relPath,
        fileContentHash: ctx.fileHash,
        summary: `${routeKey} 를 ${site.qualifiedName} 이 처리한다`,
      });
    }
    return { entities, links };
  },
};

/** Next.js Pages API — `pages/api/**`의 default export */
const nextPagesApi: EvidenceAdapter = {
  id: "next-pages-api",
  detect(ctx) {
    const pathPattern = nextPagesApiPath(ctx.relPath);
    if (!pathPattern || !ctx.sourceFile) return EMPTY;

    const handler =
      ctx.sites.find((site) => site.qualifiedName === "handler") ?? ctx.sites[0];
    if (!handler) return EMPTY;

    // Pages API는 하나의 핸들러가 모든 메서드를 받는다. 메서드를 지어내지 않는다.
    const routeKey = routeKeyOf("ALL", pathPattern);
    const entity: EntityRef = { kind: "route", routeKey };
    const location = rangeOf(ctx.sourceFile, handler.node);
    return {
      entities: [
        entityEvidence(ctx, {
          id: routeEntityId(routeKey),
          kind: "route",
          entity,
          label: routeKey,
          extentText: routeKey,
          summary: `${routeKey} (${ctx.relPath})`,
          location,
        }),
      ],
      links: [
        {
          linkKind: "api_handler",
          from: entity,
          to: { kind: "symbol", symbolId: handler.symbolId },
          extentText: `${routeKey} -> ${handler.symbolId}`,
          location,
          startColumn: startColumnOf(ctx.sourceFile, handler.node),
          filePath: ctx.relPath,
          fileContentHash: ctx.fileHash,
          summary: `${routeKey} 를 ${handler.qualifiedName} 이 처리한다`,
        },
      ],
    };
  },
};

const EXPRESS_HOSTS = new Set(["app", "router", "server", "api"]);

/** Express / Hono 류 — `app.get("/x", handler)` */
const expressRoutes: EvidenceAdapter = {
  id: "express",
  detect(ctx) {
    const sourceFile = ctx.sourceFile;
    if (!sourceFile) return EMPTY;

    const entities: Evidence[] = [];
    const links: PendingLinkSpec[] = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        EXPRESS_HOSTS.has(node.expression.expression.text)
      ) {
        const method = node.expression.name.text.toUpperCase();
        const first = node.arguments[0];
        if ((HTTP_METHODS.has(method) || method === "ALL") && first && ts.isStringLiteral(first)) {
          const routeKey = routeKeyOf(method, first.text);
          const entity: EntityRef = { kind: "route", routeKey };
          const statement = enclosingStatement(node) ?? node;
          const location = rangeOf(sourceFile, statement);

          entities.push(
            entityEvidence(ctx, {
              id: routeEntityId(routeKey),
              kind: "route",
              entity,
              label: routeKey,
              extentText: routeKey,
              summary: `${routeKey} (${ctx.relPath})`,
              location,
            }),
          );

          // 핸들러가 이름 있는 심볼일 때만 링크를 건다. 인라인 함수는 주소가 없다.
          for (const argument of node.arguments.slice(1)) {
            if (!ts.isIdentifier(argument)) continue;
            const target = ctx.resolve(argument);
            if (!target) continue;
            links.push({
              linkKind: "api_handler",
              from: entity,
              to: { kind: "symbol", symbolId: target },
              extentText: statement.getText(sourceFile),
              location,
              startColumn: startColumnOf(sourceFile, statement),
              filePath: ctx.relPath,
              fileContentHash: ctx.fileHash,
              summary: `${routeKey} 를 ${argument.text} 이 처리한다`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return { entities, links };
  },
};

// ---------------------------------------------------------------------------
// ui_event
// ---------------------------------------------------------------------------

/**
 * React JSX 이벤트 — `onClick={handleFollow}` / `onSubmit={() => submit()}`
 *
 * §29가 말한 대로 `FollowButton` 같은 저수준 객체를 Scenario participant로 승격하지는
 * 않지만, "사용자가 무엇을 눌렀을 때 무엇이 도는가"의 **근거**는 여기에만 있다.
 */
const reactJsxEvents: EvidenceAdapter = {
  id: "react-jsx-events",
  detect(ctx) {
    const sourceFile = ctx.sourceFile;
    if (!sourceFile) return EMPTY;
    const links: PendingLinkSpec[] = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        /^on[A-Z]/u.test(node.name.text) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        const owner = enclosingSymbol(node, ctx.sites);
        if (owner) {
          // 표현식 안의 식별자 중 프로젝트 심볼로 해석되는 것을 핸들러로 본다.
          const handlers = new Set<string>();
          const scan = (inner: ts.Node): void => {
            if (ts.isIdentifier(inner)) {
              const target = ctx.resolve(inner);
              if (target && target !== owner.symbolId) handlers.add(target);
            }
            ts.forEachChild(inner, scan);
          };
          scan(node.initializer.expression);

          const location = rangeOf(sourceFile, node);
          for (const target of [...handlers].sort()) {
            links.push({
              linkKind: "ui_event",
              from: { kind: "symbol", symbolId: owner.symbolId },
              to: { kind: "symbol", symbolId: target },
              extentText: node.getText(sourceFile),
              location,
              startColumn: startColumnOf(sourceFile, node),
              filePath: ctx.relPath,
              fileContentHash: ctx.fileHash,
              summary: `${owner.qualifiedName} 의 ${node.name.text} 이 ${target.split("#")[1]} 를 부른다`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return { entities: [], links };
  },
};

// ---------------------------------------------------------------------------
// db_entity / db_read / db_write
// ---------------------------------------------------------------------------

export function modelKeyOf(source: string, model: string): string {
  return `${source}:${model}`;
}

function modelEntityId(modelKey: string): string {
  return `ev:model:${sha1Hex(modelKey)}`;
}

const PRISMA_HOSTS = new Set(["prisma", "db", "client"]);
const PRISMA_WRITES = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "createManyAndReturn",
]);
const PRISMA_READS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/** `schema.prisma`의 `model X { ... }` → model entity + schema 파일이 그것을 담는다는 링크 */
const prismaSchema: EvidenceAdapter = {
  id: "prisma-schema",
  detect(ctx) {
    if (!ctx.relPath.endsWith(".prisma")) return EMPTY;

    const entities: Evidence[] = [];
    const links: PendingLinkSpec[] = [];
    const lines = ctx.text.split(/\r?\n/u);

    lines.forEach((line, offset) => {
      const match = line.match(/^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/u);
      if (!match) return;
      const model = match[1]!;
      const modelKey = modelKeyOf("prisma", model);
      const entity: EntityRef = { kind: "model", modelKey };
      const location: SourceRange = { startLine: offset + 1, endLine: offset + 1 };

      entities.push(
        entityEvidence(ctx, {
          id: modelEntityId(modelKey),
          kind: "db_entity",
          entity,
          label: model,
          extentText: `model ${model}`,
          summary: `Prisma 모델 ${model} (${ctx.relPath})`,
          location,
        }),
      );
      links.push({
        linkKind: "contains",
        from: { kind: "file", filePath: ctx.relPath },
        to: entity,
        extentText: `${ctx.relPath} contains ${modelKey}`,
        location,
        startColumn: 0,
        filePath: ctx.relPath,
        fileContentHash: ctx.fileHash,
        summary: `${ctx.relPath} 이 모델 ${model} 을 담고 있다`,
      });
    });

    return { entities, links };
  },
};

/** `prisma.followRequest.create(...)` → db_write, `.findMany(...)` → db_read */
const prismaCalls: EvidenceAdapter = {
  id: "prisma-calls",
  detect(ctx) {
    const sourceFile = ctx.sourceFile;
    if (!sourceFile) return EMPTY;
    const links: PendingLinkSpec[] = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        ts.isIdentifier(node.expression.expression.expression) &&
        PRISMA_HOSTS.has(node.expression.expression.expression.text)
      ) {
        const operation = node.expression.name.text;
        const accessor = node.expression.expression.name.text;
        const isWrite = PRISMA_WRITES.has(operation);
        const isRead = PRISMA_READS.has(operation);

        if (isWrite || isRead) {
          const owner = enclosingSymbol(node, ctx.sites);
          if (owner) {
            // `followRequest` -> `FollowRequest`. Prisma client는 모델명을 lower-camel로 노출한다.
            const model = accessor.charAt(0).toUpperCase() + accessor.slice(1);
            const statement = enclosingStatement(node) ?? node;
            links.push({
              linkKind: isWrite ? "db_write" : "db_read",
              from: { kind: "symbol", symbolId: owner.symbolId },
              to: { kind: "model", modelKey: modelKeyOf("prisma", model) },
              extentText: statement.getText(sourceFile),
              location: rangeOf(sourceFile, statement),
              startColumn: startColumnOf(sourceFile, statement),
              filePath: ctx.relPath,
              fileContentHash: ctx.fileHash,
              summary: `${owner.qualifiedName} 이 ${model} 을 ${isWrite ? "쓴다" : "읽는다"} (${operation})`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return { entities: [], links };
  },
};

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

const CONFIG_FILES = [
  "package.json",
  ".env.example",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "tsconfig.json",
];

export function isConfigFile(relPath: string): boolean {
  return CONFIG_FILES.some((name) => relPath === name || relPath.endsWith(`/${name}`));
}

/**
 * 설정 파일.
 *
 * **`graph`를 붙이지 않는다** — 가리킬 대상이 없기 때문이다. Concept를 grounding하는 데는
 * 그대로 쓰이지만 Trace에는 나오지 않는다. "근거는 있지만 코드 그래프 상의 위치로는
 * 표현되지 않는다"가 실제로 있는 상태다 (T2).
 */
const projectConfig: EvidenceAdapter = {
  id: "project-config",
  detect(ctx) {
    if (!isConfigFile(ctx.relPath)) return EMPTY;
    return {
      entities: [
        {
          id: `ev:config:${sha1Hex(ctx.relPath)}`,
          kind: "config",
          origin: "engine",
          filePath: ctx.relPath,
          rawHash: rawHashOf(ctx.text),
          normalizedFingerprint: fingerprintOf(ctx.text, "prose"),
          normalizationProfile: "prose",
          excerpt: firstLine(ctx.text),
          summary: `설정 파일 ${ctx.relPath}`,
          fileContentHash: ctx.fileHash,
          observedAtVersion: ctx.analysisVersion,
          status: "present",
        },
      ],
      links: [],
    };
  },
};

// ---------------------------------------------------------------------------

export const ADAPTERS: EvidenceAdapter[] = [
  nextAppRouter,
  nextPagesApi,
  expressRoutes,
  reactJsxEvents,
  prismaSchema,
  prismaCalls,
  projectConfig,
];

/**
 * 모든 adapter를 돌린다. **하나가 던져도 나머지는 계속 돈다** (C1).
 */
export function runAdapters(ctx: AdapterContext, report: AdapterReportEntry[]): AdapterOutput {
  const entities: Evidence[] = [];
  const links: PendingLinkSpec[] = [];

  for (const adapter of ADAPTERS) {
    try {
      const output = adapter.detect({
        ...ctx,
        report: (entry) => report.push({ adapterId: adapter.id, ...entry }),
      });
      entities.push(...output.entities);
      links.push(...output.links);
    } catch (error) {
      // 조용히 건너뛰지 않는다. 무엇이 실패했는지 남긴다.
      report.push({
        adapterId: adapter.id,
        filePath: ctx.relPath,
        level: "error",
        message: `adapter 가 실패했습니다: ${String(error)}`,
      });
    }
  }

  return { entities, links };
}
