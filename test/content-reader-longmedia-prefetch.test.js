import assert from "node:assert/strict";
import test from "node:test";
import { ReaderError } from "../src/errors.js";
import { TranscriptionService } from "../src/services/transcription.js";

const ID = "7699093023455612160";
const SOURCE = {
  url: "https://douyinvod.example.test/public.m4a",
  kind: "audio",
  mediaType: "audio/mpeg",
  acquired_at: "2026-10-26T00:00:00Z",
  validated_at: "2026-10-26T00:00:01Z",
  diagnostics: { status: 206, size: 1000 }
};
const MEDIA = { bytes: new Uint8Array([1, 2, 3, 4]), mediaType: "audio/mpeg" };
const VIDEO = {
  aweme_id: ID, media: { duration_ms: 1_006_516 },
  captions: { available: false, tracks: [] }
};
function asr() {
  return {
    method: "local_whisper_cpp_base_q5_1",
    text: "真实音频文字",
    segments: [{ start_ms: 0, end_ms: 1000, text: "真实音频文字" }],
    engine: { name: "whisper.cpp" }, model: { sha256: "a".repeat(64) },
    coverage: { start_ms: 0, end_ms: 1_006_516, full_audio_scanned: true, chunk_count: 4 }
  };
}
function service({ mediaResolver, hardSubtitleOcr, localAsr = async () => asr(), streamingAsr = null, prefetchLongMedia = true, requestDeadlineAt = null }) {
  return new TranscriptionService({
    mediaResolver, localAsr, hardSubtitleOcr, streamingAsr, prefetchLongMedia, requestDeadlineAt,
    openAiApiKey: null, aiGatewayApiKey: null, vercelOidcToken: null,
    audioExtractor: null
  });
}
test("long sparse-caption videos reuse early validated media after a lengthy OCR pass", async () => {
  const events = [];
  const r = service({
    mediaResolver: {
      async resolve(v) { assert.equal(v.aweme_id, ID); events.push("resolve"); return SOURCE; },
      async fetch(s) { assert.equal(s, SOURCE); events.push("fetch"); return MEDIA; }
    },
    hardSubtitleOcr: async () => {
      events.push("ocr");
      throw new ReaderError("OCR_CAPTIONS_SPARSE", "Sparse labels", { status: 422 });
    },
    localAsr: async ({ bytes }) => {
      assert.equal(bytes, MEDIA.bytes);
      events.push("asr");
      return asr();
    }
  });
  const out = await r.read(VIDEO);
  assert.deepEqual(events, ["resolve", "fetch", "ocr", "asr"]);
  assert.equal(out.method, "local_whisper_cpp_base_q5_1");
  assert.equal(out.source.coverage.full_audio_scanned, true);
  assert.equal(out.media_resolution.validation.status, 206);
  assert.equal(out.source.stable_aweme_id, ID);
});
test("hard OCR remains authoritative even when long-media prefetch succeeded", async () => {
  const events = [];
  const r = service({
    mediaResolver: {
      async resolve() { events.push("resolve"); return SOURCE; },
      async fetch() { events.push("fetch"); return MEDIA; }
    },
    hardSubtitleOcr: async () => {
      events.push("ocr");
      return { status: "complete", method: "hard_subtitle_ocr",
        text: "全片字幕", segments: [{ start_ms: 0, end_ms: 1000, text: "全片字幕" }] };
    },
    localAsr: async () => { events.push("asr"); throw Error("ASR must not run"); }
  });
  const out = await r.read(VIDEO);
  assert.deepEqual(events, ["resolve", "fetch", "ocr"]);
  assert.equal(out.method, "hard_subtitle_ocr");
});
test("failed early fetch falls back to fresh media after sparse OCR", async () => {
  let attempts = 0;
  const events = [];
  const r = service({
    mediaResolver: {
      async resolve() {
        events.push("resolve");
        if (++attempts === 1) throw new ReaderError("MEDIA_UNAVAILABLE", "Temporary media gap", { status: 422 });
        return SOURCE;
      },
      async fetch() { events.push("fetch"); return MEDIA; }
    },
    hardSubtitleOcr: async () => { events.push("ocr"); throw new ReaderError("OCR_CAPTIONS_SPARSE", "Sparse", { status: 422 }); },
    localAsr: async () => { events.push("asr"); return asr(); }
  });
  const out = await r.read(VIDEO);
  assert.deepEqual(events, ["resolve", "ocr", "resolve", "fetch", "asr"]);
  assert.equal(out.status, "complete");
});
test("login access restriction during prefetch stays terminal", async () => {
  const events = [];
  const r = service({
    mediaResolver: {
      async resolve() { events.push("resolve"); throw new ReaderError("DOUYIN_LOGIN_REQUIRED", "Login required", { status: 403 }); },
      async fetch() { events.push("fetch"); throw Error("Not expected"); }
    },
    hardSubtitleOcr: async () => { events.push("ocr"); throw Error("Must not scan"); }
  });
  await assert.rejects(r.read(VIDEO), e => e.code === "DOUYIN_LOGIN_REQUIRED");
  assert.deepEqual(events, ["resolve"]);
});
test("short videos retain OCR-first with zero speculative media fetches", async () => {
  const events = [];
  const r = service({
    mediaResolver: {
      async resolve() { events.push("resolve"); throw Error("Should not fetch"); },
      async fetch() { events.push("fetch"); throw Error("Should not fetch"); }
    },
    hardSubtitleOcr: async () => {
      events.push("ocr");
      return { status: "complete", method: "hard_subtitle_ocr",
        text: "短视频字幕", segments: [{ start_ms: 0, end_ms: 1000, text: "短视频字幕" }] };
    }
  });
  const out = await r.read({ ...VIDEO, media: { duration_ms: 60_000 } });
  assert.deepEqual(events, ["ocr"]);
  assert.equal(out.text, "短视频字幕");
});
test("prefetch can be disabled without changing legacy OCR-first flow", async () => {
  const events = [];
  const r = service({
    prefetchLongMedia: false,
    mediaResolver: {
      async resolve() { events.push("resolve"); return SOURCE; },
      async fetch() { events.push("fetch"); return MEDIA; }
    },
    hardSubtitleOcr: async () => { events.push("ocr"); throw new ReaderError("OCR_CAPTIONS_SPARSE", "Sparse", { status: 422 }); },
    localAsr: async () => { events.push("asr"); return asr(); }
  });
  const out = await r.read(VIDEO);
  assert.deepEqual(events, ["ocr", "resolve", "fetch", "asr"]);
  assert.equal(out.status, "complete");
});

test("media exhaustion reports only bounded candidate count and HTTP statuses", async () => {
  const r = service({
    prefetchLongMedia: false,
    mediaResolver: {
      async resolve() {
        throw new ReaderError("MEDIA_UNAVAILABLE", "No usable media", {
          status: 422,
          details: { attempts: [
            { host: "public.example.test", url_hash: "SECRET_HASH_SHOULD_NOT_LEAK", status: 403 },
            { refresh: { code: "PRIVATE_UPSTREAM_CODE" } },
            { url: "https://private.invalid/media?key=SECRET", status: 404 }
          ] }
        });
      },
      async fetch() { throw new Error("Must not fetch"); }
    },
    hardSubtitleOcr: async () => { throw new ReaderError("OCR_CAPTIONS_SPARSE", "Sparse", { status: 422 }); }
  });
  await assert.rejects(r.read(VIDEO), error => {
    assert.equal(error.code, "TRANSCRIPTION_MEDIA_UNAVAILABLE");
    assert.deepEqual(error.details.media_attempts, {
      media_candidates_checked: 2,
      refresh_failure_recorded: true,
      http_statuses: [403, 404],
      rejection_counts: { http_status: 0, oversized: 0, empty: 0, non_media: 0, network_error: 0, range_unsupported: 0 },
      largest_declared_size_bytes: null,
      checks_truncated: false
    });
    assert.doesNotMatch(JSON.stringify(error.details), /SECRET|PRIVATE_UPSTREAM|private\.invalid|https:\/\//);
    return true;
  });
});

const STREAM_SOURCE = {
  url: "https://douyinvod.example.test/range.mp4",
  kind: "video",
  mediaType: "video/mp4",
  acquired_at: "2026-10-29T00:00:00Z",
  validated_at: "2026-10-29T00:00:01Z",
  diagnostics: { status: 206, size: 262144000 }
};
function streamedResult(durationMs) {
  return {
    ...asr(),
    coverage: { start_ms: 0, end_ms: durationMs, full_audio_scanned: true, chunk_count: 8 },
    audio_preprocessing: { method: "ffmpeg_http_range_pcm16_mono", sample_rate: 16000, channel_count: 1, duration_ms: durationMs }
  };
}

test("20-90 minute videos prefer verified streaming ASR before full-frame OCR", async () => {
  const events = [];
  const durationMs = 31 * 60_000;
  const r = service({
    mediaResolver: {
      async resolve() { events.push("resolve"); throw new Error("full media must not be buffered"); },
      async fetch() { events.push("fetch"); throw new Error("full media must not be buffered"); }
    },
    hardSubtitleOcr: async () => { events.push("ocr"); throw new Error("OCR must not run after streaming succeeds"); },
    streamingAsr: async ({ video }) => {
      events.push("stream");
      return { result: streamedResult(video.media.duration_ms), source: STREAM_SOURCE };
    }
  });
  const out = await r.read({ ...VIDEO, media: { duration_ms: durationMs }, captions: { tracks: [] } });
  assert.deepEqual(events, ["stream"]);
  assert.equal(out.method, "local_whisper_cpp_base_q5_1");
  assert.equal(out.source.coverage.full_audio_scanned, true);
  assert.equal(out.source.coverage.end_ms, durationMs);
  assert.equal(out.media_resolution.validation.status, 206);
});

test("10-30 minute videos fall back to streaming ASR after OCR fails and early media is unavailable", async () => {
  const events = [];
  const r = service({
    mediaResolver: {
      async resolve() {
        events.push("resolve");
        throw new ReaderError("MEDIA_UNAVAILABLE", "The full media is too large for the bounded in-memory path.", { status: 422 });
      },
      async fetch() { events.push("fetch"); throw new Error("must not fetch full media after stream success"); }
    },
    hardSubtitleOcr: async () => {
      events.push("ocr");
      throw new ReaderError("OCR_PLAYER_CHANGED", "The public player rotated its source.", { status: 503 });
    },
    streamingAsr: async ({ video }) => {
      events.push("stream");
      return { result: streamedResult(video.media.duration_ms), source: STREAM_SOURCE };
    }
  });
  const out = await r.read(VIDEO);
  assert.deepEqual(events, ["resolve", "ocr", "stream"]);
  assert.equal(out.source.coverage.full_audio_scanned, true);
  assert.equal(out.media_resolution.validation.status, 206);
});

test("90-minute streaming failure skips OCR when the remaining budget cannot cover a full scan", async () => {
  const events = [];
  const durationMs = 90 * 60_000;
  const r = service({
    requestDeadlineAt: Date.now() + 60_000,
    mediaResolver: {
      async resolve() { events.push("resolve"); throw new Error("must not buffer a 90-minute file"); },
      async fetch() { events.push("fetch"); throw new Error("must not fetch"); }
    },
    hardSubtitleOcr: async () => { events.push("ocr"); throw new Error("OCR would exceed remaining budget"); },
    streamingAsr: async () => {
      events.push("stream");
      throw new ReaderError("STREAMING_AUDIO_EXTRACT_TIMEOUT", "The current public media range timed out.", {
        status: 503, details: { stage: "extract", chunk_index: 3, completed_chunks: 3, total_chunks: 23 }
      });
    }
  });
  await assert.rejects(r.read({ ...VIDEO, media: { duration_ms: durationMs }, captions: { tracks: [] } }), error => {
    assert.equal(error.code, "TRANSCRIPTION_UNAVAILABLE");
    assert.equal(error.details.ocr_skipped_reason, "insufficient_remaining_budget_for_full_video_ocr");
    assert.equal(error.details.streaming_attempts[0].code, "STREAMING_AUDIO_EXTRACT_TIMEOUT");
    assert.equal(error.details.streaming_attempts[0].completed_chunks, 3);
    return true;
  });
  assert.deepEqual(events, ["stream"]);
});
