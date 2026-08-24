import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

import {
  addCostCounters,
  createCostCounters,
  isTerminalStatus,
  parseDecision,
  parseExecutorReport,
  parseTaskInput
} from "../src/a2a/model.js";

const NOW = "2026-08-24T00:00:00.000Z";

test("parseTaskInput creates a bounded, explicit task state", () => {
  const task = parseTaskInput({
    goal: "Read an unknown public Douyin video",
    acceptance_criteria: ["A live transcript is returned"],
    constraints: ["Do not use login cookies"],
    budget: { max_executions: 4, max_estimated_tokens: 50_000 },
    stop_conditions: ["Two identical root-cause failures"],
    allowed_actions: ["Run tests"],
    forbidden_actions: ["Force push"]
  }, {
    now: NOW,
    idFactory: () => "task_test_1"
  });

  assert.equal(task.task_id, "task_test_1");
  assert.equal(task.owner_goal, "Read an unknown public Douyin video");
  assert.equal(task.execution_goal, "Read an unknown public Douyin video");
  assert.equal(task.current_goal, "Read an unknown public Douyin video");
  assert.equal(task.status, "submitted");
  assert.equal(task.current_stage, "planning");
  assert.equal(task.created_at, NOW);
  assert.deepEqual(task.attempts, []);
  assert.deepEqual(task.budget, {
    max_executions: 4,
    max_estimated_tokens: 50_000
  });
});

test("task control identifiers and blind sample aliases are normalized without open-ended data", () => {
  const task = parseTaskInput({
    request_id: "request_123",
    context_id: "context_123",
    workspace_id: "content-reader",
    goal: "Read a new public sample",
    acceptance_criteria: ["Return timed text"],
    sample: {
      type: "BLIND_SAMPLE",
      url: "https://v.douyin.com/new-sample/",
      author: "Yuan",
      title_prefix: "20多岁"
    }
  }, { idFactory: () => "task_control_1", now: NOW });

  assert.equal(task.request_id, "request_123");
  assert.equal(task.workspace_id, "content-reader");
  assert.deepEqual(task.sample, {
    sample_type: "BLIND_SAMPLE",
    sample_id: null,
    source_url: "https://v.douyin.com/new-sample/",
    author: "Yuan",
    title_prefix: "20多岁",
    description: null
  });
});

test("task input rejects unknown fields, missing acceptance criteria, and oversized values", () => {
  assert.throws(() => parseTaskInput({
    goal: "goal",
    acceptance_criteria: ["criterion"],
    owner_token: "must-not-enter-the-model"
  }), /owner_token is not allowed/);

  assert.throws(() => parseTaskInput({
    goal: "goal",
    acceptance_criteria: []
  }), /requires at least 1/);

  assert.throws(() => parseTaskInput({
    goal: "x".repeat(4_001),
    acceptance_criteria: ["criterion"]
  }), /exceeds the limit/);

  assert.throws(() => parseTaskInput({
    goal: "Owner goal",
    owner_goal: "Rewritten goal",
    acceptance_criteria: ["criterion"]
  }), /must match immutable/);
});

test("parseExecutorReport accepts live blind evidence and records bounded cost", () => {
  const input = validBlindReport();
  input.owner_goal_pass = true;
  input.blockers = ["Independent review required"];
  const report = parseExecutorReport(input);

  assert.equal(report.task_id, "task_test_1");
  assert.equal(report.real_world_test.sample_type, "BLIND_SAMPLE");
  assert.equal(report.real_world_test.origin, "LIVE_RUNTIME");
  assert.equal(report.cost.agent_call_count, 1);
  assert.equal(report.cost.external_api_call_count, 2);
  assert.equal(report.owner_goal_pass, true);
  assert.equal(report.real_world_test.observations.segment_timestamps.length, 2);
  assert.deepEqual(report.blockers, ["Independent review required"]);
});

test("model accepts plain JSON objects deserialized in another JavaScript realm", () => {
  const crossRealmReport = runInNewContext(
    `JSON.parse(${JSON.stringify(JSON.stringify(validBlindReport()))})`
  );
  const report = parseExecutorReport(crossRealmReport);

  assert.equal(report.task_id, "task_test_1");
  assert.equal(report.real_world_test.observations.profile, "CONTENT_READER_TRANSCRIPT");
});

test("structured observations are bounded and cannot carry transcript text", () => {
  const mismatched = validBlindReport();
  mismatched.real_world_test.observations.segment_count = 3;
  assert.throws(() => parseExecutorReport(mismatched), /must match segment_timestamps.length/);

  const transcriptLeak = validBlindReport();
  transcriptLeak.real_world_test.observations.transcript_text = "must not enter control logs";
  assert.throws(() => parseExecutorReport(transcriptLeak), /transcript_text is not allowed/);

  const oversized = validBlindReport();
  oversized.real_world_test.observations.segment_count = 4_097;
  oversized.real_world_test.observations.segment_timestamps = Array.from(
    { length: 4_097 },
    () => ({ start_ms: 0, end_ms: 1 })
  );
  assert.throws(() => parseExecutorReport(oversized), /exceeds the limit of 4096/);
});

test("blind samples reject fixture, snapshot, cache, manual, and hardcoded sources", () => {
  for (const [field, value] of [
    ["cache_hit", true],
    ["used_fixture", true],
    ["used_snapshot", true],
    ["manual_result", true],
    ["hardcoded_result", true]
  ]) {
    const report = validBlindReport();
    report.real_world_test[field] = value;
    assert.throws(() => parseExecutorReport(report), /cannot be true for a blind sample/);
  }

  const fixture = validBlindReport();
  fixture.real_world_test.origin = "TEST_FIXTURE";
  assert.throws(() => parseExecutorReport(fixture), /forbidden blind-test origin/);
});

test("failed reports require a root cause and strict cost counters", () => {
  const report = validBlindReport();
  report.status = "failed";
  assert.throws(() => parseExecutorReport(report), /root_cause is required/);

  report.root_cause = "ASR_RUNTIME_MISSING";
  report.cost.estimated_tokens = -1;
  assert.throws(() => parseExecutorReport(report), /must be between 0/);
});

test("decisions use the closed decision set and CHANGE_PATH requires a next goal", () => {
  const decision = parseDecision({
    task_id: "task_test_1",
    decision: "CONTINUE",
    reason: "The live success rate improved",
    constraints_update: [],
    next_goal: "Run one more blind sample",
    created_at: NOW
  });
  assert.equal(decision.decision, "CONTINUE");

  assert.throws(() => parseDecision({
    task_id: "task_test_1",
    decision: "CHANGE_PATH",
    reason: "Current route is stalled"
  }), /next_goal is required/);

  assert.throws(() => parseDecision({
    task_id: "task_test_1",
    decision: "RETRY_FOREVER",
    reason: "unsafe"
  }), /must be one of/);
});

test("cost counters add safely and terminal states are explicit", () => {
  const total = addCostCounters(
    createCostCounters({ execution_count: 1, estimated_tokens: 200 }),
    createCostCounters({ execution_count: 2, estimated_tokens: 300 })
  );
  assert.equal(total.execution_count, 3);
  assert.equal(total.estimated_tokens, 500);
  assert.equal(isTerminalStatus("completed"), true);
  assert.equal(isTerminalStatus("review_required"), false);
});

function validBlindReport() {
  return {
    report_id: "report_test_1",
    task_id: "task_test_1",
    status: "review_required",
    action: "Run a fresh public video",
    result: "Live runtime returned a transcript",
    evidence: [{
      evidence_id: "ev_live_1",
      type: "REAL_WORLD",
      gate: "REAL_WORLD_PASS",
      outcome: "PASS",
      origin: "LIVE_RUNTIME",
      ref: "https://v.douyin.com/example/",
      summary: "Live request returned non-empty timed text",
      observed_at: NOW,
      sample_type: "BLIND_SAMPLE",
      commit_sha: "abcdef1"
    }],
    real_world_test: {
      sample_type: "BLIND_SAMPLE",
      sample_id: "aweme-unknown-1",
      source_url: "https://v.douyin.com/example/",
      passed: true,
      success_rate: 1,
      observed_at: NOW,
      origin: "LIVE_RUNTIME",
      cache_hit: false,
      used_fixture: false,
      used_snapshot: false,
      manual_result: false,
      hardcoded_result: false,
      evidence_ids: ["ev_live_1"],
      observations: {
        profile: "CONTENT_READER_TRANSCRIPT",
        http_status: 200,
        readable_content_status: "complete",
        transcript_char_count: 80,
        transcript_sha256: "a".repeat(64),
        segment_count: 2,
        segment_timestamps: [
          { start_ms: 0, end_ms: 1_000 },
          { start_ms: 1_000, end_ms: 2_000 }
        ],
        request_url: "https://v.douyin.com/example/",
        response_sample_id: "aweme-unknown-1",
        method: "local_whisper_cpp_base_q5_1",
        response_sha256: "b".repeat(64)
      }
    },
    cost: {
      execution_count: 1,
      real_world_test_count: 1,
      agent_call_count: 1,
      estimated_tokens: 900,
      external_api_call_count: 2
    },
    root_cause: null,
    alternatives: [],
    decision_required: true,
    acceptance_results: [],
    commit_sha: "abcdef1",
    created_at: NOW
  };
}
