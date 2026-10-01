# Content Reader on-demand acquisition prototype

Scope: Preview only; repository `6Treeeee/-`, branch `codex/a2a-control-loop`. Production is not promoted or changed. The worker runs the existing public browser and existing hard-subtitle OCR together on GitHub Linux, returns the complete Content Reader object, and uses no TikHub or ASR. Vercel handles trigger, poll and result validation. This proves the minimum split without transporting large media through Vercel or adding a new datastore.

## Configuration

Vercel **Preview only** environment variables:

- `ACQUISITION_GITHUB_TOKEN` (or `GITHUB_TOKEN`): fine-grained PAT restricted to `6Treeeee/-`, repository **Actions: write** (includes read), automatic Metadata: read. Alternatively a GitHub App installation token with the same permission; short-lived tokens require renewal. Do not put a token in source or send it in chat.
- `CONTENT_READER_WORKER_API_KEY`: separate random secret of at least 32 characters, used for API bearer authentication and signed task tickets. It is not the GitHub token. Persist it across deployments for outstanding tickets.

Code publishing may require Contents: write and Workflows: write for the publishing identity. Those are **not** runtime worker-token permissions.

The connected GitHub app's ability to write code does not grant Vercel a credential. Anonymous GitHub dispatch is not supported. No permission checks are bypassed. The existing registered workflow is reused; if dispatch returns 404/422 because GitHub requires default-branch registration, record that response and add only the necessary workflow registration after evaluating its effect on Production. Do not silently push application changes to main.

## Request flow

`GET /api/acquisition` exposes configuration booleans only.

`POST /api/acquisition`, `Authorization: Bearer <worker API key>`, JSON `{"aweme_id":"7688672103729483058"}` returns HTTP 202, `request_id`, signed `task` and poll interval after GitHub accepts dispatch. Never automatically retry a failed/ambiguous POST: a network timeout might follow an accepted dispatch.

`GET /api/acquisition?task=<URL-encoded ticket>` with the same bearer key returns queued/running HTTP 202, or terminal HTTP 200 with completed/full `result`, or failed/error. Tickets expire after 24 hours. Results expire after one day. Poll every 10 seconds; do not hold a Vercel request open during acquisition.

Run matching checks exact UUID run title, branch, commit and dispatch event. Result matching checks UUID, aweme ID, run/attempt/commit provenance, complete hard-subtitle OCR, fresh_capture=true, transcript_cache_read=false, full_video_scanned=true and coverage end. Failed jobs and partial/mismatched/cached results never become PASS. The full text and segments are returned, not just summary counts.

GitHub artifact downloads are bounded to 4 MiB; credentials are not forwarded to artifact storage. Only result.json is decoded. Authenticated prototype callers are trusted operators; this is not a public quota-limited multi-user service.

## Verification boundary

Push runs a fresh worker smoke on the same publicly accessible video, with a new request UUID and full-result artifact. This is **worker evidence only**, not proof of Vercel-triggered end-to-end success. Existing fixed baseline scripts are retained for manual probe mode; OCR/provider source is unchanged.

A Preview PASS requires a real authenticated Preview POST, a matched workflow_dispatch run, and a Preview poll returning the fresh complete result. Unit tests use synthetic responses and are not content acceptance. Preserve actual HTTP replies, run/commit/artifact IDs and resulting transcript hash in acceptance evidence. The older run 36705825778 is only a verified historical baseline.

Official dispatch permission reference: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
