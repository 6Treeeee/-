import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseExecutorReport } from "../../src/a2a/model.js";
import { createCodexRunner } from "../lib/codex-runner.mjs";
import { executeTask } from "../index.mjs";

const ZERO_COST = {
  execution_count: 1,
  failure_count: 0,
  same_root_cause_repeat_count: 0,
  real_world_test_count: 1,
  agent_call_count: 1,
  estimated_tokens: 25,
  external_api_call_count: 1,
  deployment_count: 1,
};

function acceptedCompleteReport(taskId) {
  return {
    task_id: taskId,
    status: "completed",
    action: "deploy and run blind acceptance",
    result: "The live blind sample returned complete readable content.",
    evidence: [
      {
        evidence_id: "ev_build",
        type: "BUILD",
        gate: "BUILD_PASS",
        outcome: "PASS",
        origin: "COMMAND_OUTPUT",
        ref: "npm run check",
        summary: "Static checks completed successfully.",
        observed_at: "2026-08-24T00:00:00.000Z",
        commit_sha: null,
        deployment_id: null,
        sample_type: null,
      },
      {
        evidence_id: "ev_test",
        type: "TEST",
        gate: "TEST_PASS",
        outcome: "PASS",
        origin: "TEST_RUN",
        ref: "npm test",
        summary: "The test suite completed successfully.",
        observed_at: "2026-08-24T00:00:01.000Z",
        commit_sha: null,
        deployment_id: null,
        sample_type: null,
      },
      {
        evidence_id: "ev_deploy",
        type: "DEPLOYMENT",
        gate: "DEPLOY_PASS",
        outcome: "PASS",
        origin: "DEPLOYMENT_PLATFORM",
        ref: "https://preview.example.test",
        summary: "The preview deployment reached READY.",
        observed_at: "2026-08-24T00:00:02.000Z",
        commit_sha: null,
        deployment_id: "dpl_contract_test",
        sample_type: null,
      },
      {
        evidence_id: "ev_blind",
        type: "REAL_WORLD",
        gate: "REAL_WORLD_PASS",
        outcome: "PASS",
        origin: "LIVE_RUNTIME",
        ref: "https://v.douyin.com/example/",
        summary: "A newly supplied public video produced a non-empty transcript.",
        observed_at: "2026-08-24T00:00:03.000Z",
        commit_sha: null,
        deployment_id: "dpl_contract_test",
        sample_type: "BLIND_SAMPLE",
      },
    ],
    real_world_test: {
      sample_type: "BLIND_SAMPLE",
      sample_id: "blind-contract",
      source_url: "https://v.douyin.com/example/",
      passed: true,
      success_rate: 1,
      observed_at: "2026-08-24T00:00:03.000Z",
      origin: "LIVE_RUNTIME",
      cache_hit: false,
      used_fixture: false,
      used_snapshot: false,
      manual_result: false,
      hardcoded_result: false,
      evidence_ids: ["ev_blind"],
    },
    cost: ZERO_COST,
    root_cause: null,
    alternatives: [],
    decision_required: false,
    acceptance_results: [{
      criterion_index: 0,
      passed: true,
      evidence_ids: ["ev_blind"],
      note: "Live output satisfies the criterion.",
    }],
    commit_sha: null,
    complexity: {
      lines_of_code: 10,
      dependency_count: 1,
      component_count: 1,
      complexity_score: 1,
    },
    blockers: [],
    owner_goal_pass: true,
  };
}

test("Codex runner output is accepted by the control layer's strict report parser", async () => {
  const taskId = "task_contract";
  const report = acceptedCompleteReport(taskId);
  const runner = createCodexRunner({
    sdkLoader: async () => ({
      Codex: class {
        startThread() {
          return {
            run: async () => ({
              finalResponse: JSON.stringify(report),
              items: [],
              usage: {
                input_tokens: 10,
                cached_input_tokens: 0,
                cache_write_input_tokens: 0,
                output_tokens: 10,
                reasoning_output_tokens: 5,
              },
            }),
          };
        }
      },
    }),
  });
  const output = await runner.run({
    task: { task_id: taskId, acceptance_criteria: ["live transcript"] },
    role: "executor",
    workspacePath: path.resolve("."),
  });
  const parsed = parseExecutorReport(output, { taskId });
  assert.equal(parsed.owner_goal_pass, true);
  assert.equal(parsed.acceptance_results[0].evidence_ids[0], "ev_blind");
});
test("local SDK failures produce a report accepted by the control layer parser", async () => {
  const task = {
    task_id: "task_failure_contract",
    status: "submitted",
    workspace_id: "reader",
    current_stage: "executor",
  };
  let claimed = false;
  let submittedReport;
  await executeTask({
    client: {
      executorEvent: async (_taskId, event) => {
        if (event.kind === "CLAIM") claimed = true;
        if (event.kind === "REPORT") submittedReport = event.payload;
      },
      getTask: async () => ({
        ...task,
        status: claimed ? "running" : "submitted",
        worker: claimed ? { worker_id: "worker-1" } : null,
      }),
    },
    runner: { run: async () => { throw new Error("Bearer do-not-leak"); } },
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
  const parsed = parseExecutorReport(submittedReport, { taskId: task.task_id });
  assert.equal(parsed.status, "failed");
  assert.equal(parsed.cost.failure_count, 1);
  assert.equal(JSON.stringify(parsed).includes("do-not-leak"), false);
});
