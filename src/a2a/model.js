export const TASK_STATUSES = Object.freeze([
  "submitted",
  "queued",
  "running",
  "blocked",
  "review_required",
  "completed",
  "failed",
  "stopped"
]);

export const EXECUTOR_STATUSES = Object.freeze([
  "running",
  "blocked",
  "review_required",
  "completed",
  "failed"
]);

export const TERMINAL_TASK_STATUSES = Object.freeze(["completed", "failed", "stopped"]);
export const DECISIONS = Object.freeze([
  "CONTINUE",
  "CHANGE_PATH",
  "STOP",
  "ROLLBACK",
  "ASK_OWNER"
]);
export const PASS_STAGES = Object.freeze([
  "BUILD_PASS",
  "TEST_PASS",
  "DEPLOY_PASS",
  "REAL_WORLD_PASS",
  "OWNER_GOAL_PASS"
]);
export const SAMPLE_TYPES = Object.freeze(["KNOWN_SAMPLE", "BLIND_SAMPLE"]);

export const COST_FIELDS = Object.freeze([
  "execution_count",
  "failure_count",
  "same_root_cause_repeat_count",
  "real_world_test_count",
  "agent_call_count",
  "estimated_tokens",
  "external_api_call_count",
  "deployment_count"
]);

export const MODEL_LIMITS = Object.freeze({
  id: 128,
  goal: 4_000,
  text: 2_000,
  result: 12_000,
  list: 50,
  attempts: 200,
  evidence: 100,
  alternatives: 20,
  evidenceReference: 2_048,
  evidenceSummary: 4_000,
  segmentObservations: 4_096,
  transcriptCharacters: 10_000_000,
  mediaDurationMs: 86_400_000,
  counter: Number.MAX_SAFE_INTEGER,
  tokenBudget: 1_000_000_000
});

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA_PATTERN = /^[a-f0-9]{7,64}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const EVIDENCE_TYPES = new Set([
  "BUILD",
  "TEST",
  "DEPLOYMENT",
  "REAL_WORLD",
  "OWNER_ACCEPTANCE",
  "GIT",
  "RUNTIME_LOG"
]);
const EVIDENCE_OUTCOMES = new Set(["PASS", "FAIL", "INFO"]);
const EVIDENCE_ORIGINS = new Set([
  "LIVE_RUNTIME",
  "LIVE_MEDIA",
  "GIT_REMOTE",
  "DEPLOYMENT_PLATFORM",
  "COMMAND_OUTPUT",
  "TEST_RUN",
  "OWNER_CONFIRMATION",
  "TEST_FIXTURE",
  "SNAPSHOT",
  "CACHE",
  "MANUAL",
  "HARDCODE"
]);
const BLIND_FORBIDDEN_ORIGINS = new Set([
  "TEST_FIXTURE",
  "SNAPSHOT",
  "CACHE",
  "MANUAL",
  "HARDCODE"
]);

function randomModelId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid !== "string") {
    throw new TypeError(`${prefix} id is required in this runtime`);
  }
  return `${prefix}_${uuid}`;
}
const TASK_KEYS = new Set([
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
  "updated_at"
]);
const REPORT_KEYS = new Set([
  "report_id",
  "task_id",
  "status",
  "action",
  "result",
  "evidence",
  "real_world_test",
  "cost",
  "root_cause",
  "alternatives",
  "decision_required",
  "acceptance_results",
  "commit_sha",
  "complexity",
  "owner_goal_pass",
  "blockers",
  "created_at"
]);
const DECISION_KEYS = new Set([
  "decision_id",
  "task_id",
  "decision",
  "reason",
  "constraints_update",
  "next_goal",
  "created_at"
]);

export function isTerminalStatus(status) {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export function parseTaskInput(input, options = {}) {
  const value = assertPlainObject(input, "task");
  assertNoUnknownKeys(value, TASK_KEYS, "task");

  const now = options.now ?? value.created_at ?? new Date().toISOString();
  const taskId = parseId(value.task_id === undefined
    ? (options.idFactory?.() ?? randomModelId("task"))
    : value.task_id, "task.task_id");
  const createdAt = value.created_at === undefined
    ? parseTimestamp(now, "options.now")
    : parseTimestamp(value.created_at, "task.created_at");
  const updatedAt = value.updated_at === undefined
    ? createdAt
    : parseTimestamp(value.updated_at, "task.updated_at");
  const ownerGoal = parseRequiredString(
    value.owner_goal ?? value.goal,
    "task.owner_goal",
    MODEL_LIMITS.goal
  );
  if (value.goal !== undefined
    && parseRequiredString(value.goal, "task.goal", MODEL_LIMITS.goal) !== ownerGoal) {
    throw new TypeError("task.goal must match immutable task.owner_goal");
  }
  const executionGoal = parseRequiredString(
    value.execution_goal ?? value.current_goal ?? ownerGoal,
    "task.execution_goal",
    MODEL_LIMITS.goal
  );
  if (value.current_goal !== undefined
    && parseRequiredString(value.current_goal, "task.current_goal", MODEL_LIMITS.goal) !== executionGoal) {
    throw new TypeError("task.current_goal must match task.execution_goal");
  }

  const task = {
    request_id: value.request_id == null
      ? null
      : parseId(value.request_id, "task.request_id"),
    context_id: value.context_id == null
      ? null
      : parseId(value.context_id, "task.context_id"),
    workspace_id: value.workspace_id == null
      ? null
      : parseId(value.workspace_id, "task.workspace_id"),
    sample: value.sample == null ? null : parseTaskSample(value.sample, "task.sample"),
    task_id: taskId,
    goal: ownerGoal,
    owner_goal: ownerGoal,
    execution_goal: executionGoal,
    current_goal: executionGoal,
    acceptance_criteria: parseStringList(
      value.acceptance_criteria ?? [],
      "task.acceptance_criteria",
      { min: 1, max: MODEL_LIMITS.list }
    ),
    constraints: parseStringList(value.constraints ?? [], "task.constraints"),
    budget: parseBudget(value.budget ?? {}),
    stop_conditions: parseStringList(value.stop_conditions ?? [], "task.stop_conditions"),
    allowed_actions: parseStringList(value.allowed_actions ?? [], "task.allowed_actions"),
    forbidden_actions: parseStringList(value.forbidden_actions ?? [], "task.forbidden_actions"),
    status: parseEnum(value.status ?? "submitted", TASK_STATUSES, "task.status"),
    current_stage: parseRequiredString(value.current_stage ?? "planning", "task.current_stage", 128),
    attempts: parseArray(value.attempts ?? [], "task.attempts", MODEL_LIMITS.attempts)
      .map((report, index) => parseExecutorReport(report, {
        taskId,
        path: `task.attempts[${index}]`
      })),
    evidence: parseArray(value.evidence ?? [], "task.evidence", MODEL_LIMITS.evidence)
      .map((item, index) => parseEvidence(item, index, "task.evidence")),
    blockers: parseStringList(value.blockers ?? [], "task.blockers"),
    decisions: parseArray(value.decisions ?? [], "task.decisions", MODEL_LIMITS.attempts)
      .map((decision, index) => parseDecision(decision, {
        taskId,
        path: `task.decisions[${index}]`
      })),
    next_decision_required: parseBoolean(
      value.next_decision_required ?? false,
      "task.next_decision_required"
    ),
    created_at: createdAt,
    updated_at: updatedAt
  };

  if (Date.parse(task.updated_at) < Date.parse(task.created_at)) {
    throw new TypeError("task.updated_at must not be earlier than task.created_at");
  }
  if (isTerminalStatus(task.status) && task.next_decision_required) {
    throw new TypeError("terminal tasks cannot require another decision");
  }
  return task;
}

export function parseExecutorReport(input, options = {}) {
  const path = options.path ?? "executor_report";
  const value = assertPlainObject(input, path);
  assertNoUnknownKeys(value, REPORT_KEYS, path);

  const taskId = parseId(value.task_id, `${path}.task_id`);
  if (options.taskId !== undefined && taskId !== options.taskId) {
    throw new TypeError(`${path}.task_id does not match its task`);
  }
  const status = parseEnum(value.status, EXECUTOR_STATUSES, `${path}.status`);
  const rootCause = value.root_cause == null
    ? null
    : parseRequiredString(value.root_cause, `${path}.root_cause`, MODEL_LIMITS.text);
  if (status === "failed" && rootCause === null) {
    throw new TypeError(`${path}.root_cause is required when status is failed`);
  }

  const evidence = parseArray(value.evidence ?? [], `${path}.evidence`, MODEL_LIMITS.evidence)
    .map((item, index) => parseEvidence(item, index, `${path}.evidence`));
  const evidenceIds = new Set();
  for (const item of evidence) {
    if (evidenceIds.has(item.evidence_id)) {
      throw new TypeError(`${path}.evidence contains duplicate evidence_id ${item.evidence_id}`);
    }
    evidenceIds.add(item.evidence_id);
  }

  const report = {
    report_id: value.report_id === undefined
      ? randomModelId("report")
      : parseId(value.report_id, `${path}.report_id`),
    task_id: taskId,
    status,
    action: parseRequiredString(value.action, `${path}.action`, MODEL_LIMITS.text),
    result: parseRequiredString(value.result, `${path}.result`, MODEL_LIMITS.result),
    evidence,
    real_world_test: value.real_world_test == null
      ? null
      : parseRealWorldTest(value.real_world_test, `${path}.real_world_test`),
    cost: createCostCounters(value.cost ?? {}, `${path}.cost`),
    root_cause: rootCause,
    alternatives: parseArray(
      value.alternatives ?? [],
      `${path}.alternatives`,
      MODEL_LIMITS.alternatives
    ).map((alternative, index) => parseAlternative(
      alternative,
      index,
      `${path}.alternatives`
    )),
    decision_required: parseBoolean(
      value.decision_required ?? false,
      `${path}.decision_required`
    ),
    acceptance_results: parseArray(
      value.acceptance_results ?? [],
      `${path}.acceptance_results`,
      MODEL_LIMITS.list
    ).map((item, index) => parseAcceptanceResult(
      item,
      index,
      evidenceIds,
      `${path}.acceptance_results`
    )),
    commit_sha: value.commit_sha == null
      ? null
      : parseCommitSha(value.commit_sha, `${path}.commit_sha`),
    complexity: value.complexity == null
      ? null
      : parseComplexity(value.complexity, `${path}.complexity`),
    owner_goal_pass: parseBoolean(value.owner_goal_pass ?? false, `${path}.owner_goal_pass`),
    blockers: parseStringList(value.blockers ?? [], `${path}.blockers`),
    created_at: parseTimestamp(value.created_at ?? new Date().toISOString(), `${path}.created_at`)
  };

  if (report.real_world_test !== null) {
    validateBlindEvidenceConsistency(report.real_world_test, report.evidence, path);
  }
  return report;
}

export function isFailedExecutorReport(report) {
  return report?.status === "failed" || report?.real_world_test?.passed === false;
}

export function parseDecision(input, options = {}) {
  const path = options.path ?? "decision";
  const value = assertPlainObject(input, path);
  assertNoUnknownKeys(value, DECISION_KEYS, path);
  const taskId = parseId(value.task_id, `${path}.task_id`);
  if (options.taskId !== undefined && taskId !== options.taskId) {
    throw new TypeError(`${path}.task_id does not match its task`);
  }

  const decision = parseEnum(value.decision, DECISIONS, `${path}.decision`);
  const nextGoal = value.next_goal == null
    ? null
    : parseRequiredString(value.next_goal, `${path}.next_goal`, MODEL_LIMITS.goal);
  if (decision === "CHANGE_PATH" && nextGoal === null) {
    throw new TypeError(`${path}.next_goal is required for CHANGE_PATH`);
  }

  return {
    decision_id: value.decision_id === undefined
      ? randomModelId("decision")
      : parseId(value.decision_id, `${path}.decision_id`),
    task_id: taskId,
    decision,
    reason: parseRequiredString(value.reason, `${path}.reason`, MODEL_LIMITS.result),
    constraints_update: parseStringList(
      value.constraints_update ?? [],
      `${path}.constraints_update`
    ),
    next_goal: nextGoal,
    created_at: parseTimestamp(value.created_at ?? new Date().toISOString(), `${path}.created_at`)
  };
}

export function createCostCounters(input = {}, path = "cost") {
  const value = assertPlainObject(input, path);
  assertNoUnknownKeys(value, new Set(COST_FIELDS), path);
  return Object.fromEntries(COST_FIELDS.map((field) => [
    field,
    parseCounter(value[field] ?? 0, `${path}.${field}`)
  ]));
}

export function addCostCounters(...costs) {
  const total = createCostCounters();
  costs.forEach((cost, index) => {
    const parsed = createCostCounters(cost, `costs[${index}]`);
    for (const field of COST_FIELDS) {
      const next = total[field] + parsed[field];
      if (!Number.isSafeInteger(next)) {
        throw new RangeError(`cost total for ${field} exceeds the safe integer limit`);
      }
      total[field] = next;
    }
  });
  return total;
}

export function parseEvidence(input, index = 0, parentPath = "evidence") {
  const path = `${parentPath}[${index}]`;
  const value = assertPlainObject(input, path);
  const keys = new Set([
    "evidence_id",
    "type",
    "gate",
    "outcome",
    "origin",
    "ref",
    "summary",
    "observed_at",
    "commit_sha",
    "deployment_id",
    "sample_type"
  ]);
  assertNoUnknownKeys(value, keys, path);

  const gate = value.gate == null
    ? null
    : parseEnum(value.gate, PASS_STAGES, `${path}.gate`);
  const sampleType = value.sample_type == null
    ? null
    : parseEnum(value.sample_type, SAMPLE_TYPES, `${path}.sample_type`);
  const origin = parseEnum(value.origin, EVIDENCE_ORIGINS, `${path}.origin`);
  if (sampleType === "BLIND_SAMPLE" && BLIND_FORBIDDEN_ORIGINS.has(origin)) {
    throw new TypeError(`${path} uses forbidden blind-test origin ${origin}`);
  }

  return {
    evidence_id: value.evidence_id === undefined
      ? `ev_${index + 1}`
      : parseId(value.evidence_id, `${path}.evidence_id`),
    type: parseEnum(value.type, EVIDENCE_TYPES, `${path}.type`),
    gate,
    outcome: parseEnum(value.outcome ?? "INFO", EVIDENCE_OUTCOMES, `${path}.outcome`),
    origin,
    ref: value.ref == null
      ? null
      : parseRequiredString(value.ref, `${path}.ref`, MODEL_LIMITS.evidenceReference),
    summary: parseRequiredString(value.summary, `${path}.summary`, MODEL_LIMITS.evidenceSummary),
    observed_at: parseTimestamp(value.observed_at ?? new Date().toISOString(), `${path}.observed_at`),
    commit_sha: value.commit_sha == null
      ? null
      : parseCommitSha(value.commit_sha, `${path}.commit_sha`),
    deployment_id: value.deployment_id == null
      ? null
      : parseId(value.deployment_id, `${path}.deployment_id`),
    sample_type: sampleType
  };
}

export function parseRealWorldTest(input, path = "real_world_test") {
  const value = assertPlainObject(input, path);
  const keys = new Set([
    "sample_type",
    "sample_id",
    "source_url",
    "passed",
    "success_rate",
    "observed_at",
    "origin",
    "cache_hit",
    "used_fixture",
    "used_snapshot",
    "manual_result",
    "hardcoded_result",
    "evidence_ids",
    "observations"
  ]);
  assertNoUnknownKeys(value, keys, path);

  const sampleType = parseEnum(value.sample_type, SAMPLE_TYPES, `${path}.sample_type`);
  const sampleId = value.sample_id == null
    ? null
    : parseRequiredString(value.sample_id, `${path}.sample_id`, MODEL_LIMITS.text);
  const sourceUrl = value.source_url == null
    ? null
    : parseHttpUrl(value.source_url, `${path}.source_url`);
  if (sampleId === null && sourceUrl === null) {
    throw new TypeError(`${path} requires sample_id or source_url`);
  }

  const result = {
    sample_type: sampleType,
    sample_id: sampleId,
    source_url: sourceUrl,
    passed: parseBoolean(value.passed, `${path}.passed`),
    success_rate: parseRate(value.success_rate, `${path}.success_rate`),
    observed_at: parseTimestamp(value.observed_at ?? new Date().toISOString(), `${path}.observed_at`),
    origin: parseEnum(value.origin, EVIDENCE_ORIGINS, `${path}.origin`),
    cache_hit: parseBoolean(value.cache_hit ?? false, `${path}.cache_hit`),
    used_fixture: parseBoolean(value.used_fixture ?? false, `${path}.used_fixture`),
    used_snapshot: parseBoolean(value.used_snapshot ?? false, `${path}.used_snapshot`),
    manual_result: parseBoolean(value.manual_result ?? false, `${path}.manual_result`),
    hardcoded_result: parseBoolean(value.hardcoded_result ?? false, `${path}.hardcoded_result`),
    evidence_ids: parseStringList(value.evidence_ids ?? [], `${path}.evidence_ids`, {
      max: MODEL_LIMITS.evidence
    }).map((id, index) => parseId(id, `${path}.evidence_ids[${index}]`)),
    observations: value.observations == null
      ? null
      : parseRealWorldObservations(value.observations, `${path}.observations`)
  };

  if (sampleType === "BLIND_SAMPLE") {
    if (BLIND_FORBIDDEN_ORIGINS.has(result.origin)) {
      throw new TypeError(`${path} uses forbidden blind-test origin ${result.origin}`);
    }
    const tainted = [
      "cache_hit",
      "used_fixture",
      "used_snapshot",
      "manual_result",
      "hardcoded_result"
    ].find((field) => result[field]);
    if (tainted) {
      throw new TypeError(`${path}.${tainted} cannot be true for a blind sample`);
    }
  }
  return result;
}

/**
 * Parse compact live observations without retaining a response body or
 * transcript. The profile keeps the envelope replaceable while the first
 * implementation supplies enough primitive facts for Content Reader review.
 */
export function parseRealWorldObservations(input, path = "real_world_test.observations") {
  const value = assertPlainObject(input, path);
  const keys = new Set([
    "profile",
    "http_status",
    "readable_content_status",
    "transcript_char_count",
    "transcript_sha256",
    "segment_count",
    "segment_timestamps",
    "request_url",
    "response_sample_id",
    "method",
    "response_sha256"
  ]);
  assertNoUnknownKeys(value, keys, path);
  const timestamps = parseArray(
    value.segment_timestamps,
    `${path}.segment_timestamps`,
    MODEL_LIMITS.segmentObservations
  ).map((item, index) => parseSegmentTimestamp(item, index, path));
  const segmentCount = parseBoundedInteger(
    value.segment_count,
    `${path}.segment_count`,
    0,
    MODEL_LIMITS.segmentObservations
  );
  if (segmentCount !== timestamps.length) {
    throw new TypeError(`${path}.segment_count must match segment_timestamps.length`);
  }
  return {
    profile: parseEnum(
      value.profile,
      ["CONTENT_READER_TRANSCRIPT"],
      `${path}.profile`
    ),
    http_status: parseBoundedInteger(value.http_status, `${path}.http_status`, 100, 599),
    readable_content_status: parseRequiredString(
      value.readable_content_status,
      `${path}.readable_content_status`,
      64
    ),
    transcript_char_count: parseBoundedInteger(
      value.transcript_char_count,
      `${path}.transcript_char_count`,
      0,
      MODEL_LIMITS.transcriptCharacters
    ),
    transcript_sha256: parseSha256(value.transcript_sha256, `${path}.transcript_sha256`),
    segment_count: segmentCount,
    segment_timestamps: timestamps,
    request_url: parseHttpUrl(value.request_url, `${path}.request_url`),
    response_sample_id: value.response_sample_id == null
      ? null
      : parseRequiredString(value.response_sample_id, `${path}.response_sample_id`, MODEL_LIMITS.text),
    method: parseRequiredString(value.method, `${path}.method`, 128),
    response_sha256: parseSha256(value.response_sha256, `${path}.response_sha256`)
  };
}

function parseSegmentTimestamp(input, index, parentPath) {
  const path = `${parentPath}.segment_timestamps[${index}]`;
  const value = assertPlainObject(input, path);
  assertNoUnknownKeys(value, new Set(["start_ms", "end_ms"]), path);
  return {
    start_ms: parseBoundedInteger(value.start_ms, `${path}.start_ms`, 0, MODEL_LIMITS.mediaDurationMs),
    end_ms: parseBoundedInteger(value.end_ms, `${path}.end_ms`, 0, MODEL_LIMITS.mediaDurationMs)
  };
}

export function validateBlindEvidenceConsistency(realWorldTest, evidence, path = "report") {
  if (realWorldTest.sample_type !== "BLIND_SAMPLE") return;
  const evidenceById = new Map(evidence.map((item) => [item.evidence_id, item]));
  for (const id of realWorldTest.evidence_ids) {
    const item = evidenceById.get(id);
    if (!item) throw new TypeError(`${path}.real_world_test references unknown evidence_id ${id}`);
    if (item.sample_type !== "BLIND_SAMPLE") {
      throw new TypeError(`${path}.evidence ${id} is not marked as BLIND_SAMPLE`);
    }
    if (BLIND_FORBIDDEN_ORIGINS.has(item.origin)) {
      throw new TypeError(`${path}.evidence ${id} uses forbidden blind-test origin`);
    }
  }
}

function parseAcceptanceResult(input, index, evidenceIds, parentPath) {
  const path = `${parentPath}[${index}]`;
  const value = assertPlainObject(input, path);
  assertNoUnknownKeys(value, new Set([
    "criterion_index",
    "passed",
    "evidence_ids",
    "note"
  ]), path);
  const criterionIndex = parseBoundedInteger(
    value.criterion_index,
    `${path}.criterion_index`,
    0,
    MODEL_LIMITS.list - 1
  );
  const referencedEvidence = parseStringList(value.evidence_ids ?? [], `${path}.evidence_ids`, {
    max: MODEL_LIMITS.evidence
  }).map((id, evidenceIndex) => parseId(id, `${path}.evidence_ids[${evidenceIndex}]`));
  for (const id of referencedEvidence) {
    if (!evidenceIds.has(id)) throw new TypeError(`${path} references unknown evidence_id ${id}`);
  }
  return {
    criterion_index: criterionIndex,
    passed: parseBoolean(value.passed, `${path}.passed`),
    evidence_ids: referencedEvidence,
    note: value.note == null
      ? null
      : parseRequiredString(value.note, `${path}.note`, MODEL_LIMITS.evidenceSummary)
  };
}

function parseAlternative(input, index, parentPath) {
  const path = `${parentPath}[${index}]`;
  if (typeof input === "string") {
    return {
      route_id: `alternative_${index + 1}`,
      description: parseRequiredString(input, path, MODEL_LIMITS.text),
      simpler: false,
      estimated_effort: null,
      current_effort: null,
      expected_success_rate: null,
      evidence: null
    };
  }
  const value = assertPlainObject(input, path);
  assertNoUnknownKeys(value, new Set([
    "route_id",
    "description",
    "simpler",
    "estimated_effort",
    "current_effort",
    "expected_success_rate",
    "evidence"
  ]), path);
  return {
    route_id: value.route_id === undefined
      ? `alternative_${index + 1}`
      : parseId(value.route_id, `${path}.route_id`),
    description: parseRequiredString(value.description, `${path}.description`, MODEL_LIMITS.text),
    simpler: parseBoolean(value.simpler ?? false, `${path}.simpler`),
    estimated_effort: value.estimated_effort == null
      ? null
      : parseNonNegativeNumber(value.estimated_effort, `${path}.estimated_effort`),
    current_effort: value.current_effort == null
      ? null
      : parseNonNegativeNumber(value.current_effort, `${path}.current_effort`),
    expected_success_rate: value.expected_success_rate == null
      ? null
      : parseRate(value.expected_success_rate, `${path}.expected_success_rate`),
    evidence: value.evidence == null
      ? null
      : parseRequiredString(value.evidence, `${path}.evidence`, MODEL_LIMITS.evidenceSummary)
  };
}

function parseComplexity(input, path) {
  const value = assertPlainObject(input, path);
  const keys = new Set([
    "lines_of_code",
    "dependency_count",
    "component_count",
    "complexity_score"
  ]);
  assertNoUnknownKeys(value, keys, path);
  if (Object.keys(value).length === 0) throw new TypeError(`${path} must not be empty`);
  const output = {};
  for (const key of keys) {
    output[key] = value[key] == null
      ? null
      : parseNonNegativeNumber(value[key], `${path}.${key}`);
  }
  return output;
}

function parseBudget(input) {
  const path = "task.budget";
  const value = assertPlainObject(input, path);
  const allowed = new Set([
    "max_executions",
    "max_failures",
    "max_real_world_tests",
    "max_agent_calls",
    "max_estimated_tokens",
    "max_external_api_calls",
    "max_deployments"
  ]);
  assertNoUnknownKeys(value, allowed, path);
  const output = {};
  for (const key of allowed) {
    if (value[key] !== undefined) {
      output[key] = parseBoundedInteger(
        value[key],
        `${path}.${key}`,
        0,
        key === "max_estimated_tokens" ? MODEL_LIMITS.tokenBudget : MODEL_LIMITS.counter
      );
    }
  }
  return output;
}

function parseTaskSample(input, path) {
  const value = assertPlainObject(input, path);
  const allowed = new Set([
    "sample_type",
    "type",
    "sample_id",
    "source_url",
    "url",
    "author",
    "title_prefix",
    "description"
  ]);
  assertNoUnknownKeys(value, allowed, path);
  if (value.sample_type !== undefined && value.type !== undefined && value.sample_type !== value.type) {
    throw new TypeError(`${path}.sample_type and ${path}.type disagree`);
  }
  if (value.source_url !== undefined && value.url !== undefined && value.source_url !== value.url) {
    throw new TypeError(`${path}.source_url and ${path}.url disagree`);
  }
  const sampleType = parseEnum(
    value.sample_type ?? value.type,
    SAMPLE_TYPES,
    `${path}.sample_type`
  );
  const sampleId = value.sample_id == null
    ? null
    : parseRequiredString(value.sample_id, `${path}.sample_id`, MODEL_LIMITS.text);
  const sourceUrl = value.source_url == null && value.url == null
    ? null
    : parseHttpUrl(value.source_url ?? value.url, `${path}.source_url`);
  if (sampleId === null && sourceUrl === null) {
    throw new TypeError(`${path} requires sample_id or source_url`);
  }
  return {
    sample_type: sampleType,
    sample_id: sampleId,
    source_url: sourceUrl,
    author: value.author == null
      ? null
      : parseRequiredString(value.author, `${path}.author`, MODEL_LIMITS.text),
    title_prefix: value.title_prefix == null
      ? null
      : parseRequiredString(value.title_prefix, `${path}.title_prefix`, MODEL_LIMITS.text),
    description: value.description == null
      ? null
      : parseRequiredString(value.description, `${path}.description`, MODEL_LIMITS.evidenceSummary)
  };
}

function assertPlainObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  // Durable Workflow payloads are deserialized in a different JavaScript
  // realm, so their ordinary Object prototype is not reference-equal to the
  // API function's Object.prototype. A plain object still has a prototype
  // whose own prototype is null; class instances do not.
  if (
    prototype !== null &&
    prototype !== Object.prototype &&
    Object.getPrototypeOf(prototype) !== null
  ) {
    throw new TypeError(`${path} must be a plain object`);
  }
  return value;
}

function assertNoUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
  }
}

function parseArray(value, path, max) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  if (value.length > max) throw new RangeError(`${path} exceeds the limit of ${max}`);
  return value;
}

function parseStringList(value, path, limits = {}) {
  const list = parseArray(value, path, limits.max ?? MODEL_LIMITS.list);
  const output = list.map((item, index) => parseRequiredString(
    item,
    `${path}[${index}]`,
    limits.itemMax ?? MODEL_LIMITS.text
  ));
  if (output.length < (limits.min ?? 0)) {
    throw new RangeError(`${path} requires at least ${limits.min} item(s)`);
  }
  return output;
}

function parseRequiredString(value, path, max) {
  if (typeof value !== "string") throw new TypeError(`${path} must be a string`);
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${path} must not be empty`);
  if (normalized.length > max) throw new RangeError(`${path} exceeds the limit of ${max}`);
  return normalized;
}

function parseId(value, path) {
  const id = parseRequiredString(value, path, MODEL_LIMITS.id);
  if (!ID_PATTERN.test(id)) throw new TypeError(`${path} has an invalid identifier format`);
  return id;
}

function parseCommitSha(value, path) {
  const sha = parseRequiredString(value, path, 64);
  if (!SHA_PATTERN.test(sha)) throw new TypeError(`${path} must be a Git commit SHA`);
  return sha.toLowerCase();
}

function parseSha256(value, path) {
  const hash = parseRequiredString(value, path, 64);
  if (!SHA256_PATTERN.test(hash)) throw new TypeError(`${path} must be a SHA-256 digest`);
  return hash.toLowerCase();
}

function parseTimestamp(value, path) {
  const timestamp = parseRequiredString(value, path, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
    throw new TypeError(`${path} must be an ISO timestamp`);
  }
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${path} must be an ISO timestamp`);
  return new Date(milliseconds).toISOString();
}

function parseBoolean(value, path) {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
}

function parseEnum(value, values, path) {
  const contains = Array.isArray(values) ? values.includes(value) : values.has(value);
  if (typeof value !== "string" || !contains) {
    throw new TypeError(`${path} must be one of ${[...values].join(", ")}`);
  }
  return value;
}

function parseCounter(value, path) {
  return parseBoundedInteger(value, path, 0, MODEL_LIMITS.counter);
}

function parseBoundedInteger(value, path, min, max) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${path} must be a safe integer`);
  if (value < min || value > max) throw new RangeError(`${path} must be between ${min} and ${max}`);
  return value;
}

function parseNonNegativeNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  if (value < 0) throw new RangeError(`${path} must be non-negative`);
  return value;
}

function parseRate(value, path) {
  const rate = parseNonNegativeNumber(value, path);
  if (rate > 1) throw new RangeError(`${path} must be between 0 and 1`);
  return rate;
}

function parseHttpUrl(value, path) {
  const raw = parseRequiredString(value, path, MODEL_LIMITS.evidenceReference);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError(`${path} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${path} must use http or https`);
  }
  return parsed.toString();
}

// Stable aliases used by callers that prefer constructor terminology.
export const createTask = parseTaskInput;
export const validateTask = parseTaskInput;
export const createExecutorReport = parseExecutorReport;
export const validateExecutorReport = parseExecutorReport;
export const createDecision = parseDecision;
export const validateDecision = parseDecision;
