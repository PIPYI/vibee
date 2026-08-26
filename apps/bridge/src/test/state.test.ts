import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ARCHITECTURE_VIEW_ATTEMPTS, recordAttempt, startAttemptCounter } from "../state.js";

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
