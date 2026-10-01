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
    throw Object.assign(new Error("Worker result failed identity, freshness or full-coverage validation."), { code: "WORKER_RESULT_INVALID", status: 502 });
  }
  return envelope;
}
