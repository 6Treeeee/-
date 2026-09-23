# Production OCR runtime packaging

Scope: package the existing `HardSubtitleOcr` route for the existing Node.js `/api`
function. No changes to OCR algorithms, thresholds, models, provider order, ASR,
MCP, or Tree Brain. This is not ordinary ChatGPT / Level 2 acceptance.

## Build and configuration

`vercel.json` runs `scripts/package-ocr-runtime.mjs` before the unchanged build.
The Linux x64 build downloads CPython 3.12.14 from the pinned upstream release,
verifies its SHA-256, installs the exact dependency closure from
`config/ocr-production-requirements.txt`, and starts the actual unchanged Python
worker. Failure to start or initialize fails the build. Generated binaries stay
out of Git; the manifest records Python, package versions, and OCR model hashes.

Required non-secret Vercel project variables (Production and Preview):

- `CONTENT_READER_OCR_PYTHON=assets/ocr/python/bin/python3.12`
- `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`

Only `api/index.js` includes the runtime and worker in its function bundle.
Runtime assets stay in the deployed read-only filesystem; they are not downloaded
or expanded into the limited `/tmp` space during requests. Existing Chromium,
Whisper, and OCR capture behavior remains unchanged. The API still has its
300-second function limit and 292-second request budget. No long-video guarantee
is inferred from local acceptance.

The production lock deliberately installs with `--no-deps` and contains the full
resolved dependency closure. `opencv-python-headless` replaces the same-version
GUI OpenCV wheel: the real function import of the GUI wheel failed with
`ImportError: libxcb.so.1`. This is a packaging compatibility substitution, not an
OCR algorithm change. `config/ocr-requirements.txt` remains unchanged; the packager
checks that the production RapidOCR version matches it.

## Feasibility evidence

Protected Preview probes, all on the existing project and `hkg1` region:

1. `dpl_G2K5iSrf2TsVvg6QkhGaSEVUqDNg`: default Node runtime has neither `python3`
   nor `python` (`ENOENT`). Existing Chromium launches, captures a JPEG, and reports
   H.264 support. This synthetic screenshot is not video-content acceptance.
2. `dpl_DukbiH3qHgtYNWTtpPxkAyq29Xj4`: bundled Python runs, but GUI OpenCV fails to
   import because `libxcb.so.1` is absent.
3. `dpl_3FeorhNkHesvtbueURK6rXx9oMmD`: same-version headless wheel imports; Python
   3.12.14, NumPy 2.5.3, OpenCV 5.0.0, ONNX Runtime 1.30.0, and RapidOCR initialize.
   Existing browser still captures a JPEG. A real public player probe for
   `7421538381705907475` returns `DOUYIN_SECURITY_VERIFICATION_REQUIRED`; it does
   not establish player binding or full transcript coverage.

`scripts/ocr-runtime-probe.mjs` preserves the finite diagnostic source. It was
temporarily copied to `api/ocr-runtime-probe.js` for protected Preview deployments
with a 120-second limit and explicit runtime `includeFiles`. It is not an API
endpoint in the production source. No caller-selected code, path, or URL is run.

Production health `configured=true` only means the configured path is enabled.
Positive acceptance additionally requires real fresh `/api` output with matching
video identity, route provenance, and sufficient transcript coverage. A source
security challenge is an access blocker, not proof of a Vercel Python limitation.

Platform references checked on 2026-09-23:
- https://vercel.com/docs/functions/limitations
- https://vercel.com/changelog/vercel-functions-can-now-be-up-to-5-gb-in-package-size

The platform documents 300 seconds maximum on Hobby and an opt-in large-functions
path up to 5 GB. Actual build/runtime evidence takes precedence over assumptions
about eligibility or successful content retrieval.

## Production release result (2026-09-23)

Packaging source commit: `d611d0a4e77f764d292df69fe59d216a6d5df26c`, pushed to
`codex/a2a-control-loop`. Both variables above were saved on the existing project.
Three model hashes match the already-accepted local evidence. Scoped regression
tests passed 154/154; syntax and diff checks passed.

Production deployment `dpl_BUT9xX7ZeyEwB7YRKjCds23WFnHh` was blocked before build.
After pushing the commit and verifying GitHub attributes it to `6Treeeee`, one
new attempt `dpl_82JyKemzBDCeUB4uTdfneHAt7R2M` was also blocked. The authoritative
deployment API returns `readyState=BLOCKED`, `seatBlock.blockCode=TEAM_ACCESS_REQUIRED`,
`seatBlock.isVerified=false`, and:

> The deployment was blocked because the commit author doesn’t have permission to create deployments for this project.

The CLI displays this state as UNKNOWN and may keep waiting. This is an account /
commit-author authorization gate, **not** an established Vercel compute, Python,
bundle-size, or timeout hard limit. The account must recognize the actual owner's
GitHub connection/author permission before deployment can proceed; author identity
and permission settings were not changed to evade the check. Official guidance:
https://vercel.com/docs/deployments/troubleshoot-project-collaboration#team-configuration

The production alias still points to `dpl_GLUz9U7G7rn9SAYyuoMaFbxukkxX` and its
health response still reports OCR `configured=false`. Saved project variables do
not retroactively modify that deployment. No fresh production video request was
claimed against the new implementation because it has not deployed. No transcript
or content-level answer was produced. Preserve the separate observed Douyin
security-verification blocker from the Preview player probe.

Evidence: `artifacts/douyin/production-ocr-2026-09-23/acceptance.json`, runtime
receipts, `production-deployment-blocked.json`, and `production-health.json`.
Resume only after the deployment authorization condition materially changes;
deploy this existing packaging work, then perform the requested production read.
