import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { createMcpHandler } from "../src/mcp/server.js";

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
      ["check_project", "get_connection_status", "get_task", "list_workspaces"],
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
