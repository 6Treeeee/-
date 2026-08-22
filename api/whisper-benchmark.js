import { createHash } from "node:crypto";

import { createLocalWhisperAsr } from "../src/services/local-whisper.js";

const AUDIO_URL = "https://sf11-cdn-tos.douyinstatic.com/obj/ies-music/7669061106578082603.mp3";
const EXPECTED_BYTES = 876_664;
const EXPECTED_SHA256 = "40704c5253f0b904f681856ba0aca7a009d5324de9670ddea811d699579b91a2";
const DURATION_MS = 54_720;

function monotonic(segments) {
  let previousEnd = 0;
  for (const segment of segments ?? []) {
    if (!Number.isFinite(segment.start_ms) || !Number.isFinite(segment.end_ms)) return false;
    if (segment.start_ms < previousEnd || segment.end_ms < segment.start_ms) return false;
    previousEnd = segment.end_ms;
  }
  return true;
}

async function downloadExactAudio() {
  const startedAt = performance.now();
  const response = await fetch(AUDIO_URL, {
    cache: "no-store",
    credentials: "omit",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw Object.assign(new Error("MEDIA_FETCH_FAILED"), { code: "MEDIA_FETCH_FAILED" });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== EXPECTED_BYTES || sha256 !== EXPECTED_SHA256) {
    throw Object.assign(new Error("MEDIA_INTEGRITY_FAILED"), { code: "MEDIA_INTEGRITY_FAILED" });
  }
  return {
    bytes,
    elapsedMs: Math.round(performance.now() - startedAt),
    mediaType: response.headers.get("content-type")?.split(";", 1)[0] ?? "audio/mpeg"
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    return response.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  response.setHeader("cache-control", "no-store");

  const parsed = new URL(request.url, "https://benchmark.invalid");
  const threads = Number(parsed.searchParams.get("threads") ?? "1");
  if (![1, 2].includes(threads)) {
    return response.status(400).json({ ok: false, error: "THREADS_INVALID" });
  }

  const startedAt = performance.now();
  let diagnostic = null;
  try {
    const media = await downloadExactAudio();
    const inferenceStartedAt = performance.now();
    const localAsr = createLocalWhisperAsr({
      threadCount: threads,
      timeoutMs: 240_000,
      diagnosticSink: (value) => { diagnostic = value; }
    });
    const transcript = await localAsr.transcribe({
      bytes: media.bytes,
      mediaType: media.mediaType,
      video: { media: { duration_ms: DURATION_MS } }
    });
    return response.status(200).json({
      ok: true,
      target: "douyin_video_7669061012259179785_original_audio",
      threads,
      input_bytes: media.bytes.byteLength,
      input_sha256: EXPECTED_SHA256,
      media_fetch_ms: media.elapsedMs,
      local_asr_elapsed_ms: Math.round(performance.now() - inferenceStartedAt),
      total_elapsed_ms: Math.round(performance.now() - startedAt),
      method: transcript.method,
      processing_ms: transcript.processing_ms,
      text_characters: transcript.text.length,
      segment_count: transcript.segments.length,
      monotonic_timestamps: monotonic(transcript.segments),
      cpu_backend: diagnostic?.cpu_backend ?? null
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      threads,
      elapsed_ms: Math.round(performance.now() - startedAt),
      error: typeof error?.code === "string" ? error.code : "BENCHMARK_FAILED",
      stage: typeof error?.details?.stage === "string" ? error.details.stage : null,
      cpu_backend: diagnostic?.cpu_backend ?? null
    });
  }
}
