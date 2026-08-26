import test from "node:test";
import assert from "node:assert/strict";

import { reviewEvidence } from "../src/a2a/reviewer.js";
import { createInitialTask, reduceTaskEvent } from "../src/a2a/state-machine.js";

const NOW = "2026-08-24T00:00:00.000Z";

test("reviewer distinguishes each gate and independently verifies OWNER_GOAL_PASS", () => {
  const report = completeReport();
  const result = reviewEvidence(task(), report);

  assert.deepEqual(result.gates, {
    BUILD_PASS: true,
    TEST_PASS: true,
    DEPLOY_PASS: true,
    REAL_WORLD_PASS: true,
    OWNER_GOAL_PASS: true
  });
  assert.equal(result.verdict, "OWNER_GOAL_PASS");
  assert.equal(result.executor_completion_accepted, true);
});

test("TEST_PASS alone never becomes OWNER_GOAL_PASS", () => {
  const report = completeReport();
  report.evidence = report.evidence.filter((item) => item.gate === "TEST_PASS");
  report.real_world_test = null;
  report.acceptance_results = [];

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.TEST_PASS, true);
  assert.equal(result.gates.DEPLOY_PASS, false);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.equal(result.gates.OWNER_GOAL_PASS, false);
  assert.equal(result.verdict, "REVIEW_REQUIRED");
  assert.ok(result.reasons.some((item) => item.code === "PREMATURE_COMPLETION_CLAIM"));
});

test("KNOWN_SAMPLE cannot satisfy a required blind test", () => {
  const report = completeReport();
  const realEvidence = report.evidence.find((item) => item.gate === "REAL_WORLD_PASS");
  realEvidence.sample_type = "KNOWN_SAMPLE";
  report.real_world_test.sample_type = "KNOWN_SAMPLE";

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "BLIND_SAMPLE_REQUIRED"));
});

test("live-labelled evidence that admits snapshot or cache use is rejected", () => {
  const report = completeReport();
  const realEvidence = report.evidence.find((item) => item.gate === "REAL_WORLD_PASS");
  realEvidence.summary = "Live endpoint served a cached snapshot result";

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.equal(result.gates.OWNER_GOAL_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "BLIND_EVIDENCE_CONTAMINATED"));
});

test("executor PASS labels cannot hide a non-200 or incomplete Content Reader response", () => {
  const report = completeReport();
  report.real_world_test.observations.http_status = 503;
  report.real_world_test.observations.readable_content_status = "failed";

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.equal(result.gates.OWNER_GOAL_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "LIVE_HTTP_STATUS_NOT_200"));
  assert.ok(result.reasons.some((item) => item.code === "READABLE_CONTENT_INCOMPLETE"));
});

test("Content Reader proof requires substantive hashed text and timed segments", () => {
  const report = completeReport();
  report.real_world_test.observations.transcript_char_count = 0;
  report.real_world_test.observations.transcript_sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  report.real_world_test.observations.response_sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  report.real_world_test.observations.segment_count = 0;
  report.real_world_test.observations.segment_timestamps = [];

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "TRANSCRIPT_NOT_SUBSTANTIVE"));
  assert.ok(result.reasons.some((item) => item.code === "LIVE_RESPONSE_EMPTY"));
  assert.ok(result.reasons.some((item) => item.code === "TRANSCRIPT_SEGMENTS_MISSING"));
  assert.ok(result.reasons.some((item) => item.code === "TRANSCRIPT_TIMESTAMPS_NOT_MONOTONIC"));
});

test("Content Reader timestamps are recomputed instead of trusting a monotonic label", () => {
  const report = completeReport();
  report.real_world_test.observations.segment_timestamps = [
    { start_ms: 2_000, end_ms: 4_000 },
    { start_ms: 1_000, end_ms: 5_000 }
  ];

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.equal(result.blind_test.structured_observations.timestamps_monotonic, false);
  assert.ok(result.reasons.some((item) => item.code === "TRANSCRIPT_TIMESTAMPS_NOT_MONOTONIC"));
});

test("Content Reader observations must bind the response to the tested sample", () => {
  const report = completeReport();
  report.real_world_test.observations.response_sample_id = "different_aweme";
  report.real_world_test.observations.request_url = "https://v.douyin.com/different/";

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.equal(result.blind_test.structured_observations.sample_matches, false);
  assert.ok(result.reasons.some((item) => item.code === "OBSERVED_SAMPLE_ID_MISMATCH"));
  assert.ok(result.reasons.some((item) => item.code === "OBSERVED_SAMPLE_URL_MISMATCH"));
});

test("Content Reader observations reject fixture-like transcript methods", () => {
  const report = completeReport();
  report.real_world_test.observations.method = "manual_snapshot_transcript";

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "FORBIDDEN_TRANSCRIPT_METHOD"));
});

test("an explicit ASR acceptance criterion rejects a public-caption method", () => {
  const input = task();
  input.acceptance_criteria = ["ASR must produce the complete timed transcript"];
  const report = completeReport();
  report.real_world_test.observations.method = "public_caption";

  const result = reviewEvidence(input, report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.equal(result.blind_test.structured_observations.asr_method_required, true);
  assert.equal(result.blind_test.structured_observations.asr_method_verified, false);
  assert.ok(result.reasons.some((item) => item.code === "ASR_METHOD_REQUIRED"));
});

test("an explicit automatic-speech-recognition goal accepts a live Whisper route", () => {
  const input = task();
  input.goal = "通过自动语音识别生成完整文字稿";

  const result = reviewEvidence(input, completeReport());
  assert.equal(result.gates.REAL_WORLD_PASS, true);
  assert.equal(result.blind_test.structured_observations.asr_method_required, true);
  assert.equal(result.blind_test.structured_observations.asr_method_verified, true);
});

test("blind samples reject verified-artifact methods even without an ASR requirement", () => {
  const report = completeReport();
  report.real_world_test.observations.method = "verified_public_artifact";

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "FORBIDDEN_TRANSCRIPT_METHOD"));
});

test("Content Reader tasks cannot complete without structured observations", () => {
  const report = completeReport();
  report.real_world_test.observations = null;

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "STRUCTURED_OBSERVATIONS_MISSING"));
});

test("deployment evidence must come from the deployment platform and include an id", () => {
  const report = completeReport();
  const deployment = report.evidence.find((item) => item.gate === "DEPLOY_PASS");
  deployment.origin = "COMMAND_OUTPUT";
  deployment.deployment_id = null;

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.DEPLOY_PASS, false);
  assert.equal(result.gates.OWNER_GOAL_PASS, false);
});

test("a failed acceptance criterion blocks owner success even after real-world pass", () => {
  const report = completeReport();
  report.acceptance_results[0].passed = false;

  const result = reviewEvidence(task(), report);
  assert.equal(result.gates.REAL_WORLD_PASS, true);
  assert.equal(result.gates.OWNER_GOAL_PASS, false);
  assert.ok(result.reasons.some((item) => item.code === "ACCEPTANCE_CRITERION_FAILED"));
});

test("reviewer accepts a closed workflow task-state shape without trusting its prior review", () => {
  const state = {
    ...task(),
    request_id: "request_review",
    context_id: "context_review",
    workspace_id: "content-reader",
    sample: {
      sample_type: "BLIND_SAMPLE",
      sample_id: "unknown_aweme_1",
      source_url: "https://v.douyin.com/fresh-example/",
      author: "Yuan",
      title_prefix: "20多岁",
      description: null
    },
    attempts: [{ attempt_id: "event_1" }],
    worker: null,
    result: null,
    review: { owner_goal_pass: false },
    stop_loss: { triggered: false },
    cost: { executions: 1 },
    version: 2,
    processed_event_ids: ["event_1"]
  };

  const result = reviewEvidence(state, completeReport());
  assert.equal(result.owner_goal_pass, true);
});

test("REPORT transition completes only after the independent reviewer proves the owner goal", () => {
  const input = task();
  input.workspace_id = "content-reader";
  let state = createInitialTask(input, "task_review", Date.parse(NOW));
  state = reduceTaskEvent(state, {
    event_id: "event_claim_1",
    kind: "CLAIM",
    at: NOW,
    worker_id: "worker_1",
    workspace_id: "content-reader"
  });
  state = reduceTaskEvent(state, {
    event_id: "event_report_1",
    kind: "REPORT",
    at: "2026-08-24T00:00:01.000Z",
    worker_id: "worker_1",
    payload: completeReport()
  });

  assert.equal(state.status, "completed");
  assert.equal(state.current_stage, "completed");
  assert.equal(state.next_decision_required, false);
  assert.equal(state.review.owner_goal_pass, true);
});

test("REPORT transition routes a test-only claim to decision instead of completion", () => {
  const input = task();
  input.workspace_id = "content-reader";
  let state = createInitialTask(input, "task_review", Date.parse(NOW));
  state = reduceTaskEvent(state, {
    event_id: "event_claim_2",
    kind: "CLAIM",
    at: NOW,
    worker_id: "worker_1",
    workspace_id: "content-reader"
  });
  const report = completeReport();
  report.evidence = report.evidence.filter((item) => item.gate === "TEST_PASS");
  report.real_world_test = null;
  report.acceptance_results = [];
  state = reduceTaskEvent(state, {
    event_id: "event_report_2",
    kind: "REPORT",
    at: "2026-08-24T00:00:01.000Z",
    worker_id: "worker_1",
    payload: report
  });

  assert.equal(state.status, "review_required");
  assert.equal(state.current_stage, "decision");
  assert.equal(state.next_decision_required, true);
  assert.equal(state.review.gates.TEST_PASS, true);
  assert.equal(state.review.gates.OWNER_GOAL_PASS, false);
});

test("Level 1 completes only after real execution and a GPT decision changes Codex behavior", () => {
  let state = createInitialTask(controlTask(), "task_level_1", Date.parse(NOW));
  state = reduceTaskEvent(state, {
    event_id: "claim_level_1_phase_1",
    kind: "CLAIM",
    at: "2026-08-24T00:00:01.000Z",
    worker_id: "owner-machine-codex-1",
    workspace_id: "a2a-control"
  });
  state = reduceTaskEvent(state, {
    event_id: "report_level_1_phase_1",
    kind: "REPORT",
    at: "2026-08-24T00:00:02.000Z",
    worker_id: "owner-machine-codex-1",
    payload: controlReport(1)
  });

  assert.equal(state.status, "review_required");
  assert.equal(state.review.control_loop.REAL_EXECUTION_PASS, true);
  assert.equal(state.review.control_loop.DECISION_FEEDBACK_PASS, false);

  state = reduceTaskEvent(state, {
    event_id: "decision_level_1_change_path",
    kind: "DECISION",
    at: "2026-08-24T00:00:03.000Z",
    payload: {
      decision_id: "decision_level_1_change_path",
      task_id: state.task_id,
      decision: "CHANGE_PATH",
      reason: "Use the second explicit artifact action",
      constraints_update: ["Preserve the phase-one artifact"],
      next_goal: "Create a distinct phase-two artifact that references the GPT decision",
      created_at: "2026-08-24T00:00:03.000Z"
    }
  });
  assert.equal(state.current_goal, "Create a distinct phase-two artifact that references the GPT decision");

  state = reduceTaskEvent(state, {
    event_id: "claim_level_1_phase_2",
    kind: "CLAIM",
    at: "2026-08-24T00:00:04.000Z",
    worker_id: "owner-machine-codex-1",
    workspace_id: "a2a-control"
  });
  state = reduceTaskEvent(state, {
    event_id: "report_level_1_phase_2",
    kind: "REPORT",
    at: "2026-08-24T00:00:05.000Z",
    worker_id: "owner-machine-codex-1",
    payload: controlReport(2, "decision_level_1_change_path")
  });

  assert.equal(state.status, "completed");
  assert.equal(state.review.control_loop.REAL_EXECUTION_PASS, true);
  assert.equal(state.review.control_loop.DECISION_FEEDBACK_PASS, true);
  assert.equal(state.review.control_loop.previous_action_id, "phase_1");
  assert.equal(state.review.control_loop.current_action_id, "phase_2");
  assert.equal(state.review.owner_goal_pass, true);
});

function controlTask() {
  return {
    workspace_id: "a2a-control",
    sample: {
      sample_type: "KNOWN_SAMPLE",
      sample_id: "level-1-live-nonce"
    },
    goal: "Prove one real GPT to Codex decision feedback loop",
    acceptance_criteria: [
      "Codex executes a real workspace action and changes it after the GPT decision"
    ],
    constraints: ["Use only isolated low-risk artifacts"],
    budget: { max_executions: 2, max_agent_calls: 2 },
    stop_conditions: ["Stop immediately after Level 1 passes"],
    allowed_actions: ["Create ignored acceptance artifacts"],
    forbidden_actions: ["Modify production data"]
  };
}

function controlReport(phase, decisionId = null) {
  const observedAt = phase === 1
    ? "2026-08-24T00:00:02.000Z"
    : "2026-08-24T00:00:05.000Z";
  const actionId = `phase_${phase}`;
  const liveEvidenceId = `ev_control_${phase}`;
  return {
    report_id: `report_level_1_${phase}`,
    task_id: "task_level_1",
    status: phase === 1 ? "review_required" : "completed",
    action: phase === 1
      ? "Create the phase-one nonce artifact"
      : "Create the post-decision phase-two proof artifact",
    result: `The authenticated executor created and hashed phase ${phase}`,
    evidence: [
      evidenceItem(`ev_build_${phase}`, "BUILD", "BUILD_PASS", "COMMAND_OUTPUT", "Source checks passed"),
      evidenceItem(`ev_test_${phase}`, "TEST", "TEST_PASS", "TEST_RUN", "Automated tests passed"),
      {
        ...evidenceItem(
          `ev_deploy_${phase}`,
          "DEPLOYMENT",
          "DEPLOY_PASS",
          "DEPLOYMENT_PLATFORM",
          "Preview deployment is ready"
        ),
        deployment_id: "dpl_level_1"
      },
      {
        ...evidenceItem(
          liveEvidenceId,
          "REAL_WORLD",
          "REAL_WORLD_PASS",
          "LIVE_RUNTIME",
          `Authenticated executor created phase ${phase} and verified its digest`
        ),
        ref: `C:/workspace/.a2a/phase-${phase}.json`,
        sample_type: "KNOWN_SAMPLE"
      }
    ],
    real_world_test: {
      sample_type: "KNOWN_SAMPLE",
      sample_id: "level-1-live-nonce",
      source_url: null,
      passed: true,
      success_rate: 1,
      observed_at: observedAt,
      origin: "LIVE_RUNTIME",
      evidence_ids: [liveEvidenceId],
      observations: {
        profile: "A2A_CONTROL_EXECUTION",
        action_id: actionId,
        decision_id: decisionId,
        artifact_ref: `C:/workspace/.a2a/phase-${phase}.json`,
        artifact_sha256: (phase === 1 ? "c" : "d").repeat(64),
        artifact_bytes: 128 + phase,
        command_exit_code: 0
      }
    },
    cost: {
      execution_count: 1,
      real_world_test_count: 1,
      agent_call_count: 1,
      estimated_tokens: 100,
      external_api_call_count: 0,
      deployment_count: 0
    },
    root_cause: null,
    alternatives: [],
    decision_required: phase === 1,
    acceptance_results: [{
      criterion_index: 0,
      passed: true,
      evidence_ids: [liveEvidenceId],
      note: `Phase ${phase} live evidence is present`
    }],
    commit_sha: "abcdef1",
    complexity: null,
    owner_goal_pass: phase === 2,
    blockers: [],
    created_at: observedAt
  };
}

function task() {
  return {
    task_id: "task_review",
    workspace_id: "content-reader",
    goal: "Read a fresh public video into timed text",
    acceptance_criteria: ["A non-empty timed transcript comes from live media"],
    constraints: ["No fixture, snapshot, cache, manual transcript, or hardcode"],
    budget: { max_executions: 5 },
    stop_conditions: ["Repeated root cause"],
    allowed_actions: ["Run a public blind test"],
    forbidden_actions: ["Use login credentials"],
    status: "review_required",
    current_stage: "review",
    attempts: [],
    evidence: [],
    blockers: [],
    decisions: [],
    next_decision_required: true,
    created_at: NOW,
    updated_at: NOW
  };
}

function completeReport() {
  const evidence = [
    evidenceItem("ev_build", "BUILD", "BUILD_PASS", "COMMAND_OUTPUT", "Source check passed"),
    evidenceItem("ev_test", "TEST", "TEST_PASS", "TEST_RUN", "All automated tests passed"),
    {
      ...evidenceItem(
        "ev_deploy",
        "DEPLOYMENT",
        "DEPLOY_PASS",
        "DEPLOYMENT_PLATFORM",
        "Preview deployment is ready"
      ),
      deployment_id: "dpl_review_1"
    },
    {
      ...evidenceItem(
        "ev_live",
        "REAL_WORLD",
        "REAL_WORLD_PASS",
        "LIVE_RUNTIME",
        "Fresh public request returned non-empty timed text"
      ),
      ref: "https://v.douyin.com/fresh-example/",
      sample_type: "BLIND_SAMPLE"
    }
  ];
  return {
    report_id: "report_review",
    task_id: "task_review",
    status: "completed",
    action: "Deploy and run a blind public sample",
    result: "All independently reviewable evidence is attached",
    evidence,
    real_world_test: {
      sample_type: "BLIND_SAMPLE",
      sample_id: "unknown_aweme_1",
      source_url: "https://v.douyin.com/fresh-example/",
      passed: true,
      success_rate: 1,
      observed_at: NOW,
      origin: "LIVE_RUNTIME",
      evidence_ids: ["ev_live"],
      observations: contentReaderObservations()
    },
    cost: {
      execution_count: 1,
      real_world_test_count: 1,
      agent_call_count: 2,
      estimated_tokens: 1_500,
      external_api_call_count: 1,
      deployment_count: 1
    },
    root_cause: null,
    alternatives: [],
    decision_required: false,
    acceptance_results: [{
      criterion_index: 0,
      passed: true,
      evidence_ids: ["ev_live"],
      note: "Timed transcript is present"
    }],
    commit_sha: "abcdef1",
    complexity: { lines_of_code: 200, dependency_count: 0 },
    created_at: NOW
  };
}

function contentReaderObservations() {
  return {
    profile: "CONTENT_READER_TRANSCRIPT",
    http_status: 200,
    readable_content_status: "complete",
    transcript_char_count: 96,
    transcript_sha256: "a".repeat(64),
    segment_count: 2,
    segment_timestamps: [
      { start_ms: 0, end_ms: 2_000 },
      { start_ms: 2_000, end_ms: 4_000 }
    ],
    request_url: "https://v.douyin.com/fresh-example/",
    response_sample_id: "unknown_aweme_1",
    method: "local_whisper_cpp_base_q5_1",
    response_sha256: "b".repeat(64)
  };
}

function evidenceItem(evidenceId, type, gate, origin, summary) {
  return {
    evidence_id: evidenceId,
    type,
    gate,
    outcome: "PASS",
    origin,
    summary,
    observed_at: NOW,
    commit_sha: "abcdef1"
  };
}
