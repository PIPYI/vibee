import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeSemanticDocument } from "@vibee/protocol";
import {
  MAX_ARCHITECTURE_VIEW_ATTEMPTS,
  MAX_RUNTIME_SEMANTIC_ATTEMPTS,
  clearSemanticRevisions,
  commitSemanticRevision,
  getLatestSemanticRevision,
  getSemanticRevision,
  recordAttempt,
  recordSemanticAttempt,
  startAttemptCounter,
  startSemanticAttemptCounter,
} from "../state.js";

function makeSemanticDoc(title: string): RuntimeSemanticDocument {
  return {
    schemaVersion: 1,
    title,
    actors: [],
    runtimes: [],
    responsibilities: [],
    states: [],
    externals: [],
    interactions: [],
  };
}

test("recordAttempt allows exactly MAX_ARCHITECTURE_VIEW_ATTEMPTS calls before overLimit flips true", () => {
  const taskId = "task-state-test-1";
  startAttemptCounter(taskId);

  assert.equal(MAX_ARCHITECTURE_VIEW_ATTEMPTS, 6);

  // Calls 1..6 (== MAX) must all report overLimit:false.
  for (let i = 1; i <= MAX_ARCHITECTURE_VIEW_ATTEMPTS; i++) {
    const { count, overLimit } = recordAttempt(taskId);
    assert.equal(count, i);
    assert.equal(overLimit, false, `call ${i} should not be over the limit`);
  }

  // The 7th call is the first to report overLimit:true.
  const seventh = recordAttempt(taskId);
  assert.equal(seventh.count, 7);
  assert.equal(seventh.overLimit, true);

  // Once over the limit, it stays over the limit.
  const eighth = recordAttempt(taskId);
  assert.equal(eighth.count, 8);
  assert.equal(eighth.overLimit, true);
});

test("attempt counters are independent per taskId", () => {
  startAttemptCounter("task-a");
  startAttemptCounter("task-b");

  recordAttempt("task-a");
  recordAttempt("task-a");
  const b = recordAttempt("task-b");

  assert.equal(b.count, 1);
});

test("recordSemanticAttempt allows exactly MAX_RUNTIME_SEMANTIC_ATTEMPTS calls before overLimit flips true", () => {
  const taskId = "task-semantic-attempts-1";
  startSemanticAttemptCounter(taskId);

  for (let i = 1; i <= MAX_RUNTIME_SEMANTIC_ATTEMPTS; i++) {
    const { count, overLimit } = recordSemanticAttempt(taskId);
    assert.equal(count, i);
    assert.equal(overLimit, false, `call ${i} should not be over the limit`);
  }

  const overflow = recordSemanticAttempt(taskId);
  assert.equal(overflow.count, MAX_RUNTIME_SEMANTIC_ATTEMPTS + 1);
  assert.equal(overflow.overLimit, true);
});

test("the semantic attempt cap is independent of and smaller than the architecture-view cap", () => {
  assert.ok(MAX_RUNTIME_SEMANTIC_ATTEMPTS < MAX_ARCHITECTURE_VIEW_ATTEMPTS);
});

test("commitSemanticRevision numbers revisions sequentially starting at 1, scoped per taskId", () => {
  const taskId = "task-semantic-revisions-1";
  const first = commitSemanticRevision(taskId, makeSemanticDoc("first"));
  const second = commitSemanticRevision(taskId, makeSemanticDoc("second"));

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(getSemanticRevision(taskId, 1)?.title, "first");
  assert.equal(getSemanticRevision(taskId, 2)?.title, "second");
  assert.equal(getLatestSemanticRevision(taskId)?.revision, 2);

  clearSemanticRevisions(taskId);
  assert.equal(getSemanticRevision(taskId, 1), undefined);
  assert.equal(getLatestSemanticRevision(taskId), undefined);
});

test("getSemanticRevision returns undefined for an unknown taskId or revision number", () => {
  assert.equal(getSemanticRevision("no-such-task", 1), undefined);

  const taskId = "task-semantic-revisions-2";
  commitSemanticRevision(taskId, makeSemanticDoc("only"));
  assert.equal(getSemanticRevision(taskId, 99), undefined);
});
