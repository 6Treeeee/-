// Explicit opt-in, real Codex SDK probe. Uses three separate MCP-over-HTTP
// client processes and test-only local persistence, NOT production OAuth.
// Run A, B and C as SEPARATE processes, with the same fresh state file:
// node scripts/verify-task-resume.mjs a <absolute-state-file>
// node scripts/verify-task-resume.mjs b <same-absolute-state-file>
// node scripts/verify-task-resume.mjs c <same-absolute-state-file>
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpHandler } from "../src/mcp/server.js";
import { executeTask } from "../worker/index.mjs";
import { createCodexTaskRunner } from "../worker/lib/codex-task-runner.mjs";
import { localCodexService } from "../test/helpers/local-codex-service.js";

const [phase, stateFile] = process.argv.slice(2);
assert.ok(["a", "b", "c"].includes(phase) && stateFile && path.isAbsolute(stateFile), "Expected a|b|c and an absolute state path");
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const existing = existsSync(stateFile);
assert.equal(existing, phase !== "a", "Never overwrite an existing A probe or invent a B/C checkpoint");
const record = existing ? JSON.parse(readFileSync(stateFile, "utf8")) : {
  scope: "THREE_DISTINCT_MCP_HTTP_SESSIONS_REAL_CODEX_SDK_TEST_PERSISTENCE",
  production_oauth: "NOT_USED",
  created_at: new Date().toISOString(), nonce: randomUUID(), principal_id: "local-sdk-probe",
  state: null, sdk_calls: [], mcp_calls: [], sessions: [], phases: [],
};
assert.deepEqual(record.phases.map(({ phase: completedPhase }) => completedPhase),
  phase === "a" ? [] : phase === "b" ? ["a"] : ["a", "b"], "A, B and C must run once and in order");
function save() {
  mkdirSync(path.dirname(stateFile), { recursive: true });
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(record, null, 2), { flush: true });
  renameSync(`${stateFile}.tmp`, stateFile);
}
const service = localCodexService({ state: record.state, principalId: record.principal_id,
  save: state => { record.state = state; save(); } });
const sessionId = randomUUID();
record.sessions.push({ phase, session_id: sessionId, pid: process.pid, transport: "MCP Streamable HTTP" });
const testEnv = {
  TREE_BRAIN_MCP_URL: "https://tree.example/mcp",
  TREE_BRAIN_OAUTH_ISSUER: "https://identity.example/",
  TREE_BRAIN_OAUTH_JWKS_URL: "https://identity.example/.well-known/jwks.json",
  TREE_BRAIN_OAUTH_SUBJECTS_JSON: JSON.stringify({ owner: ["a2a-control"] }),
};
const handler = createMcpHandler({ env: testEnv, service, authorizer: async (_header, scopes) => {
  record.sessions.at(-1).scopes = [...new Set([...(record.sessions.at(-1).scopes || []), ...scopes])];
  save();
  return { principal_id: record.principal_id, workspace_ids: ["a2a-control"] };
} });
const httpServer = http.createServer((req, res) => void handler(req, res));
const port = await new Promise(resolve => httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port)));
const client = new Client({ name: `tree-brain-gpt-${phase}`, version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`),
  { requestInit: { headers: { authorization: "Bearer local-real-sdk-probe" } } });
await client.connect(transport);
const call = async (name, args) => {
  record.mcp_calls.push({ phase, session_id: sessionId, name, arguments: structuredClone(args) });
  save();
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
      assert.equal(phase, "a", "B/C recovery MUST NOT call startThread");
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
const status = async ({ includeTaskId = false } = {}) => (await call("task_status", {
  workspace_id: "a2a-control",
  ...(includeTaskId ? { task_id: record.state.task_id } : {}),
})).task;
try {
  const connection = await call("get_connection_status", {});
  assert.equal(connection.authenticated_principal, record.principal_id);
  record.sessions.at(-1).authenticated_principal = connection.authenticated_principal;
  save();
  if (phase === "a") {
    const args = { workspace_id: "a2a-control", request_id: `probe_${randomUUID()}`, read_only: true,
      goal: "Verify conversation continuity in two read-only steps. No file access or tool use is necessary.",
      steps: [
        { id: "remember", instruction: `Remember the nonce ${record.nonce}. Return it as the result. Do not inspect files or execute commands.` },
        { id: "recall", instruction: "Recall the nonce from the PREVIOUS completed step in this conversation. Return exactly that nonce plus ' RECOVERED'. Do not inspect files or execute commands." },
      ] };
    const receipt = await call("task_start", args);
    assert.equal((await call("task_start", args)).task.task_id, receipt.task.task_id);
    await run(runner);
    const first = await status({ includeTaskId: true });
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
    record.before_resume = await status({ includeTaskId: true });
    assert.equal(record.before_resume.status, "FAILED");
    assert.equal(record.before_resume.thread_id, first.thread_id);
    assert.deepEqual(record.before_resume.remaining_steps, ["recall"]);
    record.phases.push({ phase, session_id: sessionId, pid: process.pid, result: "A_INTERRUPTED_CHECKPOINT_SAVED" });
  } else if (phase === "b") {
    const before = await status();
    assert.equal(before.thread_id, record.before_resume.thread_id);
    assert.notEqual(process.pid, record.phases[0].pid, "Must resume in a new process");
    const request = { workspace_id: "a2a-control", request_id: `resume_${randomUUID()}` };
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
    const recoveryCalls = record.sdk_calls.filter(entry => entry.phase === "b");
    assert.deepEqual(recoveryCalls.map(entry => [entry.operation, entry.thread_id]), [["resumeThread", before.thread_id]]);
    record.phases.push({ phase, session_id: sessionId, pid: process.pid, result: "B_AUTO_DISCOVERY_RESUME_PASS" });
  } else {
    const after = await status();
    assert.notEqual(process.pid, record.phases[0].pid, "C must use a new process from A");
    assert.notEqual(process.pid, record.phases[1].pid, "C must use a new process from B");
    assert.equal(after.status, "COMPLETED");
    assert.equal(after.task_id, record.before_resume.task_id);
    assert.equal(after.thread_id, record.before_resume.thread_id);
    assert.equal(after.start_thread_calls, 1);
    assert.ok(after.resume_thread_calls >= 1);
    assert.equal(record.sdk_calls.filter(entry => entry.operation === "startThread").length, 1);
    assert.ok(record.sdk_calls.filter(entry => entry.operation === "resumeThread").length >= 1);
    assert.ok(record.sdk_calls.every(entry => entry.model === "gpt-5.6-terra" && entry.reasoning === "medium"));
    assert.equal(new Set(record.sessions.map(entry => entry.session_id)).size, 3);
    assert.ok(record.sessions.every(entry => entry.authenticated_principal === record.principal_id));
    const omittedTaskIdCalls = record.mcp_calls.filter(entry => ["b", "c"].includes(entry.phase)
      && ["task_status", "task_resume"].includes(entry.name));
    assert.ok(omittedTaskIdCalls.length >= 3 && omittedTaskIdCalls.every(entry => !("task_id" in entry.arguments)));
    record.after_c = after;
    record.phases.push({ phase, session_id: sessionId, pid: process.pid, result: "C_AUTO_DISCOVERY_COMPLETED_PASS" });
  }
  save();
  console.log(JSON.stringify({ phase, result: record.phases.at(-1).result, task_id: record.state.task_id,
    thread_id: record.state.thread_id, start_thread_calls: record.state.start_thread_calls,
    resume_thread_calls: record.state.resume_thread_calls, sdk_calls: record.sdk_calls,
    mcp_session_ids: record.sessions.map(item => item.session_id), acceptance_scope: record.scope,
    production_oauth: record.production_oauth }, null, 2));
} catch (error) {
  record.failure = { phase, error: String(error.message), last_error: record.state?.last_error, at: new Date().toISOString() };
  save();
  console.error(JSON.stringify(record.failure));
  process.exitCode = 1;
} finally {
  await client.close();
  await new Promise(resolve => httpServer.close(resolve));
}
