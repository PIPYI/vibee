/**
 * v7 §5.2(b) — 일반화된 결정론적 완전성 체크.
 *
 * "특정 프로젝트에만 맞춘 개별 패치를 짜지 말라"는 원칙과 V5 (b)("런타임 탐지가 manifest에만
 * 의존해 manifest 없는 서비스가 안 보인다")가 만나는 지점이다. `@onto/core`의
 * `detectRepositoryTopology()`가 만든 `RepositoryTopology`(런타임/데이터스토어/route-surface,
 * manifest든 route-cluster든 상관없이 일반화됨)를 그대로 받아서, AI가 저작한
 * `ArchitectureViewDocument.components[].sources[]`가 그 항목들을 하나라도 인용하는지만 본다.
 *
 * 이 체크는 **hard reject가 아니라 warning**이다 — AI가 자유롭게 저작한 뒤 사후에 repair
 * diagnostic을 받는 구조이지, 저작을 막는 게이트가 아니다(v7/README.md §9 — 과장 금지).
 */
import { entityKey, type ArchitectureViewDocument, type EntityRef, type RepositoryTopology, type SystemFactStore } from "@onto/protocol";

import { diagnostic, type Diagnostic } from "./diagnostic.js";

function pathInside(rootPath: string, filePath: string): boolean {
  // route-cluster runtime은 repository root를 의미하는 빈 문자열을 쓴다. 이를 모든 파일의
  // 부모로 취급하면 sources 하나만으로 전 저장소 런타임을 덮었다고 오판한다.
  return rootPath !== "" && (filePath === rootPath || filePath.startsWith(`${rootPath}/`));
}

function entityRefPaths(refs: readonly string[]): Set<string> {
  const paths = new Set<string>();
  for (const ref of refs) if (ref.startsWith("file:")) paths.add(ref.slice("file:".length));
  return paths;
}

function citedPaths(doc: ArchitectureViewDocument): Set<string> {
  const paths = new Set<string>();
  for (const component of doc.components) for (const source of component.sources ?? []) paths.add(source.path);
  return paths;
}

/**
 * component source는 대표 파일일 수 있고, topology는 그 아래의 entrypoint/route 파일을
 * 가리킬 수 있다. 정확 문자열 비교만 하면 monorepo/폴리글랏 경로에서 근거가 있어도
 * 헛경보가 난다. 경로 경계(`/`)에서만 prefix를 인정해 `api`와 `apiary`를 섞지 않는다.
 */
function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const left of a) for (const right of b) if (pathsOverlap(left, right)) return true;
  return false;
}

function pathForRef(ref: EntityRef): string | undefined {
  if (ref.kind === "file") return ref.filePath;
  // symbolId는 evidence/indexer 전반에서 `relative/path#symbol` 주소를 쓴다. 주소가 이
  // 형식이 아니면 억지로 경로로 해석하지 않는다.
  if (ref.kind === "symbol") {
    const hash = ref.symbolId.indexOf("#");
    return hash > 0 ? ref.symbolId.slice(0, hash) : undefined;
  }
  return undefined;
}

function currentFact(status: SystemFactStore["entities"][number]["status"]): boolean {
  return status === "valid" || status === "relocated";
}

/** 저장소·언어 패키지와 외부 서비스 fact만 대상으로 삼는다. */
function isExternalLibrary(ref: EntityRef, entityKinds: ReadonlyMap<string, string>): boolean {
  if (ref.kind !== "resource") return false;
  const entityKind = entityKinds.get(entityKey(ref));
  return entityKind === "external_library" || ["npm", "python", "external"].includes(ref.namespace);
}

function checkExternalServices(cited: ReadonlySet<string>, systemFacts?: SystemFactStore): Diagnostic[] {
  if (!systemFacts) return [];

  const entityKinds = new Map(
    systemFacts.entities
      .filter((entity) => currentFact(entity.status))
      .map((entity) => [entity.id, entity.kind] as const),
  );
  const usesByResource = new Map<string, { ref: EntityRef; localPaths: Set<string>; evidenceRefs: Set<string> }>();

  for (const link of systemFacts.links) {
    if (link.kind !== "uses" || !currentFact(link.status)) continue;
    const resource = isExternalLibrary(link.from, entityKinds)
      ? link.from
      : isExternalLibrary(link.to, entityKinds)
        ? link.to
        : undefined;
    if (!resource) continue;
    const local = resource === link.from ? link.to : link.from;
    const key = entityKey(resource);
    const current = usesByResource.get(key) ?? { ref: resource, localPaths: new Set<string>(), evidenceRefs: new Set<string>() };
    const localPath = pathForRef(local);
    if (localPath) current.localPaths.add(localPath);
    for (const evidenceRef of link.evidenceRefs) current.evidenceRefs.add(evidenceRef);
    usesByResource.set(key, current);
  }

  const diagnostics: Diagnostic[] = [];
  for (const [resourceKey, usage] of usesByResource) {
    if (usage.localPaths.size > 0 && intersects(usage.localPaths, cited)) continue;
    diagnostics.push(
      diagnostic(
        "architecture-view/external-service-not-represented",
        "warning",
        `외부 라이브러리·서비스 "${resourceKey}"를 사용하는 코드가 component.sources에 인용되지 않았습니다.`,
        {
          subject: { resource: resourceKey },
          evidence: {
            localPaths: [...usage.localPaths].sort(),
            evidenceRefs: [...usage.evidenceRefs].sort(),
          },
          supportedFixes: ["이 외부 의존성을 사용하는 대표 파일을 external/cloud component의 sources[]에 인용하거나, 지도에서 제외한 이유를 cards에 적는다"],
        },
      ),
    );
  }
  return diagnostics;
}

export function checkCompleteness(
  doc: ArchitectureViewDocument,
  topology: RepositoryTopology,
  systemFacts?: SystemFactStore,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const cited = citedPaths(doc);

  for (const runtime of topology.runtimes) {
    const entrypoints = entityRefPaths(runtime.entrypointRefs);
    const routeFiles = new Set(
      topology.routeSurfaces
        .filter((surface) => surface.runtimeId === runtime.id)
        .map((surface) => surface.filePath),
    );
    const covered =
      entrypoints.size > 0
        ? intersects(entrypoints, cited)
        : runtime.rootPath !== ""
          ? [...cited].some((path) => pathInside(runtime.rootPath, path))
          : routeFiles.size > 0 && intersects(routeFiles, cited);
    if (covered) continue;
    diagnostics.push(
      diagnostic(
        "architecture-view/runtime-not-represented",
        "warning",
        `탐지된 런타임 "${runtime.label}"(${runtime.origin})을 인용하는 component.sources가 없습니다.`,
        {
          subject: { runtimeId: runtime.id, rootPath: runtime.rootPath, origin: runtime.origin },
          evidence: { entrypointRefs: runtime.entrypointRefs },
          supportedFixes: ["이 런타임의 entrypoint 또는 대표 파일을 sources[]로 인용하는 component를 추가한다"],
        },
      ),
    );
  }

  for (const store of topology.dataStores) {
    // generated-artifact는 실행마다 파이프라인이 만드는 산출물이라 저작에 나타나지 않아도
    // 결함이 아니다 — repository-topology.ts의 coverage gate와 같은 예외(V5 C1).
    if (store.origin === "generated-artifact") continue;
    const files = entityRefPaths(store.entityRefs);
    if (intersects(files, cited)) continue;
    diagnostics.push(
      diagnostic("architecture-view/data-store-not-represented", "warning", `탐지된 로컬 데이터 저장소 "${store.label}"를 인용하는 component.sources가 없습니다.`, {
        subject: { storeId: store.id, rootPath: store.rootPath },
        supportedFixes: ["이 데이터 저장소의 대표 파일을 sources[]로 인용하는 component를 추가한다"],
      }),
    );
  }

  for (const surface of topology.routeSurfaces) {
    const files = entityRefPaths(surface.entityRefs);
    if (intersects(files, cited)) continue;
    diagnostics.push(
      diagnostic(
        "architecture-view/route-surface-not-represented",
        "warning",
        `탐지된 라우트 표면 "${surface.filePath}"(${surface.routeKeys.join(", ")})를 인용하는 component.sources가 없습니다.`,
        {
          subject: { surfaceId: surface.id, filePath: surface.filePath },
          supportedFixes: ["이 파일을 sources[]로 인용하는 component를 추가하거나 기존 component에 추가한다"],
        },
      ),
    );
  }

  diagnostics.push(...checkExternalServices(cited, systemFacts));

  return diagnostics;
}
