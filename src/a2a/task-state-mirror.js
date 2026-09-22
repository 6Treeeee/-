// A one-way projection. This module never imports the reducer or a task writer.
const SCALARS = ["task_id", "thread_id", "status", "codex_status", "current_step",
  "last_result", "last_error", "updated_at", "start_thread_calls", "resume_thread_calls"];
const ARRAYS = ["completed_steps", "remaining_steps", "blockers"];

export function projectTaskState(task, { source, generatedAt = new Date().toISOString() } = {}) {
  if (!task || typeof task !== "object" || Array.isArray(task) || !task.codex_task
      || typeof task.task_id !== "string" || !task.task_id || task.source || task.generated_at) {
    throw new Error("TASK_MIRROR_DURABLE_CODEX_STATE_REQUIRED");
  }
  if (!source || typeof source !== "object" || !source.kind) throw new Error("TASK_MIRROR_SOURCE_REQUIRED");
  return {
    ...Object.fromEntries(SCALARS.map(key => [key, structuredClone(task[key] ?? null)])),
    ...Object.fromEntries(ARRAYS.map(key => [key, structuredClone(task[key] ?? [])])),
    source: { ...structuredClone(source), task_id: task.task_id, version: task.version ?? null },
    generated_at: generatedAt,
  };
}

// Read the raw persisted stream, without getTask's synthetic initialization or
// run-status reconciliation, and without touching the index (which can create a run).
export async function readDurableTaskState(taskId, getRun) {
  if (!/^wrun_[A-Za-z0-9_-]{16,64}$/.test(taskId || "")) throw new Error("TASK_MIRROR_TASK_ID_INVALID");
  const run = getRun(taskId);
  if (!(await run.exists)) throw new Error("TASK_MIRROR_TASK_NOT_FOUND");
  const stream = run.getReadable({ namespace: "task-state" });
  const tail = await stream.getTailIndex();
  if (tail < 0) throw new Error("TASK_MIRROR_STATE_NOT_READY");
  const reader = run.getReadable({ namespace: "task-state", startIndex: tail }).getReader();
  try {
    const { done, value } = await reader.read();
    if (done || !value) throw new Error("TASK_MIRROR_STATE_NOT_READY");
    if (value.task_id !== taskId) throw new Error("TASK_MIRROR_TASK_ID_MISMATCH");
    return { task: value, source: { kind: "workflow-task-state", namespace: "task-state", stream_index: tail } };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
