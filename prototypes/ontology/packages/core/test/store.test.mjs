/**
 * generation commit + atomic HEAD switch (implementation_plan §5 T4).
 *
 * 여기서 가장 중요한 것은 **acceptance 19**다 — 주장한 실패 모드를 실제로 재현한다.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { SemanticStore, initialProjectState } from "@onto/core";
import { generationDir, headPath } from "@onto/protocol/node";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const roots = [];

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "onto-store-"));
  roots.push(dir);
  return dir;
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

test("init 은 generation 1 을 만들고 HEAD 가 그것을 가리킨다", async () => {
  const root = scratch();
  const store = new SemanticStore(root);

  assert.equal(store.isInitialized(), false);
  const state = await store.init(initialProjectState("p1", "fixture"));

  assert.equal(state.generation, 1);
  assert.equal(store.readHead().generation, 1);
  assert.equal(state.project.analysisVersion, 0);
  assert.equal(state.project.semanticReconciledAnalysisVersion, 0);
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].source, "init");
});

test("commit 마다 generation 이 하나씩 늘고 이전 것은 그대로 읽힌다", async () => {
  const root = scratch();
  const store = new SemanticStore(root);
  await store.init(initialProjectState("p1", "fixture"));

  await store.commit("index", "index", (s) => {
    s.project.analysisVersion = 1;
    s.evidence.analysisVersion = 1;
    return s;
  });
  const third = await store.commit("patch", "patch", (s) => {
    s.project.semanticVersion = 1;
    return s;
  });

  assert.equal(third.generation, 3);
  assert.deepEqual(store.listGenerations(), [1, 2, 3]);

  // generation 이 곧 history 다 (C4) — 옛 상태를 그대로 되읽을 수 있다.
  assert.equal(store.readGeneration(2).project.semanticVersion, 0);
  assert.equal(store.readGeneration(3).project.semanticVersion, 1);
});

test("두 버전은 서로 독립적으로 오른다 — index 커밋은 semanticVersion 을 건드리지 않는다", async () => {
  const root = scratch();
  const store = new SemanticStore(root);
  await store.init(initialProjectState("p1", "fixture"));

  const after1 = await store.commit("re-index", "index", (s) => {
    s.project.analysisVersion += 1;
    return s;
  });
  assert.equal(after1.project.analysisVersion, 1);
  assert.equal(after1.project.semanticVersion, 0);
  // reconcile 이 뒤처졌다 = 코드는 앞서 갔고 의미는 아직 따라가지 못했다.
  assert.equal(after1.project.semanticReconciledAnalysisVersion, 0);
});

test("manifest 해시가 어긋나면 이전 generation 으로 물러선다", async () => {
  const root = scratch();
  const store = new SemanticStore(root);
  await store.init(initialProjectState("p1", "fixture"));
  await store.commit("index", "index", (s) => {
    s.project.analysisVersion = 1;
    return s;
  });

  // generation 2 를 손상시킨다 (디스크는 거짓말을 한다).
  const victim = join(generationDir(root, 2), "project.json");
  writeFileSync(victim, '{"projectId":"tampered"}\n');

  const loaded = store.load();
  assert.equal(loaded.generation, 1, "손상된 generation 을 조용히 읽으면 안 된다");
  assert.equal(store.readHead().generation, 1, "HEAD 도 물러서야 한다");
});

test("acceptance 19 — HEAD switch 직전 SIGKILL 후에도 이전 generation 이 온전히 읽힌다", () => {
  const root = scratch();

  const child = spawnSync(process.execPath, [join(HERE, "crash-child.mjs"), root], {
    encoding: "utf8",
  });

  // 자식이 실제로 신호로 죽었는가. 정상 종료했다면 시험 자체가 성립하지 않는다.
  assert.equal(child.signal, "SIGKILL", `자식이 SIGKILL 로 죽지 않았습니다: ${child.stderr}`);

  const store = new SemanticStore(root);

  // 1. HEAD 는 넘어가지 않았다 — 옛 generation 을 가리킨다.
  assert.equal(store.readHead().generation, 2);

  // 2. 그 generation 이 온전히 읽힌다 (찢어진 상태가 아니다).
  const state = store.load();
  assert.equal(state.generation, 2);
  assert.equal(state.project.analysisVersion, 1);
  assert.equal(state.evidence.fileHashes["src/a.ts"], "aaa");
  // 커밋되지 않은 semantic patch 는 보이지 않는다.
  assert.equal(state.project.semanticVersion, 0);
  assert.equal(state.memory.concepts.length, 0);

  // 3. 미완성 generation 3 은 디스크에 남아 있지만 아무도 가리키지 않는다.
  assert.ok(existsSync(generationDir(root, 3)), "고아 generation 이 남아 있어야 한다");

  // 4. 다음 실행이 청소한다.
  assert.deepEqual(store.cleanOrphans(), [3]);
  assert.equal(existsSync(generationDir(root, 3)), false);
  assert.deepEqual(store.listGenerations(), [1, 2]);

  // 5. 청소 뒤에도 정상적으로 이어서 쓸 수 있다.
  assert.equal(JSON.parse(readFileSync(headPath(root), "utf8")).generation, 2);
});

test("SIGKILL 이후 이어서 커밋하면 generation 3 이 다시 만들어진다", async () => {
  const root = scratch();
  spawnSync(process.execPath, [join(HERE, "crash-child.mjs"), root], { encoding: "utf8" });

  const store = new SemanticStore(root);
  store.cleanOrphans();

  const next = await store.commit("patch 재시도", "patch", (s) => {
    s.project.semanticVersion = 1;
    s.project.semanticReconciledAnalysisVersion = 1;
    return s;
  });

  assert.equal(next.generation, 3);
  assert.equal(next.project.semanticVersion, 1);
  // reconcile 이 따라잡았다.
  assert.equal(
    next.project.semanticReconciledAnalysisVersion,
    next.project.analysisVersion,
  );
});

test("고아 generation 이 남아 있어도 다음 커밋이 그것을 덮어쓴다", async () => {
  const root = scratch();
  spawnSync(process.execPath, [join(HERE, "crash-child.mjs"), root], { encoding: "utf8" });

  // cleanOrphans 를 부르지 않는다 — 커밋 경로가 스스로 살아남아야 한다.
  const store = new SemanticStore(root);
  const next = await store.commit("청소 없이 재시도", "patch", (s) => {
    s.project.semanticVersion = 7;
    return s;
  });

  assert.equal(next.generation, 3);
  assert.equal(store.readGeneration(3).project.semanticVersion, 7);
});
