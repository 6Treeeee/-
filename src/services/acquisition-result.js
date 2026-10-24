import { ReaderError } from "../errors.js";

const ACCEPTED_METHODS = ["hard_subtitle_ocr", "local_whisper_cpp_base_q5_1"];

function hasReadableText(readable) {
  return readable?.status === "complete" &&
    Array.isArray(readable.segments) && readable.segments.length > 0 &&
    typeof readable.text === "string" && Boolean(readable.text.trim());
}

function verifiedOcr(readable, duration) {
  const source = readable.source;
  return readable.method === "hard_subtitle_ocr" &&
    source?.fresh_capture === true && source?.transcript_cache_read === false &&
    source?.coverage?.full_video_scanned === true &&
    Number(source.coverage.end_ms) >= duration - 1000;
}

function verifiedAudioInference(readable, duration, id) {
  const source = readable.source;
  const coverage = source?.coverage;
  const media = readable.media_resolution;
  const validatedStatus = Number(media?.validation?.status);
  if (readable.method !== "local_whisper_cpp_base_q5_1" ||
      source?.type !== "asr" || source?.provider !== "local_whisper_cpp" ||
      source?.fresh_capture !== true || source?.transcript_cache_read !== false ||
      source?.stable_aweme_id !== id || source?.engine?.name !== "whisper.cpp" ||
      !/^[a-f0-9]{64}$/.test(String(source?.model?.sha256 ?? "")) ||
      coverage?.full_audio_scanned !== true || coverage?.start_ms !== 0 ||
      !Number.isFinite(coverage?.end_ms) ||
      coverage.end_ms < duration - 1000 || coverage.end_ms > duration + 10000 ||
      !Number.isInteger(coverage?.chunk_count) || coverage.chunk_count < 1 ||
      media?.stable_identity !== "aweme_id" ||
      !["video", "audio"].includes(media?.media_kind) ||
      !media?.validated_at || ![200, 206].includes(validatedStatus)) return false;

  // Timestamps must be authentic, nonnegative and monotonic; zero-length
  // placeholders and invented segments must not satisfy the acceptance gate.
  let previousStart = 0;
  for (const segment of readable.segments) {
    const start = Number(segment?.start_ms);
    const end = Number(segment?.end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousStart ||
        end <= start || start < 0 || end > duration + 10000 ||
        typeof segment?.text !== "string" || !segment.text.trim()) return false;
    previousStart = start;
  }
  return true;
}

export function verifyAcquisitionResult(envelope, expected) {
  const content = envelope?.result?.content;
  const readable = content?.readable_content;
  const duration = Number(content?.duration_ms ?? content?.media?.duration_ms ?? 0);
  const id = String(content?.aweme_id ?? content?.id ?? "");
  const baseValid = envelope?.request_id === expected.request_id &&
    envelope?.aweme_id === expected.aweme_id && id === expected.aweme_id &&
    envelope?.pass === true && Number.isFinite(duration) && duration > 0 &&
    hasReadableText(readable);
  if (baseValid && (verifiedOcr(readable, duration) || verifiedAudioInference(readable, duration, id))) {
    return envelope;
  }
  throw new ReaderError("WORKER_RESULT_INVALID",
    "Worker result did not provide a verified fresh OCR or full-audio speech-to-text result.", {
      status: 502,
      details: {
        required_methods: ACCEPTED_METHODS,
        actual_method: ACCEPTED_METHODS.includes(readable?.method) || readable?.method === "captions"
          ? readable.method : "unknown",
        // Safe diagnostics only. Do not put transcript text or media URLs in errors.
        ...(typeof readable?.text === "string" ? { text_length: readable.text.length } : {}),
        ...(Array.isArray(readable?.segments) ? { segment_count: readable.segments.length } : {}),
        ...(Number.isFinite(readable?.source?.coverage?.end_ms)
          ? { coverage_end_ms: readable.source.coverage.end_ms } : {})
      }
    });
}
