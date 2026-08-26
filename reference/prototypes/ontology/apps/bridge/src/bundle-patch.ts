export type BundlePatchOperation = { op: "add" | "remove" | "replace"; path: string; value?: unknown };

/** server가 보존한 Bundle draft의 허용된 section에만 RFC 6902 부분집합을 적용한다. */
export function applyBundlePatch(bundle: unknown, operations: BundlePatchOperation[]): unknown {
  const root = structuredClone(bundle) as Record<string, unknown>;
  const allowedRoots = new Set(["architecture", "workflow", "userMap", "sequences"]);
  for (const operation of operations) {
    const segments = operation.path.split("/").slice(1).map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
    if (!operation.path.startsWith("/") || segments.length < 2 || !allowedRoots.has(segments[0]!)) {
      throw new Error(`허용되지 않는 Bundle patch 경로입니다: ${operation.path}`);
    }
    if (segments.some((part) => part === "__proto__" || part === "prototype" || part === "constructor")) {
      throw new Error(`안전하지 않은 Bundle patch 경로입니다: ${operation.path}`);
    }
    let parent: unknown = root;
    for (const segment of segments.slice(0, -1)) {
      if (parent === null || typeof parent !== "object") throw new Error(`존재하지 않는 patch 경로입니다: ${operation.path}`);
      parent = Array.isArray(parent) ? parent[Number(segment)] : (parent as Record<string, unknown>)[segment];
    }
    const key = segments[segments.length - 1]!;
    if (Array.isArray(parent)) {
      const index = key === "-" ? parent.length : Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`잘못된 배열 경로입니다: ${operation.path}`);
      if (operation.op === "add") parent.splice(index, 0, operation.value);
      else if (operation.op === "remove") {
        if (index >= parent.length) throw new Error(`제거할 항목이 없습니다: ${operation.path}`);
        parent.splice(index, 1);
      } else {
        if (index >= parent.length) throw new Error(`교체할 항목이 없습니다: ${operation.path}`);
        parent[index] = operation.value;
      }
    } else if (parent !== null && typeof parent === "object") {
      const record = parent as Record<string, unknown>;
      if (operation.op === "remove") delete record[key];
      else record[key] = operation.value;
    } else {
      throw new Error(`존재하지 않는 patch 경로입니다: ${operation.path}`);
    }
  }
  return root;
}
