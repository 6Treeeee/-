# Content Reader Level 2 — Production OCR Task

## Why this task exists

2026-09-23 production audit confirmed two separate unfinished areas:

1. the ordinary ChatGPT MCP entry is currently blocked by authorization;
2. the production Content Reader itself still reports `hard_subtitle_ocr.configured=false`.

Do not let the external ChatGPT authorization blocker stop engineering work that can be completed independently through the already-public Content Reader HTTP API.

## Owner Goal

Move the already-verified local Douyin single-video reading capability into the real production Content Reader path, without changing scope or rebuilding accepted components.

This task is **not** the final Level 2 acceptance. It closes the production backend gap first.

## Frozen PASS — do not redo

- Douyin public single-video identity resolution
- metadata and media discovery / validation
- public caption route
- live-browser hard-subtitle OCR logic
- Yuan full-video OCR acceptance
- unfamiliar positive and negative OCR blind tests
- existing ASR fallback behavior
- Tree Brain Infrastructure v1
- MCP task_start / task_status / task_resume
- OAuth / Tunnel exploration

Evidence:
- `gpt-handoff-content-reader-level2-blind-test.md`
- `gpt-handoff-yuan-full-subtitle.md`
- `gpt-handoff-yuan-hard-subtitle.md`
- `artifacts/douyin/level2-production-audit-2026-09-23.json`

## Current production facts

- Production Content Reader: `https://sigma-silk-88.vercel.app/api`
- Existing API handler: `api/index.js`
- Existing service: `src/content-reader.js:readPublicContent`
- Request form: `POST /api` with `{url, type:"video", fresh:true}`
- Current production health: `hard_subtitle_ocr.configured=false`
- Production env currently lacks `CONTENT_READER_OCR_PYTHON`
- Existing OCR dependency file: `config/ocr-requirements.txt`
- Existing production deployment is not evidence that Python + RapidOCR + browser capture are actually runnable there.

## Single goal

Make the **existing** hard-subtitle OCR route actually runnable in production, then prove it with one fresh unfamiliar public Douyin single-video request through the production `/api` path.

## Execution order

### 1. Audit runtime feasibility first

Before modifying architecture, determine with the smallest possible probe:

- whether the production runtime can execute the existing Python OCR worker;
- whether required Python packages can be packaged/imported;
- whether the existing browser screenshot / player-binding path is usable in the production execution environment;
- whether the real request can fit the existing production duration limits.

Do not infer from local PASS.

If a platform hard limit makes the accepted local implementation impossible on this Vercel runtime, report that exact limit and stop before redesigning the system.

### 2. Minimal production packaging only

If runtime feasibility is confirmed:

- package only the dependencies already required by the accepted OCR implementation;
- configure the existing `CONTENT_READER_OCR_PYTHON` path correctly;
- make the minimum deployment changes needed for the existing route;
- do not alter OCR algorithms, thresholds, transcript semantics, platform scope, or ASR provider choices unless a real production incompatibility requires a narrowly bounded compatibility fix.

No new paid ASR.

### 3. Production deployment

Deploy the smallest accepted change.

Record:
- deployment ID;
- source commit SHA;
- health response;
- whether `hard_subtitle_ocr.configured` becomes true;
- actual Python/RapidOCR/browser runtime probe results.

### 4. Fresh unfamiliar-video acceptance

Use one normal public Douyin single-video URL that is unfamiliar and not already present in repository evidence.

Call production `POST /api` with `fresh:true`.

PASS requires real evidence:
- requested and observed aweme_id match;
- no stored transcript / verified transcript artifact is used;
- full or reasonable video-content coverage is obtained;
- source route is recorded (caption / hard-subtitle OCR / ASR);
- returned text is sufficient for a content-level question;
- no fixture, cached transcript, manual transcription, or pre-generated evidence is substituted.

If the selected video has no usable hard subtitles and correctly falls through to unavailable ASR, that is an honest negative result but not the positive production acceptance. A second unfamiliar sample may be selected only if needed to obtain one positive read.

## Explicitly out of scope

- Do not fix or redesign ordinary ChatGPT MCP authorization in this task.
- Do not add `read_douyin_video` yet.
- Do not reopen OAuth.
- Do not reopen Secure MCP Tunnel.
- Do not change Tree Brain infrastructure.
- Do not add personal-profile support.
- Do not add Kuaishou, Bilibili, or other platforms.
- Do not add paid ASR.
- Do not claim Level 2 complete after backend production PASS.

## Final report

Return only:

1. production runtime feasibility result;
2. actual files changed;
3. deployment ID and commit SHA;
4. `hard_subtitle_ocr.configured` after deployment;
5. fresh unfamiliar video URL and aweme_id;
6. actual transcript source;
7. coverage / provenance evidence;
8. one content-level validation question and answer grounded in the returned transcript;
9. tests;
10. production backend PASS / FAIL;
11. remaining blocker for the ordinary ChatGPT direct-consumption path.

If production runtime cannot support the accepted implementation, stop with the exact platform limitation rather than inventing a replacement architecture.
