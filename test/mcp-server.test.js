import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createMcpHandler } from "../src/mcp/server.js";
import { localCodexService } from "./helpers/local-codex-service.js";

const ENV = Object.freeze({
  TREE_BRAIN_MCP_URL: "https://tree.example/mcp",
  TREE_BRAIN_OAUTH_ISSUER: "https://identity.example/",
  TREE_BRAIN_OAUTH_JWKS_URL: "https://identity.example/.well-known/jwks.json",
  TREE_BRAIN_OAUTH_SUBJECTS_JSON: JSON.stringify({ owner: ["content-reader"] }),
});

function fakeTask(overrides = {}) {
  return {
    task_id: "wrun_1234567890123456",
    request_id: "mcp_request_1",
    context_id: null,
    workspace_id: "content-reader",
    goal: "检查当前项目并报告实现、测试、部署状态与阻塞项。",
    execution_goal: "检查当前项目并报告实现、测试、部署状态与阻塞项。",
    acceptance_criteria: ["只检查现有项目，不修改源代码、配置、权限或部署。"],
    status: "submitted",
    current_stage: "executor",
    next_decision_required: false,
    result: null,
    review: null,
    stop_loss: { triggered: false },
    evidence: [],
    blockers: [],
    cost: {},
    version: 1,
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("MCP streamable HTTP advertises bounded Tree Brain tools and calls the existing service", async () => {
  const calls = [];
  let task = fakeTask();
  const service = {
    async createTask(input, options) {
      calls.push({ input, options });
      task = fakeTask({
        request_id: input.request_id,
        context_id: input.context_id,
        goal: input.goal,
        execution_goal: input.execution_goal,
        acceptance_criteria: input.acceptance_criteria,
      });
      return task;
    },
    async getTask(taskId) {
      assert.equal(taskId, task.task_id);
      return task;
    },
  };
  const authCalls = [];
  const authorizer = async (header, scopes) => {
    authCalls.push({ header, scopes });
    assert.equal(header, "Bearer integration");
    return {
      key_id: "oauth-test",
      principal_id: "oauth:test",
      role: "decision",
      workspace_ids: ["content-reader"],
    };
  };
  const handler = createMcpHandler({ env: ENV, service, authorizer });
  const server = http.createServer((req, res) => void handler(req, res));
  const port = await listen(server);
  const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers: { authorization: "Bearer integration" } } },
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["check_project", "get_connection_status", "get_task", "list_workspaces", "task_resume", "task_start", "task_status"],
    );
    const check = tools.tools.find((tool) => tool.name === "check_project");
    assert.deepEqual(check._meta.securitySchemes, [{ type: "oauth2", scopes: ["treebrain:check"] }]);
    assert.equal(check.annotations.idempotentHint, true);

    const workspaces = await client.callTool({ name: "list_workspaces", arguments: {} });
    assert.deepEqual(workspaces.structuredContent, { workspaces: ["content-reader"] });
    const accepted = await client.callTool({
      name: "check_project",
      arguments: { workspace_id: "content-reader", request_id: "mcp_request_1" },
    });
    assert.equal(accepted.structuredContent.accepted, true);
    assert.equal(accepted.structuredContent.pending, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.workspace_id, "content-reader");
    assert.equal(calls[0].options.principal_id, "oauth:test");
    const status = await client.callTool({ name: "get_task", arguments: { task_id: task.task_id } });
    assert.equal(status.structuredContent.task.task_id, task.task_id);
    assert.equal(status.structuredContent.task.workspace_id, "content-reader");
    assert.ok(authCalls.some(({ scopes }) => scopes.includes("treebrain:check")));
  } finally {
    await client.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
});

test("MCP endpoint returns an OAuth challenge before touching the service", async () => {
  let serviceCalled = false;
  const handler = createMcpHandler({
    env: ENV,
    service: {
      async createTask() {
        serviceCalled = true;
        throw new Error("should not run");
      },
    },
    authorizer: async () => {
      const error = new Error("TREE_BRAIN_UNAUTHORIZED");
      error.code = "TREE_BRAIN_UNAUTHORIZED";
      error.statusCode = 401;
      throw error;
    },
  });
  const server = http.createServer((req, res) => void handler(req, res));
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /resource_metadata=/);
    assert.equal(serviceCalled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("MCP task tools enforce scope, persist progress, and resume idempotently without creating a task", async () => {
  const service = localCodexService();
  const scopes = [];
  const handler = createMcpHandler({ env: ENV, service, authorizer: async (_header, required) => {
    scopes.push(required);
    return { principal_id: "oauth:test", workspace_ids: ["content-reader"] };
  } });
  const server = http.createServer((req, res) => void handler(req, res));
  const port = await listen(server);
  const client = new Client({ name: "codex-task-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  const call = (name, args) => client.callTool({ name, arguments: args });
  const args = { workspace_id: "content-reader", request_id: "stable_start", goal: "Complete the bounded step", read_only: true };
  try {
    await client.connect(transport);
    assert.equal((await call("task_start", { ...args, workspace_id: "a2a-control" })).isError, true);
    assert.equal(service.state, null);
    const start = await call("task_start", args);
    assert.equal(start.isError, undefined);
    const id = start.structuredContent.task.task_id;
    assert.equal(start.structuredContent.task.thread_id, null);
    assert.equal(start.structuredContent.task.status, "RUNNING");
    assert.equal((await call("task_start", args)).structuredContent.task.task_id, id);
    assert.equal((await call("task_resume", { task_id: id, request_id: "no_thread" })).isError, true);
    const emit = (kind, payload = {}) => service.executorEvent(id, { kind, payload, workerId: "worker_1", workspaceId: "content-reader" });
    await emit("CLAIM");
    await emit("CODEX_CALL", { operation: "startThread", thread_id: null, cwd: "C:\\trusted\\repo", repo: "6Treeeee/-", branch: "codex/a2a-control-loop" });
    await emit("THREAD_STARTED", { thread_id: "original-thread" });
    await emit("CODEX_RESULT", { status: "BLOCKED_BY_QUOTA", result: null, error: "usage limit" });
    const blocked = (await call("task_status", { task_id: id })).structuredContent.task;
    assert.equal(blocked.status, "BLOCKED_BY_QUOTA");
    assert.equal(blocked.thread_id, "original-thread");
    assert.equal(blocked.model, "gpt-5.6-terra");
    assert.deepEqual(blocked.remaining_steps, ["execute"]);
    const resumeArgs = { task_id: id, request_id: "stable_resume" };
    const resumed = await call("task_resume", resumeArgs);
    assert.equal(resumed.structuredContent.applied, true);
    assert.equal(resumed.structuredContent.task.thread_id, blocked.thread_id);
    assert.equal(resumed.structuredContent.task.resume_count, 1);
    assert.equal((await call("task_resume", resumeArgs)).structuredContent.task.resume_count, 1);
    assert.equal(service.state.start_thread_calls, 1);
    assert.ok(scopes.some(value => value.includes("treebrain:check")));
    assert.ok(scopes.some(value => value.includes("treebrain:read")));
  } finally {
    await client.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
});
