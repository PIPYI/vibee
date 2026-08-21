/**
 * acceptance 19의 자식 프로세스.
 *
 * generation 3을 다 쓴 뒤 **HEAD를 넘기기 직전에 스스로 SIGKILL을 받는다.**
 * mock이 아니라 실제 신호다 — 그 지점이 crash-consistency의 전부이므로 진짜로 죽어야 한다.
 */
import { SemanticStore, initialProjectState } from "@onto/core";

const projectPath = process.argv[2];
if (!projectPath) {
  console.error("usage: crash-child.mjs <projectPath>");
  process.exit(2);
}

const store = new SemanticStore(projectPath);

await store.init(initialProjectState("fixture", "crash-fixture"));

// generation 2 — 온전히 커밋된다. 크래시 뒤 여기로 읽혀야 한다.
await store.commit("evidence index v1", "index", (state) => {
  state.project.analysisVersion = 1;
  state.evidence.analysisVersion = 1;
  state.evidence.fileHashes = { "src/a.ts": "aaa" };
  return state;
});

// generation 3 — 다 쓰고 HEAD 직전에 죽는다.
await store.commit(
  "semantic patch v1",
  "patch",
  (state) => {
    state.project.semanticVersion = 1;
    state.project.semanticReconciledAnalysisVersion = 1;
    state.memory.semanticVersion = 1;
    state.memory.concepts.push({
      id: "cpt-1",
      name: "팔로우 요청",
      evidenceRefs: ["ev:symbol:x"],
      status: "active",
      createdAtVersion: 1,
      updatedAtVersion: 1,
    });
    return state;
  },
  {
    onBeforeHeadSwitch: () => {
      process.kill(process.pid, "SIGKILL");
    },
  },
);

console.error("자식이 SIGKILL 이후에도 살아 있습니다 — 시험이 성립하지 않습니다.");
process.exit(3);
