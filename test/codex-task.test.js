import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskInput } from "../src/a2a/model.js";
import { createInitialTask, reduceTaskEvent } from "../src/a2a/state-machine.js";
import { parseCodexTask } from "../src/a2a/codex-task.js";
import { reconcileTaskWithRunStatus } from "../src/a2a/control-service.js";

const NOW = "2026-09-07T00:00:00.000Z";
const THREAD = "019f1234-1111-7111-8111-123456789012";
const binding = { cwd: "C:\\trusted\\repo", repo: "6Treeeee/-", branch: "codex/a2a-control-loop" };
const input = () => parseTaskInput({ goal: "Prove original-thread recovery", workspace_id: "a2a-control",
  acceptance_criteria: ["The thread is unchanged"], codex_task: { read_only: true,
    steps: [{ id: "first", instruction: "Remember a nonce" }, { id: "second", instruction: "Recall it" }] } });
const event = (kind, payload = {}, extra = {}) => ({ event_id: crypto.randomUUID(), kind, at: NOW,
  worker_id: "worker_1", workspace_id: "a2a-control", payload, ...extra });
function running() {
  return reduceTaskEvent(createInitialTask(input(), "task_test", NOW), event("CLAIM"));
}
function started() {
  let state = reduceTaskEvent(running(), event("CODEX_CALL", { operation: "startThread", thread_id: null, ...binding }));
  return reduceTaskEvent(state, event("THREAD_STARTED", { thread_id: THREAD }));
}
const complete = () => event("CODEX_RESULT", { status: "COMPLETED", result: "A verified step result", error: null });

test("Codex task spec rejects duplicate and unknown steps or user-controlled paths", () => {
  assert.throws(() => parseCodexTask({ ...input().codex_task, cwd: "/tmp" }), /INPUT_INVALID/);
  assert.throws(() => parseCodexTask({ read_only: true, steps: [{ id: "x", instruction: "a" }, { id: "x", instruction: "b" }] }), /STEP_INVALID/);
  assert.equal(input().codex_task.read_only, true);
});

test("quota checkpoint persists the original thread and completed/remaining steps across JSON restart", () => {
  let state = reduceTaskEvent(started(), complete());
  state = reduceTaskEvent(state, event("CLAIM"));
  state = reduceTaskEvent(state, event("CODEX_CALL", { operation: "resumeThread", thread_id: THREAD, ...binding }));
  state = reduceTaskEvent(state, event("CODEX_RESULT", { status: "BLOCKED_BY_QUOTA", result: null, error: "usage limit reached" }));
  state = JSON.parse(JSON.stringify(state));
  assert.equal(state.thread_id, THREAD);
  assert.equal(state.codex_status, "BLOCKED_BY_QUOTA");
  assert.equal(state.status, "blocked");
  assert.deepEqual(state.completed_steps, ["first"]);
  assert.deepEqual(state.remaining_steps, ["second"]);
  assert.equal(state.last_result, "A verified step result");
  const resume = event("RESUME", {}, { expected_version: state.version });
  state = reduceTaskEvent(state, resume);
  assert.equal(reduceTaskEvent(state, resume), state, "identical retry is a no-op");
  assert.equal(state.last_error, "usage limit reached");
  state = reduceTaskEvent(state, event("CLAIM"));
  assert.throws(() => reduceTaskEvent(state, event("CODEX_CALL", { operation: "startThread", thread_id: null, ...binding })), /START_THREAD_PROHIBITED/);
  state = reduceTaskEvent(state, event("CODEX_CALL", { operation: "resumeThread", thread_id: THREAD, ...binding }));
  state = reduceTaskEvent(state, event("THREAD_STARTED", { thread_id: THREAD }));
  state = reduceTaskEvent(state, complete());
  assert.equal(state.codex_status, "COMPLETED");
  assert.equal(state.thread_id, THREAD);
  assert.equal(state.start_thread_calls, 1);
  assert.equal(state.resume_thread_calls, 2);
  assert.deepEqual(state.completed_steps, ["first", "second"]);
  assert.deepEqual(state.remaining_steps, []);
  assert.equal(state.last_error, null);
});

test("recovery rejects missing threads, active workers, conflicting versions, stopped tasks", () => {
  const initial = createInitialTask(input(), "task_test", NOW);
  assert.throws(() => reduceTaskEvent(initial, event("RESUME", {}, { expected_version: initial.version })), /THREAD_ID_REQUIRED/);
  let state = started();
  assert.throws(() => reduceTaskEvent(state, event("RESUME", {}, { expected_version: state.version })), /TASK_ACTIVE/);
  assert.throws(() => reduceTaskEvent(state, event("RESUME", {}, { expected_version: 1 })), /VERSION_CONFLICT/);
  state = reduceTaskEvent(state, event("STOP"));
  assert.equal(state.codex_status, "FAILED");
  assert.throws(() => reduceTaskEvent(state, event("RESUME", {}, { expected_version: state.version })), /TASK_STOPPED/);
});

test("thread binding, leases, protocol and ambiguous first creation fail closed", () => {
  let state = started();
  assert.throws(() => reduceTaskEvent(state, event("THREAD_STARTED", { thread_id: "another-thread" })), /THREAD_ID_MISMATCH/);
  assert.throws(() => reduceTaskEvent(state, completeWithWorker("other")), /LEASE_MISMATCH/);
  assert.throws(() => reduceTaskEvent(state, event("REPORT", {})), /USE_CODEX_TASK_PROTOCOL/);
  state = reduceTaskEvent(state, event("CODEX_RESULT", { status: "FAILED", result: null, error: "interrupted" }));
  state = reduceTaskEvent(state, event("RESUME", {}, { expected_version: state.version }));
  state = reduceTaskEvent(state, event("CLAIM"));
  assert.throws(() => reduceTaskEvent(state, event("CODEX_CALL", { operation: "resumeThread", thread_id: "other", ...binding })), /THREAD_ID_MISMATCH/);
  assert.throws(() => reduceTaskEvent(state, event("CODEX_CALL", { operation: "resumeThread", thread_id: THREAD, ...binding, cwd: "/elsewhere" })), /BINDING_MISMATCH/);
  const failedRun = reconcileTaskWithRunStatus(state, "failed");
  assert.equal(failedRun.codex_status, "FAILED");
  assert.equal(failedRun.last_error, "A2A_WORKFLOW_RUN_FAILED");
});
function completeWithWorker(worker_id) { return { ...complete(), worker_id }; }
