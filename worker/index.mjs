#!/usr/bin/env node

import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createCodexRunner } from "./lib/codex-runner.mjs";
import { A2AHttpError, SignedA2AClient } from "./lib/signed-client.mjs";
import { createSafeLogger, redact } from "./lib/redact.mjs";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ROLES = new Set(["decision", "planner", "reviewer", "research", "executor"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "cancelled"]);
const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

function boundedInteger(value, fallback, min, max, field) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return candidate;
}

function requireId(value, field) {
  if (!ID_PATTERN.test(value ?? "")) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return value;
}

function requireAuthKeyId(value, field) {
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(value ?? "")) {
    throw new Error(`${field} contains unsupported characters`);
  }
  return value;
}

function normalizeTask(payload) {
  return payload?.task && typeof payload.task === "object" ? payload.task : payload;
}

export function parseArgs(argv) {
  const output = { configPath: "config.json", taskId: null, poll: false, once: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") {
      output.configPath = argv[++index];
      if (!output.configPath) throw new Error("--config requires a path");
    } else if (argument === "--task-id") {
      output.taskId = requireId(argv[++index], "task_id");
    } else if (argument === "--poll") {
      output.poll = true;
    } else if (argument === "--once") {
      output.once = true;
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  if (Boolean(output.taskId) === output.poll) {
    throw new Error("Choose exactly one mode: --task-id <id> or --poll");
  }
  if (output.once && !output.poll) {
    throw new Error("--once is valid only with --poll");
  }
  return output;
}

export async function loadWorkerConfig(configPath, sourceEnv = process.env) {
  const absoluteConfigPath = path.resolve(configPath);
  const raw = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  const workerId = requireId(raw.worker_id, "worker_id");
  const keyId = requireAuthKeyId(raw.key_id, "key_id");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(raw.private_key_env ?? "")) {
    throw new Error("private_key_env must name one environment variable");
  }
  const privateKey = sourceEnv[raw.private_key_env];
  if (!privateKey) {
    throw new Error(`Required environment variable is missing: ${raw.private_key_env}`);
  }
  const hasDecisionKeyId = raw.decision_key_id !== undefined;
  const hasDecisionKeyEnv = raw.decision_private_key_env !== undefined;
  if (hasDecisionKeyId !== hasDecisionKeyEnv) {
    throw new Error("decision_key_id and decision_private_key_env must be configured together");
  }
  let decisionKeyId = null;
  let decisionPrivateKey = null;
  if (hasDecisionKeyId) {
    decisionKeyId = requireAuthKeyId(raw.decision_key_id, "decision_key_id");
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(raw.decision_private_key_env ?? "")) {
      throw new Error("decision_private_key_env must name one environment variable");
    }
    decisionPrivateKey = sourceEnv[raw.decision_private_key_env];
    if (!decisionPrivateKey) {
      throw new Error(`Required environment variable is missing: ${raw.decision_private_key_env}`);
    }
  }
  if (!raw.workspaces || typeof raw.workspaces !== "object" || Array.isArray(raw.workspaces)) {
    throw new Error("workspaces must be a workspace_id to absolute path map");
  }

  const workspaces = {};
  for (const [workspaceId, configuredPath] of Object.entries(raw.workspaces)) {
    requireId(workspaceId, "workspace_id");
    if (typeof configuredPath !== "string" || !path.isAbsolute(configuredPath)) {
      throw new Error(`Workspace ${workspaceId} must map to an absolute path`);
    }
    const canonicalPath = await realpath(configuredPath);
    const details = await stat(canonicalPath);
    if (!details.isDirectory()) {
      throw new Error(`Workspace ${workspaceId} is not a directory`);
    }
    workspaces[workspaceId] = canonicalPath;
  }
  if (Object.keys(workspaces).length === 0) {
    throw new Error("At least one workspace must be configured");
  }
  if (raw.model !== null && raw.model !== undefined && typeof raw.model !== "string") {
    throw new Error("model must be a string or null");
  }
  if (raw.reasoning_effort && !REASONING_EFFORTS.has(raw.reasoning_effort)) {
    throw new Error("reasoning_effort is unsupported");
  }

  return Object.freeze({
    controlUrl: raw.control_url,
    workerId,
    keyId,
    privateKey,
    decisionKeyId,
    decisionPrivateKey,
    workspaces: Object.freeze(workspaces),
    pollIntervalMs: boundedInteger(raw.poll_interval_ms, 5_000, 250, 300_000, "poll_interval_ms"),
    requestTimeoutMs: boundedInteger(raw.request_timeout_ms, 30_000, 1_000, 300_000, "request_timeout_ms"),
    claimTimeoutMs: boundedInteger(raw.claim_timeout_ms, 5_000, 500, 60_000, "claim_timeout_ms"),
    heartbeatIntervalMs: boundedInteger(raw.heartbeat_interval_ms, 15_000, 1_000, 300_000, "heartbeat_interval_ms"),
    executorNetworkAccess: raw.executor_network_access === true,
    researchNetworkAccess: raw.research_network_access !== false,
    model: raw.model || null,
    reasoningEffort: raw.reasoning_effort || undefined,
  });
}

export function resolveAssignment(task) {
  const source = [task?.next_action, task?.assignment, task?.execution_request]
    .find((candidate) => candidate && typeof candidate === "object") ?? {};
  let role = source.role ?? task?.assigned_role ?? task?.role;
  if (!role) {
    const stage = String(task?.current_stage ?? "").toLowerCase();
    if (stage.includes("decision")) role = "decision";
    else if (stage.includes("review")) role = "reviewer";
    else if (stage.includes("research")) role = "research";
    else if (stage.includes("plan")) role = "planner";
    else role = "executor";
  }
  if (!ROLES.has(role)) {
    throw new Error(`Task requested unsupported role: ${role}`);
  }
  return {
    role,
    instruction: source.instruction ?? source.next_goal ?? task?.next_goal ?? null,
    actionId: source.action_id ?? source.id ?? task?.version ?? task?.updated_at ?? "initial",
  };
}

export function resolveWorkspace(config, task) {
  const workspaceId = task?.workspace_id
    ?? task?.next_action?.workspace_id
    ?? task?.assignment?.workspace_id
    ?? task?.execution_request?.workspace_id;
  if (!ID_PATTERN.test(workspaceId ?? "") || !Object.hasOwn(config.workspaces, workspaceId)) {
    throw new Error("Task workspace_id is not present in the local allowlist");
  }
  return { workspaceId, workspacePath: config.workspaces[workspaceId] };
}

function executionFingerprint(task, assignment) {
  return [
    task.task_id,
    task.version ?? "",
    task.updated_at ?? "",
    task.status ?? "",
    assignment.role,
    assignment.actionId,
    task.decisions?.length ?? "",
  ].join(":");
}

function shouldSkipTask(task) {
  if (!task || !ID_PATTERN.test(task.task_id ?? "")) return true;
  if (TERMINAL_STATUSES.has(task.status)) return true;
  if (task.status === "blocked" && task.current_stage === "owner_input") return true;
  const decision = task.decision?.decision ?? task.latest_decision?.decision;
  return decision === "STOP" || decision === "ROLLBACK";
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error("Aborted"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function claimTask({ client, config, task, workspaceId, signal }) {
  try {
    const accepted = await client.executorEvent(task.task_id, {
      kind: "CLAIM",
      workerId: config.workerId,
      workspaceId,
      payload: {},
    });
    if (accepted?.applied === false) return null;
  } catch (error) {
    if (error instanceof A2AHttpError && [409, 412, 423].includes(error.status)) {
      return null;
    }
    throw error;
  }

  const deadline = Date.now() + config.claimTimeoutMs;
  while (Date.now() <= deadline) {
    const current = normalizeTask(await client.getTask(task.task_id));
    if (current?.worker?.worker_id === config.workerId) {
      return current;
    }
    if (current?.worker?.worker_id && current.worker.worker_id !== config.workerId) {
      return null;
    }
    await sleep(Math.min(250, Math.max(1, deadline - Date.now())), signal);
  }
  throw new Error("Task claim was not confirmed before timeout");
}

function failureReport(taskId, assignment, error) {
  const safeError = redact(error);
  return {
    task_id: taskId,
    status: "failed",
    action: assignment?.instruction ?? `${assignment?.role ?? "executor"} run`,
    result: safeError.message ?? "Local Codex execution failed",
    evidence: [],
    real_world_test: null,
    cost: {
      execution_count: 1,
      failure_count: 1,
      same_root_cause_repeat_count: 0,
      real_world_test_count: 0,
      agent_call_count: 1,
      estimated_tokens: 0,
      external_api_call_count: 0,
      deployment_count: 0,
    },
    root_cause: safeError.message ?? "LOCAL_WORKER_FAILURE",
    alternatives: [],
    decision_required: true,
    acceptance_results: [],
    commit_sha: null,
    complexity: null,
    blockers: [],
    owner_goal_pass: false,
  };
}

function startHeartbeat({ client, config, taskId, workspaceId, role, logger, onLeaseState }) {
  let stopped = false;
  let inFlight = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = inFlight.then(async () => {
      await client.executorEvent(taskId, {
        kind: "HEARTBEAT",
        workerId: config.workerId,
        workspaceId,
        payload: { stage: role },
      });
      const current = normalizeTask(await client.getTask(taskId));
      onLeaseState?.(current);
    }).catch((error) => logger.warn("A2A heartbeat failed", error));
  }, config.heartbeatIntervalMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}

export async function executeTask({ client, decisionClient = null, runner, config, task, signal, logger = createSafeLogger() }) {
  task = normalizeTask(task);
  if (shouldSkipTask(task)) return { ran: false, reason: "not_runnable" };
  const assignment = resolveAssignment(task);
  const { workspaceId, workspacePath } = resolveWorkspace(config, task);
  if (assignment.role === "decision") {
    if (!decisionClient) {
      throw new Error("Decision-stage task requires a separately scoped decision key");
    }
    const decision = await runner.run({
      task,
      role: "decision",
      assignment,
      workspacePath,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      executorNetworkAccess: false,
      researchNetworkAccess: false,
      signal,
    });
    const accepted = await decisionClient.sendDecision(task.task_id, decision);
    if (accepted?.applied === false) {
      return {
        ran: false,
        reason: "decision_rejected",
        rejectedCode: accepted.rejected_code ?? null,
        fingerprint: executionFingerprint(task, assignment),
      };
    }
    return { ran: true, decision, fingerprint: executionFingerprint(task, assignment) };
  }
  if (!new Set(["executor", "research"]).has(assignment.role)) {
    return { ran: false, reason: "role_not_dispatched" };
  }
  const claimed = await claimTask({ client, config, task, workspaceId, signal });
  if (!claimed) return { ran: false, reason: "claimed_elsewhere" };
  if (shouldSkipTask(claimed)) return { ran: false, reason: "stopped_after_claim" };

  // A claim may update bookkeeping fields such as current_stage. The signed,
  // pre-claim assignment remains authoritative for this one bounded run.
  const confirmedAssignment = assignment;
  const taskController = new AbortController();
  const runSignal = signal
    ? AbortSignal.any([signal, taskController.signal])
    : taskController.signal;
  let leaseLost = false;
  const stopHeartbeat = startHeartbeat({
    client,
    config,
    taskId: claimed.task_id,
    workspaceId,
    role: confirmedAssignment.role,
    logger,
    onLeaseState: (current) => {
      const stopped = TERMINAL_STATUSES.has(current?.status);
      const currentWorkerId = current?.worker?.worker_id;
      const reassigned = Boolean(currentWorkerId && currentWorkerId !== config.workerId);
      if (stopped || reassigned) {
        leaseLost = true;
        taskController.abort(new Error(stopped ? "Task stopped remotely" : "Task lease was lost"));
      }
    },
  });
  let report;
  try {
    report = await runner.run({
      task: claimed,
      role: confirmedAssignment.role,
      assignment: confirmedAssignment,
      workspacePath,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      executorNetworkAccess: config.executorNetworkAccess,
      researchNetworkAccess: config.researchNetworkAccess,
      signal: runSignal,
    });
  } catch (error) {
    report = failureReport(claimed.task_id, confirmedAssignment, error);
  } finally {
    await stopHeartbeat();
  }
  if (leaseLost || signal?.aborted) {
    return {
      ran: true,
      reason: leaseLost ? "lease_lost_or_stopped" : "worker_shutdown",
      fingerprint: executionFingerprint(claimed, confirmedAssignment),
    };
  }
  const accepted = await client.executorEvent(claimed.task_id, {
    kind: "REPORT",
    workerId: config.workerId,
    workspaceId,
    payload: report,
  });
  if (accepted?.applied === false) {
    return {
      ran: false,
      reason: "report_rejected",
      rejectedCode: accepted.rejected_code ?? null,
      fingerprint: executionFingerprint(claimed, confirmedAssignment),
    };
  }
  return { ran: true, report, fingerprint: executionFingerprint(claimed, confirmedAssignment) };
}

async function pollOnce({ client, decisionClient, runner, config, processed, signal, logger }) {
  for (const workspaceId of Object.keys(config.workspaces)) {
    const tasks = await client.listTasks({ workspaceId });
    for (const rawTask of tasks) {
      const task = normalizeTask(rawTask);
      if (shouldSkipTask(task)) continue;
      let assignment;
      try {
        assignment = resolveAssignment(task);
      } catch (error) {
        logger.warn("Skipping invalid A2A assignment", error);
        continue;
      }
      const fingerprint = executionFingerprint(task, assignment);
      if (processed.has(fingerprint)) continue;
      const result = await executeTask({ client, decisionClient, runner, config, task, signal, logger });
      processed.add(fingerprint);
      if (processed.size > 1_000) {
        processed.delete(processed.values().next().value);
      }
      if (result.ran) return true;
    }
  }
  return false;
}

export async function runWorker({ args, config, client, decisionClient = null, runner, signal, logger = createSafeLogger() }) {
  if (args.taskId) {
    const task = normalizeTask(await client.getTask(args.taskId));
    return executeTask({ client, decisionClient, runner, config, task, signal, logger });
  }

  const processed = new Set();
  do {
    const ran = await pollOnce({ client, decisionClient, runner, config, processed, signal, logger });
    if (args.once) return { ran };
    if (!ran) await sleep(config.pollIntervalMs, signal);
  } while (!signal?.aborted);
  return { ran: false, reason: "aborted" };
}

export async function main(argv = process.argv.slice(2), sourceEnv = process.env) {
  const logger = createSafeLogger();
  const args = parseArgs(argv);
  const config = await loadWorkerConfig(args.configPath, sourceEnv);
  const client = new SignedA2AClient({
    controlUrl: config.controlUrl,
    keyId: config.keyId,
    privateKey: config.privateKey,
    timeoutMs: config.requestTimeoutMs,
  });
  const decisionClient = config.decisionKeyId
    ? new SignedA2AClient({
        controlUrl: config.controlUrl,
        keyId: config.decisionKeyId,
        privateKey: config.decisionPrivateKey,
        timeoutMs: config.requestTimeoutMs,
      })
    : null;
  const runner = createCodexRunner();
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker shutdown requested"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    return await runWorker({
      args,
      config,
      client,
      decisionClient,
      runner,
      signal: controller.signal,
      logger,
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

const isDirectInvocation = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectInvocation) {
  main().catch((error) => {
    createSafeLogger().error("A2A worker stopped", error);
    process.exitCode = 1;
  });
}
