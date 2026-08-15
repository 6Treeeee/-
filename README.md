# Content Reader

Content Reader is a public-content retrieval layer intended to give AI systems enough normalized data to read a source. Phase 1 supports public Douyin videos and public creator profiles only.

It does not bypass authentication, paywalls, DRM, CAPTCHA, private-account restrictions, or other access controls. TikHub is used only for its documented public Douyin routes, and no user cookie is accepted or forwarded.

## API

```text
GET /api?url=PUBLIC_DOUYIN_URL
GET /api?type=video&url=PUBLIC_DOUYIN_VIDEO_URL
GET /api?type=profile&url=PUBLIC_DOUYIN_PROFILE_URL
POST /api
Content-Type: application/json

{"url":"PUBLIC_DOUYIN_URL","type":"auto"}
```

The service returns a versioned common envelope:

```json
{
  "ok": true,
  "schema_version": "1.0",
  "platform": "douyin",
  "content_type": "video",
  "source": {},
  "content": {}
}
```

Profiles include normalized creator metadata, the deduplicated post list, each pagination series, and a `pagination.complete` signal. Videos include metadata, author, media URLs, captions when exposed upstream, and a `transcription_input` describing either a caption track or usable public video media.

## Retrieval contracts

- Video: App V3 share-URL route, followed by the documented Web share-URL fallback only when the App result contains no video.
- Profile identity: `sec_user_id` parsed from the resolved public URL when possible, otherwise TikHub's documented Web ID extractor.
- Profile metadata: App V3 profile route, with the documented Web profile route as fallback.
- Posts: App V3 pages with `count=20`, `sort_type=0`, `channel=normal`; Web is selected only if App fails before page one. Cursor families are never mixed within a pagination series.
- Reconciliation: if the public profile's post count is greater than the exhausted normal feed, independent Lite and then Web series are tried and deduplicated.

`TIKHUB_API_KEY` must be configured in the server environment. It is sent only as `Authorization: Bearer …` and is never included in responses or diagnostics.

## Local verification

```text
npm run check
npm test
```

The test suite uses Node's built-in test runner and mocked public responses, so it does not require secrets or consume TikHub quota.
