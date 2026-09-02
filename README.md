# Content Reader

Content Reader turns legally accessible public Douyin videos and creator
profiles into timestamped, normalized text for downstream AI analysis.

It does not log in, solve CAPTCHAs, use private cookies, or bypass paid content,
DRM, private accounts, or explicit access restrictions. A visible
`登录后查看更多作品` boundary is recorded and respected.

## Pipeline

```text
public Douyin URL
  -> safe redirect resolution
  -> provider chain
       video: TikHub -> DirectPublicWeb
       profile: DirectPublicWeb -> recent VerifiedPublicArtifact
                (same authoritative public boundary; TikHub excluded)
  -> stable aweme_id + normalized metadata
  -> current media validation / refresh
  -> public captions, when real tracks exist
  -> otherwise live hard-subtitle OCR on fresh browser frames
  -> otherwise ASR (OpenAI -> Vercel AI Gateway
     [openai/gpt-4o-mini-transcribe -> openai/whisper-1]
     -> local whisper.cpp base-q5_1)
  -> timestamped readable content
  -> failure-isolated creator analysis
```

TikHub is optional. HTTP 402, an unavailable route, an empty response, or an
otherwise unusable provider result falls through to the next legitimate public
provider. Explicit Douyin access restrictions are terminal and are never
retried through another route.

`DirectPublicWebProvider` uses an ordinary fresh logged-out Chromium context.
Douyin's own public web application generates its current request parameters;
the provider captures the resulting public metadata and media responses. It
does not ship a copied request signer, stealth plugin, or challenge solver.

Profile enumeration is intentionally direct-first: the rendered public page is
the authority for the unauthenticated access boundary. API objects are
intersected with the creator-grid links when the page exposes a login-for-more
gate. If that live browser path fails for a non-access reason, production may
use a complete verified capture of the same logged-out grid for up to 24 hours.
The capture is keyed by `sec_user_id`, includes every transcript and media-read
receipt, and contains no expiring media URL. Login, CAPTCHA, private, paid, DRM,
or explicit access errors are terminal and never fall through to the artifact.

## API

```text
GET /api?url=PUBLIC_DOUYIN_URL
GET /api?type=video&url=PUBLIC_DOUYIN_VIDEO_URL
GET /api?type=profile&url=PUBLIC_DOUYIN_PROFILE_URL

POST /api
Content-Type: application/json
{"url":"PUBLIC_DOUYIN_URL","type":"auto"}
```

Single-video results use schema `2.0` and include:

- stable `aweme_id` and canonical URL;
- real metadata, public AI chapter hints, captions, and current media sources;
- media `acquired_at`, validation, and refresh diagnostics;
- `readable_content.text`, timestamped segments, language, method, confidence,
  and limitations.

Profile results additionally include:

- deduplicated public posts and explicit pagination/access-boundary state;
- a readable result or isolated failure record for every accepted public post;
- creator-level topics, recurring claims, notable videos, chronology,
  viewpoint changes/tensions, and unverifiable claims;
- evidence links back to stable aweme IDs and canonical public URLs.

Diagnostics contain routes, hosts, status codes, sizes, and URL hashes. They do
not contain bearer tokens, cookies, signed media query strings, or API keys.
Functional media URLs remain in normalized video data because downstream media
reading requires them; they are treated as expiring addresses, not identities.

For videos without usable captions, the media resolver first prefers a public
creator-original-sound MP3 only when its duration matches the video. Otherwise
the pipeline demuxes AAC from the public MP4; the local fallback converts that
audio to a 16 kHz mono WAV in the already-shipped logged-out Chromium runtime.
The pinned, OpenMP-free `whisper.cpp` Linux engine and multilingual quantized
base model are then run one at a time, without runtime downloads. One bounded
waiter may queue behind the active CPU job; excess or expired waiters receive a
retryable busy result. Local ASR is bounded to 180-second / 25 MiB single-video
inputs and reports its lower-accuracy model limitation.

Synchronous multi-video profile requests keep captions, hosted ASR, and verified
artifacts, but deliberately do not enqueue local Whisper work. Serially
transcribing an unknown creator's full public grid cannot fit truthfully inside
one 300-second Function request; the response exposes this policy and reports
content-processing completeness separately from public-feed completeness.

## Configuration

All credentials are optional:

```text
TIKHUB_API_KEY       optional metadata provider
OPENAI_API_KEY       preferred cloud ASR when configured
AI_GATEWAY_API_KEY   Vercel AI Gateway ASR
VERCEL_OIDC_TOKEN    injected by Vercel and accepted by AI Gateway
CONTENT_READER_OCR_PYTHON
                     absolute path to a Python runtime with the pinned
                     config/ocr-requirements.txt dependencies installed
CONTENT_READER_HARD_SUBTITLES
                     set to 0 only to disable the live OCR route
CONTENT_READER_OCR_EVIDENCE_DIR
                     optional local directory for live frame/OCR evidence
```

On Vercel's Linux x64 runtime the checked-in, checksummed local Whisper assets
are an additional credential-free fallback. The health response distinguishes
platform support from an asset and executable startup preflight. No local-ASR
environment variable is required.

Hard-subtitle OCR is attempted only after real caption tracks are absent. It
uses a fresh public browser session, binds the exact aweme ID and target-player
duration, captures visual changes throughout the video, and rejects sparse
scene/UI text before the existing ASR routes are considered. For local
verification, install `config/ocr-requirements.txt`, set
`CONTENT_READER_OCR_PYTHON`, run `npm run serve`, and send a single-video
request with `fresh: true`. A production Linux/Vercel runtime must likewise
package the Python OCR dependencies; the repository does not claim deployment
until that runtime path has been exercised separately.

The repository contains a generated, source-evidenced transcript artifact for
the real acceptance profile. It avoids paying for and repeating identical ASR
on every production request. The artifact is keyed only by stable aweme ID;
single-video requests still retrieve and validate a current public media source
before serving cached readable content. The profile fallback records the media
validation performed during its recent public capture and intentionally omits
the expiring source URL. Unknown videos use the live caption/ASR path.

## Local verification and artifact generation

```text
npm install
npm run check
npm test

npm run capture:profile -- PUBLIC_PROFILE_URL
npm run download:media
python scripts/transcribe_profile.py --device cpu --compute-type int8
node scripts/build-verified-artifact.mjs
```

`faster-whisper` uses PyAV, so an external FFmpeg executable is not required for
the local acceptance pipeline. Media and raw captures are ignored by Git; the
committed verified artifact excludes expiring media URLs and credentials.

The deployable local fallback uses the pinned assets documented in
`assets/whisper/ASSET_MANIFEST.json`. Their hashes are verified both by tests
and once per cold runtime before inference.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for runtime dependencies
and open-source research references.

## A2A control loop

The repository also contains a deliberately small control layer between a
decision agent and a replaceable local coding executor. It borrows the A2A
task/message/artifact semantics, but it is not advertised as full A2A Protocol
conformance.

```text
authenticated decision client
  -> durable task + acceptance criteria + budgets
  -> outbound-only local Codex worker
  -> structured attempt + evidence + real-world observation
  -> deterministic reviewer + stop-loss rules
  -> CONTINUE | CHANGE_PATH | STOP | ROLLBACK | ASK_OWNER
```

The control API is intentionally limited to:

```text
POST /tasks
GET  /tasks
GET  /tasks/:id
GET  /tasks/:id/result
POST /tasks/:id/decision
POST /tasks/:id/executor
POST /tasks/:id/stop
```

All task routes require an Ed25519-signed request (or an explicitly configured
hashed bearer credential). Decision and worker identities use different keys,
roles, principals, and workspace scopes. Private keys stay outside the
repository; `config/a2a-public-keys.js` contains only public verification keys.
The worker accepts assignments only for fixed local workspace paths, strips
credential environment variables from Codex subprocesses, and never exposes an
inbound command port.

The server-side reviewer keeps build, test, deployment, real-world, and Owner
goal gates separate. The stop-loss state machine rejects mechanical retries
after two identical root causes, requires architecture review after two commits
without blind-test improvement, lowers priority when complexity rises without
Owner-goal progress, and routes a simpler alternative through a minimal proof
of concept. `ASK_OWNER` is accepted only for credentials, payment, permission,
manual login, legal/compliance boundaries, irreversible actions, or a major
product-direction choice.

For local development:

```text
npm install
npm run check
npm test
npm run build

npm install --prefix worker
copy worker/config.example.json worker/config.json
npm run test:worker
npm run a2a:worker
```

Generate a fresh decision/worker key pair with `npm run a2a:keys`. Store the
private PEM files outside this checkout, deploy only the generated public-key
configuration, and supply the private PEM text to the local worker through the
environment names referenced by `worker/config.json`.

The source selection and licensing analysis is recorded in
[`docs/a2a-upstream-evaluation.md`](docs/a2a-upstream-evaluation.md). The local
executor is optional: another coding agent can implement the same signed task
and report contract without changing the control service.
