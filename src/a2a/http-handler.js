import { randomUUID } from "node:crypto";

import {
  A2AAuthError,
  canonicalPathAndQuery,
  createRequestAuthorizer,
} from "./auth.js";
import {
  parseDecision,
  parseExecutorReport,
  parseTaskInput,
} from "./model.js";
import { workflowControlService } from "./control-service.js";

const MAX_BODY_BYTES = 256 * 1024;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_KINDS = new Set(["CLAIM", "HEARTBEAT", "REPORT"]);
const TASK_STATUSES = new Set([
  "submitted",
  "running",
  "blocked",
  "review_required",
  "completed",
  "failed",
  "stopped",
]);
const CREATE_TASK_KEYS = new Set([
  "request_id",
  "context_id",
  "workspace_id",
  "sample",
  "goal",
  "acceptance_criteria",
  "constraints",
  "budget",
  "stop_conditions",
  "allowed_actions",
  "forbidden_actions",
]);
const ENFORCED_FORBIDDEN_ACTIONS = Object.freeze([
  "Do not hardcode, manually transcribe, snapshot, fixture, or use cached content as a blind-test result.",
  "Do not expose credentials or copy secrets into task data, logs, evidence, commits, or deployments.",
  "Do not force-push, delete production data, change permissions, make payments, or perform irreversible actions.",
]);
const DEFAULT_BUDGET = Object.freeze({
  max_executions: 12,
  max_failures: 6,
  max_real_world_tests: 8,
  max_agent_calls: 30,
  max_estimated_tokens: 2_000_000,
  max_external_api_calls: 100,
  max_deployments: 8,
});
const OWNER_BLOCKER_PATTERN = /\b(?:account|credential|payment|billing|permission|authorization|manual login|legal|compliance|irreversible|product direction)\b|账号|凭据|付款|计费|权限|授权|人工登录|法律|合规|不可逆|重大产品方向/iu;

function errorWithStatus(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertPlainObject(value, code = "A2A_BODY_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw errorWithStatus(code, 400);
  }
  return value;
}

function assertKnownKeys(value, allowed, code = "A2A_BODY_INVALID") {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw errorWithStatus(code, 400);
  }
}

function firstHeader(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(req) {
  const declaredLength = Number(firstHeader(req.headers, "content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw errorWithStatus("A2A_BODY_TOO_LARGE", 413);
  }
  if (Buffer.isBuffer(req.body)) {
    if (req.body.byteLength > MAX_BODY_BYTES) {
      throw errorWithStatus("A2A_BODY_TOO_LARGE", 413);
    }
    return req.body.toString("utf8");
  }
  if (typeof req.body === "string") {
    if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) {
      throw errorWithStatus("A2A_BODY_TOO_LARGE", 413);
    }
    return req.body;
  }
  if (req.body && typeof req.body === "object") {
    const serialized = JSON.stringify(req.body);
    if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) {
      throw errorWithStatus("A2A_BODY_TOO_LARGE", 413);
    }
    return serialized;
  }
  if (!req[Symbol.asyncIterator]) return "";

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_BODY_BYTES) throw errorWithStatus("A2A_BODY_TOO_LARGE", 413);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(rawBody) {
  if (!rawBody) throw errorWithStatus("A2A_JSON_BODY_REQUIRED", 400);
  try {
    return JSON.parse(rawBody);
  } catch {
    throw errorWithStatus("A2A_JSON_INVALID", 400);
  }
}

function resolveRoute(req) {
  const url = new URL(req.url || "/", "https://a2a.invalid");
  const queryRoute = Array.isArray(req.query?.route)
    ? req.query.route[0]
    : req.query?.route;
  const route = String(queryRoute || url.searchParams.get("route") || url.pathname);
  if (!route.startsWith("/") || route.includes("\\") || /[\u0000-\u001f]/u.test(route)) {
    throw errorWithStatus("A2A_ROUTE_INVALID", 400);
  }
  return {
    route: route.length > 1 ? route.replace(/\/+$/u, "") : route,
    url,
    pathAndQuery: canonicalPathAndQuery(route, url.searchParams),
  };
}

function matchTaskRoute(route) {
  const match = /^\/tasks(?:\/([^/]+)(?:\/(result|decision|stop|executor))?)?$/u.exec(route);
  if (!match) return null;
  let taskId = null;
  if (match[1]) {
    try {
      taskId = decodeURIComponent(match[1]);
    } catch {
      throw errorWithStatus("A2A_TASK_ID_INVALID", 400);
    }
    if (!ID_RE.test(taskId)) throw errorWithStatus("A2A_TASK_ID_INVALID", 400);
  }
  return { taskId, action: match[2] || null };
}

function parseStatusFilter(value) {
  if (!value) return undefined;
  const statuses = String(value).split("|");
  if (statuses.length > TASK_STATUSES.size || statuses.some((item) => !TASK_STATUSES.has(item))) {
    throw errorWithStatus("A2A_STATUS_FILTER_INVALID", 400);
  }
  return statuses.join("|");
}

function parseLimit(value) {
  if (value == null || value === "") return 25;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw errorWithStatus("A2A_LIMIT_INVALID", 400);
  }
  return limit;
}

function assertIdentity(value, code) {
  if (!ID_RE.test(String(value || ""))) throw errorWithStatus(code, 400);
  return String(value);
}

function assertWorkspaceScope(principal, workspaceId) {
  if (principal.workspace_ids && !principal.workspace_ids.includes(workspaceId)) {
    throw errorWithStatus("A2A_WORKSPACE_FORBIDDEN", 403);
  }
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value)))];
}

function prepareTaskInput(body) {
  const input = assertPlainObject(body);
  assertKnownKeys(input, CREATE_TASK_KEYS);
  if (input.request_id == null || input.request_id === "") {
    throw errorWithStatus("A2A_REQUEST_ID_REQUIRED", 400);
  }
  const requestId = assertIdentity(input.request_id, "A2A_REQUEST_ID_INVALID");
  const workspaceId = assertIdentity(input.workspace_id, "A2A_WORKSPACE_ID_REQUIRED");
  return parseTaskInput({
    ...input,
    request_id: requestId,
    workspace_id: workspaceId,
    budget: { ...DEFAULT_BUDGET, ...(input.budget || {}) },
    forbidden_actions: uniqueStrings([
      ...(input.forbidden_actions || []),
      ...ENFORCED_FORBIDDEN_ACTIONS,
    ]),
    status: "submitted",
    current_stage: "executor",
  });
}

function eventEnvelope(input, principal, task, taskId, idFactory, now) {
  const body = assertPlainObject(input);
  assertKnownKeys(body, new Set(["event"]));
  const event = assertPlainObject(body.event, "A2A_EXECUTOR_EVENT_INVALID");
  assertKnownKeys(
    event,
    new Set(["event_id", "kind", "worker_id", "workspace_id", "at", "payload"]),
    "A2A_EXECUTOR_EVENT_INVALID",
  );
  if (!EVENT_KINDS.has(event.kind)) {
    throw errorWithStatus("A2A_EXECUTOR_EVENT_KIND_INVALID", 400);
  }
  const workerId = assertIdentity(event.worker_id, "A2A_WORKER_ID_INVALID");
  const workspaceId = assertIdentity(event.workspace_id, "A2A_WORKSPACE_ID_REQUIRED");
  if (principal.principal_id && principal.principal_id !== workerId) {
    throw errorWithStatus("A2A_WORKER_ID_FORBIDDEN", 403);
  }
  assertWorkspaceScope(principal, workspaceId);
  if (task.workspace_id !== workspaceId) {
    throw errorWithStatus("A2A_TASK_WORKSPACE_MISMATCH", 409);
  }
  if (event.event_id == null) {
    throw errorWithStatus("A2A_EVENT_ID_REQUIRED", 400);
  }
  const eventId = assertIdentity(event.event_id, "A2A_EVENT_ID_INVALID");
  const payload = event.kind === "REPORT"
    ? parseExecutorReport(event.payload, { taskId })
    : assertPlainObject(event.payload || {}, "A2A_EXECUTOR_EVENT_INVALID");
  if (event.kind === "HEARTBEAT") {
    assertKnownKeys(payload, new Set(["stage"]), "A2A_EXECUTOR_EVENT_INVALID");
    if (payload.stage != null && (!ID_RE.test(String(payload.stage)) || String(payload.stage).length > 128)) {
      throw errorWithStatus("A2A_EXECUTOR_STAGE_INVALID", 400);
    }
  } else if (event.kind === "CLAIM") {
    assertKnownKeys(payload, new Set(), "A2A_EXECUTOR_EVENT_INVALID");
  }
  return {
    event_id: eventId,
    kind: event.kind,
    worker_id: workerId,
    workspace_id: workspaceId,
    at: new Date(now()).toISOString(),
    actor_key_id: principal.key_id,
    payload,
  };
}

function publicResult(task) {
  return {
    task_id: task.task_id,
    status: task.status,
    current_stage: task.current_stage,
    result: task.result || null,
    review: task.review || null,
    stop_loss: task.stop_loss || null,
    evidence: task.evidence || [],
    blockers: task.blockers || [],
    cost: task.cost || {},
    updated_at: task.updated_at || null,
  };
}

function sendJson(res, statusCode, payload, requestId) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  if (requestId) res.setHeader("x-request-id", requestId);
  res.end(JSON.stringify(payload));
}

function normalizeError(error) {
  if (error instanceof A2AAuthError) {
    return { code: error.code, statusCode: error.statusCode };
  }
  if (error instanceof TypeError || error instanceof RangeError) {
    return { code: "A2A_VALIDATION_FAILED", statusCode: 400 };
  }
  const code = String(error?.code || error?.message || "A2A_INTERNAL_ERROR");
  const statusCode = Number(error?.statusCode) || (
    /(?:CONFLICT|TERMINAL|NOT_CLAIMABLE|NOT_RUNNING|LEASE_MISMATCH|DECISION_NOT_REQUIRED)/u.test(code)
      ? 409
      : 500
  );
  return {
    code: /^[A-Z0-9_]{3,128}$/u.test(code) ? code : "A2A_INTERNAL_ERROR",
    statusCode: Math.min(Math.max(statusCode, 400), 599),
  };
}

export function createA2AHttpHandler({
  service = workflowControlService,
  publicKeys = [],
  authorizer = createRequestAuthorizer({ publicKeys }),
  idFactory = randomUUID,
  now = () => Date.now(),
} = {}) {
  return async function a2aHttpHandler(req, res) {
    const requestId = `http_${idFactory()}`;
    try {
      const { route, url, pathAndQuery } = resolveRoute(req);
      const matched = matchTaskRoute(route);
      if (!matched) throw errorWithStatus("A2A_ROUTE_NOT_FOUND", 404);
      const method = String(req.method || "GET").toUpperCase();
      const rawBody = await readRawBody(req);
      const authRequest = {
        method,
        headers: req.headers,
        body: rawBody,
        pathAndQuery,
      };

      if (method === "POST" && route === "/tasks") {
        const principal = authorizer(authRequest, ["decision"]);
        const taskInput = prepareTaskInput(parseJsonBody(rawBody));
        assertWorkspaceScope(principal, taskInput.workspace_id);
        const task = await service.createTask(taskInput, {
          principal_id: principal.principal_id || principal.key_id,
        });
        if (!task || task.workspace_id !== taskInput.workspace_id) {
          throw errorWithStatus("A2A_TASK_WORKSPACE_MISMATCH", 409);
        }
        assertWorkspaceScope(principal, task.workspace_id);
        sendJson(res, 201, { task }, requestId);
        return;
      }

      if (method === "GET" && route === "/tasks") {
        const principal = authorizer(authRequest, ["decision", "worker"]);
        let workspaceId = url.searchParams.get("workspace_id") || undefined;
        if (workspaceId) assertIdentity(workspaceId, "A2A_WORKSPACE_ID_INVALID");
        if (principal.workspace_ids) {
          if (!workspaceId && principal.workspace_ids.length !== 1) {
            throw errorWithStatus("A2A_WORKSPACE_FILTER_REQUIRED", 400);
          }
          workspaceId ||= principal.workspace_ids[0];
          assertWorkspaceScope(principal, workspaceId);
        }
        const tasks = await service.listTasks({
          status: parseStatusFilter(url.searchParams.get("status")),
          workspace_id: workspaceId,
          limit: parseLimit(url.searchParams.get("limit")),
        });
        sendJson(res, 200, { tasks }, requestId);
        return;
      }

      if (!matched.taskId) throw errorWithStatus("A2A_ROUTE_NOT_FOUND", 404);

      if (method === "GET" && matched.action === null) {
        const principal = authorizer(authRequest, ["decision", "worker"]);
        const task = await service.getTask(matched.taskId);
        assertWorkspaceScope(principal, task.workspace_id);
        sendJson(res, 200, { task }, requestId);
        return;
      }

      if (method === "GET" && matched.action === "result") {
        const principal = authorizer(authRequest, ["decision", "worker"]);
        const task = await service.getTask(matched.taskId);
        assertWorkspaceScope(principal, task.workspace_id);
        sendJson(res, 200, publicResult(task), requestId);
        return;
      }

      if (method === "POST" && matched.action === "decision") {
        const principal = authorizer(authRequest, ["decision"]);
        const task = await service.getTask(matched.taskId);
        assertWorkspaceScope(principal, task.workspace_id);
        const input = assertPlainObject(parseJsonBody(rawBody));
        if (input.decision_id == null || input.decision_id === "") {
          throw errorWithStatus("A2A_DECISION_ID_REQUIRED", 400);
        }
        const expectedVersion = input.expected_version;
        if (expectedVersion != null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
          throw errorWithStatus("A2A_EXPECTED_VERSION_INVALID", 400);
        }
        const { expected_version: ignored, ...decisionInput } = input;
        void ignored;
        const decision = parseDecision(
          { ...decisionInput, task_id: matched.taskId },
          { taskId: matched.taskId },
        );
        if (decision.decision === "ASK_OWNER" && !OWNER_BLOCKER_PATTERN.test(decision.reason)) {
          throw errorWithStatus("A2A_OWNER_ESCALATION_NOT_ALLOWED", 422);
        }
        const event = {
          event_id: decision.decision_id,
          kind: "DECISION",
          at: new Date(now()).toISOString(),
          expected_version: expectedVersion ?? task.version,
          payload: decision,
        };
        const accepted = await service.sendDecision(matched.taskId, event);
        sendJson(res, 202, accepted, requestId);
        return;
      }

      if (method === "POST" && matched.action === "stop") {
        const principal = authorizer(authRequest, ["decision"]);
        const task = await service.getTask(matched.taskId);
        assertWorkspaceScope(principal, task.workspace_id);
        const input = assertPlainObject(parseJsonBody(rawBody));
        assertKnownKeys(input, new Set(["reason", "stop_id", "event_id"]));
        if (input.stop_id != null && input.event_id != null && input.stop_id !== input.event_id) {
          throw errorWithStatus("A2A_STOP_ID_CONFLICT", 400);
        }
        const stopId = input.stop_id ?? input.event_id;
        if (stopId == null || stopId === "") {
          throw errorWithStatus("A2A_STOP_ID_REQUIRED", 400);
        }
        const reason = String(input.reason || "").trim();
        if (!reason || reason.length > 2_000) {
          throw errorWithStatus("A2A_STOP_REASON_INVALID", 400);
        }
        const event = {
          event_id: assertIdentity(stopId, "A2A_STOP_ID_INVALID"),
          kind: "STOP",
          at: new Date(now()).toISOString(),
          payload: { reason },
        };
        const accepted = await service.stopTask(matched.taskId, event);
        sendJson(res, 202, accepted, requestId);
        return;
      }

      if (method === "POST" && matched.action === "executor") {
        const principal = authorizer(authRequest, ["worker"]);
        const task = await service.getTask(matched.taskId);
        const event = eventEnvelope(
          parseJsonBody(rawBody),
          principal,
          task,
          matched.taskId,
          idFactory,
          now,
        );
        const accepted = await service.sendExecutorEvent(matched.taskId, event);
        sendJson(res, 202, accepted, requestId);
        return;
      }

      throw errorWithStatus("A2A_METHOD_NOT_ALLOWED", 405);
    } catch (error) {
      const normalized = normalizeError(error);
      sendJson(
        res,
        normalized.statusCode,
        { error: { code: normalized.code }, request_id: requestId },
        requestId,
      );
    }
  };
}
