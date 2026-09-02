# Content Reader Level 2 hard-subtitle OCR handoff

Task ID: `CONTENT_READER_LEVEL2_HARD_SUBTITLE_OCR_001`

Final status: **COMPLETE — formal single-video route accepted locally, including one positive unfamiliar blind read and one honest negative routing case.**

Branch: `codex/a2a-control-loop`

This handoff was finalized from the evidence already present after the interrupted run. The finalization did **not** rerun Yuan or either unfamiliar blind video.

## Scope and acceptance boundary

The formal Content Reader single-video flow now retains all existing reading routes in this order:

1. real public caption tracks;
2. fresh live-browser hard-subtitle OCR;
3. existing media resolution and ASR fallbacks.

The OCR route uses only a fresh public Douyin page and the player bound to the requested `aweme_id`. A request with `fresh: true` bypasses stored transcript and verified-transcript artifacts. The result records the live run ID, exact video identity, duration, frame and probe hash chains, full-video coverage, OCR engine/model hashes, and whether any transcript cache was read.

No login, cookies, CAPTCHA bypass, private endpoint, pre-generated transcript, saved experiment transcript, or hardcoded content is used. The code does not replace or remove direct captions or ASR.

## Minimal production-path implementation

- `src/services/hard-subtitle-ocr.js`: exact-player binding, 250 ms visual-change probing, browser screenshots, live OCR orchestration, temporal consensus, timeline assembly, coverage gating, and evidence receipts.
- `src/services/hard-subtitle-worker.py`: lower-frame subtitle-region OCR with pinned RapidOCR dependencies and scene/UI filtering.
- `config/ocr-requirements.txt`: pinned Python OCR runtime dependencies.
- `src/providers/direct-public-web.js`: exposes only the identity-bound live page callback needed by OCR.
- `src/services/transcription.js`: runs OCR after real caption tracks and before existing media/ASR routes; rejects sparse screen text and falls through.
- `src/services/content-processing.js`, `src/platforms/douyin.js`, `src/content-reader.js`, and `api/index.js`: propagate the fresh/no-artifact policy, browser evidence callback, request deadline, and safe public response.
- `scripts/serve-content-reader.mjs`: local formal API entry used for the recorded runs.
- `test/content-reader.test.js` and `test/douyin-pipeline.test.js`: route-order, identity/deadline, deduplication, temporal-consensus, sparse-coverage, and multi-row UI exclusion coverage.

## Yuan formal-entry acceptance (existing evidence; not rerun during finalization)

- Public ID: `7674668931734326528`
- Formal request: `yuan-live-ocr-006`
- OCR run: `97a87ed7-1b9a-4b64-a881-682aa5a31697`
- Expected/observed identity: exact match
- Bound player duration: 1,119,782 ms; normalized media duration: 1,119,766 ms
- Coverage: 0–1,119,782 ms, full video, 250 ms visual probe
- 4,480 checks; 1,175 live changed frames; 499 final segments
- Timeline audit: 0 time reversals, 0 adjacent exact duplicates, maximum uncovered gap 1,250 ms
- First/last text: `你20多岁了` / `我们下期再见`
- Source: `hard_subtitle_ocr` / `live_browser_rapidocr`
- `fresh_capture: true`; `transcript_cache_read: false`; ASR not used
- Frame chain: `3f9cbc175d05ea5db984d9fca4e976f78c97aa6b8a511d1a7589b095785f8245`
- Probe chain: `19b0f031e1fbaa13dccceb1d883915b45316da1fa5af73201f217003d1fd5318`

The task Owner had already accepted this final full-video run. It was preserved and packaged, not repeated.

### Yuan failure/fix trail preserved from the live work

| Attempt | Real result | Minimal correction |
|---|---|---|
| 001 | OCR failed and the unavailable ASR route returned a safe failure | exposed only safe OCR failure evidence |
| 002 | browser canvas access was blocked by cross-origin security | changed capture to browser screenshots |
| 003 | a short recommended same-page video was initially mistaken for the target | bound both exact `aweme_id` and target-player duration |
| 004 | correct long player reached about 6:30, then seek recovery exhausted its deadline | added bounded seek recovery without changing architecture |
| 005 | full-video run succeeded, but audit found short-lived OCR oscillation | added temporal consensus and tighter subtitle-region filtering |
| 006 | final accepted full-video evidence above | no further route change |

## Unfamiliar blind video 1: honest negative routing test

- Selection receipt: `artifacts/douyin/hard-subtitle-ocr-validation/blind-selection.json`
- Public ID: `7550875346879417639`
- Duration: 374,144 ms
- It was absent from prior development evidence and was not pre-read before selection.
- Pre-fix request `blind-live-ocr-002` incorrectly treated 36 sparse scene/UI labels as a caption track. Content-level frame review found long ordinary interview stretches without readable hard subtitles, so HTTP success was rejected as a false acceptance.
- Minimal fix: multi-row scene/UI exclusion plus sustained caption-activity gating.
- Post-fix request: `blind-live-ocr-003`; run `131a8758-b637-4b56-b90a-ba07e7f529d8`.
- 1,497 checks; 390 changed frames; only 29,000 ms active text (7.7532%); only 21/38 ten-second windows contained candidate captions (55.2632%).
- OCR correctly returned `OCR_CAPTIONS_SPARSE` and invoked the existing ASR route.
- Final API result was the honest `TRANSCRIPTION_UNAVAILABLE` (HTTP 503), because this Windows host had no configured cloud ASR credentials and the checked-in local Whisper runtime supports Linux x64 only.

This is accepted as a negative routing test: the formal route no longer invents a readable transcript from incidental screen text, and it correctly falls through.

## Unfamiliar blind video 2: positive full read

- Selection receipt: `artifacts/douyin/hard-subtitle-ocr-validation/blind-positive-selection.json`
- Public ID: `7589860433402531110`
- Title: `停不下来的“无脑刷视频”？知识到底怎么进脑子啊！`
- Author: `苏大实验员萝卜`
- It had zero repository/evidence matches and was not opened before the blind request.
- Formal request: `blind-positive-ocr-002`
- OCR run: `b8e48b02-a2d4-4596-9178-beca216e7f72`
- Expected/observed identity: exact match; bound duration 133,237 ms
- Coverage: 0–133,237 ms, full video, 250 ms visual probe
- 533 checks; 413 changed frames; 115 final segments
- Sustained captions: 101,807 ms active (76.4105%); 14/14 ten-second windows covered
- Timeline audit: 0 time reversals, 0 adjacent exact duplicates, maximum uncovered gap 3,000 ms
- Source: `hard_subtitle_ocr`; `fresh_capture: true`; `transcript_cache_read: false`; no ASR fallback
- Frame chain: `2854f5915ce04fd0b9a2bc31887f8a4935c5fccd2c7afa6835e38e801d151676`
- Probe chain: `10f55f20a0403cbdf19f45bc241a495a435489e29ecf6c0b33fdc6789821b102`

Content-level review found the correct video/player, full coverage, ordered subtitles, no obvious sustained missing-caption stretch, no large-scale repetition, and no scene/UI dump after the fix. Localized OCR mistakes remain (examples: `你门`, `保解`, `B国HO`), so the output is useful machine-readable content but is not represented as a manually corrected quotation transcript.

## Verification completed during finalization

- `npm run check`: pass, including both new OCR JavaScript entry points
- `npm test`: **241/241 pass**
- `npm run build`: pass; standalone workflow build completed
- `python -m py_compile src/services/hard-subtitle-worker.py`: pass
- `git diff --check`: pass

No test or build step accessed or reran any Douyin video.

## Committed evidence package

Root: `artifacts/douyin/hard-subtitle-ocr-validation/`

Each final run directory contains:

- a sanitized formal API response with the full readable timeline but no signed media URL;
- `session.json`, `events.jsonl`, `visual-changes.jsonl`, and `ocr-frames.jsonl`;
- an explicit content/timeline/provenance `audit.json`;
- dispersed sample frames;
- `raw-evidence-manifest.json`, which hashes every external raw evidence file.

Manifest coverage:

- Yuan: 1,180 files / 274,077,004 bytes
- negative blind final run: 395 files / 48,064,491 bytes
- positive blind final run: 419 files / 75,828,955 bytes

The full raw runs remain locally at:

`C:\Users\Administrator\.codex\visualizations\2026\08\29\01a04bb7-861a-7631-9dc6-09ff18e801a2\CONTENT_READER_LEVEL2_001\live-runs`

They are deliberately not copied wholesale into Git. The committed manifests, logs, sanitized responses, audits, and sample frames make their content and integrity independently inspectable without committing roughly 398 MB of redundant raw frames or expiring media addresses.

## Known limits

1. This is a verified local formal-entry implementation, not a claim that the Python OCR runtime has already been packaged and exercised on Vercel production.
2. Deployment must install `config/ocr-requirements.txt` and point `CONTENT_READER_OCR_PYTHON` at that runtime.
3. Visual OCR reads visible subtitles only; sub-250ms, low-contrast, low-change, occluded, or stylized subtitles can be missed.
4. Temporal consensus reduces but cannot eliminate localized character errors. Output is not manually corrected quotation-grade text.
5. Sparse or absent hard subtitles are rejected and fall through to the existing ASR routes; success then depends on an available ASR provider/runtime.
6. The synchronous browser OCR route retains the existing bounded single-video duration and request-deadline constraints.

## Stop state

All requested code, final tests, Yuan evidence, both blind-test outcomes, failure/fix evidence, and known limitations are packaged on the current branch. No A2A work, personal-profile support, other platform, control bridge, real-time progress API, or unrelated refactor was added.
