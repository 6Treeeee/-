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
  -> otherwise ASR (OpenAI -> Vercel AI Gateway -> injected local ASR)
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

## Configuration

All credentials are optional:

```text
TIKHUB_API_KEY       optional metadata provider
OPENAI_API_KEY       preferred cloud ASR when configured
AI_GATEWAY_API_KEY   Vercel AI Gateway ASR
VERCEL_OIDC_TOKEN    injected by Vercel and accepted by AI Gateway
```

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

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for runtime dependencies
and open-source research references.
