import {
  createHook,
  getWorkflowMetadata,
  getWritable,
} from "workflow";

import {
  createInitialTask,
  isTerminalTask,
  recordRejectedTaskEvent,
  reduceTaskEvent,
} from "../src/a2a/state-machine.js";

export const TASK_INDEX_HOOK_TOKEN = "a2a-control:task-index:v2";

export function taskInboxToken(taskId) {
  return `a2a-control:task:${taskId}:inbox:v1`;
}

export function taskRequestKey(workspaceId, requestId, principalId = "unscoped") {
  return [workspaceId, principalId, requestId].map((value) => encodeURIComponent(
    String(value || "unscoped"),
  )).join(":");
}

export function taskRequestToken(workspaceId, requestId, principalId = "unscoped") {
  return `a2a-control:request:${taskRequestKey(
    workspaceId,
    requestId,
    principalId,
  )}:v2`;
}

export function findTaskIndexEntry(entries, {
  workspace_id: workspaceId,
  request_id: requestId,
  principal_id: principalId = "unscoped",
}) {
  const reservationKey = taskRequestKey(workspaceId, requestId, principalId);
  return entries.find((entry) => entry.reservation_key === reservationKey) || null;
}

export function applyTaskIndexEvent(entries, event) {
  if (event?.kind !== "TASK_CREATED" || !event.task_id) return entries;
  const reservationKey = taskRequestKey(
    event.workspace_id,
    event.request_id,
    event.principal_id,
  );
  const reserved = entries.find((entry) => entry.reservation_key === reservationKey);
  if (reserved && reserved.task_id !== event.task_id) return entries;
  return [{
    task_id: event.task_id,
    request_id: event.request_id,
    workspace_id: event.workspace_id,
    principal_id: event.principal_id || "unscoped",
    reservation_key: reservationKey,
    created_at: event.created_at,
  }, ...entries.filter((entry) => entry.task_id !== event.task_id)].slice(0, 200);
}

async function emitTaskState(state) {
  "use step";

  const writable = getWritable({ namespace: "task-state" });
  const writer = writable.getWriter();
  try {
    await writer.write(state);
  } finally {
    writer.releaseLock();
  }
}

async function closeTaskState() {
  "use step";
  await getWritable({ namespace: "task-state" }).close();
}

async function emitTaskIndex(entries) {
  "use step";

  const writable = getWritable({ namespace: "task-index" });
  const writer = writable.getWriter();
  try {
    await writer.write({ entries, updated_at: new Date().toISOString() });
  } finally {
    writer.releaseLock();
  }
}

export async function a2aControlWorkflow(input) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const reservation = createHook({ token: taskRequestToken(
    input.workspace_id,
    input.request_id,
    input.reservation_principal_id,
  ) });
  const inbox = createHook({ token: taskInboxToken(workflowRunId) });
  try {
    const reservationConflict = await reservation.getConflict();
    if (reservationConflict) return { deduped_to: reservationConflict.runId };
    let state = createInitialTask(input, workflowRunId);
    await emitTaskState(state);
    const conflict = await inbox.getConflict();
    if (conflict) throw new Error("A2A_TASK_HOOK_CONFLICT");
    for await (const event of inbox) {
      try {
        state = reduceTaskEvent(state, event);
      } catch (error) {
        console.warn(JSON.stringify({
          event: "a2a_workflow_event_rejected",
          task_id: workflowRunId,
          event_id: event?.event_id || null,
          kind: event?.kind || null,
          error_name: String(error?.name || "Error").slice(0, 80),
          error_message: String(error?.message || "A2A_EVENT_REJECTED").slice(0, 300),
        }));
        state = recordRejectedTaskEvent(state, event, error);
      }
      await emitTaskState(state);
      if (isTerminalTask(state)) break;
    }
    await closeTaskState();
    return state;
  } finally {
    inbox.dispose();
    reservation.dispose();
  }
}

export async function a2aTaskIndexWorkflow() {
  "use workflow";

  let entries = [];
  const inbox = createHook({ token: TASK_INDEX_HOOK_TOKEN });
  try {
    const conflict = await inbox.getConflict();
    if (conflict) return { deduped_to: conflict.runId };
    await emitTaskIndex(entries);
    for await (const event of inbox) {
      entries = applyTaskIndexEvent(entries, event);
      await emitTaskIndex(entries);
    }
  } finally {
    inbox.dispose();
  }
}
