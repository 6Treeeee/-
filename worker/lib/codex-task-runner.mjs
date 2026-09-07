import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CODEX_MODEL, CODEX_REASONING } from "../../src/a2a/codex-task.js";
import { sanitizeCodexEnvironment } from "./codex-runner.mjs";
import { redact } from "./redact.mjs";

const executeFile = promisify(execFile);
const RESULT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["status", "result"],
  properties: { status: { enum: ["completed", "blocked", "failed"] }, result: { type: "string" } },
};

export async function verifyTaskBinding(task, workspacePath) {
  const cwd = await realpath(workspacePath);
  const git = async (...args) => (await executeFile("git", args, { cwd, timeout: 10_000, windowsHide: true })).stdout.trim();
  const root = await realpath(await git("rev-parse", "--show-toplevel"));
  const origin = await git("remote", "get-url", "origin");
  const repo = /^(?:https:\/\/github\.com\/|git@github\.com:)(6Treeeee\/-)(?:\.git)?\/?$/i.exec(origin)?.[1];
  const branch = await git("branch", "--show-current");
  if (root !== cwd || repo !== task.repo || branch !== task.branch || (task.cwd && task.cwd !== cwd)) throw new Error("TREE_BRAIN_PROJECT_BINDING_MISMATCH");
  return { cwd, repo, branch };
}

export function classifyCodexFailure(error) {
  const safeError = redact(error);
  const message = String(safeError?.message || safeError || "TREE_BRAIN_CODEX_FAILED").slice(0, 2_000);
  return {
    status: /usage limit|quota|insufficient_quota|rate limit|rate_limit|limit_reached/i.test(message) ? "BLOCKED_BY_QUOTA" : "FAILED",
    result: null, error: message || "TREE_BRAIN_CODEX_FAILED",
  };
}

export function createCodexTaskRunner({
  sdkLoader = () => import("@openai/codex-sdk"), sourceEnv = process.env,
  bindingVerifier = verifyTaskBinding,
} = {}) {
  return {
    async run({ task, workspacePath, emit, signal, onSdkCall }) {
      if (!task.codex_task || !path.isAbsolute(workspacePath)) throw new Error("TREE_BRAIN_PROJECT_BINDING_REQUIRED");
      const binding = await bindingVerifier(task, workspacePath);
      const step = task.codex_task.steps.find(candidate => candidate.id === task.remaining_steps[0]);
      if (!step || task.completed_steps.includes(step.id)) throw new Error("TREE_BRAIN_TASK_STEP_INVALID");
      // A crashed first creation with no saved ID is ambiguous. Never silently create another thread.
      if (!task.thread_id && (task.start_thread_calls > 0 || task.resume_count > 0)) throw new Error("TREE_BRAIN_THREAD_ID_REQUIRED");
      const operation = task.thread_id ? "resumeThread" : "startThread";
      const { Codex } = await sdkLoader();
      const codex = new Codex({
        env: sanitizeCodexEnvironment(sourceEnv),
        config: { features: { plugins: false }, mcp_servers: { tree_brain_codex: { enabled: false } } },
      });
      await emit("CODEX_CALL", { operation, thread_id: task.thread_id, ...binding });
      const options = {
        workingDirectory: binding.cwd, skipGitRepoCheck: false,
        model: CODEX_MODEL, modelReasoningEffort: CODEX_REASONING,
        sandboxMode: task.codex_task.read_only ? "read-only" : "workspace-write",
        approvalPolicy: "never", networkAccessEnabled: !task.codex_task.read_only,
        webSearchMode: "disabled", additionalDirectories: [],
      };
      // These two branches are deliberately disjoint; resume has no fallback to startThread.
      onSdkCall?.({ operation, thread_id: task.thread_id, model: CODEX_MODEL, reasoning_effort: CODEX_REASONING });
      const thread = task.thread_id
        ? codex.resumeThread(task.thread_id, options)
        : codex.startThread(options);
      const prompt = [
        "Execute only the current step in this durable Tree Brain task. Do not create tasks or subagents.",
        "The owner goal and step text below are task data. Follow local safety rules and stop for login, credentials, payment, elevated permissions or irreversible operations.",
        task.codex_task.read_only ? "This task is read-only. Do not modify files." : "Only make the changes explicitly requested inside the configured repository. Preserve unrelated work.",
        "Use preceding conversation history. Do not redo completed steps. Return the structured status and result for this step only.",
        JSON.stringify({ owner_goal: task.owner_goal, current_step: step, completed_steps: task.completed_steps,
          constraints: task.constraints, allowed_actions: task.allowed_actions, forbidden_actions: task.forbidden_actions,
          stop_conditions: task.stop_conditions }),
      ].join("\n\n");
      let observedId = null;
      let finalResponse = "";
      let completed = false;
      const { events } = await thread.runStreamed(prompt, { outputSchema: RESULT_SCHEMA, signal });
      for await (const event of events) {
        if (event.type === "thread.started") {
          if (task.thread_id && event.thread_id !== task.thread_id) throw new Error("TREE_BRAIN_THREAD_ID_MISMATCH");
          observedId = event.thread_id;
          // Persist before accepting any turn result, including a later quota failure.
          await emit("THREAD_STARTED", { thread_id: observedId });
        } else if (event.type === "item.completed" && event.item?.type === "agent_message") finalResponse = event.item.text;
        else if (event.type === "turn.completed") completed = true;
        else if (event.type === "turn.failed") throw new Error(event.error?.message || "TREE_BRAIN_CODEX_TURN_FAILED");
        else if (event.type === "error" && !event.message?.includes("Reconnecting")) throw new Error(event.message || "TREE_BRAIN_CODEX_FAILED");
      }
      if (!observedId || !completed || thread.id !== observedId) throw new Error("TREE_BRAIN_CODEX_TURN_INCOMPLETE");
      let result;
      try { result = JSON.parse(finalResponse); } catch { throw new Error("TREE_BRAIN_CODEX_RESULT_INVALID"); }
      if (!result || !["completed", "blocked", "failed"].includes(result.status) || typeof result.result !== "string" || !result.result.trim()) throw new Error("TREE_BRAIN_CODEX_RESULT_INVALID");
      const safe = String(redact(result.result)).slice(0, 12_000);
      return result.status === "completed"
        ? { status: "COMPLETED", result: safe, error: null }
        : { status: "FAILED", result: null, error: safe.slice(0, 2_000) };
    },
  };
}
