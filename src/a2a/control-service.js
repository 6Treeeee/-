import {
  getHookByToken,
  getRun,
  resumeHook,
  start,
} from "workflow/api";

import {
  findTaskIndexEntry,
  TASK_INDEX_HOOK_TOKEN,
  taskInboxToken,
  taskRequestToken,
} from "../../workflows/a2a-control.js";

export const CONTROL_WORKFLOW = {
  workflowId: "workflow//./workflows/a2a-control//a2aControlWorkflow",
};
export const INDEX_WORKFLOW = {
  workflowId: "workflow//./workflows/a2a-control//a2aTaskIndexWorkflow",
};

const TASK_ID_RE = /^wrun_[A-Za-z0-9_-]{16,64}$/;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertTaskId(taskId) {
  if (!TASK_ID_RE.test(String(taskId || ""))) {
    const error = new Error("A2A_TASK_ID_INVALID");
    error.statusCode = 400;
    throw error;
  }
}

async function lookupHook(token) {
  try {
    return await getHookByToken(token);
  } catch {
    return null;
  }
}

async function waitForHook(token, { attempts = 30, intervalMs = 100 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const hook = await lookupHook(token);
    if (hook) return hook;
    await delay(intervalMs);
  }
  const error = new Error("A2A_WORKFLOW_HOOK_NOT_READY");
  error.statusCode = 503;
  throw error;
}

async function ensureIndexRun() {
  const existing = await lookupHook(TASK_INDEX_HOOK_TOKEN);
  if (existing) return existing.runId;

  const run = await start(INDEX_WORKFLOW, []);
  const hook = await waitForHook(TASK_INDEX_HOOK_TOKEN);
  return hook.runId || run.runId;
}

async function readLatest(runId, namespace) {
  const run = getRun(runId);
  if (!(await run.exists)) return null;

  const tail = await run.getReadable({ namespace }).getTailIndex();
  if (tail < 0) return null;

  const readable = run.getReadable({ namespace, startIndex: tail });
  const reader = readable.getReader();
  let latest = null;
  try {
    const { done, value } = await reader.read();
    if (!done) latest = value;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return latest;
}

async function readIndex() {
  const runId = await ensureIndexRun();
  return (await readLatest(runId, "task-index")) || { entries: [] };
}

async function resumeWithRetry(token, event) {
  let lastError;
  for (let index = 0; index < 20; index += 1) {
    try {
      return await resumeHook(token, event);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  const failure = new Error("A2A_WORKFLOW_RESUME_FAILED", { cause: lastError });
  failure.statusCode = 503;
  throw failure;
}

async function waitForEventOutcome(taskId, eventId, { attempts = 50 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const task = await readLatest(taskId, "task-state").catch(() => null);
    const outcome = eventOutcomeFromTask(task, eventId);
    if (outcome) {
      return {
        accepted: true,
        ...outcome,
        task_id: taskId,
        event_id: eventId,
        task_version: task.version,
      };
    }
    await delay(100);
  }
  return {
    accepted: true,
    applied: null,
    pending: true,
    task_id: taskId,
    event_id: eventId,
  };
}

async function waitForTaskWorkspace(service, taskId, workspaceId, { attempts = 30 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const task = await service.getTask(taskId);
    if (task?.workspace_id === workspaceId) return task;
    if (task?.workspace_id && task.workspace_id !== workspaceId) {
      const error = new Error("A2A_TASK_WORKSPACE_MISMATCH");
      error.statusCode = 409;
      throw error;
    }
    await delay(100);
  }
  const error = new Error("A2A_TASK_STATE_NOT_READY");
  error.statusCode = 503;
  throw error;
}

export function eventOutcomeFromTask(task, eventId) {
  if (!task || !eventId) return null;
  const receipt = [...(task.event_receipts || [])]
    .reverse()
    .find((candidate) => candidate.event_id === eventId);
  if (receipt) {
    return {
      applied: receipt.applied === true,
      receipt_version: receipt.version,
      ...(receipt.applied === false ? { rejected_code: receipt.code } : {}),
    };
  }
  if (task.processed_event_ids?.includes(eventId)) {
    return {
      applied: null,
      outcome_unknown: true,
    };
  }
  return null;
}

export function reconcileTaskWithRunStatus(task, runStatus) {
  if (!task || ["completed", "failed", "stopped"].includes(task.status)) return task;
  const failure = runStatus === "failed"
    ? { status: "failed", stage: "workflow_failed", blocker: "A2A_WORKFLOW_RUN_FAILED" }
    : runStatus === "cancelled"
      ? { status: "stopped", stage: "workflow_cancelled", blocker: "A2A_WORKFLOW_RUN_CANCELLED" }
      : runStatus === "completed"
        ? {
          status: "failed",
          stage: "workflow_state_incomplete",
          blocker: "A2A_WORKFLOW_COMPLETED_WITHOUT_TERMINAL_TASK_STATE",
        }
        : null;
  if (!failure) return { ...task, workflow_run_status: runStatus };
  return {
    ...task,
    status: failure.status,
    current_stage: failure.stage,
    next_decision_required: false,
    worker: null,
    blockers: [...new Set([...(task.blockers || []), failure.blocker])].slice(-64),
    workflow_run_status: runStatus,
  };
}

export class WorkflowControlService {
  constructor({
    getRunImpl = getRun,
    readLatestImpl = readLatest,
  } = {}) {
    this.getRunImpl = getRunImpl;
    this.readLatestImpl = readLatestImpl;
  }

  async createTask(input, { principal_id: principalId = "unscoped" } = {}) {
    const index = await readIndex();
    const existing = findTaskIndexEntry(index.entries, {
      workspace_id: input.workspace_id,
      request_id: input.request_id,
      principal_id: principalId,
    });
    if (existing) {
      return waitForTaskWorkspace(this, existing.task_id, input.workspace_id);
    }

    const createdAt = input.created_at || new Date().toISOString();
    const run = await start(CONTROL_WORKFLOW, [{
      ...input,
      created_at: createdAt,
      reservation_principal_id: principalId,
    }]);
    const reservation = await waitForHook(taskRequestToken(
      input.workspace_id,
      input.request_id,
      principalId,
    ));
    const taskId = reservation.runId || run.runId;
    await waitForHook(taskInboxToken(taskId));
    if (taskId !== run.runId) {
      return waitForTaskWorkspace(this, taskId, input.workspace_id);
    }
    await resumeWithRetry(TASK_INDEX_HOOK_TOKEN, {
      kind: "TASK_CREATED",
      task_id: taskId,
      request_id: input.request_id,
      workspace_id: input.workspace_id,
      principal_id: principalId,
      created_at: createdAt,
    });

    return {
      ...input,
      task_id: taskId,
      goal: input.owner_goal || input.goal,
      owner_goal: input.owner_goal || input.goal,
      execution_goal: input.execution_goal || input.current_goal || input.goal,
      current_goal: input.current_goal || input.execution_goal || input.goal,
      status: "submitted",
      current_stage: "executor",
      attempts: [],
      evidence: [],
      blockers: [],
      next_decision_required: false,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  async getTask(taskId) {
    assertTaskId(taskId);
    const state = await this.readLatestImpl(taskId, "task-state");
    const run = this.getRunImpl(taskId);
    if (!(await run.exists)) {
      const error = new Error("A2A_TASK_NOT_FOUND");
      error.statusCode = 404;
      throw error;
    }
    const runStatus = await run.status;
    return reconcileTaskWithRunStatus(state || {
        task_id: taskId,
        status: "submitted",
        current_stage: "initializing",
        blockers: [],
      }, runStatus);
  }

  async listTasks({ status, workspace_id: workspaceId, limit = 25 } = {}) {
    const statuses = String(status || "")
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
    const index = await readIndex();
    const selected = index.entries
      .filter((entry) => !workspaceId || entry.workspace_id === workspaceId)
      .slice(0, Math.min(Math.max(Number(limit) || 25, 1), 50));
    const states = await Promise.all(
      selected.map((entry) => this.getTask(entry.task_id).catch(() => null)),
    );
    return states.filter(
      (task) => task && (statuses.length === 0 || statuses.includes(task.status)),
    );
  }

  async sendExecutorEvent(taskId, event) {
    assertTaskId(taskId);
    await resumeWithRetry(taskInboxToken(taskId), event);
    return waitForEventOutcome(taskId, event.event_id);
  }

  async sendDecision(taskId, event) {
    assertTaskId(taskId);
    await resumeWithRetry(taskInboxToken(taskId), event);
    return waitForEventOutcome(taskId, event.event_id);
  }

  async stopTask(taskId, event) {
    return this.sendDecision(taskId, event);
  }
}

export const workflowControlService = new WorkflowControlService();
