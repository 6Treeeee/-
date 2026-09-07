// Runtime-neutral: this module also executes inside the durable Workflow VM.
export const CODEX_MODEL = "gpt-5.6-terra";
export const CODEX_REASONING = "medium";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATES = new Set(["RUNNING", "BLOCKED_BY_QUOTA", "FAILED", "COMPLETED"]);
const OPERATIONS = new Set(["startThread", "resumeThread"]);

function fail(code) { throw new Error(code); }
function text(value, maximum = 4_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail("TREE_BRAIN_TASK_INPUT_INVALID");
  return value.trim();
}
function known(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail("TREE_BRAIN_TASK_INPUT_INVALID");
}

export function parseCodexTask(value) {
  known(value, ["steps", "read_only"]);
  if (typeof value.read_only !== "boolean" || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 20) fail("TREE_BRAIN_TASK_INPUT_INVALID");
  const ids = new Set();
  const steps = value.steps.map(step => {
    known(step, ["id", "instruction"]);
    if (!ID.test(step.id || "") || ids.has(step.id)) fail("TREE_BRAIN_TASK_STEP_INVALID");
    ids.add(step.id);
    return { id: step.id, instruction: text(step.instruction) };
  });
  return { steps, read_only: value.read_only };
}

export function initialCodexState(spec) {
  const parsed = parseCodexTask(spec);
  return {
    codex_task: parsed, project_id: "6Treeeee/-", repo: "6Treeeee/-",
    branch: "codex/a2a-control-loop", cwd: null,
    model: CODEX_MODEL, reasoning_effort: CODEX_REASONING,
    thread_id: null, codex_status: "RUNNING",
    current_step: parsed.steps[0].id, completed_steps: [], remaining_steps: parsed.steps.map(step => step.id),
    last_result: null, last_error: null, start_thread_calls: 0, resume_thread_calls: 0,
    codex_operations: [], active_codex_operation: null, resume_count: 0,
  };
}

export function parseCodexEvent(kind, value) {
  const keys = kind === "CODEX_CALL" ? ["operation", "thread_id", "cwd", "repo", "branch"]
    : kind === "THREAD_STARTED" ? ["thread_id"]
      : kind === "CODEX_RESULT" ? ["status", "result", "error"] : [];
  known(value, keys);
  if (kind === "CODEX_CALL") {
    if (!OPERATIONS.has(value.operation)) fail("TREE_BRAIN_CODEX_OPERATION_INVALID");
    if (value.operation === "resumeThread" && !ID.test(value.thread_id || "")) fail("TREE_BRAIN_THREAD_ID_REQUIRED");
    if (value.operation === "startThread" && value.thread_id !== null) fail("TREE_BRAIN_THREAD_ID_INVALID");
    if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(text(value.cwd, 2_000))) fail("TREE_BRAIN_CWD_INVALID");
    if (value.repo !== "6Treeeee/-" || value.branch !== "codex/a2a-control-loop") fail("TREE_BRAIN_PROJECT_BINDING_MISMATCH");
  } else if (kind === "THREAD_STARTED") {
    if (!ID.test(value.thread_id || "")) fail("TREE_BRAIN_THREAD_ID_INVALID");
  } else if (kind === "CODEX_RESULT") {
    if (!STATES.has(value.status) || value.status === "RUNNING") fail("TREE_BRAIN_CODEX_STATUS_INVALID");
    if (value.result !== null && (typeof value.result !== "string" || value.result.length > 12_000)) fail("TREE_BRAIN_RESULT_INVALID");
    if (value.error !== null && (typeof value.error !== "string" || value.error.length > 2_000)) fail("TREE_BRAIN_ERROR_INVALID");
    if (value.status === "COMPLETED" && (!value.result?.trim() || value.error !== null)) fail("TREE_BRAIN_RESULT_INVALID");
    if (value.status !== "COMPLETED" && !value.error?.trim()) fail("TREE_BRAIN_ERROR_INVALID");
  } else fail("TREE_BRAIN_CODEX_EVENT_INVALID");
  return { ...value };
}

export function codexEventPatch(task, event) {
  if (!task.codex_task) fail("TREE_BRAIN_NOT_CODEX_TASK");
  if (event.kind === "RESUME") {
    if (event.expected_version !== task.version) fail("TREE_BRAIN_RESUME_VERSION_CONFLICT");
    if (task.codex_status === "COMPLETED") fail("TREE_BRAIN_TASK_COMPLETED");
    if (task.status === "stopped") fail("TREE_BRAIN_TASK_STOPPED");
    if (!task.thread_id) fail("TREE_BRAIN_THREAD_ID_REQUIRED");
    if (task.worker && Date.parse(task.worker.lease_expires_at) > Date.parse(event.at)) fail("TREE_BRAIN_TASK_ACTIVE");
    if (!task.remaining_steps.length) fail("TREE_BRAIN_NO_REMAINING_STEPS");
    return { status: "submitted", codex_status: "RUNNING", current_stage: "executor", current_step: task.remaining_steps[0], worker: null, active_codex_operation: null, resume_count: task.resume_count + 1 };
  }
  if (task.status !== "running" || !task.worker || task.worker.worker_id !== event.worker_id
      || task.worker.workspace_id !== event.workspace_id || Date.parse(task.worker.lease_expires_at) <= Date.parse(event.at)) fail("A2A_WORKER_LEASE_MISMATCH");
  const payload = parseCodexEvent(event.kind, event.payload);
  if (event.kind === "CODEX_CALL") {
    if (task.active_codex_operation) fail("TREE_BRAIN_CODEX_OPERATION_ACTIVE");
    if (payload.operation === "startThread" && (task.thread_id || task.start_thread_calls > 0)) fail("TREE_BRAIN_START_THREAD_PROHIBITED");
    if (payload.operation === "resumeThread" && (!task.thread_id || payload.thread_id !== task.thread_id)) fail("TREE_BRAIN_THREAD_ID_MISMATCH");
    if (task.cwd && task.cwd !== payload.cwd) fail("TREE_BRAIN_PROJECT_BINDING_MISMATCH");
    const operation = { operation_id: event.event_id, operation: payload.operation, thread_id: payload.thread_id, step: task.current_step, at: event.at };
    return { cwd: payload.cwd, active_codex_operation: operation,
      start_thread_calls: task.start_thread_calls + Number(payload.operation === "startThread"),
      resume_thread_calls: task.resume_thread_calls + Number(payload.operation === "resumeThread"),
      codex_operations: [...task.codex_operations, operation].slice(-128) };
  }
  if (event.kind === "THREAD_STARTED") {
    if (!task.active_codex_operation) fail("TREE_BRAIN_CODEX_OPERATION_REQUIRED");
    if (task.thread_id && task.thread_id !== payload.thread_id) fail("TREE_BRAIN_THREAD_ID_MISMATCH");
    return { thread_id: payload.thread_id };
  }
  if (payload.status === "COMPLETED" && (!task.thread_id || !task.active_codex_operation)) fail("TREE_BRAIN_THREAD_ID_REQUIRED");
  const completed = payload.status === "COMPLETED";
  const remaining = completed ? task.remaining_steps.slice(1) : task.remaining_steps;
  const done = completed && remaining.length === 0;
  return {
    status: done ? "completed" : completed ? "submitted" : "blocked",
    codex_status: done ? "COMPLETED" : completed ? "RUNNING" : payload.status,
    current_stage: done ? "completed" : completed ? "executor" : "owner_input",
    current_step: done ? null : remaining[0],
    completed_steps: completed ? [...task.completed_steps, task.current_step] : task.completed_steps,
    remaining_steps: remaining, last_result: completed ? payload.result : task.last_result,
    last_error: payload.error, worker: null, active_codex_operation: null,
    next_decision_required: false,
  };
}
