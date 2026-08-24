import test from "node:test";
import assert from "node:assert/strict";

import {
  WorkflowControlService,
  eventOutcomeFromTask,
  reconcileTaskWithRunStatus
} from "../src/a2a/control-service.js";
import {
  createInitialTask,
  recordRejectedTaskEvent,
  reduceTaskEvent
} from "../src/a2a/state-machine.js";
import {
  applyTaskIndexEvent,
  findTaskIndexEntry,
  taskRequestToken
} from "../workflows/a2a-control.js";

const NOW = "2026-08-24T00:00:00.000Z";

test("request reservations isolate identical request ids by workspace and principal", () => {
  assert.notEqual(
    taskRequestToken("content-reader", "request_same", "decision_1"),
    taskRequestToken("finance-tree", "request_same", "decision_1")
  );
  assert.notEqual(
    taskRequestToken("content-reader", "request_same", "decision_1"),
    taskRequestToken("content-reader", "request_same", "decision_2")
  );

  let entries = applyTaskIndexEvent([], taskCreated({
    taskId: "task_content",
    workspaceId: "content-reader",
    principalId: "decision_1"
  }));
  entries = applyTaskIndexEvent(entries, taskCreated({
    taskId: "task_finance",
    workspaceId: "finance-tree",
    principalId: "decision_1"
  }));
  entries = applyTaskIndexEvent(entries, taskCreated({
    taskId: "task_other_principal",
    workspaceId: "content-reader",
    principalId: "decision_2"
  }));

  assert.equal(entries.length, 3);
  assert.equal(findTaskIndexEntry(entries, {
    workspace_id: "content-reader",
    request_id: "request_same",
    principal_id: "decision_1"
  }).task_id, "task_content");
  assert.equal(findTaskIndexEntry(entries, {
    workspace_id: "finance-tree",
    request_id: "request_same",
    principal_id: "decision_1"
  }).task_id, "task_finance");

  const afterConflictingWriter = applyTaskIndexEvent(entries, taskCreated({
    taskId: "task_late_conflict",
    workspaceId: "content-reader",
    principalId: "decision_1"
  }));
  assert.deepEqual(afterConflictingWriter, entries);
});

test("per-event receipts preserve concurrent rejection outcomes", () => {
  let state = createInitialTask(taskInput(), "task_receipts", Date.parse(NOW));
  const first = event("event_rejected_1", "DECISION", "2026-08-24T00:00:01.000Z");
  const second = event("event_rejected_2", "DECISION", "2026-08-24T00:00:02.000Z");
  state = recordRejectedTaskEvent(state, first, new Error("A2A_FIRST_REJECTED"));
  state = recordRejectedTaskEvent(state, second, new Error("A2A_SECOND_REJECTED"));

  assert.equal(state.last_rejected_event.event_id, "event_rejected_2");
  assert.deepEqual(eventOutcomeFromTask(state, "event_rejected_1"), {
    applied: false,
    receipt_version: 2,
    rejected_code: "A2A_FIRST_REJECTED"
  });
  assert.deepEqual(eventOutcomeFromTask(state, "event_rejected_2"), {
    applied: false,
    receipt_version: 3,
    rejected_code: "A2A_SECOND_REJECTED"
  });

  const legacy = {
    processed_event_ids: ["event_legacy"],
    last_rejected_event: { event_id: "event_other", code: "A2A_OTHER" }
  };
  assert.deepEqual(eventOutcomeFromTask(legacy, "event_legacy"), {
    applied: null,
    outcome_unknown: true
  });
});

test("event receipts and processed ids remain bounded", () => {
  let state = createInitialTask(taskInput(), "task_bounded", Date.parse(NOW));
  for (let index = 0; index < 140; index += 1) {
    state = recordRejectedTaskEvent(
      state,
      event(`event_${index}`, "HEARTBEAT", new Date(Date.parse(NOW) + index * 1_000).toISOString()),
      new Error("A2A_REJECTED")
    );
  }
  assert.equal(state.event_receipts.length, 128);
  assert.equal(state.processed_event_ids.length, 128);
  assert.equal(state.event_receipts[0].event_id, "event_12");
});

test("owner goal is immutable while CHANGE_PATH updates only the execution goal", () => {
  const initial = createInitialTask(taskInput(), "task_goals", Date.parse(NOW));
  const waiting = {
    ...initial,
    status: "review_required",
    current_stage: "decision",
    next_decision_required: true
  };
  const changed = reduceTaskEvent(waiting, {
    event_id: "decision_change_path_1",
    kind: "DECISION",
    at: "2026-08-24T00:00:01.000Z",
    expected_version: 1,
    payload: {
      decision_id: "decision_change_path_1",
      task_id: "task_goals",
      decision: "CHANGE_PATH",
      reason: "Use a simpler public media route",
      constraints_update: [],
      next_goal: "Prove direct media retrieval before ASR"
    }
  });

  assert.equal(changed.goal, "Return a live transcript for the Owner");
  assert.equal(changed.owner_goal, "Return a live transcript for the Owner");
  assert.equal(changed.execution_goal, "Prove direct media retrieval before ASR");
  assert.equal(changed.current_goal, "Prove direct media retrieval before ASR");
});

test("task cost uses canonical model fields and one shared failure definition", () => {
  let state = createInitialTask(taskInput(), "task_costs", Date.parse(NOW));
  state = reduceTaskEvent(state, {
    event_id: "claim_cost_1",
    kind: "CLAIM",
    at: NOW,
    worker_id: "worker_1",
    workspace_id: "content-reader",
    payload: {}
  });
  state = reduceTaskEvent(state, {
    event_id: "report_cost_1",
    kind: "REPORT",
    at: "2026-08-24T00:00:01.000Z",
    worker_id: "worker_1",
    workspace_id: "content-reader",
    payload: failedBlindReport()
  });

  assert.deepEqual(state.cost, {
    execution_count: 1,
    failure_count: 1,
    same_root_cause_repeat_count: 0,
    real_world_test_count: 1,
    agent_call_count: 1,
    estimated_tokens: 100,
    external_api_call_count: 2,
    deployment_count: 0
  });
  assert.equal(state.stop_loss.cost.failure_count, 1);
  assert.equal("executions" in state.cost, false);
  assert.equal("failures" in state.cost, false);
});

test("stop-loss route review can acknowledge research and return to executor", () => {
  let state = createInitialTask(taskInput(), "task_route_loop", Date.parse(NOW));
  state = applyClaim(state, "claim_route_1", NOW);
  state = reduceTaskEvent(state, {
    event_id: "report_route_1",
    kind: "REPORT",
    at: "2026-08-24T00:00:01.000Z",
    worker_id: "worker_1",
    workspace_id: "content-reader",
    payload: failedBlindReport({
      taskId: "task_route_loop",
      reportId: "report_route_1",
      evidenceId: "ev_route_1"
    })
  });
  state = applyDecision(state, {
    eventId: "decision_continue_1",
    decision: "CONTINUE",
    nextGoal: null,
    reason: "One bounded retry remains justified"
  });
  state = applyClaim(state, "claim_route_2", "2026-08-24T00:00:02.000Z");
  state = reduceTaskEvent(state, {
    event_id: "report_route_2",
    kind: "REPORT",
    at: "2026-08-24T00:00:03.000Z",
    worker_id: "worker_1",
    workspace_id: "content-reader",
    payload: failedBlindReport({
      taskId: "task_route_loop",
      reportId: "report_route_2",
      evidenceId: "ev_route_2",
      alternatives: [{
        route_id: "direct_media",
        description: "Test direct media before ASR",
        simpler: true,
        estimated_effort: 1,
        current_effort: 5,
        expected_success_rate: 0.7,
        evidence: "Media retrieval already exists"
      }]
    })
  });

  assert.equal(state.stop_loss.same_fix_prohibited, true);
  assert.throws(() => applyDecision(state, {
    eventId: "decision_forbidden_continue",
    decision: "CONTINUE",
    nextGoal: null,
    reason: "Mechanical retry"
  }), /A2A_STOP_LOSS_PATH_CHANGE_REQUIRED/);

  state = applyDecision(state, {
    eventId: "decision_research_path",
    decision: "CHANGE_PATH",
    nextGoal: "Research the direct media route",
    reason: "Stop-loss requires a shorter route review"
  });
  assert.equal(state.current_stage, "research");
  assert.equal(state.path_review.status, "researching");
  assert.equal(state.owner_goal, "Return a live transcript for the Owner");

  state = applyClaim(state, "claim_research_1", "2026-08-24T00:00:04.000Z");
  state = reduceTaskEvent(state, {
    event_id: "report_research_1",
    kind: "REPORT",
    at: "2026-08-24T00:00:05.000Z",
    worker_id: "worker_1",
    workspace_id: "content-reader",
    payload: researchReport("task_route_loop")
  });
  assert.equal(state.path_review.status, "reviewed");
  assert.ok(state.stop_loss.rules.some((rule) => rule.rule === "RULE_4_SIMPLER_ROUTE"));

  state = applyDecision(state, {
    eventId: "decision_execute_new_path",
    decision: "CHANGE_PATH",
    nextGoal: "Execute one direct media proof of concept",
    reason: "Research identified the explicit replacement route"
  });
  assert.equal(state.status, "submitted");
  assert.equal(state.current_stage, "executor");
  assert.equal(state.current_goal, "Execute one direct media proof of concept");
  assert.equal(state.owner_goal, "Return a live transcript for the Owner");
  assert.equal(state.path_review, null);
  assert.equal(state.path_attempt_start, 3);
  assert.equal(state.stop_loss.triggered, false);
});

test("getTask reconciles a nonterminal snapshot with failed Workflow run status", async () => {
  let statusReads = 0;
  const service = new WorkflowControlService({
    readLatestImpl: async () => ({
      task_id: "wrun_1234567890abcdef",
      workspace_id: "content-reader",
      status: "running",
      current_stage: "executor",
      blockers: [],
      next_decision_required: false
    }),
    getRunImpl: () => ({
      exists: Promise.resolve(true),
      get status() {
        statusReads += 1;
        return Promise.resolve("failed");
      }
    })
  });

  const task = await service.getTask("wrun_1234567890abcdef");
  assert.equal(statusReads, 1);
  assert.equal(task.status, "failed");
  assert.equal(task.current_stage, "workflow_failed");
  assert.deepEqual(task.blockers, ["A2A_WORKFLOW_RUN_FAILED"]);
});

test("cancelled and inconsistent completed Workflow runs cannot remain running forever", () => {
  const running = {
    task_id: "wrun_1234567890abcdef",
    status: "running",
    current_stage: "executor",
    blockers: []
  };
  assert.equal(reconcileTaskWithRunStatus(running, "cancelled").status, "stopped");
  const completedWithoutTerminalState = reconcileTaskWithRunStatus(running, "completed");
  assert.equal(completedWithoutTerminalState.status, "failed");
  assert.ok(completedWithoutTerminalState.blockers.includes(
    "A2A_WORKFLOW_COMPLETED_WITHOUT_TERMINAL_TASK_STATE"
  ));
});

function taskCreated({ taskId, workspaceId, principalId }) {
  return {
    kind: "TASK_CREATED",
    task_id: taskId,
    request_id: "request_same",
    workspace_id: workspaceId,
    principal_id: principalId,
    created_at: NOW
  };
}

function event(eventId, kind, at) {
  return { event_id: eventId, kind, at };
}

function taskInput() {
  return {
    request_id: "request_consistency",
    workspace_id: "content-reader",
    goal: "Return a live transcript for the Owner",
    owner_goal: "Return a live transcript for the Owner",
    execution_goal: "Return a live transcript for the Owner",
    current_goal: "Return a live transcript for the Owner",
    acceptance_criteria: ["Live timed text is non-empty"],
    constraints: [],
    budget: {
      max_executions: 10,
      max_failures: 10,
      max_real_world_tests: 10,
      max_agent_calls: 10,
      max_estimated_tokens: 100_000,
      max_external_api_calls: 100,
      max_deployments: 10
    },
    stop_conditions: [],
    allowed_actions: [],
    forbidden_actions: [],
    sample: null
  };
}

function failedBlindReport({
  taskId = "task_costs",
  reportId = "report_cost_1",
  evidenceId = "ev_live_failure",
  alternatives = []
} = {}) {
  return {
    report_id: reportId,
    task_id: taskId,
    status: "review_required",
    action: "Run a live blind sample",
    result: "The live media request failed",
    evidence: [{
      evidence_id: evidenceId,
      type: "REAL_WORLD",
      gate: "REAL_WORLD_PASS",
      outcome: "FAIL",
      origin: "LIVE_RUNTIME",
      summary: "Fresh public request failed before transcript completion",
      observed_at: "2026-08-24T00:00:01.000Z",
      sample_type: "BLIND_SAMPLE"
    }],
    real_world_test: {
      sample_type: "BLIND_SAMPLE",
      sample_id: "unknown_sample_1",
      source_url: "https://v.douyin.com/unknown-sample/",
      passed: false,
      success_rate: 0,
      observed_at: "2026-08-24T00:00:01.000Z",
      origin: "LIVE_RUNTIME",
      cache_hit: false,
      used_fixture: false,
      used_snapshot: false,
      manual_result: false,
      hardcoded_result: false,
      evidence_ids: [evidenceId]
    },
    cost: {
      execution_count: 1,
      failure_count: 0,
      same_root_cause_repeat_count: 0,
      real_world_test_count: 1,
      agent_call_count: 1,
      estimated_tokens: 100,
      external_api_call_count: 2,
      deployment_count: 0
    },
    root_cause: "PUBLIC_MEDIA_TIMEOUT",
    alternatives,
    decision_required: true,
    acceptance_results: [{
      criterion_index: 0,
      passed: false,
      evidence_ids: [evidenceId]
    }],
    commit_sha: "abcdef1",
    complexity: null,
    owner_goal_pass: false,
    blockers: [],
    created_at: "2026-08-24T00:00:01.000Z"
  };
}

function applyClaim(state, eventId, at) {
  return reduceTaskEvent(state, {
    event_id: eventId,
    kind: "CLAIM",
    at,
    worker_id: "worker_1",
    workspace_id: "content-reader",
    payload: {}
  });
}

function applyDecision(state, { eventId, decision, nextGoal, reason }) {
  return reduceTaskEvent(state, {
    event_id: eventId,
    kind: "DECISION",
    at: new Date(Date.parse(state.updated_at) + 500).toISOString(),
    expected_version: state.version,
    payload: {
      decision_id: eventId,
      task_id: state.task_id,
      decision,
      reason,
      constraints_update: [],
      next_goal: nextGoal
    }
  });
}

function researchReport(taskId) {
  return {
    report_id: "report_research_1",
    task_id: taskId,
    status: "review_required",
    action: "Compare the direct media route",
    result: "Direct media is the smallest proof of concept",
    evidence: [],
    real_world_test: null,
    cost: {
      execution_count: 1,
      failure_count: 0,
      same_root_cause_repeat_count: 0,
      real_world_test_count: 0,
      agent_call_count: 1,
      estimated_tokens: 50,
      external_api_call_count: 0,
      deployment_count: 0
    },
    root_cause: null,
    alternatives: [],
    decision_required: true,
    acceptance_results: [],
    commit_sha: null,
    complexity: null,
    owner_goal_pass: false,
    blockers: [],
    created_at: "2026-08-24T00:00:05.000Z"
  };
}
