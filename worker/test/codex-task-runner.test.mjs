import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createCodexTaskRunner, classifyCodexFailure } from "../lib/codex-task-runner.mjs";
import { initialCodexState } from "../../src/a2a/codex-task.js";

const THREAD = "019f1234-1111-7111-8111-123456789012";
const cwd = path.resolve(".");
const makeTask = extra => ({ ...initialCodexState({ read_only: true, steps: [{ id: "first", instruction: "First" }, { id: "second", instruction: "Second" }] }), ...extra });
function setup({ fail = false, mismatch = false } = {}) {
  const calls = [], checkpoints = [], prompts = [];
  class Codex {
    startThread(options) { calls.push({ name: "startThread", options }); return this.thread(THREAD); }
    resumeThread(id, options) { calls.push({ name: "resumeThread", id, options }); return this.thread(mismatch ? "wrong-thread" : id); }
    thread(id) { return { id, async runStreamed(prompt) {
      prompts.push(prompt);
      return { events: (async function* () {
        yield { type: "thread.started", thread_id: id };
        assert.ok(checkpoints.some(entry => entry.kind === "THREAD_STARTED"), "persist before later events");
        if (fail) { yield { type: "turn.failed", error: { message: "usage limit reached" } }; return; }
        yield { type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ status: "completed", result: "verified" }) } };
        yield { type: "turn.completed" };
      })() };
    } }; }
  }
  const runner = createCodexTaskRunner({ sdkLoader: async () => ({ Codex }), bindingVerifier: async () => ({ cwd, repo: "6Treeeee/-", branch: "codex/a2a-control-loop" }) });
  const run = (task, emit = async (kind, payload) => checkpoints.push({ kind, payload })) => runner.run({ task, workspacePath: cwd, emit });
  return { calls, checkpoints, prompts, run };
}
test("only first execution calls startThread and always uses Terra Medium", async () => {
  const probe = setup();
  assert.equal((await probe.run(makeTask())).status, "COMPLETED");
  assert.deepEqual(probe.calls.map(call => call.name), ["startThread"]);
  assert.equal(probe.calls[0].options.model, "gpt-5.6-terra");
  assert.equal(probe.calls[0].options.modelReasoningEffort, "medium");
  assert.deepEqual(probe.checkpoints.map(item => item.kind), ["CODEX_CALL", "THREAD_STARTED"]);
});
test("resumption uses saved thread, excludes completed instructions, and never falls back", async () => {
  const probe = setup();
  await probe.run(makeTask({ thread_id: THREAD, start_thread_calls: 1, completed_steps: ["first"], remaining_steps: ["second"] }));
  assert.deepEqual(probe.calls.map(call => [call.name, call.id]), [["resumeThread", THREAD]]);
  assert.equal(probe.prompts[0].includes('"instruction":"First"'), false);
  assert.equal(probe.prompts[0].includes('"instruction":"Second"'), true);
  const broken = setup({ fail: true });
  await assert.rejects(broken.run(makeTask({ thread_id: THREAD, start_thread_calls: 1 })), /usage limit/);
  assert.deepEqual(broken.calls.map(call => call.name), ["resumeThread"]);
  assert.equal(classifyCodexFailure(new Error("usage limit reached")).status, "BLOCKED_BY_QUOTA");
});
test("SDK call requires an acknowledged checkpoint; ambiguous creation and wrong IDs cannot start anew", async () => {
  const probe = setup();
  await assert.rejects(probe.run(makeTask(), async () => { throw new Error("disk unavailable"); }), /disk unavailable/);
  assert.equal(probe.calls.length, 0);
  await assert.rejects(probe.run(makeTask({ start_thread_calls: 1 })), /THREAD_ID_REQUIRED/);
  assert.equal(probe.calls.length, 0);
  const wrong = setup({ mismatch: true });
  await assert.rejects(wrong.run(makeTask({ thread_id: THREAD })), /THREAD_ID_MISMATCH/);
  assert.equal(wrong.calls.length, 1);
  assert.equal(wrong.calls[0].name, "resumeThread");
  assert.equal(classifyCodexFailure("failed Bearer secret").error, "failed Bearer [REDACTED]");
});
