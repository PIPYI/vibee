/**
 * Viewer Shell의 딥링크 (schema2 §2.1, §7 I14).
 *
 * URL hash만 읽고 쓴다 — IR에도 store에도 쓰지 않는다. 상호작용 상태(focus·view kind)는
 * 브라우저 메모리와 여기뿐이다.
 */
export type HashParams = Record<string, string>;

export function readHashParams(): HashParams {
  const raw = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(raw);
  const result: HashParams = {};
  for (const [key, value] of params.entries()) result[key] = value;
  return result;
}

/** 지정한 key만 갱신하고 나머지는 보존한다. value가 undefined면 그 key를 지운다. */
export function writeHashParams(patch: Record<string, string | undefined>): void {
  const current = readHashParams();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete current[key];
    else current[key] = value;
  }
  const params = new URLSearchParams(current);
  const next = params.toString();
  const url = window.location.pathname + window.location.search + (next ? `#${next}` : "");
  window.history.replaceState(null, "", url);
}
