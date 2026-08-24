import {
  PASS_STAGES,
  parseExecutorReport,
  parseTaskInput
} from "./model.js";

const LIVE_ORIGINS = new Set(["LIVE_RUNTIME", "LIVE_MEDIA"]);
const BANNED_BLIND_ORIGINS = new Set([
  "TEST_FIXTURE",
  "SNAPSHOT",
  "CACHE",
  "MANUAL",
  "HARDCODE"
]);
const BANNED_BLIND_MARKER = /\b(?:fixture|snapshots?|cached?|manual(?:ly)?|hard[ -]?cod(?:e|ed|ing))\b|固定测试|快照|缓存|人工(?:结果|转录)?|硬编码/iu;
const BANNED_METHOD_MARKER = /(?:^|[^a-z0-9])(?:fixture|snapshots?|cache|cached|manual|artifact|verified[ _-]?artifact|hard[ _-]?cod(?:e|ed|ing))(?:$|[^a-z0-9])/iu;
const ASR_REQUIREMENT_MARKER = /\b(?:asr|automatic[ _-]?speech[ _-]?recognition|speech[ _-]?to[ _-]?text)\b|自动语音识别/iu;
const ASR_METHOD_MARKER = /(?:^|[^a-z0-9])(?:asr|whisper|transcrib(?:e|er|ing|tion)|speech[ _-]?to[ _-]?text)(?:$|[^a-z0-9])/iu;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const MIN_TRANSCRIPT_CHARACTERS = 20;

/**
 * Independently classify the evidence for an executor report. Passing a build,
 * test suite, or deployment never implies that the Owner's goal passed.
 */
export function reviewEvidence(taskInput, reportInput, options = {}) {
  const task = parseReviewerTask(taskInput);
  const report = parseExecutorReport(reportInput, { taskId: task.task_id });
  const policy = parseReviewOptions(options);
  const reasons = [];

  const buildPass = verifyGate(report.evidence, "BUILD_PASS", {
    allowedOrigins: new Set(["COMMAND_OUTPUT", "TEST_RUN", "GIT_REMOTE"]),
    reasons
  });
  const testPass = verifyGate(report.evidence, "TEST_PASS", {
    allowedOrigins: new Set(["TEST_RUN", "COMMAND_OUTPUT"]),
    reasons
  });
  const deployPass = verifyDeployment(report.evidence, reasons);
  const blindReview = inspectBlindTest(report, {
    requireBlindSample: policy.require_blind_sample,
    minimumSuccessRate: policy.minimum_success_rate,
    requiredObservationProfile: task.workspace_id === "content-reader"
      ? "CONTENT_READER_TRANSCRIPT"
      : null,
    requireAsrMethod: taskRequiresAsr(task)
  });
  const sampleReview = verifyExpectedSample(task.sample, report.real_world_test);
  reasons.push(...blindReview.reasons);
  reasons.push(...sampleReview.reasons);
  const realWorldPass = blindReview.valid && sampleReview.matches;
  const criteriaReview = verifyAcceptanceCriteria(task, report);
  reasons.push(...criteriaReview.reasons);

  const ownerGoalPass = buildPass
    && testPass
    && deployPass
    && realWorldPass
    && criteriaReview.all_passed;
  const gates = {
    BUILD_PASS: buildPass,
    TEST_PASS: testPass,
    DEPLOY_PASS: deployPass,
    REAL_WORLD_PASS: realWorldPass,
    OWNER_GOAL_PASS: ownerGoalPass
  };

  const claimedOwnerPass = report.evidence.some((item) => (
    item.gate === "OWNER_GOAL_PASS" && item.outcome === "PASS"
  ));
  if (claimedOwnerPass && !ownerGoalPass) {
    reasons.push({
      code: "UNSUPPORTED_OWNER_GOAL_CLAIM",
      message: "executor OWNER_GOAL_PASS evidence is not accepted without all prerequisite gates"
    });
  }
  if (report.status === "completed" && !ownerGoalPass) {
    reasons.push({
      code: "PREMATURE_COMPLETION_CLAIM",
      message: "executor reported completed before OWNER_GOAL_PASS was independently verified"
    });
  }

  return {
    task_id: task.task_id,
    report_id: report.report_id,
    verdict: ownerGoalPass ? "OWNER_GOAL_PASS" : "REVIEW_REQUIRED",
    highest_verified_stage: highestVerifiedStage(gates),
    gates,
    owner_goal_pass: ownerGoalPass,
    executor_completion_accepted: report.status === "completed" && ownerGoalPass,
    criteria: criteriaReview.results,
    blind_test: { ...blindReview, expected_sample_matches: sampleReview.matches },
    reasons: deduplicateReasons(reasons)
  };
}

function normalizedUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString();
}

function verifyExpectedSample(expected, observed) {
  if (!expected) return { matches: true, reasons: [] };
  const reasons = [];
  if (!observed) {
    return {
      matches: false,
      reasons: [{
        code: "EXPECTED_SAMPLE_NOT_TESTED",
        message: "the task's required sample was not tested"
      }]
    };
  }
  if (expected.sample_type !== observed.sample_type) {
    reasons.push({
      code: "EXPECTED_SAMPLE_TYPE_MISMATCH",
      message: "the reported real-world test uses a different sample type"
    });
  }
  if (expected.sample_id && observed.sample_id !== expected.sample_id) {
    reasons.push({
      code: "EXPECTED_SAMPLE_ID_MISMATCH",
      message: "the reported real-world test uses a different sample id"
    });
  }
  if (expected.source_url && normalizedUrl(observed.source_url) !== normalizedUrl(expected.source_url)) {
    reasons.push({
      code: "EXPECTED_SAMPLE_URL_MISMATCH",
      message: "the reported real-world test uses a different source URL"
    });
  }
  return { matches: reasons.length === 0, reasons };
}

function parseReviewerTask(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("task must be an object");
  }
  const allowed = new Set([
    "request_id",
    "context_id",
    "workspace_id",
    "sample",
    "task_id",
    "goal",
    "owner_goal",
    "execution_goal",
    "current_goal",
    "acceptance_criteria",
    "constraints",
    "budget",
    "stop_conditions",
    "allowed_actions",
    "forbidden_actions",
    "status",
    "current_stage",
    "attempts",
    "evidence",
    "blockers",
    "decisions",
    "next_decision_required",
    "created_at",
    "updated_at",
    "worker",
    "result",
    "review",
    "stop_loss",
    "cost",
    "version",
    "processed_event_ids",
    "event_receipts",
    "path_review",
    "path_attempt_start",
    "path_version",
    "workflow_run_status",
    "last_rejected_event"
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new TypeError(`task.${key} is not allowed`);
  }
  return parseTaskInput({
    request_id: input.request_id ?? null,
    context_id: input.context_id ?? null,
    workspace_id: input.workspace_id ?? null,
    sample: input.sample ?? null,
    task_id: input.task_id,
    goal: input.owner_goal ?? input.goal,
    owner_goal: input.owner_goal ?? input.goal,
    execution_goal: input.execution_goal ?? input.current_goal ?? input.owner_goal ?? input.goal,
    current_goal: input.current_goal ?? input.execution_goal ?? input.owner_goal ?? input.goal,
    acceptance_criteria: input.acceptance_criteria,
    constraints: input.constraints ?? [],
    budget: input.budget ?? {},
    stop_conditions: input.stop_conditions ?? [],
    allowed_actions: input.allowed_actions ?? [],
    forbidden_actions: input.forbidden_actions ?? [],
    status: input.status ?? "review_required",
    current_stage: input.current_stage ?? "reviewer",
    attempts: [],
    evidence: [],
    blockers: input.blockers ?? [],
    decisions: [],
    next_decision_required: input.next_decision_required ?? false,
    created_at: input.created_at,
    updated_at: input.updated_at
  });
}

export function inspectBlindTest(reportInput, options = {}) {
  const report = parseExecutorReport(reportInput);
  const requireBlindSample = options.requireBlindSample ?? true;
  const minimumSuccessRate = options.minimumSuccessRate ?? 1;
  const requiredObservationProfile = options.requiredObservationProfile ?? null;
  const requireAsrMethod = options.requireAsrMethod ?? false;
  if (typeof requireBlindSample !== "boolean") {
    throw new TypeError("requireBlindSample must be a boolean");
  }
  if (typeof minimumSuccessRate !== "number"
    || !Number.isFinite(minimumSuccessRate)
    || minimumSuccessRate < 0
    || minimumSuccessRate > 1) {
    throw new TypeError("minimumSuccessRate must be between 0 and 1");
  }
  if (requiredObservationProfile !== null
    && requiredObservationProfile !== "CONTENT_READER_TRANSCRIPT") {
    throw new TypeError("requiredObservationProfile is not supported");
  }
  if (typeof requireAsrMethod !== "boolean") {
    throw new TypeError("requireAsrMethod must be a boolean");
  }

  const test = report.real_world_test;
  const reasons = [];
  if (test === null) {
    return {
      valid: false,
      sample_type: null,
      live: false,
      uncontaminated: false,
      success_rate: null,
      reasons: [{ code: "REAL_WORLD_TEST_MISSING", message: "no real-world test was reported" }]
    };
  }

  if (requireBlindSample && test.sample_type !== "BLIND_SAMPLE") {
    reasons.push({
      code: "BLIND_SAMPLE_REQUIRED",
      message: "a KNOWN_SAMPLE cannot satisfy the required blind-test gate"
    });
  }
  if (!LIVE_ORIGINS.has(test.origin)) {
    reasons.push({
      code: "NOT_LIVE_EVIDENCE",
      message: `real-world evidence origin ${test.origin} is not a live runtime or live media observation`
    });
  }
  if (BANNED_BLIND_ORIGINS.has(test.origin)) {
    reasons.push({
      code: "BLIND_EVIDENCE_CONTAMINATED",
      message: `forbidden blind-test origin ${test.origin}`
    });
  }

  const contaminationFlags = [
    ["cache_hit", test.cache_hit],
    ["used_fixture", test.used_fixture],
    ["used_snapshot", test.used_snapshot],
    ["manual_result", test.manual_result],
    ["hardcoded_result", test.hardcoded_result]
  ].filter(([, enabled]) => enabled).map(([name]) => name);
  if (contaminationFlags.length > 0) {
    reasons.push({
      code: "BLIND_EVIDENCE_CONTAMINATED",
      message: `blind result uses forbidden source flags: ${contaminationFlags.join(", ")}`
    });
  }
  if (!test.passed || test.success_rate < minimumSuccessRate) {
    reasons.push({
      code: "REAL_WORLD_THRESHOLD_NOT_MET",
      message: `real-world success rate ${test.success_rate} is below ${minimumSuccessRate}`
    });
  }
  if (test.evidence_ids.length === 0) {
    reasons.push({
      code: "REAL_WORLD_EVIDENCE_MISSING",
      message: "real-world test has no linked evidence"
    });
  }

  const evidenceById = new Map(report.evidence.map((item) => [item.evidence_id, item]));
  for (const evidenceId of test.evidence_ids) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      reasons.push({
        code: "REAL_WORLD_EVIDENCE_MISSING",
        message: `linked evidence ${evidenceId} is missing`
      });
      continue;
    }
    if (evidence.gate !== "REAL_WORLD_PASS" || evidence.outcome !== "PASS") {
      reasons.push({
        code: "INVALID_REAL_WORLD_EVIDENCE",
        message: `evidence ${evidenceId} is not a passing REAL_WORLD_PASS observation`
      });
    }
    if (!LIVE_ORIGINS.has(evidence.origin)) {
      reasons.push({
        code: "NOT_LIVE_EVIDENCE",
        message: `evidence ${evidenceId} does not come from live runtime or media`
      });
    }
    if (requireBlindSample && evidence.sample_type !== "BLIND_SAMPLE") {
      reasons.push({
        code: "BLIND_EVIDENCE_SAMPLE_MISMATCH",
        message: `evidence ${evidenceId} is not marked BLIND_SAMPLE`
      });
    }
    if (BANNED_BLIND_ORIGINS.has(evidence.origin)
      || BANNED_BLIND_MARKER.test(evidence.summary)
      || (evidence.ref !== null && BANNED_BLIND_MARKER.test(evidence.ref))) {
      reasons.push({
        code: "BLIND_EVIDENCE_CONTAMINATED",
        message: `evidence ${evidenceId} indicates fixture, snapshot, cache, manual, or hardcoded data`
      });
    }
  }

  const structuredReview = inspectStructuredObservations(
    test,
    requiredObservationProfile,
    requireAsrMethod
  );
  reasons.push(...structuredReview.reasons);

  return {
    valid: reasons.length === 0,
    sample_type: test.sample_type,
    live: LIVE_ORIGINS.has(test.origin),
    uncontaminated: contaminationFlags.length === 0
      && !BANNED_BLIND_ORIGINS.has(test.origin),
    success_rate: test.success_rate,
    structured_observations: structuredReview.summary,
    reasons: deduplicateReasons(reasons)
  };
}

function inspectStructuredObservations(test, requiredProfile, requireAsrMethod) {
  const observations = test.observations;
  const reasons = [];
  if (observations === null) {
    if (requiredProfile !== null) {
      reasons.push({
        code: "STRUCTURED_OBSERVATIONS_MISSING",
        message: `${requiredProfile} requires compact structured runtime observations`
      });
    }
    return {
      summary: {
        required: requiredProfile !== null,
        present: false,
        valid: requiredProfile === null,
        profile: null,
        asr_method_required: requireAsrMethod,
        asr_method_verified: false
      },
      reasons
    };
  }

  if (requiredProfile !== null && observations.profile !== requiredProfile) {
    reasons.push({
      code: "OBSERVATION_PROFILE_MISMATCH",
      message: `expected ${requiredProfile} structured observations`
    });
  }
  if (observations.http_status !== 200) {
    reasons.push({
      code: "LIVE_HTTP_STATUS_NOT_200",
      message: `live endpoint returned HTTP ${observations.http_status}`
    });
  }
  if (observations.readable_content_status.toLowerCase() !== "complete") {
    reasons.push({
      code: "READABLE_CONTENT_INCOMPLETE",
      message: "readable_content.status was not complete"
    });
  }
  if (observations.transcript_char_count < MIN_TRANSCRIPT_CHARACTERS
    || observations.transcript_sha256 === EMPTY_SHA256) {
    reasons.push({
      code: "TRANSCRIPT_NOT_SUBSTANTIVE",
      message: `transcript must contain at least ${MIN_TRANSCRIPT_CHARACTERS} characters and a non-empty digest`
    });
  }
  if (observations.response_sha256 === EMPTY_SHA256) {
    reasons.push({
      code: "LIVE_RESPONSE_EMPTY",
      message: "live response digest indicates an empty response body"
    });
  }

  const timestampReview = inspectTimestamps(observations.segment_timestamps);
  reasons.push(...timestampReview.reasons);
  if (observations.segment_count === 0) {
    reasons.push({
      code: "TRANSCRIPT_SEGMENTS_MISSING",
      message: "no transcript segments were observed"
    });
  }
  if (normalizedUrl(observations.request_url) !== normalizedUrl(test.source_url)) {
    reasons.push({
      code: "OBSERVED_SAMPLE_URL_MISMATCH",
      message: "structured observation request URL does not match the tested sample URL"
    });
  }
  if (test.sample_id !== null
    && observations.response_sample_id !== test.sample_id) {
    reasons.push({
      code: "OBSERVED_SAMPLE_ID_MISMATCH",
      message: "structured observation sample id does not match the tested sample id"
    });
  }
  if (BANNED_METHOD_MARKER.test(observations.method)) {
    reasons.push({
      code: "FORBIDDEN_TRANSCRIPT_METHOD",
      message: "transcript method indicates fixture, snapshot, cache, manual, artifact, or hardcoded data"
    });
  }
  const asrMethodVerified = ASR_METHOD_MARKER.test(observations.method);
  if (requireAsrMethod && !asrMethodVerified) {
    reasons.push({
      code: "ASR_METHOD_REQUIRED",
      message: "the task explicitly requires ASR, but the observed method is not an ASR route"
    });
  }

  return {
    summary: {
      required: requiredProfile !== null,
      present: true,
      valid: reasons.length === 0,
      profile: observations.profile,
      http_status: observations.http_status,
      readable_content_status: observations.readable_content_status,
      transcript_char_count: observations.transcript_char_count,
      segment_count: observations.segment_count,
      timestamps_monotonic: timestampReview.monotonic,
      sample_matches: !reasons.some((reason) => (
        reason.code === "OBSERVED_SAMPLE_URL_MISMATCH"
          || reason.code === "OBSERVED_SAMPLE_ID_MISMATCH"
      )),
      method: observations.method,
      asr_method_required: requireAsrMethod,
      asr_method_verified: asrMethodVerified
    },
    reasons
  };
}

function taskRequiresAsr(task) {
  return [task.goal, ...task.acceptance_criteria]
    .some((value) => ASR_REQUIREMENT_MARKER.test(String(value)));
}

function inspectTimestamps(timestamps) {
  const reasons = [];
  let monotonic = timestamps.length > 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    const current = timestamps[index];
    const previous = timestamps[index - 1];
    if (current.end_ms < current.start_ms
      || (previous && (
        current.start_ms < previous.start_ms
          || current.end_ms < previous.end_ms
      ))) {
      monotonic = false;
      break;
    }
  }
  if (timestamps.length > 0
    && timestamps.at(-1).end_ms <= timestamps[0].start_ms) {
    monotonic = false;
  }
  if (!monotonic) {
    reasons.push({
      code: "TRANSCRIPT_TIMESTAMPS_NOT_MONOTONIC",
      message: "transcript timestamps are empty, reversed, or non-monotonic"
    });
  }
  return { monotonic, reasons };
}

function verifyGate(evidence, gate, { allowedOrigins, reasons }) {
  const observations = evidence.filter((item) => item.gate === gate);
  const passing = observations.filter((item) => (
    item.outcome === "PASS" && allowedOrigins.has(item.origin)
  ));
  const failing = observations.filter((item) => item.outcome === "FAIL");
  if (passing.length === 0) {
    reasons.push({
      code: `${gate}_EVIDENCE_MISSING`,
      message: `no acceptable passing evidence for ${gate}`
    });
    return false;
  }
  if (failing.length > 0) {
    reasons.push({
      code: `${gate}_HAS_FAILURE`,
      message: `${gate} contains unresolved failing evidence`
    });
    return false;
  }
  return true;
}

function verifyDeployment(evidence, reasons) {
  const observations = evidence.filter((item) => item.gate === "DEPLOY_PASS");
  const passing = observations.filter((item) => (
    item.outcome === "PASS"
    && item.origin === "DEPLOYMENT_PLATFORM"
    && item.deployment_id !== null
  ));
  const failing = observations.filter((item) => item.outcome === "FAIL");
  if (passing.length === 0) {
    reasons.push({
      code: "DEPLOY_PASS_EVIDENCE_MISSING",
      message: "DEPLOY_PASS requires passing deployment-platform evidence with a deployment id"
    });
    return false;
  }
  if (failing.length > 0) {
    reasons.push({
      code: "DEPLOY_PASS_HAS_FAILURE",
      message: "DEPLOY_PASS contains unresolved failing evidence"
    });
    return false;
  }
  return true;
}

function verifyAcceptanceCriteria(task, report) {
  const reasons = [];
  const byIndex = new Map();
  const evidenceById = new Map(report.evidence.map((item) => [item.evidence_id, item]));
  for (const result of report.acceptance_results) {
    if (result.criterion_index >= task.acceptance_criteria.length) {
      reasons.push({
        code: "UNKNOWN_ACCEPTANCE_CRITERION",
        message: `criterion index ${result.criterion_index} does not exist`
      });
      continue;
    }
    if (byIndex.has(result.criterion_index)) {
      reasons.push({
        code: "DUPLICATE_ACCEPTANCE_RESULT",
        message: `criterion index ${result.criterion_index} was reported more than once`
      });
      continue;
    }
    byIndex.set(result.criterion_index, result);
  }

  const results = task.acceptance_criteria.map((criterion, index) => {
    const result = byIndex.get(index);
    const requiredGate = inferCriterionGate(criterion);
    const linkedEvidence = (result?.evidence_ids ?? [])
      .map((id) => evidenceById.get(id))
      .filter(Boolean);
    const evidencePasses = linkedEvidence.length > 0
      && linkedEvidence.every(
        (item) => item.outcome === "PASS" && item.gate === requiredGate,
      );
    const passed = result?.passed === true && evidencePasses;
    if (result === undefined) {
      reasons.push({
        code: "ACCEPTANCE_RESULT_MISSING",
        message: `no result for acceptance criterion ${index}`
      });
    } else if (result.evidence_ids.length === 0) {
      reasons.push({
        code: "ACCEPTANCE_EVIDENCE_MISSING",
        message: `acceptance criterion ${index} has no linked evidence`
      });
    } else if (!result.passed) {
      reasons.push({
        code: "ACCEPTANCE_CRITERION_FAILED",
        message: `acceptance criterion ${index} did not pass`
      });
    } else if (!evidencePasses) {
      reasons.push({
        code: "ACCEPTANCE_EVIDENCE_NOT_PASSING",
        message: `acceptance criterion ${index} is not linked only to passing gate evidence`
      });
    }
    return {
      criterion_index: index,
      criterion,
      passed,
      required_gate: requiredGate,
      evidence_ids: result?.evidence_ids ?? []
    };
  });
  return {
    all_passed: results.length > 0 && results.every((item) => item.passed),
    results,
    reasons
  };
}

function inferCriterionGate(criterion) {
  const value = String(criterion).toLowerCase();
  if (/\b(?:build|compile|syntax)\b|构建|编译|语法/u.test(value)) return "BUILD_PASS";
  if (/\b(?:unit test|integration test|test suite|security|secret|credential)\b|单元测试|集成测试|测试套件|安全|密钥|凭据/u.test(value)) {
    return "TEST_PASS";
  }
  if (/\b(?:deploy|deployment|preview|production|vercel)\b|部署|预览环境|生产环境/u.test(value)) {
    return "DEPLOY_PASS";
  }
  return "REAL_WORLD_PASS";
}

function highestVerifiedStage(gates) {
  let highest = "NONE";
  for (const stage of PASS_STAGES) {
    if (!gates[stage]) break;
    highest = stage;
  }
  return highest;
}

function parseReviewOptions(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("review options must be an object");
  }
  const allowed = new Set(["require_blind_sample", "minimum_success_rate"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new TypeError(`review options.${key} is not allowed`);
  }
  const requireBlindSample = options.require_blind_sample ?? true;
  const minimumSuccessRate = options.minimum_success_rate ?? 1;
  if (typeof requireBlindSample !== "boolean") {
    throw new TypeError("review options.require_blind_sample must be a boolean");
  }
  if (typeof minimumSuccessRate !== "number"
    || !Number.isFinite(minimumSuccessRate)
    || minimumSuccessRate < 0
    || minimumSuccessRate > 1) {
    throw new TypeError("review options.minimum_success_rate must be between 0 and 1");
  }
  return {
    require_blind_sample: requireBlindSample,
    minimum_success_rate: minimumSuccessRate
  };
}

function deduplicateReasons(reasons) {
  const seen = new Set();
  return reasons.filter((reason) => {
    const key = `${reason.code}\u0000${reason.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const reviewTaskResult = reviewEvidence;
