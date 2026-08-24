import test from "node:test";
import assert from "node:assert/strict";

import { evaluateStopLoss } from "../src/a2a/stop-loss.js";

const NOW = "2026-08-24T00:00:00.000Z";

test("two consecutive failures with one root cause prohibit another mechanical fix", () => {
  const result = evaluateStopLoss([
    report({ reportId: "report_1", status: "failed", rootCause: "LOCAL_ASR_BUSY" }),
    report({ reportId: "report_2", status: "failed", rootCause: " local_asr_busy " })
  ]);

  assert.equal(result.same_fix_prohibited, true);
  assert.equal(result.action, "REVIEW_PATH");
  assert.equal(result.cost.failure_count, 2);
  assert.equal(result.cost.same_root_cause_repeat_count, 1);
  assert.equal(result.triggers[0].rule, "RULE_1_SAME_ROOT_CAUSE");
});

test("two distinct commits without blind-test improvement trigger architecture review", () => {
  const result = evaluateStopLoss([
    report({
      reportId: "report_1",
      commitSha: "aaaaaaa",
      blindRate: 0.5,
      rootCause: "MEDIA_TIMEOUT"
    }),
    report({
      reportId: "report_2",
      commitSha: "bbbbbbb",
      blindRate: 0.5,
      rootCause: "ASR_TIMEOUT"
    })
  ]);

  assert.equal(result.action, "ARCHITECTURE_REVIEW");
  const trigger = result.triggers.find((item) => item.rule === "RULE_2_BLIND_TEST_NO_IMPROVEMENT");
  assert.deepEqual(trigger.commits, ["aaaaaaa", "bbbbbbb"]);
  assert.deepEqual(trigger.success_rates, [0.5, 0.5]);
});

test("increasing complexity without OWNER_GOAL_PASS lowers route priority", () => {
  const result = evaluateStopLoss([
    report({
      reportId: "report_1",
      complexity: { lines_of_code: 100, dependency_count: 2 }
    }),
    report({
      reportId: "report_2",
      complexity: { lines_of_code: 140, dependency_count: 3 }
    })
  ], { owner_goal_pass: false });

  assert.equal(result.path_priority, "LOWERED");
  assert.ok(result.triggers.some((item) => (
    item.rule === "RULE_3_COMPLEXITY_WITHOUT_OWNER_GOAL"
      && item.action === "DEPRIORITIZE_PATH"
  )));
});

test("a simpler route must receive a minimal proof of concept before more investment", () => {
  const result = evaluateStopLoss([
    report({
      reportId: "report_1",
      alternatives: [{
        route_id: "route_direct_media",
        description: "Use the existing direct media path",
        simpler: true,
        estimated_effort: 1,
        current_effort: 5,
        expected_success_rate: 0.8,
        evidence: "Existing code already retrieves media"
      }]
    })
  ]);

  assert.equal(result.minimal_poc_required, true);
  assert.ok(result.triggers.some((item) => (
    item.rule === "RULE_4_SIMPLER_ROUTE" && item.action === "MINIMAL_POC"
  )));
});

test("cost counters expose budget exhaustion rather than silently spending more", () => {
  const result = evaluateStopLoss([
    report({ reportId: "report_1" }),
    report({ reportId: "report_2" })
  ], { budget: { max_executions: 2 } });

  assert.equal(result.cost.execution_count, 2);
  assert.deepEqual(result.budget_breaches, [{
    budget: "max_executions",
    limit: 2,
    observed: 2
  }]);
});

test("an intervening success breaks the same-root-cause failure run", () => {
  const result = evaluateStopLoss([
    report({ reportId: "report_1", status: "failed", rootCause: "ASR_BUSY" }),
    report({ reportId: "report_2", status: "running", rootCause: null }),
    report({ reportId: "report_3", status: "failed", rootCause: "ASR_BUSY" })
  ]);

  assert.equal(result.same_fix_prohibited, false);
  assert.ok(!result.triggers.some((item) => item.rule === "RULE_1_SAME_ROOT_CAUSE"));
});

test("workflow attempt summaries use the same stop-loss contract", () => {
  const summaries = [
    workflowAttempt("event_1", "LOCAL_ASR_BUSY"),
    workflowAttempt("event_2", "LOCAL_ASR_BUSY")
  ];
  const result = evaluateStopLoss(summaries, {
    task_id: "task_workflow",
    budget: { max_executions: 5 },
    owner_goal_pass: false,
    acceptance_criteria: ["Live timed text"]
  });

  assert.equal(result.triggered, true);
  assert.equal(result.rules[0].action, "REVIEW_PATH");
  assert.equal(result.current_path_priority, "normal");
});

function report({
  reportId,
  status = "review_required",
  rootCause = null,
  commitSha = null,
  blindRate = null,
  complexity = null,
  alternatives = []
}) {
  const evidence = [];
  let realWorldTest = null;
  if (blindRate !== null) {
    evidence.push({
      evidence_id: `ev_${reportId}`,
      type: "REAL_WORLD",
      gate: "REAL_WORLD_PASS",
      outcome: blindRate === 1 ? "PASS" : "FAIL",
      origin: "LIVE_RUNTIME",
      summary: "Fresh blind request",
      observed_at: NOW,
      sample_type: "BLIND_SAMPLE",
      commit_sha: commitSha
    });
    realWorldTest = {
      sample_type: "BLIND_SAMPLE",
      sample_id: `sample_${reportId}`,
      passed: blindRate === 1,
      success_rate: blindRate,
      observed_at: NOW,
      origin: "LIVE_RUNTIME",
      evidence_ids: [`ev_${reportId}`]
    };
  }
  return {
    report_id: reportId,
    task_id: "task_stop_loss",
    status,
    action: "Execute bounded attempt",
    result: status === "failed" ? "Attempt failed" : "Attempt needs review",
    evidence,
    real_world_test: realWorldTest,
    cost: { execution_count: 1, estimated_tokens: 100 },
    root_cause: rootCause,
    alternatives,
    decision_required: true,
    acceptance_results: [],
    commit_sha: commitSha,
    complexity,
    created_at: NOW
  };
}

function workflowAttempt(attemptId, rootCause) {
  return {
    attempt_id: attemptId,
    at: NOW,
    action: "Run local ASR",
    result: "Runtime remained busy",
    status: "failed",
    root_cause: rootCause,
    commit_sha: "abcdef1",
    complexity: null,
    real_world_test: {},
    evidence: [],
    cost: { execution_count: 1, failure_count: 1 },
    alternatives: []
  };
}
