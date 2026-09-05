import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { parseTaskInput } from "../a2a/model.js";
import { workflowControlService } from "../a2a/control-service.js";
import {
  authenticationChallenge,
  createOAuthAuthorizer,
  readAuthConfig,
  TreeBrainOAuthError,
} from "./auth.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_TASK_TEXT = 4_000;
const DEFAULT_GOAL = "检查当前项目并报告实现、测试、部署状态与阻塞项。";
const DEFAULT_ACCEPTANCE = Object.freeze([
  "只检查现有项目，不修改源代码、配置、权限或部署。",
  "报告已观察到的实现、验证结果、正式部署入口和仍需用户授权的阻塞项。",
]);
const DEFAULT_CONSTRAINTS = Object.freeze([
  "diagnosis-only: read source/configuration and run bounded diagnostic checks only",
  "preserve existing production Content Reader behavior and unrelated uncommitted artifacts",
]);
const DEFAULT_ALLOWED_ACTIONS = Object.freeze([
  "read source files, configuration, and deployment metadata",
  "run bounded syntax checks and tests required to substantiate the report",
]);
const DEFAULT_FORBIDDEN_ACTIONS = Object.freeze([
  "modify files, commit, push, deploy, change permissions, or change production routing",
  "read, copy, or expose credentials, private keys, cookies, or access tokens",
  "invent a successful real-world test from fixtures, snapshots, cache, or an HTTP status alone",
]);
const DEFAULT_BUDGET = Object.freeze({
  max_executions: 6,
  max_failures: 3,
  max_real_world_tests: 3,
  max_agent_calls: 8,
  max_estimated_tokens: 500_000,
  max_external_api_calls: 20,
  max_deployments: 0,
});

const WORKSPACE_SCHEMA = z.string().trim().min(1).max(128).regex(ID_PATTERN);
const REQUEST_ID_SCHEMA = z.string().trim().min(1).max(128).regex(ID_PATTERN).optional();
const TEXT_SCHEMA = z.string().trim().min(1).max(MAX_TASK_TEXT);

function firstHeader(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

function headerMap(req) {
  return req?.headers || {};
}

function parseBodyHint(req) {
  const body = req?.body;
  if (body && typeof body === "object") return body;
  if (typeof body !== "string" || body.length > 256 * 1024) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function readMcpBody(req) {
  if (req?.body !== undefined && req?.body !== null) return req.body;
  if (!req?.[Symbol.asyncIterator]) return undefined;
  const declaredLength = Number(firstHeader(req.headers, "content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > 256 * 1024) {
    const error = new Error("TREE_BRAIN_MCP_BODY_TOO_LARGE");
    error.statusCode = 413;
    throw error;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > 256 * 1024) {
      const error = new Error("TREE_BRAIN_MCP_BODY_TOO_LARGE");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("TREE_BRAIN_MCP_JSON_INVALID");
    error.statusCode = 400;
    throw error;
  }
}

function requiredScopeForBody(body) {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some((message) =>
    message?.method === "tools/call" && message?.params?.name === "check_project"
  ) ? "treebrain:check" : "treebrain:read";
}

function assertWorkspaceAccess(principal, workspaceId) {
  if (!principal || !Array.isArray(principal.workspace_ids)) {
    const error = new Error("TREE_BRAIN_WORKSPACE_SCOPE_UNAVAILABLE");
    error.statusCode = 403;
    throw error;
  }
  if (!principal.workspace_ids.includes(workspaceId)) {
    const error = new Error("TREE_BRAIN_WORKSPACE_FORBIDDEN");
    error.statusCode = 403;
    throw error;
  }
}

function boundedString(value, max = MAX_TASK_TEXT) {
  return typeof value === "string" ? value.slice(0, max) : value;
}

function boundedList(value, max = 100) {
  return Array.isArray(value) ? value.slice(-max) : [];
}

function safeEvidence(item) {
  if (!item || typeof item !== "object") return null;
  return {
    evidence_id: boundedString(item.evidence_id, 128),
    type: boundedString(item.type, 64),
    gate: item.gate ?? null,
    outcome: boundedString(item.outcome, 32),
    origin: boundedString(item.origin, 64),
    ref: boundedString(item.ref, 2_048),
    summary: boundedString(item.summary, 4_000),
    observed_at: boundedString(item.observed_at, 64),
    commit_sha: boundedString(item.commit_sha, 64),
    deployment_id: boundedString(item.deployment_id, 128),
    sample_type: boundedString(item.sample_type, 32),
  };
}

function safeJsonValue(value, max = 12_000) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, max);
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= max) return value;
    return { truncated: true, value: serialized.slice(0, max) };
  } catch {
    return { unavailable: true };
  }
}

function publicTask(task) {
  return {
    task_id: boundedString(task?.task_id, 128),
    request_id: boundedString(task?.request_id, 128),
    context_id: boundedString(task?.context_id, 128),
    workspace_id: boundedString(task?.workspace_id, 128),
    goal: boundedString(task?.goal),
    execution_goal: boundedString(task?.execution_goal),
    acceptance_criteria: boundedList(task?.acceptance_criteria, 50).map((value) => boundedString(value, 2_000)),
    status: boundedString(task?.status, 64),
    current_stage: boundedString(task?.current_stage, 128),
    next_decision_required: task?.next_decision_required === true,
    result: safeJsonValue(task?.result),
    review: safeJsonValue(task?.review),
    stop_loss: safeJsonValue(task?.stop_loss),
    evidence: boundedList(task?.evidence, 100).map(safeEvidence).filter(Boolean),
    blockers: boundedList(task?.blockers, 100).map((value) => boundedString(value, 2_000)),
    cost: task?.cost && typeof task.cost === "object" ? { ...task.cost } : {},
    version: Number.isSafeInteger(task?.version) ? task.version : null,
    created_at: boundedString(task?.created_at, 64),
    updated_at: boundedString(task?.updated_at, 64),
  };
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function taskInputFromArguments(args) {
  const requestId = args.request_id || `mcp_${randomUUID()}`;
  return parseTaskInput({
    request_id: requestId,
    context_id: args.context_id || null,
    workspace_id: args.workspace_id,
    goal: args.goal || DEFAULT_GOAL,
    acceptance_criteria: args.acceptance_criteria || [...DEFAULT_ACCEPTANCE],
    constraints: [...DEFAULT_CONSTRAINTS],
    allowed_actions: [...DEFAULT_ALLOWED_ACTIONS],
    forbidden_actions: [...DEFAULT_FORBIDDEN_ACTIONS],
    budget: { ...DEFAULT_BUDGET },
    stop_conditions: [
      "stop when account login, permission, payment, credential, or other manual owner action is required",
      "stop when the requested diagnosis would require modifying unrelated architecture",
    ],
    status: "submitted",
    current_stage: "executor",
  });
}

function securityMeta(scopes) {
  return {
    securitySchemes: [{ type: "oauth2", scopes }],
  };
}

export function createMcpServer({ principal, service = workflowControlService } = {}) {
  const server = new McpServer({
    name: "tree-brain-codex",
    version: "1.0.0",
  });

  server.registerTool("get_connection_status", {
    title: "Get Tree Brain connection status",
    description: "Report the MCP transport and backend readiness without exposing credentials or filesystem paths.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: securityMeta(["treebrain:read"]),
  }, async () => toolResult({
    service: "tree-brain-codex",
    transport: "MCP Streamable HTTP",
    status: "ready",
    authenticated_principal: principal?.principal_id || null,
    workspaces_available: Array.isArray(principal?.workspace_ids)
      ? principal.workspace_ids.length
      : 0,
  }));

  server.registerTool("list_workspaces", {
    title: "List authorized workspaces",
    description: "List only workspace identifiers granted to the authenticated Tree Brain user.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: securityMeta(["treebrain:read"]),
  }, async () => toolResult({
    workspaces: Array.isArray(principal?.workspace_ids) ? [...principal.workspace_ids] : [],
  }));

  server.registerTool("check_project", {
    title: "Check the existing project",
    description: "Start a bounded, diagnosis-only Tree Brain task against an authorized workspace. The result is a task receipt; it does not claim that inspection has completed.",
    inputSchema: {
      workspace_id: WORKSPACE_SCHEMA.describe("Authorized workspace identifier"),
      request_id: REQUEST_ID_SCHEMA.describe("Optional idempotency identifier"),
      context_id: REQUEST_ID_SCHEMA.describe("Optional conversation context identifier"),
      goal: TEXT_SCHEMA.optional().describe("Inspection goal"),
      acceptance_criteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50).optional().describe("Evidence requirements for the inspection"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: securityMeta(["treebrain:check"]),
  }, async (args) => {
    assertWorkspaceAccess(principal, args.workspace_id);
    const taskInput = taskInputFromArguments(args);
    const task = await service.createTask(taskInput, {
      principal_id: principal.principal_id || principal.key_id || "oauth",
    });
    if (!task || task.workspace_id !== args.workspace_id) {
      const error = new Error("TREE_BRAIN_TASK_WORKSPACE_MISMATCH");
      error.statusCode = 409;
      throw error;
    }
    return toolResult({
      accepted: true,
      pending: true,
      task: publicTask(task),
      message: "Task accepted. Wait for the executor result before treating the project check as complete.",
    });
  });

  server.registerTool("get_task", {
    title: "Get Tree Brain task status",
    description: "Read a bounded status, result, evidence, and blocker view for an authorized Tree Brain task.",
    inputSchema: {
      task_id: z.string().trim().min(1).max(128).regex(ID_PATTERN).describe("Tree Brain task identifier"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: securityMeta(["treebrain:read"]),
  }, async ({ task_id: taskId }) => {
    const task = await service.getTask(taskId);
    assertWorkspaceAccess(principal, task.workspace_id);
    return toolResult({ task: publicTask(task) });
  });

  return server;
}

function sendHttpError(res, error, config, requestId = null) {
  const status = Number(error?.statusCode || error?.status || 500);
  const safeStatus = Math.min(Math.max(status, 400), 599);
  const code = error instanceof TreeBrainOAuthError
    ? error.code
    : (/^[A-Z0-9_]{3,128}$/u.test(String(error?.code || error?.message || ""))
      ? String(error.code || error.message)
      : "TREE_BRAIN_MCP_INTERNAL_ERROR");
  res.statusCode = safeStatus;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  if (safeStatus === 401) res.setHeader("www-authenticate", authenticationChallenge(config));
  if (requestId) res.setHeader("x-request-id", requestId);
  res.end(JSON.stringify({ error: { code }, request_id: requestId }));
}

/** Create a stateless MCP endpoint suitable for a Vercel Node Function. */
export function createMcpHandler({
  env = process.env,
  service = workflowControlService,
  authorizer = createOAuthAuthorizer({ env }),
  idFactory = randomUUID,
} = {}) {
  return async function mcpHandler(req, res) {
    const requestId = `mcp_${idFactory()}`;
    if (String(req.method || "POST").toUpperCase() !== "POST") {
      res.statusCode = 405;
      res.setHeader("allow", "POST");
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "TREE_BRAIN_MCP_METHOD_NOT_ALLOWED" }, request_id: requestId }));
      return;
    }

    let config = null;
    try {
      config = readAuthConfig(env);
      const body = await readMcpBody(req);
      const bodyHint = parseBodyHint({ body });
      const scope = requiredScopeForBody(bodyHint);
      const principal = await authorizer(firstHeader(headerMap(req), "authorization"), [scope]);
      const server = createMcpServer({ principal, service });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      res.on?.("close", () => {
        void transport.close().catch(() => {});
        void server.close().catch(() => {});
      });
    } catch (error) {
      if (!res.headersSent) sendHttpError(res, error, config, requestId);
    }
  };
}

export { DEFAULT_ACCEPTANCE, DEFAULT_GOAL };
