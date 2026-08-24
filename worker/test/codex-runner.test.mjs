import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildPrompt,
  createCodexRunner,
  REPORT_SCHEMA,
  sanitizeCodexEnvironment,
} from "../lib/codex-runner.mjs";

function validReport(taskId) {
  return {
    task_id: taskId,
    status: "review_required",
    action: "ran checks",
    result: "tests passed; real-world test not run",
    evidence: [],
    real_world_test: null,
    cost: {
      execution_count: 1,
      failure_count: 0,
      same_root_cause_repeat_count: 0,
      real_world_test_count: 0,
      agent_call_count: 0,
      estimated_tokens: 0,
      external_api_call_count: 0,
      deployment_count: 0,
    },
    root_cause: null,
    alternatives: [],
    decision_required: true,
    acceptance_results: [],
    commit_sha: null,
    complexity: null,
    blockers: [],
    owner_goal_pass: false,
  };
}

function fakeSdk(turn, capture) {
  return {
    Codex: class {
      constructor(options) {
        capture.codexOptions = options;
      }

      startThread(options) {
        capture.threadOptions = options;
        return {
          run: async (prompt, turnOptions) => {
            capture.prompt = prompt;
            capture.turnOptions = turnOptions;
            return turn;
          },
        };
      }
    },
  };
}

test("executor is fixed to workspace-write, never approval, and local workspace", async () => {
  const capture = {};
  const task = {
    task_id: "task-1",
    goal: "Fix the actual reader",
    workspace_id: "content-reader",
    cwd: "C:\\attacker-controlled",
    shell: "dangerous command",
    env: { A2A_WORKER_PRIVATE_KEY: "do-not-leak" },
  };
  const workspacePath = path.resolve(".");
  const runner = createCodexRunner({
    sourceEnv: {
      Path: "safe-path",
      SystemRoot: "C:\\Windows",
      A2A_WORKER_PRIVATE_KEY: "do-not-leak",
      OPENAI_API_KEY: "also-do-not-leak",
    },
    sdkLoader: async () => fakeSdk({
      finalResponse: JSON.stringify(validReport("task-1")),
      items: [
        {
          type: "command_execution",
          command: "curl -H 'Authorization: Bearer very-secret-token'",
          status: "completed",
          exit_code: 0,
        },
      ],
      usage: {
        input_tokens: 10,
        cached_input_tokens: 2,
        cache_write_input_tokens: 1,
        output_tokens: 5,
        reasoning_output_tokens: 3,
      },
    }, capture),
  });

  const report = await runner.run({
    task,
    role: "executor",
    workspacePath,
    executorNetworkAccess: true,
  });

  assert.deepEqual(capture.codexOptions.env, { Path: "safe-path", SystemRoot: "C:\\Windows" });
  assert.equal(capture.threadOptions.workingDirectory, workspacePath);
  assert.equal(capture.threadOptions.sandboxMode, "workspace-write");
  assert.equal(capture.threadOptions.approvalPolicy, "never");
  assert.equal(capture.threadOptions.networkAccessEnabled, true);
  assert.deepEqual(capture.threadOptions.additionalDirectories, []);
  assert.equal(capture.prompt.includes("attacker-controlled"), false);
  assert.equal(capture.prompt.includes("do-not-leak"), false);
  assert.equal(capture.turnOptions.outputSchema.type, "object");
  assert.equal(report.cost.agent_call_count, 1);
  assert.equal(report.cost.estimated_tokens, 15);
  assert.equal(JSON.stringify(report.evidence).includes("very-secret-token"), false);
});

test("planner and reviewer remain read-only even if executor networking is enabled", async () => {
  for (const role of ["planner", "reviewer"]) {
    const capture = {};
    const runner = createCodexRunner({
      sdkLoader: async () => fakeSdk({
        finalResponse: JSON.stringify(validReport(`task-${role}`)),
        items: [],
        usage: null,
      }, capture),
    });
    await runner.run({
      task: { task_id: `task-${role}`, goal: "Inspect" },
      role,
      workspacePath: path.resolve("."),
      executorNetworkAccess: true,
    });
    assert.equal(capture.threadOptions.sandboxMode, "read-only");
    assert.equal(capture.threadOptions.networkAccessEnabled, false);
  }
});

test("decision role uses a separate decision schema in read-only mode", async () => {
  const capture = {};
  const decision = {
    task_id: "task-decision",
    decision: "CHANGE_PATH",
    reason: "Two attempts had the same root cause",
    constraints_update: ["Do not repeat the same provider"],
    next_goal: "Prove the simpler route with one blind sample",
  };
  const runner = createCodexRunner({
    sdkLoader: async () => fakeSdk({
      finalResponse: JSON.stringify(decision),
      items: [],
      usage: null,
    }, capture),
  });
  const output = await runner.run({
    task: { task_id: "task-decision", current_stage: "decision" },
    role: "decision",
    workspacePath: path.resolve("."),
  });
  assert.deepEqual(output, decision);
  assert.equal(capture.threadOptions.sandboxMode, "read-only");
  assert.deepEqual(capture.turnOptions.outputSchema.properties.decision.enum, [
    "CONTINUE",
    "CHANGE_PATH",
    "STOP",
    "ROLLBACK",
    "ASK_OWNER",
  ]);
});

test("unknown roles fail before the SDK is loaded", async () => {
  let loaded = false;
  const runner = createCodexRunner({
    sdkLoader: async () => {
      loaded = true;
      return {};
    },
  });
  await assert.rejects(
    runner.run({ task: { task_id: "task-1" }, role: "owner", workspacePath: path.resolve(".") }),
    /Unsupported role/,
  );
  assert.equal(loaded, false);
});

test("environment sanitizer excludes credentials and arbitrary task variables", () => {
  assert.deepEqual(sanitizeCodexEnvironment({
    PATH: "path",
    HOME: "/home/owner",
    A2A_WORKER_PRIVATE_KEY: "secret",
    VERCEL_TOKEN: "secret",
  }), {
    PATH: "path",
    HOME: "/home/owner",
  });
});

test("prompt includes evidence semantics and omits non-allowlisted control fields", () => {
  const prompt = buildPrompt({
    task: {
      task_id: "task-1",
      goal: "Test",
      cloud_supplied_shell: "remove everything",
      last_rejected_event: { code: "A2A_STOP_LOSS_DECISION_REJECTED" },
    },
    role: "reviewer",
  });
  assert.match(prompt, /BUILD_PASS/);
  assert.match(prompt, /Never include the transcript text or response body/);
  assert.equal(prompt.includes("cloud_supplied_shell"), false);
  assert.equal(prompt.includes("A2A_STOP_LOSS_DECISION_REJECTED"), true);
});

test("report schema carries the evidence and acceptance shapes needed for independent owner-goal review", () => {
  assert.equal(REPORT_SCHEMA.required.includes("acceptance_results"), true);
  assert.equal(REPORT_SCHEMA.properties.evidence.items.additionalProperties, false);
  assert.deepEqual(REPORT_SCHEMA.properties.acceptance_results.items.required, [
    "criterion_index",
    "passed",
    "evidence_ids",
    "note",
  ]);
  assert.equal(REPORT_SCHEMA.properties.owner_goal_pass.type, "boolean");
  assert.deepEqual(REPORT_SCHEMA.properties.real_world_test.required, [
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
    "observations",
  ]);
  const observations = REPORT_SCHEMA.properties.real_world_test.properties.observations;
  assert.equal(observations.additionalProperties, false);
  assert.equal(observations.required.includes("transcript_sha256"), true);
  assert.equal(observations.required.includes("segment_timestamps"), true);
  assert.equal(observations.properties.segment_timestamps.maxItems, 4_096);
  assert.equal("transcript_text" in observations.properties, false);
});
