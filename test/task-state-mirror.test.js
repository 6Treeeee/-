import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTaskInput } from "../src/a2a/model.js";
import { createInitialTask, reduceTaskEvent } from "../src/a2a/state-machine.js";
import { projectTaskState, readDurableTaskState } from "../src/a2a/task-state-mirror.js";

const NOW = "2026-09-22T00:00:00.000Z";
const ID = "wrun_mirror_1234567890123456";
const THREAD = "019f1234-1111-7111-8111-123456789012";
const binding = { cwd: "C:\\trusted\\repo", repo: "6Treeeee/-", branch: "codex/a2a-control-loop" };
const options = { source: { kind: "test-persisted-state" }, generatedAt: NOW };
const event = (kind, payload = {}, extra = {}) => ({ kind, payload, event_id: crypto.randomUUID(),
  at: NOW, worker_id: "worker_1", workspace_id: "a2a-control", ...extra });
function started() {
  const input = parseTaskInput({ goal: "Mirror fixture", workspace_id: "a2a-control",
    acceptance_criteria: ["Preserve state"], codex_task: { read_only: true,
      steps: [{ id: "one", instruction: "Fixture step" }] } });
  let state = createInitialTask(input, ID, NOW);
  state = reduceTaskEvent(state, event("CLAIM"));
  state = reduceTaskEvent(state, event("CODEX_CALL", { operation: "startThread", thread_id: null, ...binding }));
  return reduceTaskEvent(state, event("THREAD_STARTED", { thread_id: THREAD }));
}

for (const status of ["BLOCKED_BY_QUOTA", "FAILED", "COMPLETED"]) {
  test(`projection preserves persisted ${status}, every selected field and call counts`, () => {
    const state = reduceTaskEvent(started(), event("CODEX_RESULT", {
      status, result: status === "COMPLETED" ? "Done" : null, error: status === "COMPLETED" ? null : "Fixture error",
    }));
    const before = structuredClone(state);
    const mirror = projectTaskState(state, options);
    for (const key of Object.keys(mirror).filter(key => !["source", "generated_at"].includes(key))) {
      assert.deepEqual(mirror[key], state[key]);
    }
    assert.equal(mirror.codex_status, status);
    assert.equal(mirror.thread_id, THREAD);
    assert.equal(mirror.start_thread_calls, 1);
    assert.equal(mirror.resume_thread_calls, 0);
    assert.equal(mirror.source.version, state.version);
    assert.equal(mirror.generated_at, NOW);
    mirror.remaining_steps.push("untrusted mirror edit");
    mirror.blockers.push("untrusted mirror blocker");
    assert.deepEqual(state, before);
    assert.equal("codex_task" in mirror, false);
  });
}

test("missing fields remain null or empty, without inferred status or counters", () => {
  const mirror = projectTaskState({ task_id: ID, codex_task: {} }, options);
  for (const key of ["thread_id", "status", "codex_status", "updated_at", "start_thread_calls", "resume_thread_calls"]) {
    assert.equal(mirror[key], null);
  }
  for (const key of ["completed_steps", "remaining_steps", "blockers"]) assert.deepEqual(mirror[key], []);
  assert.equal(mirror.source.version, null);
});

test("summary files and mirrors cannot become durable input", () => {
  assert.throws(() => projectTaskState({ task_id: ID, status: "COMPLETED" }, options), /DURABLE_CODEX_STATE_REQUIRED/);
  assert.throws(() => projectTaskState(projectTaskState(started(), options), options), /DURABLE_CODEX_STATE_REQUIRED/);
  assert.throws(() => projectTaskState(started()), /SOURCE_REQUIRED/);
});

test("projection leaves the existing start/resume transition behavior identical", () => {
  let state = reduceTaskEvent(started(), event("CODEX_RESULT", { status: "BLOCKED_BY_QUOTA", result: null, error: "quota" }));
  const untouched = structuredClone(state);
  projectTaskState(state, options);
  const resume = event("RESUME", {}, { expected_version: state.version });
  const claim = event("CLAIM");
  state = reduceTaskEvent(reduceTaskEvent(state, resume), claim);
  const baseline = reduceTaskEvent(reduceTaskEvent(untouched, resume), claim);
  const start = event("CODEX_CALL", { operation: "startThread", thread_id: null, ...binding });
  for (const task of [state, baseline]) assert.throws(() => reduceTaskEvent(task, start), /START_THREAD_PROHIBITED/);
  const call = event("CODEX_CALL", { operation: "resumeThread", thread_id: THREAD, ...binding });
  const resumed = reduceTaskEvent(state, call);
  assert.deepEqual(resumed, reduceTaskEvent(baseline, call));
  const mirror = projectTaskState(resumed, options);
  assert.equal(mirror.thread_id, THREAD);
  assert.equal(mirror.start_thread_calls, 1);
  assert.equal(mirror.resume_thread_calls, 1);
});

test("durable reader only reads the last task-state record and releases its reader", async () => {
  const state = started();
  const calls = [];
  const run = { exists: Promise.resolve(true), getReadable(args) {
    calls.push(args);
    return args.startIndex === undefined ? { getTailIndex: async () => 7 } : { getReader: () => ({
      read: async () => ({ done: false, value: state }),
      cancel: async () => calls.push("cancel"), releaseLock: () => calls.push("release"),
    }) };
  } };
  const result = await readDurableTaskState(ID, id => { assert.equal(id, ID); return run; });
  assert.equal(result.task, state);
  assert.equal(result.source.stream_index, 7);
  assert.deepEqual(calls, [{ namespace: "task-state" }, { namespace: "task-state", startIndex: 7 }, "cancel", "release"]);
});

test("missing runs, empty state streams and mismatched records fail without synthetic state", async () => {
  await assert.rejects(readDurableTaskState("bad", () => assert.fail()), /TASK_ID_INVALID/);
  await assert.rejects(readDurableTaskState(ID, () => ({ exists: false })), /TASK_NOT_FOUND/);
  await assert.rejects(readDurableTaskState(ID, () => ({ exists: true,
    getReadable: () => ({ getTailIndex: async () => -1 }),
  })), /STATE_NOT_READY/);
  for (const value of [null, { task_id: "another" }]) {
    let released = false;
    await assert.rejects(readDurableTaskState(ID, () => ({ exists: true, getReadable: () => ({
      getTailIndex: async () => 0, getReader: () => ({ read: async () => ({ done: !value, value }),
        cancel: async () => {}, releaseLock: () => { released = true; } }),
    }) })), value ? /TASK_ID_MISMATCH/ : /STATE_NOT_READY/);
    assert.equal(released, true);
  }
});

test("CLI writes the fixed path atomically with provenance; invalid input preserves the old mirror", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "task-mirror-"));
  try {
    for (const dir of ["scripts", "src/a2a"]) await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    for (const file of ["scripts/export-task-state.mjs", "src/a2a/task-state-mirror.js"]) {
      await copyFile(new URL(`../${file}`, import.meta.url), path.join(root, file));
    }
    const input = path.join(root, "persisted.json");
    const bytes = JSON.stringify({ scope: "TEST_ONLY", state: started() });
    await writeFile(input, bytes);
    const script = path.join(root, "scripts/export-task-state.mjs");
    execFileSync(process.execPath, [script, "--snapshot", input], { cwd: tmpdir() });
    const output = path.join(root, "artifacts/tree-brain/latest-task-state.json");
    const saved = await readFile(output, "utf8");
    const mirror = JSON.parse(saved);
    assert.equal(mirror.thread_id, THREAD);
    assert.equal(mirror.source.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(mirror.source.pointer, "/state");
    assert.equal(mirror.source.scope, "TEST_ONLY");
    assert.equal(await readFile(input, "utf8"), bytes);
    for (const invalid of [output, input]) {
      if (invalid === input) await writeFile(input, '{"task_id":"summary"}');
      const result = spawnSync(process.execPath, [script, "--snapshot", invalid], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /TASK_MIRROR_/);
      assert.equal(await readFile(output, "utf8"), saved);
    }
    await writeFile(input, JSON.stringify(started()));
    execFileSync(process.execPath, [script, "--snapshot", input]);
    assert.equal(JSON.parse(await readFile(output, "utf8")).source.pointer, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
