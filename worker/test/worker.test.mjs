import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  executeTask,
  loadWorkerConfig,
  parseArgs,
  resolveAssignment,
  resolveWorkspace,
} from "../index.mjs";

test("CLI accepts exactly one of task-id and poll modes", () => {
  assert.deepEqual(parseArgs(["--config", "worker.json", "--task-id", "task-1"]), {
    configPath: "worker.json",
    taskId: "task-1",
    poll: false,
    once: false,
  });
  assert.deepEqual(parseArgs(["--poll", "--once"]), {
    configPath: "config.json",
    taskId: null,
    poll: true,
    once: true,
  });
  assert.throws(() => parseArgs(["--poll", "--task-id", "task-1"]), /exactly one/);
  assert.throws(() => parseArgs(["--cwd", "C:\\unsafe", "--poll"]), /Unsupported argument/);
});

test("config resolves only fixed absolute workspace mappings and reads key from env", async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "a2a-worker-test-"));
  const workspace = path.join(tempDirectory, "workspace");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(workspace);
  const configPath = path.join(tempDirectory, "config.json");
  const { privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  await writeFile(configPath, JSON.stringify({
    control_url: "https://control.example.test",
    worker_id: "worker-1",
    key_id: "key-1",
    private_key_env: "A2A_TEST_PRIVATE_KEY",
    workspaces: { reader: workspace },
  }));
  try {
    const config = await loadWorkerConfig(configPath, { A2A_TEST_PRIVATE_KEY: privatePem });
    assert.equal(config.privateKey, privatePem);
    assert.equal(config.workspaces.reader, await (await import("node:fs/promises")).realpath(workspace));
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("workspace resolution ignores any task-provided cwd and uses the local allowlist", () => {
  const fixed = path.resolve(".");
  const config = { workspaces: { reader: fixed } };
  assert.deepEqual(resolveWorkspace(config, {
    workspace_id: "reader",
    cwd: path.resolve(".."),
  }), { workspaceId: "reader", workspacePath: fixed });
  assert.throws(() => resolveWorkspace(config, { workspace_id: "unknown" }), /allowlist/);
});

test("assignment chooses reviewer from stage and rejects arbitrary roles", () => {
  assert.equal(resolveAssignment({ current_stage: "independent_review" }).role, "reviewer");
  assert.equal(resolveAssignment({ current_stage: "decision" }).role, "decision");
  assert.throws(() => resolveAssignment({ role: "shell" }), /unsupported role/i);
});

test("owner-input blockers remain idle until the Owner changes the task", async () => {
  let called = false;
  const result = await executeTask({
    client: { executorEvent: async () => { called = true; } },
    decisionClient: { sendDecision: async () => { called = true; } },
    runner: { run: async () => { called = true; } },
    config: { workerId: "worker-1", workspaces: { reader: path.resolve(".") } },
    task: {
      task_id: "task-owner-input",
      status: "blocked",
      current_stage: "owner_input",
      workspace_id: "reader",
    },
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { ran: false, reason: "not_runnable" });
  assert.equal(called, false);
});

test("worker confirms its claim before running and submits a structured report", async () => {
  const events = [];
  let claimed = false;
  const task = {
    task_id: "task-1",
    status: "submitted",
    workspace_id: "reader",
    current_stage: "execute",
  };
  const client = {
    executorEvent: async (taskId, event) => {
      events.push({ taskId, event });
      if (event.kind === "CLAIM") claimed = true;
      return { ok: true };
    },
    getTask: async () => ({
      ...task,
      worker: claimed ? { worker_id: "worker-1" } : null,
    }),
  };
  let runCount = 0;
  const report = {
    task_id: "task-1",
    status: "review_required",
    action: "test",
    result: "done",
    evidence: [],
    real_world_test: null,
    cost: {
      execution_count: 1,
      failure_count: 0,
      same_root_cause_repeat_count: 0,
      real_world_test_count: 0,
      agent_call_count: 1,
      estimated_tokens: 10,
      external_api_call_count: 0,
      deployment_count: 0,
    },
    root_cause: null,
    alternatives: [],
    decision_required: true,
    acceptance_results: [],
    blockers: [],
    owner_goal_pass: false,
  };
  const result = await executeTask({
    client,
    runner: { run: async () => { runCount += 1; return report; } },
    config: {
      workerId: "worker-1",
      workspaces: { reader: path.resolve(".") },
      claimTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      executorNetworkAccess: false,
      researchNetworkAccess: true,
      model: null,
      reasoningEffort: undefined,
    },
    task,
    signal: new AbortController().signal,
  });

  assert.equal(result.ran, true);
  assert.equal(runCount, 1);
  assert.deepEqual(events.map(({ event }) => event.kind), ["CLAIM", "REPORT"]);
  assert.deepEqual(events[1].event.payload, report);
});

test("decision stage is read-only and posts with the separately scoped decision client without claiming", async () => {
  const workerEvents = [];
  const decisions = [];
  const task = {
    task_id: "task-decision",
    status: "review_required",
    workspace_id: "reader",
    current_stage: "decision",
  };
  const expected = {
    task_id: "task-decision",
    decision: "CONTINUE",
    reason: "A different bounded action remains",
    constraints_update: [],
    next_goal: null,
  };
  const result = await executeTask({
    client: {
      executorEvent: async (...args) => workerEvents.push(args),
    },
    decisionClient: {
      sendDecision: async (taskId, decision) => decisions.push({ taskId, decision }),
    },
    runner: {
      run: async (input) => {
        assert.equal(input.role, "decision");
        assert.equal(input.executorNetworkAccess, false);
        return expected;
      },
    },
    config: {
      workerId: "worker-1",
      workspaces: { reader: path.resolve(".") },
      model: null,
      reasoningEffort: undefined,
    },
    task,
    signal: new AbortController().signal,
  });
  assert.equal(result.ran, true);
  assert.deepEqual(workerEvents, []);
  assert.deepEqual(decisions, [{ taskId: "task-decision", decision: expected }]);
});

test("a rejected decision is not reported as a successful run", async () => {
  const task = {
    task_id: "task-decision-rejected",
    status: "review_required",
    workspace_id: "reader",
    current_stage: "decision",
    version: 4,
    last_rejected_event: {
      event_id: "decision_previous",
      code: "A2A_STOP_LOSS_DECISION_REJECTED",
    },
  };
  let decisionPromptTask;
  const result = await executeTask({
    client: {},
    decisionClient: {
      sendDecision: async () => ({
        accepted: true,
        applied: false,
        rejected_code: "A2A_STOP_LOSS_DECISION_REJECTED",
      }),
    },
    runner: {
      run: async ({ task: promptTask }) => {
        decisionPromptTask = promptTask;
        return {
          task_id: task.task_id,
          decision: "CONTINUE",
          reason: "try again",
          constraints_update: [],
          next_goal: null,
        };
      },
    },
    config: {
      workerId: "worker-1",
      workspaces: { reader: path.resolve(".") },
      model: null,
      reasoningEffort: undefined,
    },
    task,
    signal: new AbortController().signal,
  });
  assert.equal(decisionPromptTask.last_rejected_event.code, "A2A_STOP_LOSS_DECISION_REJECTED");
  assert.equal(result.ran, false);
  assert.equal(result.reason, "decision_rejected");
  assert.equal(result.rejectedCode, "A2A_STOP_LOSS_DECISION_REJECTED");
});

test("research remains read-only after the server changes claim bookkeeping to executor", async () => {
  const task = {
    task_id: "task-research",
    status: "submitted",
    workspace_id: "reader",
    current_stage: "research",
  };
  let claimed = false;
  let observedRole;
  const report = {
    task_id: "task-research",
    status: "review_required",
    action: "researched a shorter route",
    result: "one bounded proof of concept is preferable",
    evidence: [],
    real_world_test: null,
    cost: {
      execution_count: 1,
      failure_count: 0,
      same_root_cause_repeat_count: 0,
      real_world_test_count: 0,
      agent_call_count: 1,
      estimated_tokens: 1,
      external_api_call_count: 0,
      deployment_count: 0,
    },
    root_cause: null,
    alternatives: ["bounded proof of concept"],
    decision_required: true,
    acceptance_results: [],
    blockers: [],
    owner_goal_pass: false,
  };
  await executeTask({
    client: {
      executorEvent: async (_taskId, event) => {
        if (event.kind === "CLAIM") claimed = true;
      },
      getTask: async () => ({
        ...task,
        status: claimed ? "running" : "submitted",
        current_stage: claimed ? "executor" : "research",
        worker: claimed ? { worker_id: "worker-1" } : null,
      }),
    },
    runner: {
      run: async (input) => {
        observedRole = input.role;
        return report;
      },
    },
    config: {
      workerId: "worker-1",
      workspaces: { reader: path.resolve(".") },
      claimTimeoutMs: 1_000,
      heartbeatIntervalMs: 60_000,
      executorNetworkAccess: true,
      researchNetworkAccess: true,
      model: null,
      reasoningEffort: undefined,
    },
    task,
    signal: new AbortController().signal,
  });
  assert.equal(observedRole, "research");
});

test("remote stop aborts the local Codex turn and suppresses a stale report", async () => {
  const task = {
    task_id: "task-stop",
    status: "submitted",
    workspace_id: "reader",
    current_stage: "executor",
  };
  const kinds = [];
  let claimed = false;
  let stopped = false;
  const result = await executeTask({
    client: {
      executorEvent: async (_taskId, event) => {
        kinds.push(event.kind);
        if (event.kind === "CLAIM") claimed = true;
        if (event.kind === "HEARTBEAT") stopped = true;
      },
      getTask: async () => ({
        ...task,
        status: stopped ? "stopped" : claimed ? "running" : "submitted",
        worker: stopped ? null : claimed ? { worker_id: "worker-1" } : null,
      }),
    },
    runner: {
      run: async ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    },
    config: {
      workerId: "worker-1",
      workspaces: { reader: path.resolve(".") },
      claimTimeoutMs: 1_000,
      heartbeatIntervalMs: 10,
      executorNetworkAccess: false,
      researchNetworkAccess: true,
      model: null,
      reasoningEffort: undefined,
    },
    task,
    signal: new AbortController().signal,
  });
  assert.equal(result.reason, "lease_lost_or_stopped");
  assert.deepEqual(kinds, ["CLAIM", "HEARTBEAT"]);
});
