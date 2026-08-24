import {
  createCostCounters,
  isFailedExecutorReport,
  parseDecision,
  parseExecutorReport,
} from "./model.js";
import { reviewEvidence } from "./reviewer.js";
import { evaluateStopLoss } from "./stop-loss.js";

const TERMINAL = new Set(["completed", "failed", "stopped"]);
const DECISIONS = new Set([
  "CONTINUE",
  "CHANGE_PATH",
  "STOP",
  "ROLLBACK",
  "ASK_OWNER",
]);
const EVENT_HISTORY_LIMIT = 128;

function iso(value = Date.now()) {
  return new Date(value).toISOString();
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

function canonicalStoredCost(cost = {}) {
  return createCostCounters({
    execution_count: safeNumber(cost.execution_count ?? cost.executions),
    failure_count: safeNumber(cost.failure_count ?? cost.failures),
    same_root_cause_repeat_count: safeNumber(
      cost.same_root_cause_repeat_count ?? cost.same_root_cause_repeats,
    ),
    real_world_test_count: safeNumber(cost.real_world_test_count ?? cost.real_world_tests),
    agent_call_count: safeNumber(cost.agent_call_count ?? cost.agent_calls),
    estimated_tokens: safeNumber(cost.estimated_tokens),
    external_api_call_count: safeNumber(
      cost.external_api_call_count ?? cost.external_api_calls,
    ),
    deployment_count: safeNumber(cost.deployment_count ?? cost.deployments),
  });
}

function mergeCost(cost, reportCost = {}, report = {}) {
  const current = canonicalStoredCost(cost);
  const executionDelta = Math.max(1, safeNumber(reportCost.execution_count));
  const agentCallDelta = Math.max(1, safeNumber(reportCost.agent_call_count));
  return {
    execution_count: current.execution_count + executionDelta,
    failure_count: current.failure_count + (isFailedExecutorReport(report) ? 1 : 0),
    same_root_cause_repeat_count: current.same_root_cause_repeat_count,
    real_world_test_count:
      current.real_world_test_count +
      (report.real_world_test && Object.keys(report.real_world_test).length > 0
        ? 1
        : 0),
    agent_call_count: current.agent_call_count + agentCallDelta,
    estimated_tokens:
      current.estimated_tokens +
      safeNumber(reportCost.estimated_tokens),
    external_api_call_count:
      current.external_api_call_count +
      safeNumber(reportCost.external_api_call_count),
    deployment_count: current.deployment_count +
      safeNumber(reportCost.deployment_count),
  };
}

function normalizeRootCause(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 256);
}

function countTrailingRootCause(attempts, rootCause) {
  let count = 0;
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (normalizeRootCause(attempts[index]?.root_cause) !== rootCause) break;
    count += 1;
  }
  return count;
}

function rememberEvent(task, eventId) {
  return [...(task.processed_event_ids || []), eventId].slice(-EVENT_HISTORY_LIMIT);
}

function rememberReceipt(task, event, applied, code, version) {
  return [...(task.event_receipts || []), {
    event_id: event.event_id,
    kind: event.kind,
    applied,
    ...(code ? { code } : {}),
    at: event.at,
    version,
  }].slice(-EVENT_HISTORY_LIMIT);
}

function changed(task, event, patch) {
  const version = safeNumber(task.version) + 1;
  return {
    ...task,
    ...patch,
    version,
    updated_at: event.at,
    processed_event_ids: rememberEvent(task, event.event_id),
    event_receipts: rememberReceipt(task, event, true, null, version),
  };
}

export function recordRejectedTaskEvent(task, event, error) {
  const candidate = String(error?.message || "A2A_EVENT_REJECTED");
  const code = /^[A-Z0-9_]{3,128}$/u.test(candidate)
    ? candidate
    : "A2A_EVENT_REJECTED";
  const version = safeNumber(task.version) + 1;
  return {
    ...task,
    version,
    updated_at: event?.at || task.updated_at,
    processed_event_ids: event?.event_id
      ? rememberEvent(task, event.event_id)
      : task.processed_event_ids,
    event_receipts: event?.event_id
      ? rememberReceipt(task, event, false, code, version)
      : task.event_receipts,
    last_rejected_event: {
      event_id: event?.event_id || null,
      kind: event?.kind || null,
      code,
      at: event?.at || task.updated_at,
    },
  };
}

function assertWorker(task, event) {
  if (!task.worker || task.worker.worker_id !== event.worker_id) {
    throw new Error("A2A_WORKER_LEASE_MISMATCH");
  }
}

export function createInitialTask(input, taskId, now = Date.now()) {
  const timestamp = iso(now);
  return {
    task_id: taskId,
    request_id: input.request_id || null,
    context_id: input.context_id || null,
    goal: input.owner_goal || input.goal,
    owner_goal: input.owner_goal || input.goal,
    execution_goal: input.execution_goal || input.current_goal || input.goal,
    current_goal: input.current_goal || input.execution_goal || input.goal,
    acceptance_criteria: input.acceptance_criteria,
    constraints: input.constraints,
    budget: input.budget,
    stop_conditions: input.stop_conditions,
    allowed_actions: input.allowed_actions,
    forbidden_actions: input.forbidden_actions,
    workspace_id: input.workspace_id,
    sample: input.sample || null,
    status: "submitted",
    current_stage: "executor",
    attempts: [],
    evidence: [],
    blockers: [],
    decisions: [],
    next_decision_required: false,
    worker: null,
    result: null,
    review: null,
    stop_loss: {
      triggered: false,
      action: null,
      rules: [],
      current_path_priority: "normal",
    },
    path_review: null,
    path_attempt_start: 0,
    path_version: 0,
    cost: createCostCounters(),
    version: 1,
    created_at: timestamp,
    updated_at: timestamp,
    processed_event_ids: [],
    event_receipts: [],
    last_rejected_event: null,
  };
}

export function reduceTaskEvent(task, event) {
  if (!event || !event.event_id || !event.kind || !event.at) {
    throw new Error("A2A_EVENT_INVALID");
  }
  if (task.processed_event_ids?.includes(event.event_id)) return task;
  if (TERMINAL.has(task.status)) throw new Error("A2A_TASK_TERMINAL");

  if (event.kind === "CLAIM") {
    const leaseExpired =
      task.worker?.lease_expires_at &&
      Date.parse(task.worker.lease_expires_at) <= Date.parse(event.at);
    const claimable = task.status === "submitted" ||
      (task.status === "running" && task.worker && leaseExpired);
    if (!claimable || (task.worker && !leaseExpired)) {
      throw new Error("A2A_TASK_NOT_CLAIMABLE");
    }
    return changed(task, event, {
      status: "running",
      current_stage: task.current_stage,
      worker: {
        worker_id: event.worker_id,
        workspace_id: event.workspace_id,
        claimed_at: event.at,
        last_heartbeat_at: event.at,
        lease_expires_at: iso(Date.parse(event.at) + 60_000),
      },
    });
  }

  if (event.kind === "HEARTBEAT") {
    assertWorker(task, event);
    if (task.status !== "running") throw new Error("A2A_TASK_NOT_RUNNING");
    return changed(task, event, {
      current_stage: event.payload?.stage || task.current_stage,
      worker: {
        ...task.worker,
        last_heartbeat_at: event.at,
        lease_expires_at: iso(Date.parse(event.at) + 60_000),
      },
    });
  }

  if (event.kind === "REPORT") {
    assertWorker(task, event);
    if (task.status !== "running") throw new Error("A2A_TASK_NOT_RUNNING");
    const report = parseExecutorReport(event.payload, { taskId: task.task_id });
    const attempt = {
      attempt_id: event.event_id,
      at: event.at,
      action: report.action,
      result: report.result,
      status: report.status,
      root_cause: report.root_cause || "unknown",
      commit_sha: report.commit_sha || null,
      complexity: report.complexity || null,
      real_world_test: report.real_world_test || {},
      evidence: report.evidence || [],
      cost: report.cost || {},
      alternatives: report.alternatives || [],
    };
    const attempts = [...task.attempts, attempt];
    const currentPathAttempts = attempts.slice(task.path_attempt_start || 0);
    const review = reviewEvidence(task, report);
    const stopLoss = evaluateStopLoss(currentPathAttempts, {
      task_id: task.task_id,
      acceptance_criteria: task.acceptance_criteria,
      budget: task.budget,
      owner_goal_pass: review.owner_goal_pass,
    });
    const normalizedRootCause = isFailedExecutorReport(report) && report.root_cause
      ? normalizeRootCause(report.root_cause)
      : null;
    const repeats = normalizedRootCause
      ? countTrailingRootCause(attempts, normalizedRootCause)
      : 0;
    const blockers = report.blockers || [];
    const completedPathReview = task.path_review?.status === "researching"
      ? {
        ...task.path_review,
        status: "reviewed",
        reviewed_at: event.at,
        research_attempt_id: event.event_id,
      }
      : task.path_review;
    const mergedCost = mergeCost(task.cost, report.cost, report);
    return changed(task, event, {
      status: review.owner_goal_pass ? "completed" : "review_required",
      current_stage: review.owner_goal_pass ? "completed" : "decision",
      attempts,
      evidence: [...task.evidence, ...(report.evidence || [])].slice(-256),
      blockers,
      result: report,
      next_decision_required: !review.owner_goal_pass,
      worker: null,
      review,
      stop_loss: stopLoss,
      path_review: completedPathReview,
      cost: {
        ...mergedCost,
        same_root_cause_repeat_count:
          mergedCost.same_root_cause_repeat_count + (repeats >= 2 ? 1 : 0),
      },
    });
  }

  if (event.kind === "DECISION") {
    if (!task.next_decision_required && task.status !== "blocked") {
      throw new Error("A2A_DECISION_NOT_REQUIRED");
    }
    if (event.expected_version != null && event.expected_version !== task.version) {
      throw new Error("A2A_DECISION_VERSION_CONFLICT");
    }
    const decision = parseDecision(event.payload, { taskId: task.task_id });
    if (!DECISIONS.has(decision.decision)) throw new Error("A2A_DECISION_INVALID");
    const rules = task.stop_loss?.rules || [];
    const forcedPathReview = task.stop_loss?.same_fix_prohibited === true ||
      rules.some((rule) => [
        "RULE_2_BLIND_TEST_NO_IMPROVEMENT",
        "RULE_4_SIMPLER_ROUTE",
      ].includes(rule.rule));
    if (forcedPathReview && decision.decision === "CONTINUE") {
      throw new Error("A2A_STOP_LOSS_PATH_CHANGE_REQUIRED");
    }
    if (
      decision.decision === "CHANGE_PATH" &&
      decision.next_goal.trim().toLowerCase() ===
        (task.current_goal || task.execution_goal || task.goal).trim().toLowerCase()
    ) {
      throw new Error("A2A_CHANGE_PATH_MUST_CHANGE_GOAL");
    }
    const budgetProhibitsExecution = rules.some(
      (rule) => rule.rule === "BUDGET_LIMIT_REACHED" && rule.prohibit_new_execution,
    );
    if (budgetProhibitsExecution && !["STOP", "ASK_OWNER"].includes(decision.decision)) {
      throw new Error("A2A_BUDGET_REQUIRES_STOP_OR_OWNER");
    }
    const decisions = [
      ...task.decisions,
      { ...decision, decision_id: event.event_id, at: event.at },
    ];

    if (decision.decision === "STOP") {
      return changed(task, event, {
        status: "stopped",
        current_stage: "stopped",
        decisions,
        next_decision_required: false,
      });
    }
    if (decision.decision === "ASK_OWNER") {
      return changed(task, event, {
        status: "blocked",
        current_stage: "owner_input",
        decisions,
        blockers: [...task.blockers, decision.reason].slice(-64),
        next_decision_required: true,
      });
    }

    const routeReviewCompleted = task.path_review?.status === "reviewed";
    const requiresResearch = decision.decision === "CHANGE_PATH"
      && forcedPathReview
      && !routeReviewCompleted;
    const activatesNewPath = decision.decision === "CHANGE_PATH"
      && (!forcedPathReview || routeReviewCompleted);
    const nextExecutionGoal = decision.decision === "CHANGE_PATH"
      ? decision.next_goal
      : (task.current_goal || task.execution_goal || task.goal);
    return changed(task, event, {
      status: "submitted",
      current_stage: decision.decision === "ROLLBACK"
        ? "rollback_executor"
        : requiresResearch
          ? "research"
          : "executor",
      decisions,
      constraints: [
        ...task.constraints,
        ...(decision.constraints_update || []),
      ].slice(-128),
      goal: task.owner_goal || task.goal,
      owner_goal: task.owner_goal || task.goal,
      execution_goal: nextExecutionGoal,
      current_goal: nextExecutionGoal,
      path_review: requiresResearch
        ? {
          status: "researching",
          triggered_rules: rules.map((rule) => rule.rule),
          requested_at: event.at,
        }
        : activatesNewPath
          ? null
          : task.path_review,
      path_attempt_start: activatesNewPath ? task.attempts.length : task.path_attempt_start,
      path_version: activatesNewPath
        ? safeNumber(task.path_version) + 1
        : safeNumber(task.path_version),
      stop_loss: activatesNewPath
        ? {
          triggered: false,
          action: null,
          rules: [],
          current_path_priority: "normal",
        }
        : task.stop_loss,
      next_decision_required: false,
      worker: null,
      review: decision.review || task.review,
    });
  }

  if (event.kind === "STOP") {
    return changed(task, event, {
      status: "stopped",
      current_stage: "stopped",
      next_decision_required: false,
      worker: null,
      blockers: event.payload?.reason
        ? [...task.blockers, event.payload.reason].slice(-64)
        : task.blockers,
    });
  }

  throw new Error("A2A_EVENT_KIND_UNSUPPORTED");
}

export function isTerminalTask(task) {
  return TERMINAL.has(task?.status);
}
