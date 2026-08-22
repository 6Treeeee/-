import { Buffer } from "node:buffer";

import { ReaderError } from "../errors.js";
import { PublicBrowserService } from "./public-browser.js";

const TARGET_SAMPLE_RATE = 16_000;
const WAV_HEADER_BYTES = 44;
const PCM_BYTES_PER_SAMPLE = 2;
const DEFAULT_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const HARD_MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const HARD_MAX_TIMEOUT_MS = 120_000;
const SAFE_RUNTIME_KINDS = new Set([
  "local_chrome",
  "local_edge",
  "sparticuz_chromium"
]);
const DECODER_ERROR_CODES = new Set([
  "AUDIO_DECODE_EMPTY_INPUT",
  "AUDIO_DECODE_FAILED",
  "AUDIO_DECODE_INPUT_TOO_LARGE",
  "AUDIO_DECODE_INVALID_INPUT",
  "AUDIO_DECODE_INVALID_OUTPUT",
  "AUDIO_DECODE_OUTPUT_TOO_LARGE",
  "AUDIO_DECODE_TIMEOUT",
  "AUDIO_DECODE_UNAVAILABLE",
  "AUDIO_DECODE_UNSUPPORTED"
]);

function configuredInteger(value, {
  field,
  minimum,
  maximum
}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ReaderError(
      "AUDIO_DECODER_CONFIGURATION_INVALID",
      "The browser audio decoder configuration is invalid.",
      { status: 500, details: { field } }
    );
  }
  return number;
}

function inputBytes(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new ReaderError(
    "AUDIO_DECODE_INVALID_INPUT",
    "Audio decoding requires binary media bytes.",
    { status: 422 }
  );
}

function runtimeKind(value) {
  return SAFE_RUNTIME_KINDS.has(value) ? value : "unknown";
}

function diagnosticCount(value, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 && number <= maximum ? number : 0;
}

function decoderDetails(runtime) {
  return {
    decoder: "browser_offline_audio_context",
    runtime: runtimeKind(runtime)
  };
}

function decoderError(code, message, status, runtime, details = {}) {
  return new ReaderError(code, message, {
    status,
    details: { ...decoderDetails(runtime), ...details }
  });
}

function failFromBrowser(result, runtime, maxOutputBytes) {
  switch (result?.code) {
    case "AUDIO_DECODE_OUTPUT_TOO_LARGE": {
      const outputBytes = Number(result.outputBytes);
      const frames = Number(result.frames);
      return decoderError(
        "AUDIO_DECODE_OUTPUT_TOO_LARGE",
        "The decoded PCM audio exceeds the processing size limit.",
        422,
        runtime,
        {
          ...(Number.isSafeInteger(frames) && frames >= 0 ? { frames } : {}),
          ...(Number.isSafeInteger(outputBytes) && outputBytes >= 0 ? { output_bytes: outputBytes } : {}),
          max_bytes: maxOutputBytes
        }
      );
    }
    case "AUDIO_DECODE_UNAVAILABLE":
      return decoderError(
        "AUDIO_DECODE_UNAVAILABLE",
        "The public browser runtime cannot decode audio.",
        503,
        runtime
      );
    case "AUDIO_DECODE_UNSUPPORTED":
      return decoderError(
        "AUDIO_DECODE_UNSUPPORTED",
        "The public audio codec could not be decoded by the browser runtime.",
        422,
        runtime
      );
    case "AUDIO_DECODE_INVALID_OUTPUT":
      return decoderError(
        "AUDIO_DECODE_INVALID_OUTPUT",
        "The browser audio decoder returned invalid PCM metadata.",
        502,
        runtime
      );
    default:
      return decoderError(
        "AUDIO_DECODE_FAILED",
        "The public audio could not be converted to PCM WAV.",
        502,
        runtime
      );
  }
}

function decodeBase64Wav(value, maxOutputBytes, runtime) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw decoderError(
      "AUDIO_DECODE_INVALID_OUTPUT",
      "The browser audio decoder returned an invalid WAV payload.",
      502,
      runtime
    );
  }
  const maximumEncodedLength = 4 * Math.ceil(maxOutputBytes / 3);
  if (value.length > maximumEncodedLength) {
    throw decoderError(
      "AUDIO_DECODE_OUTPUT_TOO_LARGE",
      "The decoded PCM audio exceeds the processing size limit.",
      422,
      runtime,
      { max_bytes: maxOutputBytes }
    );
  }

  const output = Buffer.from(value, "base64");
  if (output.byteLength > maxOutputBytes) {
    throw decoderError(
      "AUDIO_DECODE_OUTPUT_TOO_LARGE",
      "The decoded PCM audio exceeds the processing size limit.",
      422,
      runtime,
      { output_bytes: output.byteLength, max_bytes: maxOutputBytes }
    );
  }
  return output;
}

function ascii(bytes, offset, length) {
  return bytes.subarray(offset, offset + length).toString("ascii");
}

function validateWav(output, expectedFrames, runtime) {
  if (output.byteLength < WAV_HEADER_BYTES) {
    throw decoderError(
      "AUDIO_DECODE_INVALID_OUTPUT",
      "The browser audio decoder returned a truncated WAV payload.",
      502,
      runtime
    );
  }
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const dataBytes = view.getUint32(40, true);
  const frames = dataBytes / PCM_BYTES_PER_SAMPLE;
  const valid = ascii(output, 0, 4) === "RIFF" &&
    view.getUint32(4, true) === output.byteLength - 8 &&
    ascii(output, 8, 4) === "WAVE" &&
    ascii(output, 12, 4) === "fmt " &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === TARGET_SAMPLE_RATE &&
    view.getUint32(28, true) === TARGET_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE &&
    view.getUint16(32, true) === PCM_BYTES_PER_SAMPLE &&
    view.getUint16(34, true) === 16 &&
    ascii(output, 36, 4) === "data" &&
    dataBytes === output.byteLength - WAV_HEADER_BYTES &&
    Number.isSafeInteger(frames) && frames > 0 &&
    Number.isSafeInteger(expectedFrames) && expectedFrames === frames;
  if (!valid) {
    throw decoderError(
      "AUDIO_DECODE_INVALID_OUTPUT",
      "The browser audio decoder returned a malformed WAV payload.",
      502,
      runtime
    );
  }
  return { frames, dataBytes };
}

function timeoutAfter(timeoutMs, runtime) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(decoderError(
      "AUDIO_DECODE_TIMEOUT",
      "The browser audio decoder timed out.",
      503,
      runtime,
      { timeout_ms: timeoutMs }
    )), timeoutMs);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

// This function is serialized into the fresh public browser page by Puppeteer.
// Keep it self-contained: closures and Node globals are unavailable there.
async function decodeAudioInBrowser(base64, options) {
  try {
    if (typeof OfflineAudioContext !== "function") {
      return { ok: false, code: "AUDIO_DECODE_UNAVAILABLE" };
    }

    const binary = atob(base64);
    const encoded = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      encoded[index] = binary.charCodeAt(index);
    }

    let decoded;
    try {
      const context = new OfflineAudioContext(1, 1, options.sampleRate);
      decoded = await context.decodeAudioData(encoded.buffer.slice(0));
    } catch {
      return { ok: false, code: "AUDIO_DECODE_UNSUPPORTED" };
    }

    const frames = decoded?.length;
    const sourceChannelCount = decoded?.numberOfChannels;
    if (!Number.isSafeInteger(frames) || frames <= 0 ||
        !Number.isSafeInteger(sourceChannelCount) || sourceChannelCount <= 0 || sourceChannelCount > 32 ||
        decoded.sampleRate !== options.sampleRate) {
      return { ok: false, code: "AUDIO_DECODE_INVALID_OUTPUT" };
    }

    const outputBytes = 44 + frames * 2;
    if (!Number.isSafeInteger(outputBytes) || outputBytes > options.maxOutputBytes) {
      return {
        ok: false,
        code: "AUDIO_DECODE_OUTPUT_TOO_LARGE",
        frames,
        outputBytes
      };
    }

    const channels = [];
    for (let channel = 0; channel < sourceChannelCount; channel += 1) {
      channels.push(decoded.getChannelData(channel));
    }

    const wav = new Uint8Array(outputBytes);
    const view = new DataView(wav.buffer);
    const writeAscii = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) {
        wav[offset + index] = text.charCodeAt(index);
      }
    };
    writeAscii(0, "RIFF");
    view.setUint32(4, outputBytes - 8, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, options.sampleRate, true);
    view.setUint32(28, options.sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, "data");
    view.setUint32(40, frames * 2, true);

    let clippedSamples = 0;
    let nonFiniteSamples = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[frame] / sourceChannelCount;
      if (!Number.isFinite(sample)) {
        sample = 0;
        nonFiniteSamples += 1;
      }
      if (sample > 1 || sample < -1) clippedSamples += 1;
      sample = Math.max(-1, Math.min(1, sample));
      const pcm = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      view.setInt16(44 + frame * 2, pcm, true);
    }

    const binaryChunks = [];
    for (let offset = 0; offset < wav.byteLength; offset += 0x8000) {
      binaryChunks.push(String.fromCharCode(...wav.subarray(offset, offset + 0x8000)));
    }
    return {
      ok: true,
      wavBase64: btoa(binaryChunks.join("")),
      frames,
      outputBytes,
      sampleRate: decoded.sampleRate,
      sourceChannelCount,
      clippedSamples,
      nonFiniteSamples
    };
  } catch {
    return { ok: false, code: "AUDIO_DECODE_FAILED" };
  }
}

/**
 * Decode a complete public audio asset to a deterministic 16 kHz mono PCM16
 * WAV using the already-installed Chrome-family runtime. This is preprocessing
 * for an injected local ASR implementation; it does not bypass media access or
 * perform speech recognition itself.
 */
export class BrowserAudioDecoder {
  constructor({
    browserService = new PublicBrowserService(),
    maxInputBytes = DEFAULT_MAX_INPUT_BYTES,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    if (!browserService || typeof browserService.withPage !== "function") {
      throw new ReaderError(
        "AUDIO_DECODER_CONFIGURATION_INVALID",
        "The browser audio decoder requires a public browser service.",
        { status: 500, details: { field: "browserService" } }
      );
    }
    this.browser = browserService;
    this.maxInputBytes = configuredInteger(maxInputBytes, {
      field: "maxInputBytes",
      minimum: 1,
      maximum: HARD_MAX_BYTES
    });
    this.maxOutputBytes = configuredInteger(maxOutputBytes, {
      field: "maxOutputBytes",
      minimum: WAV_HEADER_BYTES + PCM_BYTES_PER_SAMPLE,
      maximum: HARD_MAX_BYTES
    });
    this.timeoutMs = configuredInteger(timeoutMs, {
      field: "timeoutMs",
      minimum: 1,
      maximum: HARD_MAX_TIMEOUT_MS
    });
  }

  async decode(value) {
    const input = inputBytes(value);
    if (input.byteLength === 0) {
      throw new ReaderError("AUDIO_DECODE_EMPTY_INPUT", "The audio media was empty.", {
        status: 422
      });
    }
    if (input.byteLength > this.maxInputBytes) {
      throw new ReaderError(
        "AUDIO_DECODE_INPUT_TOO_LARGE",
        "The audio media exceeds the browser decoding size limit.",
        {
          status: 422,
          details: { size: input.byteLength, max_bytes: this.maxInputBytes }
        }
      );
    }

    const base64 = Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString("base64");
    let envelope;
    try {
      envelope = await this.browser.withPage(async ({ page, runtime }) => {
        const safeRuntime = runtimeKind(runtime?.kind);
        if (!page || typeof page.evaluate !== "function") {
          throw decoderError(
            "AUDIO_DECODE_UNAVAILABLE",
            "The public browser runtime cannot decode audio.",
            503,
            safeRuntime
          );
        }
        const timeout = timeoutAfter(this.timeoutMs, safeRuntime);
        try {
          const result = await Promise.race([
            page.evaluate(decodeAudioInBrowser, base64, {
              sampleRate: TARGET_SAMPLE_RATE,
              maxOutputBytes: this.maxOutputBytes
            }),
            timeout.promise
          ]);
          return { result, runtime: safeRuntime };
        } finally {
          timeout.cancel();
        }
      });
    } catch (error) {
      if (error instanceof ReaderError && DECODER_ERROR_CODES.has(error.code)) throw error;
      if (error instanceof ReaderError && error.code === "DOUYIN_PUBLIC_BROWSER_UNAVAILABLE") {
        throw decoderError(
          "AUDIO_DECODE_UNAVAILABLE",
          "The public browser runtime cannot decode audio.",
          503,
          error?.details?.runtime
        );
      }
      // Browser/protocol errors can contain executable paths, signed URLs, or
      // request data. Deliberately discard the original error and its cause.
      throw decoderError(
        "AUDIO_DECODE_FAILED",
        "The public audio could not be converted to PCM WAV.",
        502,
        "unknown"
      );
    }

    const runtime = runtimeKind(envelope?.runtime);
    const result = envelope?.result;
    if (!result?.ok) throw failFromBrowser(result, runtime, this.maxOutputBytes);

    const output = decodeBase64Wav(result.wavBase64, this.maxOutputBytes, runtime);
    const metadata = validateWav(output, Number(result.frames), runtime);
    if (result.outputBytes !== output.byteLength || result.sampleRate !== TARGET_SAMPLE_RATE) {
      throw decoderError(
        "AUDIO_DECODE_INVALID_OUTPUT",
        "The browser audio decoder returned inconsistent WAV metadata.",
        502,
        runtime
      );
    }

    const sourceChannelCount = Number(result.sourceChannelCount);
    if (!Number.isSafeInteger(sourceChannelCount) || sourceChannelCount <= 0 || sourceChannelCount > 32) {
      throw decoderError(
        "AUDIO_DECODE_INVALID_OUTPUT",
        "The browser audio decoder returned invalid channel metadata.",
        502,
        runtime
      );
    }

    return {
      bytes: new Uint8Array(output.buffer, output.byteOffset, output.byteLength),
      mediaType: "audio/wav",
      method: "browser_offline_audio_context_pcm16_wav",
      sampleRate: TARGET_SAMPLE_RATE,
      channelCount: 1,
      sourceChannelCount,
      durationMs: Math.round((metadata.frames / TARGET_SAMPLE_RATE) * 1000),
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      diagnostics: {
        decoder: "browser_offline_audio_context",
        runtime,
        frames: metadata.frames,
        clipped_samples: diagnosticCount(result.clippedSamples, metadata.frames),
        non_finite_samples: diagnosticCount(result.nonFiniteSamples, metadata.frames)
      }
    };
  }
}
