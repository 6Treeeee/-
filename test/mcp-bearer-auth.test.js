import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpAuthorizer, readAuthConfig, protectedResourceMetadata } from "../src/mcp/auth.js";
import { createMcpHandler } from "../src/mcp/server.js";

test("control bearer permits only content-reader start/resume and preserves original thread", async () => {
  const { token, env } = setup({ scopes: ["treebrain:read", "treebrain:check"] });
  const principal = await createMcpAuthorizer({ env })(`Bearer ${token}`, ["treebrain:check"]);
  assert.deepEqual(principal.workspace_ids, ["content-reader"]);
  assert.deepEqual(protectedResourceMetadata(readAuthConfig(env)).scopes_supported, ["treebrain:read", "treebrain:check"]);
  let state, creates = 0, resumes = 0;
  const service = {
    async createTask(input, identity) {
      assert.equal(identity.principal_id, principal.principal_id);
      creates++;
      return state = { ...input, task_id: "control-test", version: 1, codex_status: "RUNNING", thread_id: null };
    },
    async findCodexTask(query) {
      assert.equal(query.principal_id, principal.principal_id);
      assert.equal(query.workspace_id, "content-reader");
      return state;
    },
    async sendDecision(id, event) {
      assert.equal(id, "control-test");
      assert.equal(event.kind, "RESUME");
      resumes++;
      return { applied: true };
    },
    async getTask() { return state; },
  };
  const handler = createMcpHandler({ env, service });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const client = new Client({ name: "control-boundary-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const startArgs = { workspace_id: "content-reader", request_id: "control-start", goal: "Test only", read_only: true };
    const started = await client.callTool({ name: "task_start", arguments: startArgs });
    assert.equal(started.isError, undefined);
    assert.equal(creates, 1);
    state.thread_id = "original-test-thread";
    state.codex_status = "FAILED";
    const resumed = await client.callTool({ name: "task_resume", arguments: { workspace_id: "content-reader", task_id: state.task_id, request_id: "control-resume" } });
    assert.equal(resumed.isError, undefined);
    assert.equal(resumed.structuredContent.task.thread_id, "original-test-thread");
    assert.equal(resumes, 1);
    for (const name of ["task_start", "task_status", "task_resume"]) {
      const args = name === "task_start" ? { ...startArgs, workspace_id: "a2a-control" }
        : { workspace_id: "a2a-control", ...(name === "task_resume" ? { request_id: "denied-resume" } : {}) };
      assert.equal((await client.callTool({ name, arguments: args })).isError, true);
    }
    for (const name of ["check_project", "get_task", "unknown_tool"]) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) });
      assert.equal(response.status, 403);
    }
    assert.equal(creates, 1);
    assert.equal(resumes, 1);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
});

function setup(overrides = {}) {
  const token = `tb_${randomBytes(32).toString("base64url")}`;
  const grant = { sha256: createHash("sha256").update(token).digest("hex"),
    principal_id: "bearer:tree-brain-owner", workspace_ids: ["content-reader"],
    scopes: ["treebrain:read"], expires_at: Math.floor(Date.now() / 1000) + 3600, ...overrides };
  return { token, env: { TREE_BRAIN_AUTH_MODE: "bearer", TREE_BRAIN_MCP_URL: "https://tree.example/mcp",
    TREE_BRAIN_BEARER_GRANT_JSON: JSON.stringify(grant) } };
}

test("read-only bearer authenticates, expires and rejects incorrect tokens and write scope", async () => {
  const { token, env } = setup();
  const authorize = createMcpAuthorizer({ env });
  const principal = await authorize(`Bearer ${token}`, ["treebrain:read"]);
  assert.equal(principal.principal_id, "bearer:tree-brain-owner");
  assert.deepEqual(principal.workspace_ids, ["content-reader"]);
  for (const header of [undefined, "Bearer wrong", `Bearer tb_${"a".repeat(43)}`, `Bearer ${token} extra`]) {
    await assert.rejects(authorize(header, ["treebrain:read"]), { code: "TREE_BRAIN_UNAUTHORIZED" });
  }
  await assert.rejects(authorize(`Bearer ${token}`, ["treebrain:check"]), { code: "TREE_BRAIN_FORBIDDEN" });
  const expired = setup({ expires_at: 1 });
  await assert.rejects(createMcpAuthorizer({ env: expired.env })(`Bearer ${expired.token}`), { code: "TREE_BRAIN_UNAUTHORIZED" });
  assert.deepEqual(protectedResourceMetadata(readAuthConfig(env)), {
    resource: "https://tree.example/mcp", scopes_supported: ["treebrain:read"] });
});

test("bearer configuration cannot broaden workspace or impersonate prior OAuth/test identities", () => {
  for (const grant of [{ sha256: "wrong" }, { principal_id: "local-sdk-probe" },
    { principal_id: "oauth:owner" }, { workspace_ids: ["a2a-control"] },
    { workspace_ids: ["content-reader", "a2a-control"] }, { scopes: ["treebrain:check"] },
    { scopes: ["treebrain:read", "admin"] }, { scopes: ["treebrain:read", "treebrain:read"] }, { expires_at: "2099-01-01" }]) {
    assert.throws(() => readAuthConfig(setup(grant).env), { code: "TREE_BRAIN_BEARER_NOT_CONFIGURED" });
  }
  assert.throws(() => readAuthConfig({ TREE_BRAIN_AUTH_MODE: "typo" }), { code: "TREE_BRAIN_OAUTH_NOT_CONFIGURED" });
});

test("real MCP transport passes bearer identity to unchanged scoped lookup and blocks mutations", async () => {
  const { token, env } = setup();
  const calls = [];
  const handler = createMcpHandler({ env, service: {
    async findCodexTask(query) { calls.push(query); throw Object.assign(new Error("TREE_BRAIN_CODEX_TASK_NOT_FOUND"), { statusCode: 404 }); },
    async createTask() { assert.fail("must not create a task"); },
    async sendEvent() { assert.fail("must not resume a task"); },
  } });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const client = new Client({ name: "bearer-acceptance", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const tools = (await client.listTools()).tools;
    assert.ok(tools.some(t => t.name === "task_status"));
    assert.ok(tools.every(t => !t._meta?.securitySchemes));
    const result = await client.callTool({ name: "task_status", arguments: { workspace_id: "content-reader" } });
    assert.equal(result.isError, true);
    assert.deepEqual(calls, [{ task_id: null, workspace_id: "content-reader", principal_id: "bearer:tree-brain-owner" }]);
    const forbidden = await client.callTool({ name: "task_status", arguments: { workspace_id: "a2a-control" } });
    assert.equal(forbidden.isError, true);
    assert.equal(calls.length, 1);
    for (const name of ["task_start", "task_resume", "check_project", "get_task"]) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }) });
      assert.equal(response.status, 403);
    }
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
});
