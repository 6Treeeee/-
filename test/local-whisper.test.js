import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { publicError, ReaderError } from "../src/errors.js";
import {
  createLocalWhisperAsr,
  isLocalWhisperAvailable,
  LocalWhisperAsr,
  parseWhisperJson
} from "../src/services/local-whisper.js";

const RAW_RESULT = {
  result: { language: "zh" },
  transcription: [
    {
      offsets: { from: 0, to: 2360 },
      text: " 你好\uFFFD 世界 ",
      tokens: [
        { text: "[_BEG_]", p: 0.99 },
        { text: "你", p: 0.8 },
        { text: "好", p: 0.6 }
      ]
    },
    {
      offsets: { from: 2360, to: 4100 },
      text: "第二段",
      tokens: [{ text: "第二段", p: 0.9 }]
    }
  ]
};

function runtime() {
  return {
    binaryPath: "/runtime/whisper-cli",
    modelPath: "/runtime/model.bin",
    libraryPath: "/runtime",
    engineRelease: "b4938",
    modelName: "whisper-base-q5_1-multilingual"
  };
}

test("parseWhisperJson preserves timestamps and reports real token probability", () => {
  const result = parseWhisperJson(RAW_RESULT, { processingMs: 1234 });

  assert.equal(result.method, "local_whisper_cpp_base_q5_1");
  assert.equal(result.language, "zh");
  assert.equal(result.text, "你好 世界\n第二段");
  assert.deepEqual(result.segments.map(({ start_ms, end_ms }) => ({ start_ms, end_ms })), [
    { start_ms: 0, end_ms: 2360 },
    { start_ms: 2360, end_ms: 4100 }
  ]);
  assert.equal(result.segments[0].confidence, 0.7);
  assert.ok(Math.abs(result.confidence - (0.8 + 0.6 + 0.9) / 3) < 1e-12);
  assert.equal(result.processing_ms, 1234);
  assert.ok(result.limitations.includes("quantized_base_model_lower_accuracy"));
  assert.doesNotMatch(result.text, /\uFFFD/);
});

test("parseWhisperJson rejects an empty or malformed result without exposing payloads", () => {
  assert.throws(
    () => parseWhisperJson({ transcription: [{ text: "secret", offsets: {} }] }),
    (error) => error instanceof ReaderError && error.code === "LOCAL_ASR_EMPTY_RESULT" &&
      !JSON.stringify(publicError(error)).includes("secret")
  );
});

test("parseWhisperJson sorts and clamps overlapping segments to monotonic timestamps", () => {
  const result = parseWhisperJson({
    result: { language: "zh" },
    transcription: [
      { offsets: { from: 1800, to: 3000 }, text: "第三段", tokens: [] },
      { offsets: { from: 0, to: 1200 }, text: "第一段", tokens: [] },
      { offsets: { from: 900, to: 2000 }, text: "第二段", tokens: [] }
    ]
  });

  assert.deepEqual(result.segments.map(({ start_ms, end_ms }) => ({ start_ms, end_ms })), [
    { start_ms: 0, end_ms: 1200 },
    { start_ms: 1200, end_ms: 2000 },
    { start_ms: 2000, end_ms: 3000 }
  ]);
});

test("LocalWhisperAsr passes duration-matched public MP3 directly to whisper.cpp", async () => {
  let decoded = 0;
  let invocation;
  const engine = new LocalWhisperAsr({
    platform: "linux",
    arch: "x64",
    runtimeProvider: async () => runtime(),
    runImpl: async (input) => {
      invocation = input;
      return RAW_RESULT;
    },
    audioDecoder: { async decode() { decoded += 1; throw new Error("not expected"); } }
  });

  const result = await engine.transcribe({
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: "audio/mpeg; charset=binary",
    video: { aweme_id: "public", media: { duration_ms: 54_720 } }
  });

  assert.equal(decoded, 0);
  assert.equal(invocation.extension, ".mp3");
  assert.deepEqual([...invocation.bytes], [1, 2, 3]);
  assert.equal(result.language, "zh");
  assert.equal(result.audio_preprocessing, undefined);
});

test("LocalWhisperAsr decodes AAC MP4 to bounded PCM WAV before inference", async () => {
  let decoderInput;
  let invocation;
  const engine = new LocalWhisperAsr({
    platform: "linux",
    arch: "x64",
    runtimeProvider: async () => runtime(),
    runImpl: async (input) => {
      invocation = input;
      return RAW_RESULT;
    },
    audioDecoder: {
      async decode(bytes) {
        decoderInput = bytes;
        return {
          bytes: new Uint8Array([82, 73, 70, 70]),
          mediaType: "audio/wav",
          method: "browser_offline_audio_context_pcm16_wav",
          sampleRate: 16_000,
          channelCount: 1,
          sourceChannelCount: 2,
          durationMs: 10_000,
          inputBytes: bytes.byteLength,
          outputBytes: 4,
          diagnostics: { runtime: "sparticuz_chromium" }
        };
      }
    }
  });

  const result = await engine.transcribe({
    bytes: new Uint8Array([9, 8, 7]),
    mediaType: "audio/mp4",
    video: { media: { duration_ms: 10_000 } }
  });

  assert.deepEqual([...decoderInput], [9, 8, 7]);
  assert.equal(invocation.extension, ".wav");
  assert.deepEqual([...invocation.bytes], [82, 73, 70, 70]);
  assert.equal(result.audio_preprocessing.runtime, "sparticuz_chromium");
  assert.equal(result.audio_preprocessing.duration_ms, 10_000);
});

test("LocalWhisperAsr rejects overlong media before preparing or running the engine", async () => {
  let prepared = 0;
  let ran = 0;
  const engine = new LocalWhisperAsr({
    platform: "linux",
    arch: "x64",
    maxDurationMs: 180_000,
    runtimeProvider: async () => { prepared += 1; return runtime(); },
    runImpl: async () => { ran += 1; return RAW_RESULT; }
  });

  await assert.rejects(
    engine.transcribe({
      bytes: new Uint8Array([1]),
      mediaType: "audio/mpeg",
      video: { media: { duration_ms: 180_001 } }
    }),
    (error) => error.code === "LOCAL_ASR_DURATION_LIMIT"
  );
  assert.equal(prepared, 0);
  assert.equal(ran, 0);
});

test("LocalWhisperAsr serializes one bounded waiter instead of dropping concurrent work", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let startedFirst;
  const firstStarted = new Promise((resolve) => { startedFirst = resolve; });
  let calls = 0;
  let running = 0;
  let maxRunning = 0;
  const engine = new LocalWhisperAsr({
    platform: "linux",
    arch: "x64",
    runtimeProvider: async () => runtime(),
    runImpl: async () => {
      calls += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      if (calls === 1) {
        startedFirst();
        await gate;
      }
      running -= 1;
      return RAW_RESULT;
    }
  });
  const input = {
    bytes: new Uint8Array([1]),
    mediaType: "audio/mpeg",
    video: { media: { duration_ms: 1_000 } }
  };

  const first = engine.transcribe(input);
  await firstStarted;
  const second = engine.transcribe(input);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results.length, 2);
  assert.equal(calls, 2);
  assert.equal(maxRunning, 1);
});

test("LocalWhisperAsr keeps its CPU queue bounded", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const firstStarted = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  const engine = new LocalWhisperAsr({
    platform: "linux",
    arch: "x64",
    maxQueued: 1,
    runtimeProvider: async () => runtime(),
    runImpl: async () => {
      calls += 1;
      if (calls === 1) {
        started();
        await gate;
      }
      return RAW_RESULT;
    }
  });
  const input = {
    bytes: new Uint8Array([1]),
    mediaType: "audio/mpeg",
    video: { media: { duration_ms: 1_000 } }
  };

  const first = engine.transcribe(input);
  await firstStarted;
  const second = engine.transcribe(input);
  await assert.rejects(
    engine.transcribe(input),
    (error) => error.code === "LOCAL_ASR_BUSY" && error.details?.reason === "full"
  );
  release();
  await Promise.all([first, second]);
});

test("Local Whisper availability is explicit and the bound factory is callable", async () => {
  assert.equal(isLocalWhisperAvailable({ platform: "linux", arch: "x64" }), true);
  assert.equal(isLocalWhisperAvailable({ platform: "win32", arch: "x64" }), false);
  const wrapper = createLocalWhisperAsr({ platform: "win32", arch: "x64" });
  assert.equal(wrapper.available, false);
  assert.deepEqual(await wrapper.status(), {
    platform_supported: false,
    runtime_verified: false,
    scope: "single_video"
  });
  await assert.rejects(
    wrapper.transcribe({ bytes: new Uint8Array([1]), mediaType: "audio/mpeg" }),
    (error) => error.code === "LOCAL_ASR_RUNTIME_UNAVAILABLE"
  );
});

test("Local Whisper runtime status requires a successful cached startup probe", async () => {
  let prepared = 0;
  let probed = 0;
  const wrapper = createLocalWhisperAsr({
    platform: "linux",
    arch: "x64",
    runtimeProvider: async () => { prepared += 1; return runtime(); },
    probeImpl: async ({ runtime: preparedRuntime }) => {
      probed += 1;
      assert.equal(preparedRuntime.binaryPath, "/runtime/whisper-cli");
    }
  });

  const first = await wrapper.status();
  const second = await wrapper.status();
  assert.deepEqual(first, {
    platform_supported: true,
    runtime_verified: true,
    scope: "single_video"
  });
  assert.deepEqual(second, first);
  assert.equal(prepared, 1);
  assert.equal(probed, 1);
});

test("vendored Whisper archive and model match their pinned checksums", async () => {
  const manifest = JSON.parse(await readFile(new URL("../assets/whisper/ASSET_MANIFEST.json", import.meta.url)));
  for (const item of [manifest.engine, manifest.model]) {
    const bytes = await readFile(new URL(`../assets/whisper/${item.file}`, import.meta.url));
    assert.equal(bytes.byteLength, item.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
  }
});
