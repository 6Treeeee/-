# Tree Brain task recovery checkpoint — 2026-09-09

## Acceptance boundary

Local real Codex recovery across three MCP HTTP sessions: **PASS**. Production/ordinary GPT acceptance: **FAIL / not run because OAuth is not configured and was explicitly out of scope**.

The local probe called the real registered `task_start`, `task_status`, and `task_resume` MCP handlers over Streamable HTTP, the real worker, and the installed Codex SDK with `gpt-5.6-terra` / `medium`. It used a **test-only JSON persistence adapter and local authorizer**, not Vercel Workflow storage, production OAuth, or a ChatGPT client. Its PASS must not be promoted to an ordinary-GPT or production PASS.

MCP session A completed `remember`, began `recall` on the original thread, and aborted the actual SDK stream after persisting its thread ID. MCP session B ran in a separate process, omitted `task_id` from both `task_status` and `task_resume`, discovered the newest Codex task for the same principal and workspace, and completed `recall` through `resumeThread` on the same thread. MCP session C ran in a third process, again omitted `task_id`, and read the same task as `COMPLETED`. The nonce was recovered from conversation history, not supplied in the resumed prompt. Instrumented SDK calls recorded exactly one `startThread` and two `resumeThread` calls. See `artifacts/tree-brain/task-resume-2026-09-09.json`.

Quota preservation was tested with a deterministic unit test, **not a real quota exhaustion**. The real interruption test used controlled cancellation.

Production checks on 2026-09-07 UTC:

- Vercel environment variable names: only `TIKHUB_API_KEY`, for Preview and Production. No values were printed or changed.
- `GET /.well-known/oauth-protected-resource`: HTTP 503 `TREE_BRAIN_OAUTH_NOT_CONFIGURED`.
- `POST /mcp` with a `task_status` tools/call request: HTTP 503 `TREE_BRAIN_OAUTH_NOT_CONFIGURED` (request ID `mcp_20edf943-e311-4ab7-ba0f-faad55c1f76d`).
- No production authorization was bypassed, invented, or replaced with test credentials.
- `read_douyin_video` was **not implemented or called**, because the first production acceptance gate is still blocked. No Douyin backend, OCR/ASR route, or prior evidence was modified or re-scanned.

## Implemented contract

- `task_start`: required stable `request_id`, authorized `workspace_id`, `goal`, optional bounded ordered `steps`; read-only by default. Binds the repository to `6Treeeee/-` and branch to `codex/a2a-control-loop`. No caller-supplied directory is accepted.
- `task_status`: requires an authorized `workspace_id`; `task_id` is optional. When omitted, it reads the task index for the newest Codex task owned by the exact authenticated principal in that workspace. It returns persisted task/thread identity, project binding, model/effort, progress, result/error, timestamps, and operation receipts.
- `task_resume`: requires an authorized `workspace_id` and stable `request_id`; `task_id` is optional and uses the same principal/workspace-scoped Codex discovery. Explicit IDs also pass through the scoped index, preventing another principal with the same workspace grant from reading or resuming a guessed task. It preserves the thread and completed steps, rejects absent thread IDs, active leases, version conflicts, and stopped tasks, and treats a completed task as an idempotent read.
- New index entries record whether they are Codex tasks. Legacy entries are treated only as candidates and must still load a persisted state containing `codex_task`. `task_start` waits until its index entry is durably visible before returning.
- The worker validates the real Git root, origin and branch, then persists the operation intent before invoking the SDK and persists `thread.started` before accepting a turn result or failure.
- When `thread_id` exists, execution invokes only `resumeThread(thread_id)`. A failed resume never falls back to `startThread`. Ambiguous first creation without a saved ID fails closed.
- `RUNNING`, `BLOCKED_BY_QUOTA`, `FAILED`, `COMPLETED` are distinct from the durable queue state. Codex failures keep the Workflow inbox open for recovery; legacy A2A reports/reviews remain unchanged.
- `start_thread_calls` / `resume_thread_calls` are **persisted call-intent counts**, not independent proof the remote SDK call succeeded. The acceptance probe separately instruments the real SDK methods.

## Remaining credential gates

The existing protected MCP endpoint requires real values for `TREE_BRAIN_MCP_URL`, `TREE_BRAIN_OAUTH_ISSUER`, `TREE_BRAIN_OAUTH_JWKS_URL`, and `TREE_BRAIN_OAUTH_SUBJECTS_JSON`. A real issuer/JWKS and explicit authorized subject/workspace grants must come from the owner's OAuth configuration. The local worker also needs its existing signed worker credential and fixed `worker/config.json` workspace binding; neither was present in the current shell/checkout. Do not generate replacement production credentials or disable authorization to make acceptance green.

Once those are available: deploy/verify the same implementation, call all three tools from the ordinary GPT MCP connection, let the configured worker execute, interrupt, inspect the persisted original thread, resume it, and verify the returned result. Only after that gate passes, add the thin `read_douyin_video` adapter over the already-PASS Content Reader single-video endpoint; use `fresh: true` for acceptance so cached artifacts cannot satisfy the result, and do not rebuild its backend.

## Reproducible local checks

Release checks passed: `npm run check`; `npm test` (259/259); `npm --prefix worker run check`; `npm --prefix worker test` (34/34); and the Workflow build (7 steps, 2 workflows). The Workflow build ran outside the filesystem sandbox because its bundler must traverse dependency parent directories.

For a **new, explicitly authorized** real SDK probe, run the following commands as separate processes using the same fresh absolute evidence-file path:

```text
node scripts/verify-task-resume.mjs a <absolute-state-file>
node scripts/verify-task-resume.mjs b <same-absolute-state-file>
node scripts/verify-task-resume.mjs c <same-absolute-state-file>
```

Phase A refuses to overwrite an existing evidence file. Phases B and C refuse a missing or out-of-order checkpoint. Do not rerun the completed acceptance task unnecessarily.
