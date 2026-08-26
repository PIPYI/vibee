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
import type { ArchitectureViewDocument, RepositoryTopology } from "@onto/protocol";

import { diagnostic, type Diagnostic } from "./diagnostic.js";

function pathInside(rootPath: string, filePath: string): boolean {
  return rootPath === "" ? true : filePath === rootPath || filePath.startsWith(`${rootPath}/`);
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

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) if (b.has(value)) return true;
  return false;
}

export function checkCompleteness(doc: ArchitectureViewDocument, topology: RepositoryTopology): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const cited = citedPaths(doc);

  for (const runtime of topology.runtimes) {
    const entrypoints = entityRefPaths(runtime.entrypointRefs);
    const covered =
      entrypoints.size > 0 ? intersects(entrypoints, cited) : [...cited].some((path) => pathInside(runtime.rootPath, path));
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

  return diagnostics;
}
