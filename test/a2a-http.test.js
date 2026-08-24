import test from "node:test";
import assert from "node:assert/strict";

import { A2AAuthError } from "../src/a2a/auth.js";
import { createA2AHttpHandler } from "../src/a2a/http-handler.js";

const NOW_MS = Date.parse("2026-08-24T00:00:00.000Z");

test("HTTP control surface creates, lists, reads, returns results, decides, stops, and accepts executor events", async () => {
  const service = new FakeControlService();
  const handler = handlerFor(service);

  const created = await request(handler, {
    method: "POST",
    url: "/tasks",
    role: "decision",
    body: {
      request_id: "request_http_1",
      workspace_id: "content-reader",
      goal: "Read a new public video",
      acceptance_criteria: ["Live timed transcript is non-empty"],
      constraints: ["Public unauthenticated access only"],
      stop_conditions: ["Repeated root cause"],
      allowed_actions: ["Run a blind test"],
      forbidden_actions: [],
      sample: {
        sample_type: "BLIND_SAMPLE",
        source_url: "https://v.douyin.com/new-example/",
        author: "Yuan",
        title_prefix: "20多岁"
      }
    }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json.task.task_id, "task_http_1");
  assert.equal(service.calls.createTask[0].request_id, "request_http_1");
  assert.equal(service.calls.createTaskContext[0].principal_id, "decision_1");
  assert.equal(service.calls.createTask[0].budget.max_executions, 12);
  assert.ok(service.calls.createTask[0].forbidden_actions.some((item) => item.includes("hardcode")));

  const listed = await request(handler, {
    method: "GET",
    url: "/tasks?workspace_id=content-reader&status=submitted&limit=10",
    role: "decision"
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json.tasks.length, 1);
  assert.deepEqual(service.calls.listTasks[0], {
    status: "submitted",
    workspace_id: "content-reader",
    limit: 10
  });

  const fetched = await request(handler, {
    method: "GET",
    url: "/tasks/task_http_1",
    role: "worker"
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json.task.goal, "Read a new public video");

  const result = await request(handler, {
    method: "GET",
    url: "/tasks/task_http_1/result",
    role: "decision"
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(Object.keys(result.json).sort(), [
    "blockers",
    "cost",
    "current_stage",
    "evidence",
    "result",
    "review",
    "status",
    "stop_loss",
    "task_id",
    "updated_at"
  ]);

  const decisionBody = {
    decision_id: "decision_retry_1",
    decision: "CONTINUE",
    reason: "Use a bounded alternate ASR route",
    constraints_update: ["Keep the blind sample uncontaminated"],
    next_goal: "Run the alternate route once",
    expected_version: 1
  };
  const decided = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/decision",
    role: "decision",
    body: decisionBody
  });
  const retriedDecision = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/decision",
    role: "decision",
    body: decisionBody
  });
  assert.equal(decided.statusCode, 202);
  assert.equal(retriedDecision.statusCode, 202);
  assert.equal(service.calls.sendDecision[0].event.event_id, "decision_retry_1");
  assert.equal(service.calls.sendDecision[1].event.event_id, "decision_retry_1");
  assert.equal(service.calls.sendDecision[0].event.expected_version, 1);

  const stopped = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/stop",
    role: "decision",
    body: {
      stop_id: "stop_http_1",
      reason: "Stop before another equivalent attempt"
    }
  });
  const retriedStop = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/stop",
    role: "decision",
    body: {
      stop_id: "stop_http_1",
      reason: "Stop before another equivalent attempt"
    }
  });
  assert.equal(stopped.statusCode, 202);
  assert.equal(retriedStop.statusCode, 202);
  assert.equal(service.calls.stopTask[0].event.kind, "STOP");
  assert.equal(service.calls.stopTask[0].event.event_id, "stop_http_1");
  assert.equal(service.calls.stopTask[1].event.event_id, "stop_http_1");

  const claimed = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/executor",
    role: "worker",
    body: {
      event: {
        event_id: "executor_event_1",
        kind: "CLAIM",
        worker_id: "worker_1",
        workspace_id: "content-reader",
        payload: {}
      }
    }
  });
  assert.equal(claimed.statusCode, 202);
  assert.equal(service.calls.sendExecutorEvent[0].event.event_id, "executor_event_1");
  assert.equal(service.calls.sendExecutorEvent[0].event.actor_key_id, "test-worker-key");
});

test("workspace scope is enforced for create, list, get, and decision paths", async () => {
  const service = new FakeControlService();
  const handler = handlerFor(service);

  const forbiddenCreate = await request(handler, {
    method: "POST",
    url: "/tasks",
    role: "decision",
    scopes: ["finance-tree"],
    body: {
      request_id: "request_forbidden_1",
      workspace_id: "content-reader",
      goal: "Out of scope",
      acceptance_criteria: ["Must not be created"]
    }
  });
  assertError(forbiddenCreate, 403, "A2A_WORKSPACE_FORBIDDEN");
  assert.equal(service.calls.createTask.length, 0);

  const listNeedsScope = await request(handler, {
    method: "GET",
    url: "/tasks",
    role: "decision",
    scopes: ["content-reader", "finance-tree"]
  });
  assertError(listNeedsScope, 400, "A2A_WORKSPACE_FILTER_REQUIRED");

  const forbiddenGet = await request(handler, {
    method: "GET",
    url: "/tasks/task_http_1",
    role: "worker",
    scopes: ["finance-tree"]
  });
  assertError(forbiddenGet, 403, "A2A_WORKSPACE_FORBIDDEN");

  const forbiddenDecision = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/decision",
    role: "decision",
    scopes: ["finance-tree"],
    body: {
      decision_id: "decision_scope_1",
      decision: "STOP",
      reason: "Outside the authorized workspace",
      constraints_update: [],
      next_goal: null
    }
  });
  assertError(forbiddenDecision, 403, "A2A_WORKSPACE_FORBIDDEN");
  assert.equal(service.calls.sendDecision.length, 0);
});

test("executor endpoint requires a caller-stable event_id before mutating state", async () => {
  const service = new FakeControlService();
  const handler = handlerFor(service);
  const response = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/executor",
    role: "worker",
    body: {
      event: {
        kind: "HEARTBEAT",
        worker_id: "worker_1",
        workspace_id: "content-reader",
        payload: { stage: "testing" }
      }
    }
  });

  assertError(response, 400, "A2A_EVENT_ID_REQUIRED");
  assert.equal(service.calls.sendExecutorEvent.length, 0);
});

test("ASK_OWNER is restricted to genuine Owner-only blockers", async () => {
  const service = new FakeControlService();
  const handler = handlerFor(service);
  const ordinaryDecision = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/decision",
    role: "decision",
    body: {
      decision_id: "decision_owner_1",
      decision: "ASK_OWNER",
      reason: "Choose whether to retry the same parser",
      constraints_update: [],
      next_goal: null
    }
  });
  assertError(ordinaryDecision, 422, "A2A_OWNER_ESCALATION_NOT_ALLOWED");
  assert.equal(service.calls.sendDecision.length, 0);

  const genuineBlocker = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/decision",
    role: "decision",
    body: {
      decision_id: "decision_owner_2",
      decision: "ASK_OWNER",
      reason: "Owner permission is required for this irreversible production action",
      constraints_update: [],
      next_goal: null
    }
  });
  assert.equal(genuineBlocker.statusCode, 202);
  assert.equal(service.calls.sendDecision[0].event.payload.decision, "ASK_OWNER");
});

test("endpoint roles prevent a worker from issuing a decision", async () => {
  const service = new FakeControlService();
  const handler = handlerFor(service);
  const response = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/decision",
    role: "worker",
    body: {
      decision_id: "decision_wrong_role_1",
      decision: "STOP",
      reason: "Worker must not control the decision loop",
      constraints_update: [],
      next_goal: null
    }
  });

  assertError(response, 401, "A2A_UNAUTHORIZED");
  assert.equal(service.calls.sendDecision.length, 0);
});

test("all state-changing HTTP paths require a caller-stable idempotency id", async () => {
  const service = new FakeControlService();
  const handler = handlerFor(service);

  const missingRequestId = await request(handler, {
    method: "POST",
    url: "/tasks",
    role: "decision",
    body: {
      workspace_id: "content-reader",
      goal: "Missing id",
      acceptance_criteria: ["Rejected before creation"]
    }
  });
  assertError(missingRequestId, 400, "A2A_REQUEST_ID_REQUIRED");

  const missingDecisionId = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/decision",
    role: "decision",
    body: {
      decision: "STOP",
      reason: "Missing stable decision id",
      constraints_update: [],
      next_goal: null
    }
  });
  assertError(missingDecisionId, 400, "A2A_DECISION_ID_REQUIRED");

  const missingStopId = await request(handler, {
    method: "POST",
    url: "/tasks/task_http_1/stop",
    role: "decision",
    body: { reason: "Missing stable stop id" }
  });
  assertError(missingStopId, 400, "A2A_STOP_ID_REQUIRED");

  assert.equal(service.calls.createTask.length, 0);
  assert.equal(service.calls.sendDecision.length, 0);
  assert.equal(service.calls.stopTask.length, 0);
});

test("create response is re-authorized and cannot return a task from another workspace", async () => {
  const service = new FakeControlService();
  service.createdWorkspaceOverride = "finance-tree";
  const handler = handlerFor(service);
  const response = await request(handler, {
    method: "POST",
    url: "/tasks",
    role: "decision",
    scopes: null,
    body: {
      request_id: "request_scope_leak_1",
      workspace_id: "content-reader",
      goal: "Never return another workspace",
      acceptance_criteria: ["Workspace must match"]
    }
  });

  assertError(response, 409, "A2A_TASK_WORKSPACE_MISMATCH");
});

function handlerFor(service) {
  let generated = 0;
  return createA2AHttpHandler({
    service,
    authorizer: testAuthorizer,
    idFactory: () => `generated_${++generated}`,
    now: () => NOW_MS
  });
}

function testAuthorizer(requestInput, allowedRoles) {
  const role = requestInput.headers["x-test-role"];
  if (!allowedRoles.includes(role)) throw new A2AAuthError("A2A_UNAUTHORIZED");
  const rawScopes = requestInput.headers["x-test-scopes"];
  const workspaceIds = rawScopes === "*" ? null : rawScopes.split(",").filter(Boolean);
  return {
    key_id: `test-${role}-key`,
    role,
    method: "test",
    principal_id: role === "worker" ? "worker_1" : "decision_1",
    workspace_ids: workspaceIds
  };
}

async function request(handler, { method, url, role, scopes = ["content-reader"], body }) {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const req = {
    method,
    url,
    headers: {
      "x-test-role": role,
      "x-test-scopes": scopes === null ? "*" : scopes.join(","),
      "content-length": String(Buffer.byteLength(rawBody))
    },
    body: rawBody
  };
  const response = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload;
    }
  };
  await handler(req, response);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    json: JSON.parse(response.body)
  };
}

function assertError(response, statusCode, code) {
  assert.equal(response.statusCode, statusCode);
  assert.equal(response.json.error.code, code);
}

class FakeControlService {
  constructor() {
    this.calls = {
      createTask: [],
      createTaskContext: [],
      listTasks: [],
      getTask: [],
      sendDecision: [],
      stopTask: [],
      sendExecutorEvent: []
    };
    this.tasks = new Map([["task_http_1", {
      task_id: "task_http_1",
      workspace_id: "content-reader",
      goal: "Read a new public video",
      status: "submitted",
      current_stage: "executor",
      result: null,
      review: null,
      stop_loss: null,
      evidence: [],
      blockers: [],
      cost: {},
      version: 1,
      updated_at: "2026-08-24T00:00:00.000Z"
    }]]);
  }

  async createTask(input, context) {
    this.calls.createTask.push(input);
    this.calls.createTaskContext.push(context);
    const task = {
      ...input,
      task_id: "task_http_1",
      version: 1,
      workspace_id: this.createdWorkspaceOverride || input.workspace_id
    };
    this.tasks.set(task.task_id, task);
    return task;
  }

  async listTasks(filters) {
    this.calls.listTasks.push(filters);
    return [...this.tasks.values()];
  }

  async getTask(taskId) {
    this.calls.getTask.push(taskId);
    return this.tasks.get(taskId);
  }

  async sendDecision(taskId, event) {
    this.calls.sendDecision.push({ taskId, event });
    return { accepted: true, task_id: taskId, event_id: event.event_id };
  }

  async stopTask(taskId, event) {
    this.calls.stopTask.push({ taskId, event });
    return { accepted: true, task_id: taskId, event_id: event.event_id };
  }

  async sendExecutorEvent(taskId, event) {
    this.calls.sendExecutorEvent.push({ taskId, event });
    return { accepted: true, task_id: taskId, event_id: event.event_id };
  }
}
