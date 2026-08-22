import assert from "node:assert/strict";
import test from "node:test";

import { publicError, ReaderError } from "../src/errors.js";
import { BrowserAudioDecoder } from "../src/services/browser-audio-decoder.js";

function pcm16Wav(samples, sampleRate = 16_000) {
  const pcm = samples instanceof Int16Array ? samples : Int16Array.from(samples);
  const output = Buffer.alloc(44 + pcm.byteLength);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.byteLength - 8, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(pcm.byteLength, 40);
  for (let index = 0; index < pcm.length; index += 1) {
    output.writeInt16LE(pcm[index], 44 + index * 2);
  }
  return output;
}

function successfulPageResult(wav, overrides = {}) {
  return {
    ok: true,
    wavBase64: wav.toString("base64"),
    frames: (wav.byteLength - 44) / 2,
    outputBytes: wav.byteLength,
    sampleRate: 16_000,
    sourceChannelCount: 2,
    clippedSamples: 1,
    nonFiniteSamples: 0,
    ...overrides
  };
}

function fakeBrowser(result, {
  runtime = { kind: "local_edge" },
  onEvaluate = null
} = {}) {
  return {
    async withPage(operation) {
      return operation({
        runtime,
        page: {
          async evaluate(fn, ...args) {
            onEvaluate?.(fn, ...args);
            return typeof result === "function" ? result(fn, ...args) : result;
          }
        }
      });
    }
  };
}

test("BrowserAudioDecoder returns a strictly validated 16 kHz mono PCM WAV", async () => {
  const samples = Int16Array.from({ length: 160 }, (_, index) => index - 80);
  const wav = pcm16Wav(samples);
  const backing = new Uint8Array([99, 1, 2, 3, 88]);
  const input = backing.subarray(1, 4);
  let evaluateInput;
  let evaluateOptions;
  const decoder = new BrowserAudioDecoder({
    browserService: fakeBrowser(successfulPageResult(wav), {
      onEvaluate(fn, base64, options) {
        assert.equal(typeof fn, "function");
        evaluateInput = Buffer.from(base64, "base64");
        evaluateOptions = options;
      }
    }),
    maxInputBytes: 16,
    maxOutputBytes: 1_024
  });

  const result = await decoder.decode(input);

  assert.deepEqual([...evaluateInput], [1, 2, 3]);
  assert.deepEqual(evaluateOptions, { sampleRate: 16_000, maxOutputBytes: 1_024 });
  assert.equal(result.mediaType, "audio/wav");
  assert.equal(result.method, "browser_offline_audio_context_pcm16_wav");
  assert.equal(result.sampleRate, 16_000);
  assert.equal(result.channelCount, 1);
  assert.equal(result.sourceChannelCount, 2);
  assert.equal(result.durationMs, 10);
  assert.equal(result.inputBytes, 3);
  assert.equal(result.outputBytes, wav.byteLength);
  assert.deepEqual(Buffer.from(result.bytes), wav);
  assert.deepEqual(result.diagnostics, {
    decoder: "browser_offline_audio_context",
    runtime: "local_edge",
    frames: 160,
    clipped_samples: 1,
    non_finite_samples: 0
  });
});

test("BrowserAudioDecoder rejects non-binary, empty, and oversized input before launching a browser", async (t) => {
  let browserCalls = 0;
  const decoder = new BrowserAudioDecoder({
    browserService: {
      async withPage() {
        browserCalls += 1;
        throw new Error("must not launch");
      }
    },
    maxInputBytes: 3,
    maxOutputBytes: 1_024
  });

  await t.test("non-binary", async () => {
    await assert.rejects(decoder.decode("secret audio"), (error) =>
      error instanceof ReaderError && error.code === "AUDIO_DECODE_INVALID_INPUT");
  });
  await t.test("empty", async () => {
    await assert.rejects(decoder.decode(new Uint8Array()), (error) =>
      error instanceof ReaderError && error.code === "AUDIO_DECODE_EMPTY_INPUT");
  });
  await t.test("oversized", async () => {
    await assert.rejects(decoder.decode(new Uint8Array(4)), (error) => {
      assert.equal(error.code, "AUDIO_DECODE_INPUT_TOO_LARGE");
      assert.deepEqual(error.details, { size: 4, max_bytes: 3 });
      return true;
    });
  });
  assert.equal(browserCalls, 0);
});

test("BrowserAudioDecoder enforces its decoded-output cap without reflecting browser data", async () => {
  const decoder = new BrowserAudioDecoder({
    browserService: fakeBrowser({
      ok: false,
      code: "AUDIO_DECODE_OUTPUT_TOO_LARGE",
      frames: 100_000,
      outputBytes: 200_044,
      message: "Bearer secret-token https://signed.example.test/audio?token=secret"
    }),
    maxInputBytes: 16,
    maxOutputBytes: 1_024
  });

  await assert.rejects(decoder.decode(new Uint8Array([1])), (error) => {
    assert.equal(error.code, "AUDIO_DECODE_OUTPUT_TOO_LARGE");
    assert.deepEqual(error.details, {
      decoder: "browser_offline_audio_context",
      runtime: "local_edge",
      frames: 100_000,
      output_bytes: 200_044,
      max_bytes: 1_024
    });
    assert.doesNotMatch(JSON.stringify(publicError(error)), /secret-token|signed\.example|Bearer/);
    return true;
  });
});

test("BrowserAudioDecoder rejects malformed or inconsistent WAV output", async (t) => {
  const valid = pcm16Wav(new Int16Array(20));
  const malformed = Buffer.from(valid);
  malformed.write("NOPE", 0, "ascii");

  await t.test("malformed header", async () => {
    const decoder = new BrowserAudioDecoder({
      browserService: fakeBrowser(successfulPageResult(malformed)),
      maxInputBytes: 16,
      maxOutputBytes: 1_024
    });
    await assert.rejects(decoder.decode(new Uint8Array([1])), (error) =>
      error.code === "AUDIO_DECODE_INVALID_OUTPUT");
  });

  await t.test("inconsistent metadata", async () => {
    const decoder = new BrowserAudioDecoder({
      browserService: fakeBrowser(successfulPageResult(valid, { sampleRate: 48_000 })),
      maxInputBytes: 16,
      maxOutputBytes: 1_024
    });
    await assert.rejects(decoder.decode(new Uint8Array([1])), (error) =>
      error.code === "AUDIO_DECODE_INVALID_OUTPUT");
  });

  await t.test("missing frame metadata", async () => {
    const decoder = new BrowserAudioDecoder({
      browserService: fakeBrowser(successfulPageResult(valid, { frames: null })),
      maxInputBytes: 16,
      maxOutputBytes: 1_024
    });
    await assert.rejects(decoder.decode(new Uint8Array([1])), (error) =>
      error.code === "AUDIO_DECODE_INVALID_OUTPUT");
  });

  await t.test("invalid base64", async () => {
    const decoder = new BrowserAudioDecoder({
      browserService: fakeBrowser(successfulPageResult(valid, { wavBase64: "token=https://secret.invalid" })),
      maxInputBytes: 16,
      maxOutputBytes: 1_024
    });
    await assert.rejects(decoder.decode(new Uint8Array([1])), (error) => {
      assert.equal(error.code, "AUDIO_DECODE_INVALID_OUTPUT");
      assert.doesNotMatch(JSON.stringify(publicError(error)), /secret\.invalid|token=/);
      return true;
    });
  });
});

test("BrowserAudioDecoder sanitizes browser and protocol failures", async () => {
  const decoder = new BrowserAudioDecoder({
    browserService: {
      async withPage() {
        throw new Error(
          "Bearer protocol-secret https://signed.example.test/media.mp4?token=query-secret C:\\private\\chrome.exe"
        );
      }
    },
    maxInputBytes: 16,
    maxOutputBytes: 1_024
  });

  await assert.rejects(decoder.decode(new Uint8Array([1])), (error) => {
    assert.equal(error.code, "AUDIO_DECODE_FAILED");
    assert.equal(error.cause, undefined);
    assert.deepEqual(error.details, {
      decoder: "browser_offline_audio_context",
      runtime: "unknown"
    });
    assert.doesNotMatch(
      JSON.stringify(publicError(error)),
      /protocol-secret|signed\.example|query-secret|private|chrome\.exe/
    );
    return true;
  });
});

test("BrowserAudioDecoder allowlists runtime diagnostics", async () => {
  const wav = pcm16Wav(new Int16Array(20));
  const decoder = new BrowserAudioDecoder({
    browserService: fakeBrowser(successfulPageResult(wav), {
      runtime: { kind: "C:\\secret\\chromium.exe?token=private" }
    }),
    maxInputBytes: 16,
    maxOutputBytes: 1_024
  });

  const result = await decoder.decode(new Uint8Array([1]));

  assert.equal(result.diagnostics.runtime, "unknown");
  assert.doesNotMatch(JSON.stringify(result), /secret|token|chromium\.exe/);
});

test("BrowserAudioDecoder times out a stalled page evaluation with safe diagnostics", async () => {
  const decoder = new BrowserAudioDecoder({
    browserService: fakeBrowser(() => new Promise(() => {}), {
      runtime: { kind: "sparticuz_chromium" }
    }),
    maxInputBytes: 16,
    maxOutputBytes: 1_024,
    timeoutMs: 5
  });

  await assert.rejects(decoder.decode(new Uint8Array([1])), (error) => {
    assert.equal(error.code, "AUDIO_DECODE_TIMEOUT");
    assert.deepEqual(error.details, {
      decoder: "browser_offline_audio_context",
      runtime: "sparticuz_chromium",
      timeout_ms: 5
    });
    return true;
  });
});

test("BrowserAudioDecoder rejects unsafe cap configuration", () => {
  const browserService = fakeBrowser({ ok: false });
  assert.throws(
    () => new BrowserAudioDecoder({ browserService, maxInputBytes: 64 * 1024 * 1024 }),
    (error) => error.code === "AUDIO_DECODER_CONFIGURATION_INVALID" &&
      error.details.field === "maxInputBytes"
  );
  assert.throws(
    () => new BrowserAudioDecoder({ browserService, maxOutputBytes: 44 }),
    (error) => error.code === "AUDIO_DECODER_CONFIGURATION_INVALID" &&
      error.details.field === "maxOutputBytes"
  );
});
