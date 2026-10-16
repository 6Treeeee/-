import { ReaderError } from "../errors.js";

export function verifyAcquisitionResult(envelope, expected) {
  const content = envelope?.result?.content;
  const readable = content?.readable_content;
  const duration = Number(content?.duration_ms ?? content?.media?.duration_ms ?? 0);
  const id = String(content?.aweme_id ?? content?.id ?? "");
  if (envelope?.request_id !== expected.request_id || envelope?.aweme_id !== expected.aweme_id ||
      id !== expected.aweme_id || envelope?.pass !== true ||
      readable?.status !== "complete" || readable?.method !== "hard_subtitle_ocr" ||
      readable?.source?.fresh_capture !== true || readable?.source?.transcript_cache_read !== false ||
      readable?.source?.coverage?.full_video_scanned !== true || duration <= 0 ||
      Number(readable?.source?.coverage?.end_ms ?? 0) < duration - 1000 ||
      !Array.isArray(readable?.segments) || readable.segments.length === 0 ||
      typeof readable?.text !== "string" || !readable.text.trim()) {
    throw new ReaderError("WORKER_RESULT_INVALID",
      "Worker result did not provide a complete fresh hard-subtitle OCR transcript.", {
        status: 502,
        details: {
          required_method: "hard_subtitle_ocr",
          actual_method: ["hard_subtitle_ocr", "local_whisper_cpp_base_q5_1", "captions"]
            .includes(readable?.method) ? readable.method : "unknown"
        }
      });
  }
  return envelope;
}
