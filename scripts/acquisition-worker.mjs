import { mkdir, writeFile } from "node:fs/promises";
import { readPublicContent } from "../src/content-reader.js";
import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { HardSubtitleOcr } from "../src/services/hard-subtitle-ocr.js";
import { publicError } from "../src/errors.js";
import { verifyAcquisitionResult } from "../src/services/acquisition-result.js";

const aweme_id = process.env.ACQUISITION_AWEME_ID;
const request_id = process.env.ACQUISITION_REQUEST_ID;
if (!/^\d{15,22}$/.test(aweme_id ?? "") || !/^[a-f0-9-]{36}$/.test(request_id ?? "")) {
  throw new Error("Validated aweme_id and request UUID required.");
}
const started = Date.now();
const browserService = new PublicBrowserService({
  env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview" }, platform: "linux",
  navigationTimeoutMs: 45_000, protocolTimeoutMs: 60_000,
  viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
});
const directProvider = new DirectPublicWebProvider({ browserService, retries: 2,
  retryDelayMs: 500, videoNavigationTimeoutMs: 45_000, videoContentWaitMs: 22_000, settleMs: 700 });
const hardSubtitles = new HardSubtitleOcr({ env: process.env, provider: directProvider, requestId: request_id });
let envelope;
try {
  const result = await readPublicContent({ url: `https://www.douyin.com/video/${aweme_id}`, type: "video", fresh: true }, {
    fetchImpl: globalThis.fetch, providers: [directProvider],
    hardSubtitleOcr: hardSubtitles.read.bind(hardSubtitles),
    localAsr: null, openAiApiKey: null, aiGatewayApiKey: null, vercelOidcToken: null,
    requestId: request_id, requestDeadlineAt: started + 1_000_000
  });
  envelope = { request_id, aweme_id, pass: true, result, elapsed_ms: Date.now() - started,
    worker: { run_id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, commit: process.env.GITHUB_SHA } };
  verifyAcquisitionResult(envelope, { request_id, aweme_id });
} catch (error) {
  const safe = publicError(error);
  envelope = { request_id, aweme_id, pass: false, elapsed_ms: Date.now() - started,
    error: { code: error.code ?? safe.code, message: safe.message },
    worker: { run_id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, commit: process.env.GITHUB_SHA } };
  process.exitCode = 2;
}
await mkdir("acquisition-output", { recursive: true });
await writeFile("acquisition-output/result.json", JSON.stringify(envelope));
const readable = envelope.result?.content?.readable_content;
console.log(JSON.stringify({ event: "acquisition.completed", request_id, aweme_id, pass: envelope.pass,
  elapsed_ms: envelope.elapsed_ms, error: envelope.error,
  duration_ms: envelope.result?.content?.duration_ms,
  segment_count: readable?.segments?.length, text_length: readable?.text?.length,
  fresh_capture: readable?.source?.fresh_capture, transcript_cache_read: readable?.source?.transcript_cache_read,
  full_video_scanned: readable?.source?.coverage?.full_video_scanned }));
