# Tree Brain task recovery checkpoint — 2026-09-08

## Acceptance boundary

Local real Codex recovery: **PASS**. Production/ordinary GPT acceptance: **FAIL / blocked by missing OAuth configuration**.

The local probe called the real registered `task_start`, `task_status`, and `task_resume` MCP handlers, the real worker, and the installed Codex SDK with `gpt-5.6-terra` / `medium`. It used a **test-only JSON persistence adapter and in-memory MCP transport**, not Vercel Workflow storage, production OAuth, or a ChatGPT client. Its PASS must not be promoted to an end-to-end production PASS.

The first process completed `remember`, began `recall` on the original thread, and aborted the actual SDK stream after persisting its thread ID. A separate process loaded the checkpoint, called `task_resume`, and completed only `recall`. The nonce was recovered from conversation history, not supplied in the resumed prompt. Actual SDK method instrumentation recorded zero `startThread` calls in the recovery process. See `artifacts/tree-brain/task-resume-2026-09-08.json` for the extracted evidence.

Quota preservation was tested with a deterministic unit test, **not a real quota exhaustion**. The real interruption test used controlled cancellation.

Production checks on 2026-09-07 UTC:

- Vercel environment variable names: only `TIKHUB_API_KEY`, for Preview and Production. No values were printed or changed.
- `GET /.well-known/oauth-protected-resource`: HTTP 503 `TREE_BRAIN_OAUTH_NOT_CONFIGURED`.
- `POST /mcp` with a `task_status` tools/call request: HTTP 503 `TREE_BRAIN_OAUTH_NOT_CONFIGURED` (request ID `mcp_20edf943-e311-4ab7-ba0f-faad55c1f76d`).
- No production authorization was bypassed, invented, or replaced with test credentials.
- `read_douyin_video` was **not implemented or called**, because the first production acceptance gate is still blocked. No Douyin backend, OCR/ASR route, or prior evidence was modified or re-scanned.

## Implemented contract

- `task_start`: required stable `request_id`, authorized `workspace_id`, `goal`, optional bounded ordered `steps`; read-only by default. Binds the repository to `6Treeeee/-` and branch to `codex/a2a-control-loop`. No caller-supplied directory is accepted.
- `task_status`: persisted `task_id`, `thread_id`, project/repo/branch/cwd, model/effort, status, completed/remaining steps, last result/error, timestamps, and operation receipts.
- `task_resume`: required stable `request_id` and existing `task_id`; preserves the thread and completed steps. Rejects absent thread IDs, active leases, version conflicts, and stopped tasks. A completed task is read-only/idempotent.
- The worker validates the real Git root, origin and branch, then persists the operation intent before invoking the SDK and persists `thread.started` before accepting a turn result or failure.
- When `thread_id` exists, execution invokes only `resumeThread(thread_id)`. A failed resume never falls back to `startThread`. Ambiguous first creation without a saved ID fails closed.
- `RUNNING`, `BLOCKED_BY_QUOTA`, `FAILED`, `COMPLETED` are distinct from the durable queue state. Codex failures keep the Workflow inbox open for recovery; legacy A2A reports/reviews remain unchanged.
- `start_thread_calls` / `resume_thread_calls` are **persisted call-intent counts**, not independent proof the remote SDK call succeeded. The acceptance probe separately instruments the real SDK methods.

## Remaining credential gates

The existing protected MCP endpoint requires real values for `TREE_BRAIN_MCP_URL`, `TREE_BRAIN_OAUTH_ISSUER`, `TREE_BRAIN_OAUTH_JWKS_URL`, and `TREE_BRAIN_OAUTH_SUBJECTS_JSON`. A real issuer/JWKS and explicit authorized subject/workspace grants must come from the owner's OAuth configuration. The local worker also needs its existing signed worker credential and fixed `worker/config.json` workspace binding; neither was present in the current shell/checkout. Do not generate replacement production credentials or disable authorization to make acceptance green.

Once those are available: deploy/verify the same implementation, call all three tools from the ordinary GPT MCP connection, let the configured worker execute, interrupt, inspect the persisted original thread, resume it, and verify the returned result. Only after that gate passes, add the thin `read_douyin_video` adapter over the already-PASS Content Reader single-video endpoint (`fresh: false`); do not rebuild its backend.

## Reproducible local checks

`npm test`: 258/258. `npm --prefix worker test`: 34/34. Both syntax checks and the existing Workflow build passed. The build required running outside the filesystem sandbox because its bundler could not traverse dependency parent directories inside the sandbox.

For a **new, explicitly authorized** real SDK probe, run the following commands as separate processes using the same fresh absolute evidence-file path:

```text
node scripts/verify-task-resume.mjs start <absolute-state-file>
node scripts/verify-task-resume.mjs resume <same-absolute-state-file>
```

The start command refuses to overwrite an existing evidence file. The resume command refuses a missing checkpoint. Do not rerun the completed acceptance task unnecessarily.
