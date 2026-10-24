import { mkdir, writeFile } from "node:fs/promises";
import { readPublicContent } from "../src/content-reader.js";
import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { createLocalWhisperAsr } from "../src/services/local-whisper.js";
import { verifyAcquisitionResult } from "../src/services/acquisition-result.js";

const id = "7699751880649428250";
const requestId = "00000000-0000-4000-8000-000000000001";
const started = Date.now();
const safe = { video_id: id, method: "asr_only_existing_public_media", verified: false };
await mkdir("asr-one-shot-output", { recursive: true });
try {
  const browserService = new PublicBrowserService({
    env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview" },
    platform: "linux",
    navigationTimeoutMs: 45_000,
    protocolTimeoutMs: 60_000,
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
  });
  const directProvider = new DirectPublicWebProvider({
    browserService, retries: 1, retryDelayMs: 500,
    videoNavigationTimeoutMs: 45_000, videoContentWaitMs: 22_000, settleMs: 700
  });
  const localWhisper = createLocalWhisperAsr();
  if (!localWhisper.available) throw Object.assign(new Error("Whisper unavailable"), {code:"LOCAL_ASR_UNAVAILABLE"});
  const result = await readPublicContent({
    url: `https://www.douyin.com/video/${id}`, type: "video", fresh: true
  }, {
    fetchImpl: globalThis.fetch, providers: [directProvider],
    hardSubtitleOcr: null, localAsr: localWhisper.transcribe,
    openAiApiKey: null, aiGatewayApiKey: null, vercelOidcToken: null,
    requestId, requestDeadlineAt: started + 440_000
  });
  const content = result.content;
  const readable = content?.readable_content;
  const envelope = { request_id: requestId, aweme_id: id, pass: true, result };
  verifyAcquisitionResult(envelope, { request_id: requestId, aweme_id: id });
  Object.assign(safe, {
    verified: true,
    duration_ms: content.duration_ms,
    recognition_method: readable.method,
    text_length: readable.text?.length ?? 0,
    segment_count: readable.segments?.length ?? 0,
    confidence: readable.confidence,
    coverage: readable.source?.coverage ?? null,
    limitations: readable.limitations ?? [],
    sample_head: String(readable.text ?? "").slice(0, 130),
    sample_tail: String(readable.text ?? "").slice(-130)
  });
  await writeFile("asr-one-shot-output/transcript.json", JSON.stringify({
    video_id: id, method: readable.method, duration_ms: content.duration_ms,
    limitations: readable.limitations, segments: readable.segments,
    text: readable.text
  }));
} catch (error) {
  safe.error_code = String(error?.code ?? "UNEXPECTED").slice(0, 80);
  safe.error_stage = String(error?.details?.stage ?? "unknown").slice(0, 50);
  process.exitCode = 2;
} finally {
  safe.elapsed_ms = Date.now() - started;
  console.log("TREE_ASR_ONE_SHOT_RESULT", JSON.stringify(safe));
  await writeFile("asr-one-shot-output/status.json", JSON.stringify(safe));
}
