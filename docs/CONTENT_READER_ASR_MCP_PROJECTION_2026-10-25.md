# Tree Content Reader — ASR MCP projection repair (2026-10-25)

## Owner Goal
Ordinary ChatGPT can truly read a public Douyin single-video link and return the verified full transcript. Preserve all PASS acquisition and Whisper stages; no new paid ASR, no re-download of the completed 12-minute sample, no unrelated Codex/A2A modifications.

## Proven facts
1. Real worker run [40130743092](https://github.com/6Treeeee/-/actions/runs/40130743092), aweme ID `7699751880649428250`, artifact `12575305245`: `pass=true`, `4026` transcript characters, `343` segments, verified full-audio local Whisper.
2. Vercel preview `dpl_GMW1NN78vTL1MpvkxVeUppAhC9nD`, original alias `git-codex-a2a-control-loop-1790063688-9925s-projects.vercel.app`, logs `content_reader.return_verified`. This proves upstream acceptance.
3. `bridge/content-reader-proxy/src/proxy.js` performs authentication, bounds and transparent JSON forwarding only; it does not independently check OCR/ASR methods.
4. The repository MCP formatter `src/mcp/douyin-tools.js` originally required `readable.source.coverage.full_video_scanned === true` for ALL completed videos, although verified local ASR uses `coverage.full_audio_scanned === true`. It also unconditionally emitted `full_video_scanned:true`, which would mislabel ASR.
5. Minimal repair: reuse the existing `verifyAcquisitionResult` strict acceptance gate and faithfully project OCR as full-video coverage or ASR as full-audio coverage; never weaken video/media/provenance checks or relabel speech as OCR. Changed files: `src/mcp/douyin-tools.js` and `test/douyin-tools.test.js`.
6. GitHub Actions [40163507117](https://github.com/6Treeeee/-/actions/runs/40163507117): `52/52 PASS`. Actual existing ZIP replay [40163632437](https://github.com/6Treeeee/-/actions/runs/40163632437): verified transcript `4026` chars / `343` segments correctly projected, `full_audio_scanned=true`, `full_video_scanned` absent; no new video or ASR.
7. Same two files synced to `codex/a2a-control-loop` at commit [de71806b](https://github.com/6Treeeee/-/commit/de71806b89562d5a6538437bdbd3be567b2579da). The pre-existing preview alias was switched to READY `dpl_GMW1NN78vTL1MpvkxVeUppAhC9nD`. Production alias `sigma-silk-88.vercel.app` still points to unchanged `dpl_29u8iDtKcGYNLTBxEp25W3ZaVsGn`.
8. **Ordinary ChatGPT plugin acceptance still FAIL**: `get_douyin_read_result` returned `WORKER_RESULT_INVALID` after the preview deployment. Preview logged `content_reader.return_verified` for that same request. The connected private plugin runtime has not been verified to load updated `src/mcp/douyin-tools.js`; its actual hosting/registration requires investigation. Global plugin catalog searches do not disclose private MCP configuration. **Do NOT claim end-to-end PASS.**

## First unresolved blocker / next smallest action
Identify the actual deployment/endpoint of the installed `Tree Content Reader` MCP plugin and synchronize its `publicDouyinResult` projection with the tested code. Verify the already existing task WITHOUT starting another acquisition, if its 24-hour ticket is still valid. If the connected runtime cannot be updated using available tools, report the access/connector constraint plainly; do not change Production or bypass identity checks to manufacture PASS. The real text is already preserved in the artifact and conversation attachment.

## Out of scope
Do not restart Douyin retrieval, OCR or local Whisper, do not modify Agent Core/DB/investment logic, do not create new servers or tunnel, do not enable paid transcription, do not touch A2A task lifecycle or change production deployment without explicit user approval.
