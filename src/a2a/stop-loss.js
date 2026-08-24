import {
  COST_FIELDS,
  MODEL_LIMITS,
  addCostCounters,
  createCostCounters,
  isFailedExecutorReport,
  parseExecutorReport
} from "./model.js";

export const STOP_LOSS_ACTIONS = Object.freeze({
  CONTINUE: "CONTINUE",
  REVIEW_PATH: "REVIEW_PATH",
  ARCHITECTURE_REVIEW: "ARCHITECTURE_REVIEW",
  DEPRIORITIZE_PATH: "DEPRIORITIZE_PATH",
  MINIMAL_POC: "MINIMAL_POC"
});

const BUDGET_TO_COST = Object.freeze({
  max_executions: "execution_count",
  max_failures: "failure_count",
  max_real_world_tests: "real_world_test_count",
  max_agent_calls: "agent_call_count",
  max_estimated_tokens: "estimated_tokens",
  max_external_api_calls: "external_api_call_count",
  max_deployments: "deployment_count"
});

/**
 * Evaluate deterministic stop-loss rules against ordered executor attempts.
 * The returned triggers are facts; a decision agent remains responsible for
 * mapping them to CONTINUE, CHANGE_PATH, STOP, ROLLBACK, or ASK_OWNER.
 */
export function evaluateStopLoss(attempts, context = {}) {
  if (!Array.isArray(attempts)) throw new TypeError("attempts must be an array");
  if (attempts.length > MODEL_LIMITS.attempts) {
    throw new RangeError(`attempts exceeds the limit of ${MODEL_LIMITS.attempts}`);
  }
  if (context === null || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("context must be an object");
  }
  const allowedContextKeys = new Set([
    "task_id",
    "budget",
    "owner_goal_pass",
    "alternatives",
    "acceptance_criteria"
  ]);
  for (const key of Object.keys(context)) {
    if (!allowedContextKeys.has(key)) throw new TypeError(`context.${key} is not allowed`);
  }

  const reports = attempts.map((attempt, index) => parseStopLossAttempt(
    attempt,
    index,
    context.task_id
  ));
  const triggers = [];
  const failureReports = reports.filter(isFailedAttempt);
  const rootCauseRun = trailingRootCauseRun(reports);

  if (rootCauseRun.count >= 2) {
    triggers.push({
      rule: "RULE_1_SAME_ROOT_CAUSE",
      action: STOP_LOSS_ACTIONS.REVIEW_PATH,
      reason: `root cause ${rootCauseRun.root_cause} failed ${rootCauseRun.count} consecutive times`,
      root_cause: rootCauseRun.root_cause,
      consecutive_failures: rootCauseRun.count,
      prohibit_same_fix: true
    });
  }

  const blindCommits = blindTestByDistinctCommit(reports);
  if (blindCommits.length >= 2) {
    const previous = blindCommits.at(-2);
    const current = blindCommits.at(-1);
    if (current.success_rate <= previous.success_rate) {
      triggers.push({
        rule: "RULE_2_BLIND_TEST_NO_IMPROVEMENT",
        action: STOP_LOSS_ACTIONS.ARCHITECTURE_REVIEW,
        reason: "two consecutive code commits did not improve blind-test success rate",
        commits: [previous.commit_sha, current.commit_sha],
        success_rates: [previous.success_rate, current.success_rate],
        complexity_increase_prohibited: true
      });
    }
  }

  const ownerGoalPass = context.owner_goal_pass === true || reports.some(hasOwnerGoalPass);
  const complexityTrend = sustainedComplexityIncrease(reports);
  if (!ownerGoalPass && complexityTrend.increasing) {
    triggers.push({
      rule: "RULE_3_COMPLEXITY_WITHOUT_OWNER_GOAL",
      action: STOP_LOSS_ACTIONS.DEPRIORITIZE_PATH,
      reason: "complexity increased while OWNER_GOAL_PASS remained false",
      metrics: complexityTrend.metrics,
      observations: complexityTrend.observations,
      priority_adjustment: "LOWER"
    });
  }

  const simplerRoute = findSimplerRoute(reports, context);
  if (simplerRoute !== null) {
    triggers.push({
      rule: "RULE_4_SIMPLER_ROUTE",
      action: STOP_LOSS_ACTIONS.MINIMAL_POC,
      reason: "a materially simpler route is available and must be tested before more investment",
      route_id: simplerRoute.route_id,
      description: simplerRoute.description,
      require_minimal_poc: true
    });
  }

  const cost = aggregateObservedCost(reports, failureReports, rootCauseRun.count);
  const budget = context.budget ?? {};
  const budgetBreaches = findBudgetBreaches(cost, budget);
  if (budgetBreaches.length > 0) {
    triggers.push({
      rule: "BUDGET_LIMIT_REACHED",
      action: STOP_LOSS_ACTIONS.REVIEW_PATH,
      reason: "one or more task budget limits were reached",
      breaches: budgetBreaches,
      prohibit_new_execution: true
    });
  }

  const primaryAction = selectPrimaryAction(triggers);
  const priority = complexityTrend.increasing && !ownerGoalPass ? "LOWERED" : "UNCHANGED";
  return {
    action: primaryAction,
    triggered: triggers.length > 0,
    review_required: triggers.length > 0,
    same_fix_prohibited: rootCauseRun.count >= 2,
    path_priority: priority,
    current_path_priority: priority === "LOWERED" ? "lowered" : "normal",
    minimal_poc_required: simplerRoute !== null,
    triggers,
    rules: triggers,
    cost,
    budget_breaches: budgetBreaches
  };
}

function parseStopLossAttempt(attempt, index, taskId) {
  const path = `attempts[${index}]`;
  if (attempt === null || typeof attempt !== "object" || Array.isArray(attempt)) {
    throw new TypeError(`${path} must be an object`);
  }
  if (attempt.task_id !== undefined || attempt.report_id !== undefined) {
    return parseExecutorReport(attempt, { path });
  }

  const allowed = new Set([
    "attempt_id",
    "at",
    "action",
    "result",
    "status",
    "root_cause",
    "commit_sha",
    "complexity",
    "real_world_test",
    "evidence",
    "cost",
    "alternatives"
  ]);
  for (const key of Object.keys(attempt)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
  }
  const realWorldTest = attempt.real_world_test
    && Object.keys(attempt.real_world_test).length > 0
    ? attempt.real_world_test
    : null;
  return parseExecutorReport({
    report_id: attempt.attempt_id ?? `attempt_${index + 1}`,
    task_id: taskId ?? "task_stop_loss",
    status: attempt.status,
    action: attempt.action,
    result: attempt.result,
    evidence: attempt.evidence ?? [],
    real_world_test: realWorldTest,
    cost: attempt.cost ?? {},
    root_cause: attempt.root_cause === "unknown" ? null : (attempt.root_cause ?? null),
    alternatives: attempt.alternatives ?? [],
    decision_required: true,
    acceptance_results: [],
    commit_sha: attempt.commit_sha ?? null,
    complexity: attempt.complexity ?? null,
    created_at: attempt.at ?? new Date().toISOString()
  }, { path });
}

function isFailedAttempt(report) {
  return isFailedExecutorReport(report);
}

function normalizedRootCause(report) {
  if (!isFailedAttempt(report) || report.root_cause === null) return null;
  // Locale-sensitive transforms are unnecessary for stable machine codes and
  // are not portable across every deterministic Workflow runtime.
  return report.root_cause.trim().toLowerCase().replace(/\s+/g, " ");
}

function trailingRootCauseRun(reports) {
  if (reports.length === 0) return { root_cause: null, count: 0 };
  const lastCause = normalizedRootCause(reports.at(-1));
  if (lastCause === null) return { root_cause: null, count: 0 };
  let count = 0;
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    if (normalizedRootCause(reports[index]) !== lastCause) break;
    count += 1;
  }
  return { root_cause: lastCause, count };
}

function blindTestByDistinctCommit(reports) {
  const observations = [];
  for (const report of reports) {
    if (report.real_world_test?.sample_type !== "BLIND_SAMPLE") continue;
    const commitSha = report.commit_sha ?? report.evidence.find((item) => item.commit_sha)?.commit_sha;
    if (commitSha === null || commitSha === undefined) continue;
    const current = {
      commit_sha: commitSha,
      success_rate: report.real_world_test.success_rate,
      observed_at: report.real_world_test.observed_at
    };
    if (observations.at(-1)?.commit_sha === commitSha) {
      observations[observations.length - 1] = current;
    } else {
      observations.push(current);
    }
  }
  return observations;
}

function hasOwnerGoalPass(report) {
  return report.evidence.some((item) => (
    item.gate === "OWNER_GOAL_PASS" && item.outcome === "PASS"
  ));
}

function sustainedComplexityIncrease(reports) {
  const observations = reports
    .filter((report) => report.complexity !== null)
    .map((report) => report.complexity);
  if (observations.length < 2) {
    return { increasing: false, metrics: [], observations: observations.length };
  }

  const allMetrics = [
    "lines_of_code",
    "dependency_count",
    "component_count",
    "complexity_score"
  ];
  const comparableMetrics = allMetrics.filter((metric) => observations.every(
    (observation) => observation[metric] !== null
  ));
  if (comparableMetrics.length === 0) {
    return { increasing: false, metrics: [], observations: observations.length };
  }

  let sawIncrease = false;
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    if (comparableMetrics.some((metric) => current[metric] < previous[metric])) {
      return { increasing: false, metrics: comparableMetrics, observations: observations.length };
    }
    if (comparableMetrics.some((metric) => current[metric] > previous[metric])) {
      sawIncrease = true;
    }
  }
  return {
    increasing: sawIncrease,
    metrics: comparableMetrics,
    observations: observations.length
  };
}

function findSimplerRoute(reports, context) {
  const alternatives = reports.flatMap((report) => report.alternatives);
  if (Array.isArray(context.alternatives)) alternatives.push(...context.alternatives);
  for (const alternative of alternatives) {
    if (alternative === null || typeof alternative !== "object" || Array.isArray(alternative)) continue;
    const explicitlySimpler = alternative.simpler === true;
    const quantifiedSimpler = Number.isFinite(alternative.estimated_effort)
      && Number.isFinite(alternative.current_effort)
      && alternative.estimated_effort < alternative.current_effort;
    if (explicitlySimpler || quantifiedSimpler) {
      return {
        route_id: typeof alternative.route_id === "string"
          ? alternative.route_id
          : "context_alternative",
        description: typeof alternative.description === "string"
          ? alternative.description
          : "simpler route"
      };
    }
  }
  return null;
}

function aggregateObservedCost(reports, failureReports, rootCauseCount) {
  const reported = addCostCounters(...reports.map((report) => report.cost));
  const observed = createCostCounters({
    execution_count: reports.length,
    failure_count: failureReports.length,
    same_root_cause_repeat_count: Math.max(0, rootCauseCount - 1),
    real_world_test_count: reports.filter((report) => report.real_world_test !== null).length,
    deployment_count: reports.filter((report) => report.evidence.some((item) => (
      item.type === "DEPLOYMENT" || item.gate === "DEPLOY_PASS"
    ))).length
  });
  for (const field of COST_FIELDS) {
    if (field === "failure_count") continue;
    observed[field] = Math.max(observed[field], reported[field]);
  }
  return observed;
}

function findBudgetBreaches(cost, budget) {
  if (budget === null || typeof budget !== "object" || Array.isArray(budget)) {
    throw new TypeError("context.budget must be an object");
  }
  const allowed = new Set(Object.keys(BUDGET_TO_COST));
  for (const [key, value] of Object.entries(budget)) {
    if (!allowed.has(key)) throw new TypeError(`context.budget.${key} is not allowed`);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`context.budget.${key} must be a non-negative safe integer`);
    }
  }
  return Object.entries(BUDGET_TO_COST)
    .filter(([budgetKey, costKey]) => budget[budgetKey] !== undefined && cost[costKey] >= budget[budgetKey])
    .map(([budgetKey, costKey]) => ({
      budget: budgetKey,
      limit: budget[budgetKey],
      observed: cost[costKey]
    }));
}

function selectPrimaryAction(triggers) {
  const priority = [
    STOP_LOSS_ACTIONS.ARCHITECTURE_REVIEW,
    STOP_LOSS_ACTIONS.REVIEW_PATH,
    STOP_LOSS_ACTIONS.MINIMAL_POC,
    STOP_LOSS_ACTIONS.DEPRIORITIZE_PATH
  ];
  return priority.find((action) => triggers.some((trigger) => trigger.action === action))
    ?? STOP_LOSS_ACTIONS.CONTINUE;
}
