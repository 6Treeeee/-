// Explicit opt-in, real Codex SDK probe. Uses local test persistence, NOT Vercel
// Workflow or ChatGPT OAuth. A local PASS must never be called a production PASS.
// Run start and resume as SEPARATE processes, with the same fresh state file:
// node scripts/verify-task-resume.mjs start <absolute-state-file>
// node scripts/verify-task-resume.mjs resume <same-absolute-state-file>
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { executeTask } from "../worker/index.mjs";
import { createCodexTaskRunner } from "../worker/lib/codex-task-runner.mjs";
import { localCodexService } from "../test/helpers/local-codex-service.js";

const [phase, stateFile] = process.argv.slice(2);
assert.ok(["start", "resume"].includes(phase) && stateFile && path.isAbsolute(stateFile), "Expected start|resume and an absolute state path");
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const existing = existsSync(stateFile);
assert.equal(existing, phase === "resume", "Never overwrite an existing start probe or invent a resume checkpoint");
const record = existing ? JSON.parse(readFileSync(stateFile, "utf8")) : {
  scope: "LOCAL_MCP_TOOL_HANDLERS_REAL_CODEX_SDK_TEST_PERSISTENCE",
  production_acceptance: "NOT_TESTED",
  created_at: new Date().toISOString(), nonce: randomUUID(), state: null, sdk_calls: [], phases: [],
};
function save() {
  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(record, null, 2), { flush: true });
  renameSync(`${stateFile}.tmp`, stateFile);
}
const service = localCodexService({ state: record.state, save: state => { record.state = state; save(); } });
const server = createMcpServer({ principal: { principal_id: "local-sdk-probe", workspace_ids: ["a2a-control"] }, service });
const client = new Client({ name: "local-real-codex-probe", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
const call = async (name, args) => {
  const value = await client.callTool({ name, arguments: args });
  if (value.isError) throw new Error(value.content?.[0]?.text || "MCP_TOOL_FAILED");
  return value.structuredContent;
};
const config = { workerId: `sdk_probe_${process.pid}`, workspaces: { "a2a-control": cwd }, claimTimeoutMs: 5_000, heartbeatIntervalMs: 10_000 };
const runner = createCodexTaskRunner({ sdkLoader: async () => {
  const { Codex } = await import("../worker/node_modules/@openai/codex-sdk/dist/index.js");
  return { Codex: class ObservedCodex extends Codex {
    startThread(options) {
      record.sdk_calls.push({ operation: "startThread", phase, pid: process.pid, thread_id: null, model: options.model, reasoning: options.modelReasoningEffort });
      save();
      assert.equal(phase, "start", "Recovery MUST NOT call startThread");
      return super.startThread(options);
    }
    resumeThread(id, options) {
      record.sdk_calls.push({ operation: "resumeThread", phase, pid: process.pid, thread_id: id, model: options.model, reasoning: options.modelReasoningEffort });
      save();
      return super.resumeThread(id, options);
    }
  } };
} });
const run = async codexTaskRunner => executeTask({ client: service, config, task: await service.getTask(record.state.task_id), codexTaskRunner,
  signal: AbortSignal.timeout(180_000) });
const status = async () => (await call("task_status", { task_id: record.state.task_id })).task;
try {
  if (phase === "start") {
    const args = { workspace_id: "a2a-control", request_id: `probe_${randomUUID()}`, read_only: true,
      goal: "Verify conversation continuity in two read-only steps. No file access or tool use is necessary.",
      steps: [
        { id: "remember", instruction: `Remember the nonce ${record.nonce}. Return it as the result. Do not inspect files or execute commands.` },
        { id: "recall", instruction: "Recall the nonce from the PREVIOUS completed step in this conversation. Return exactly that nonce plus ' RECOVERED'. Do not inspect files or execute commands." },
      ] };
    const receipt = await call("task_start", args);
    assert.equal((await call("task_start", args)).task.task_id, receipt.task.task_id);
    await run(runner);
    const first = await status();
    assert.deepEqual(first.completed_steps, ["remember"], first.last_error || "First real Codex step did not complete");
    assert.ok(first.last_result.includes(record.nonce));
    record.first_completed = first;
    save();
    // Interrupt the second real turn immediately after its thread ID checkpoint.
    await run({ run: async options => {
      const interrupted = new AbortController();
      return runner.run({ ...options, signal: AbortSignal.any([options.signal, interrupted.signal]), emit: async (kind, payload) => {
        const receipt = await options.emit(kind, payload);
        if (kind === "THREAD_STARTED") interrupted.abort(new Error("PROBE_CONTROLLED_WORKER_INTERRUPTION"));
        return receipt;
      } });
    } });
    record.before_resume = await status();
    assert.equal(record.before_resume.status, "FAILED");
    assert.equal(record.before_resume.thread_id, first.thread_id);
    assert.deepEqual(record.before_resume.remaining_steps, ["recall"]);
    record.phases.push({ phase, pid: process.pid, result: "INTERRUPTED_CHECKPOINT_SAVED" });
  } else {
    const before = await status();
    assert.equal(before.thread_id, record.before_resume.thread_id);
    assert.notEqual(process.pid, record.phases[0].pid, "Must resume in a new process");
    const request = { task_id: before.task_id, request_id: `resume_${randomUUID()}` };
    const receipt = await call("task_resume", request);
    assert.equal(receipt.applied, true);
    assert.equal((await call("task_resume", request)).task.resume_count, receipt.task.resume_count);
    await run(runner);
    const after = await status();
    record.after_resume = after;
    assert.equal(after.status, "COMPLETED", after.last_error || "Real resumed turn incomplete");
    assert.equal(after.thread_id, before.thread_id);
    assert.deepEqual(after.completed_steps, ["remember", "recall"]);
    assert.deepEqual(after.remaining_steps, []);
    assert.ok(after.last_result.includes(record.nonce) && after.last_result.includes("RECOVERED"), "Conversation continuity nonce missing");
    const recoveryCalls = record.sdk_calls.filter(entry => entry.phase === "resume");
    assert.deepEqual(recoveryCalls.map(entry => [entry.operation, entry.thread_id]), [["resumeThread", before.thread_id]]);
    record.phases.push({ phase, pid: process.pid, result: "LOCAL_REAL_SDK_RESUME_PASS" });
  }
  save();
  console.log(JSON.stringify({ phase, local_result: record.phases.at(-1).result, task_id: record.state.task_id, thread_id: record.state.thread_id, sdk_calls: record.sdk_calls, production_acceptance: record.production_acceptance }, null, 2));
} catch (error) {
  record.failure = { phase, error: String(error.message), last_error: record.state?.last_error, at: new Date().toISOString() };
  save();
  console.error(JSON.stringify(record.failure));
  process.exitCode = 1;
} finally {
  await client.close();
  await server.close();
}
