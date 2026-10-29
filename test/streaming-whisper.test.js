import test from "node:test";
import assert from "node:assert/strict";
import { createStreamingWhisperAsr } from "../src/services/streaming-whisper.js";

const video = (durationMs) => ({
  aweme_id: "7693868342775532850",
  duration_ms: durationMs,
  media: { duration_ms: durationMs }
});
const source = (url = "https://video.example.net/public.mp4") => ({
  url, kind: "video", mediaType: "video/mp4", acquired_at: new Date().toISOString(),
  validated_at: new Date().toISOString(), diagnostics: { status: 206, size: 262144000 }
});
const resultFor = (v, text = "spoken words") => ({
  text, segments: [{ start_ms: 0, end_ms: Math.min(1000, v.duration_ms), text }],
  language: "zh", method: "local_whisper_cpp_base_q5_1", confidence: 0.8,
  engine: { name: "whisper.cpp", release: "b4938", commit: "371b5a7561823ab2bb32142d2751e35e7534727b" },
  model: { name: "whisper-base-q5_1-multilingual", sha256: "a".repeat(64) },
  coverage: { start_ms: 0, end_ms: v.duration_ms, full_audio_scanned: true, chunk_count: 1 }
});
const pcmFor = (durationMs, sampleRate = 1000) => Buffer.alloc(Math.round(durationMs * sampleRate * 2 / 1000));

test("streaming transcription covers every chunk and emits a verified full-audio result", async () => {
  const resolver = { resolveStreamable: async () => source() };
  const extracted = [];
  const transcribed = [];
  const progress = [];
  const streaming = createStreamingWhisperAsr({
    chunkDurationMs: 30_000, overlapMs: 5_000, minDurationMs: 0, maxDurationMs: 120_000,
    sampleRate: 1000,
    onProgress: async (event) => progress.push(event),
    extractChunkImpl: async ({ startMs, durationMs }) => {
      extracted.push({ startMs, durationMs });
      return pcmFor(durationMs);
    }
  });
  const output = await streaming({
    video: video(65_000), mediaResolver: resolver, deadlineAt: Date.now() + 60_000, requestId: "b52a1e90-7d4c-4f63-a8b2-0c6e91f537da",
    localAsr: async ({ video: part }) => {
      transcribed.push(part.duration_ms);
      return resultFor(part, "spoken " + transcribed.length);
    }
  });
  assert.equal(extracted.length, 3);
  assert.equal(transcribed.length, 3);
  assert.equal(output.result.coverage.full_audio_scanned, true);
  assert.equal(output.result.coverage.start_ms, 0);
  assert.equal(output.result.coverage.end_ms, 65_000);
  assert.equal(output.result.coverage.chunk_count, 3);
  assert.equal(output.result.segments[0].start_ms, 0);
  assert.equal(output.result.segments.at(-1).end_ms, 61_000);
  assert.equal(output.source.diagnostics.status, 206);
  assert.equal(progress[0].phase, "started");
  assert.equal(progress.filter((item) => item.phase === "chunk_completed").length, 3);
  assert.equal(progress.at(-1).completed_chunks, 3);
  assert.equal(progress.at(-1).aweme_id, "7693868342775532850");
  assert.ok(!JSON.stringify(progress).includes("video.example.net"));
});

test("a transient chunk failure refreshes the public media source and retries only that chunk", async () => {
  let resolves = 0, extracts = 0;
  const resolver = { resolveStreamable: async () => source("https://video.example.net/public-" + (++resolves) + ".mp4") };
  const streaming = createStreamingWhisperAsr({
    chunkDurationMs: 30_000, overlapMs: 5_000, minDurationMs: 0, maxDurationMs: 120_000,
    sampleRate: 1000,
    extractChunkImpl: async ({ durationMs }) => {
      extracts++;
      if (extracts === 1) throw Object.assign(new Error("temporary"), { code: "STREAMING_AUDIO_EXTRACT_FAILED" });
      return pcmFor(durationMs);
    }
  });
  const output = await streaming({
    video: video(35_000), mediaResolver: resolver, deadlineAt: Date.now() + 60_000,
    localAsr: async ({ video: part }) => resultFor(part)
  });
  assert.equal(resolves, 2);
  assert.equal(extracts, 3);
  assert.equal(output.source.url, "https://video.example.net/public-2.mp4");
});

test("streaming rejects media sources without a validated HTTP range response", async () => {
  const resolver = { resolveStreamable: async () => ({ ...source(), diagnostics: { status: 200 } }) };
  const streaming = createStreamingWhisperAsr({ minDurationMs: 0, maxDurationMs: 120_000 });
  await assert.rejects(streaming({
    video: video(5000), mediaResolver: resolver, localAsr: async () => resultFor(video(5000))
  }), (error) => error.code === "STREAMING_ASR_SOURCE_UNVERIFIED");
});

test("a duration beyond the streaming policy is rejected before any media fetch", async () => {
  let resolveCalls = 0;
  const streaming = createStreamingWhisperAsr();
  await assert.rejects(streaming({
    video: video(90 * 60_000 + 1),
    mediaResolver: { resolveStreamable: async () => { resolveCalls++; return source(); } },
    localAsr: async () => resultFor(video(90 * 60_000 + 1))
  }), (error) => error.code === "STREAMING_ASR_DURATION_UNSUPPORTED");
  assert.equal(resolveCalls, 0);
});

test("silent chunks are tolerated, but an all-silent video is not reported as a transcript", async () => {
  const streaming = createStreamingWhisperAsr({
    chunkDurationMs: 30_000, overlapMs: 5_000, minDurationMs: 0, maxDurationMs: 120_000,
    sampleRate: 1000, extractChunkImpl: async ({ durationMs }) => pcmFor(durationMs)
  });
  await assert.rejects(streaming({
    video: video(35_000), mediaResolver: { resolveStreamable: async () => source() },
    localAsr: async () => { throw Object.assign(new Error("no speech"), { code: "LOCAL_ASR_EMPTY_RESULT" }); }
  }), (error) => error.code === "STREAMING_ASR_NO_SPEECH");
});

test("a timed-out ASR window is split into smaller bounded windows", async () => {
  let calls = 0;
  const streaming = createStreamingWhisperAsr({
    chunkDurationMs: 60_000, overlapMs: 5_000, minDurationMs: 0, maxDurationMs: 120_000,
    sampleRate: 1000, extractChunkImpl: async ({ durationMs }) => pcmFor(durationMs)
  });
  const output = await streaming({
    video: video(65_000), mediaResolver: { resolveStreamable: async () => source() },
    deadlineAt: Date.now() + 600_000,
    localAsr: async ({ video: part }) => {
      calls++;
      if (part.duration_ms > 30_000) throw Object.assign(new Error("timeout"), { code: "LOCAL_ASR_TIMEOUT" });
      return resultFor(part, "speech " + calls);
    }
  });
  assert.ok(calls >= 3);
  assert.equal(output.result.coverage.full_audio_scanned, true);
});
