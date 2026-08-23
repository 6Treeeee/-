import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { inflate } from "@sparticuz/chromium";

import { ReaderError } from "../errors.js";
import { BrowserAudioDecoder } from "./browser-audio-decoder.js";

const ENGINE_RELEASE = "b4938";
const ENGINE_COMMIT = "371b5a7561823ab2bb32142d2751e35e7534727b";
const ENGINE_ARCHIVE = "whisper-bin-ubuntu-x64-b4938-no-openmp.tar.gz";
const ENGINE_ARCHIVE_SHA256 = "5b016d00d2f845c582b63cedefd4d5f881a29f94c546087d306e717758215d16";
const ENGINE_CLI_SHA256 = "9892707815b8063b02bc7def10ea8393487069a1bb10ef1bb174abd878553d34";
const MODEL_FILE = "ggml-base-q5_1.bin";
const MODEL_SHA256 = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898";
const MODEL_NAME = "whisper-base-q5_1-multilingual";
const DEFAULT_MAX_INPUT_BYTES = 25 * 1024 * 1024;
// The pinned CLI already processes complete inputs through internal 30-second
// Whisper windows. Keep one process/model load for bounded long videos instead
// of spawning application-level chunks, which would consume the same CPU while
// repeatedly loading the model inside the Function deadline.
const DEFAULT_MAX_DURATION_MS = 280_000;
const DEFAULT_TIMEOUT_MS = 280_000;
// The Vercel runtime may report one available CPU even though the pinned
// whisper.cpp binary is measurably faster with two worker threads there. The
// process-local queue below still limits inference to one job at a time.
const DEFAULT_THREADS = 2;
const DEFAULT_RESPONSE_RESERVE_MS = 4_000;
const DEFAULT_QUEUE_WAIT_MS = 20_000;
const DEFAULT_MAX_QUEUED = 1;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 10_000;
const MAX_RESULT_BYTES = 5 * 1024 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const SAFE_RUNTIME_DEPENDENCIES = Object.freeze(["libgomp.so.1"]);
const SAFE_INPUT_TYPES = new Map([
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"]
]);
const DECODE_INPUT_TYPES = new Set([
  "audio/mp4",
  "audio/x-m4a",
  "video/mp4"
]);

const DEFAULT_ASSET_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets/whisper"
);

let defaultRuntimePromise = null;

function logLocalAsr(event, details = {}) {
  if (!process.env.VERCEL) return;
  console.info(JSON.stringify({ event, ...details }));
}

function integerOption(value, { field, minimum, maximum }) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new ReaderError(
      "LOCAL_ASR_CONFIGURATION_INVALID",
      "The local speech-to-text configuration is invalid.",
      { status: 500, details: { field } }
    );
  }
  return number;
}

function binaryInput(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new ReaderError("LOCAL_ASR_INVALID_INPUT", "Local speech-to-text requires binary audio.", {
    status: 422
  });
}

function canonicalMediaType(value) {
  return String(value ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function durationMs(video) {
  const millisecondCandidates = [
    video?.media?.duration_ms,
    video?.duration_ms
  ];
  for (const value of millisecondCandidates) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    return Math.round(number);
  }
  for (const value of [video?.duration, video?.video?.duration]) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    // Raw Douyin video.duration values are milliseconds; small generic values
    // are commonly seconds. Normalized inputs always use media.duration_ms.
    return number >= 1_000 ? Math.round(number) : Math.round(number * 1000);
  }
  const musicMilliseconds = Number(video?.music?.duration_ms);
  if (Number.isFinite(musicMilliseconds) && musicMilliseconds > 0) {
    return Math.round(musicMilliseconds);
  }
  return null;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

function assetError(asset) {
  return new ReaderError(
    "LOCAL_ASR_ASSET_INVALID",
    "A pinned local speech-to-text asset failed integrity verification.",
    { status: 500, details: { asset } }
  );
}

async function verifiedFile(filePath, expectedHash, asset) {
  try {
    await access(filePath);
    if (await sha256File(filePath) !== expectedHash) throw assetError(asset);
  } catch (error) {
    if (error instanceof ReaderError) throw error;
    throw assetError(asset);
  }
}

function extractionRoot(archivePath, runtimeTempRoot) {
  return join(
    runtimeTempRoot,
    basename(archivePath).replace(/\.(?:tar\.)?gz$/i, "")
  );
}

async function prepareDefaultRuntime({
  assetRoot = DEFAULT_ASSET_ROOT,
  runtimeTempRoot = tmpdir(),
  inflateImpl = inflate
} = {}) {
  const archivePath = join(assetRoot, ENGINE_ARCHIVE);
  const modelPath = join(assetRoot, MODEL_FILE);
  await Promise.all([
    verifiedFile(archivePath, ENGINE_ARCHIVE_SHA256, "engine_archive"),
    verifiedFile(modelPath, MODEL_SHA256, "model")
  ]);

  const root = extractionRoot(archivePath, runtimeTempRoot);
  const libraryPath = join(root, "whisper-bin-ubuntu-x64");
  const binaryPath = join(libraryPath, "whisper-cli");
  const markerPath = join(root, ".content-reader-ready");
  let ready = false;
  try {
    const marker = (await readFile(markerPath, "utf8")).trim();
    ready = marker === ENGINE_ARCHIVE_SHA256;
    if (ready) await access(binaryPath);
  } catch {
    ready = false;
  }

  if (!ready) {
    // `inflate` treats an existing output directory as complete. Only remove
    // the exact versioned directory derived from our pinned archive name.
    if (dirname(root) !== resolve(runtimeTempRoot) || !basename(root).startsWith("whisper-bin-ubuntu-x64-")) {
      throw new ReaderError(
        "LOCAL_ASR_RUNTIME_UNAVAILABLE",
        "The local speech-to-text runtime path is invalid.",
        { status: 503, details: { stage: "extract" } }
      );
    }
    await rm(root, { recursive: true, force: true });
    try {
      await inflateImpl(archivePath);
      await verifiedFile(binaryPath, ENGINE_CLI_SHA256, "engine_binary");
      await chmod(binaryPath, 0o755);
      await writeFile(markerPath, `${ENGINE_ARCHIVE_SHA256}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      if (error instanceof ReaderError) throw error;
      throw new ReaderError(
        "LOCAL_ASR_RUNTIME_UNAVAILABLE",
        "The local speech-to-text runtime could not be prepared.",
        { status: 503, details: { stage: "extract" } }
      );
    }
  }

  return {
    binaryPath,
    modelPath,
    libraryPath,
    engineRelease: ENGINE_RELEASE,
    engineCommit: ENGINE_COMMIT,
    modelName: MODEL_NAME,
    modelSha256: MODEL_SHA256
  };
}

async function defaultRuntimeProvider(options) {
  defaultRuntimePromise ??= prepareDefaultRuntime(options).catch((error) => {
    defaultRuntimePromise = null;
    throw error;
  });
  return defaultRuntimePromise;
}

function safeExitDetails({ timedOut, exitCode, signal, stage = "inference" }) {
  return {
    stage,
    ...(timedOut ? { timeout: true } : {}),
    ...(Number.isSafeInteger(exitCode) ? { exit_code: exitCode } : {}),
    ...(["SIGABRT", "SIGKILL", "SIGSEGV", "SIGTERM"].includes(signal) ? { signal } : {})
  };
}

function safeMissingDependency(stderr) {
  const output = String(stderr ?? "");
  return SAFE_RUNTIME_DEPENDENCIES.find((dependency) => output.includes(dependency)) ?? null;
}

async function spawnWhisper({ binaryPath, args, cwd, env, timeoutMs, stage = "inference" }) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let timedOut = false;
    let stderr = "";
    let stderrBytes = 0;
    let child;
    try {
      child = spawn(binaryPath, args, {
        cwd,
        env,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true
      });
    } catch {
      reject(new ReaderError(
        "LOCAL_ASR_RUNTIME_UNAVAILABLE",
        "The local speech-to-text engine could not start.",
        { status: 503, details: { stage: "spawn" } }
      ));
      return;
    }

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
    }, timeoutMs);

    child.stderr?.on("data", (chunk) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      const bytes = Buffer.from(chunk);
      const remaining = MAX_STDERR_BYTES - stderrBytes;
      stderr += bytes.subarray(0, remaining).toString("utf8");
      stderrBytes += Math.min(bytes.byteLength, remaining);
    });

    child.once("error", () => finish(new ReaderError(
      "LOCAL_ASR_RUNTIME_UNAVAILABLE",
      "The local speech-to-text engine could not start.",
      { status: 503, details: { stage: "spawn" } }
    )));
    child.once("close", (code, signal) => {
      if (timedOut) {
        finish(new ReaderError("LOCAL_ASR_TIMEOUT", "Local speech-to-text timed out.", {
          status: 503,
          details: safeExitDetails({ timedOut, exitCode: code, signal, stage })
        }));
        return;
      }
      if (code !== 0) {
        const dependency = safeMissingDependency(stderr);
        if (dependency) {
          finish(new ReaderError(
            "LOCAL_ASR_RUNTIME_UNAVAILABLE",
            "The local speech-to-text runtime is missing a required dependency.",
            {
              status: 503,
              details: {
                ...safeExitDetails({ timedOut, exitCode: code, signal, stage: "dependency" }),
                dependency
              }
            }
          ));
          return;
        }
        if (stage === "preflight") {
          finish(new ReaderError(
            "LOCAL_ASR_RUNTIME_UNAVAILABLE",
            "The local speech-to-text runtime failed its startup check.",
            { status: 503, details: safeExitDetails({ timedOut, exitCode: code, signal, stage }) }
          ));
          return;
        }
        finish(new ReaderError(
          "LOCAL_ASR_INFERENCE_FAILED",
          "The local speech-to-text engine did not produce a transcript.",
          { status: 502, details: safeExitDetails({ timedOut, exitCode: code, signal, stage }) }
        ));
        return;
      }
      finish();
    });
  });
}

async function defaultProbeImpl({ runtime, timeoutMs }) {
  await spawnWhisper({
    binaryPath: runtime.binaryPath,
    args: ["--help"],
    cwd: runtime.libraryPath,
    env: {
      ...process.env,
      LD_LIBRARY_PATH: [runtime.libraryPath, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(":")
    },
    timeoutMs,
    stage: "preflight"
  });
}

export function buildWhisperCliArgs({
  modelPath,
  inputPath,
  outputPrefix,
  durationMs,
  threads
}) {
  return [
    "-m", modelPath,
    "-f", inputPath,
    "-l", "auto",
    // The pinned b4938 CLI accepts millisecond duration windows. Bound the
    // actual decoded input as well as trusting the public page metadata.
    "-d", String(durationMs),
    "-t", String(threads),
    // The CLI otherwise selects five-beam decoding and full token alignment.
    // One greedy candidate plus segment-level JSON keeps long synchronous
    // videos bounded while preserving complete text and segment timestamps.
    "-bs", "1",
    "-bo", "1",
    "-nf",
    "-ng",
    "-oj",
    "-of", outputPrefix,
    "-np"
  ];
}

async function defaultRunImpl({ runtime, bytes, extension, durationMs: boundedDurationMs, timeoutMs, threads }) {
  const jobRoot = join(tmpdir(), `content-reader-asr-${randomUUID()}`);
  const inputPath = join(jobRoot, `input${extension}`);
  const outputPrefix = join(jobRoot, "result");
  const outputPath = `${outputPrefix}.json`;
  await mkdir(jobRoot, { recursive: false, mode: 0o700 });
  try {
    await writeFile(inputPath, bytes, { mode: 0o600 });
    await spawnWhisper({
      binaryPath: runtime.binaryPath,
      args: buildWhisperCliArgs({
        modelPath: runtime.modelPath,
        inputPath,
        outputPrefix,
        durationMs: boundedDurationMs,
        threads
      }),
      cwd: runtime.libraryPath,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [runtime.libraryPath, process.env.LD_LIBRARY_PATH]
          .filter(Boolean)
          .join(":")
      },
      timeoutMs
    });
    let metadata;
    try {
      metadata = await stat(outputPath);
    } catch {
      throw new ReaderError(
        "LOCAL_ASR_INVALID_RESPONSE",
        "The local speech-to-text engine returned no result file.",
        { status: 502, details: { stage: "result" } }
      );
    }
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_RESULT_BYTES) {
      throw new ReaderError(
        "LOCAL_ASR_INVALID_RESPONSE",
        "The local speech-to-text engine returned an invalid result.",
        { status: 502, details: { stage: "result" } }
      );
    }
    try {
      return JSON.parse(await readFile(outputPath, "utf8"));
    } catch {
      throw new ReaderError(
        "LOCAL_ASR_INVALID_RESPONSE",
        "The local speech-to-text engine returned an invalid result.",
        { status: 502, details: { stage: "result" } }
      );
    }
  } finally {
    await rm(jobRoot, { recursive: true, force: true });
  }
}

function compactText(value) {
  return String(value ?? "")
    .replace(/\u0000|\uFFFD/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function probability(values) {
  const usable = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function tokenProbabilities(segment) {
  return (segment?.tokens ?? [])
    .filter((token) => !/^\[_.*_\]$/.test(String(token?.text ?? "")))
    .map((token) => Number(token?.p))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

export function parseWhisperJson(payload, {
  processingMs = null,
  audioPreprocessing = null
} = {}) {
  const rawSegments = [];
  const confidences = [];
  for (const entry of payload?.transcription ?? []) {
    const text = compactText(entry?.text);
    const start = Number(entry?.offsets?.from);
    const end = Number(entry?.offsets?.to);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const tokenConfidenceValues = tokenProbabilities(entry);
    const confidence = probability(tokenConfidenceValues);
    confidences.push(...tokenConfidenceValues);
    rawSegments.push({
      start_ms: Math.max(0, Math.round(start)),
      end_ms: Math.max(Math.max(0, Math.round(start)), Math.round(end)),
      text,
      ...(confidence !== null ? { confidence } : {})
    });
  }
  if (!rawSegments.length) {
    throw new ReaderError(
      "LOCAL_ASR_EMPTY_RESULT",
      "The local speech-to-text engine returned no readable speech.",
      { status: 502 }
    );
  }
  rawSegments.sort((left, right) => left.start_ms - right.start_ms || left.end_ms - right.end_ms);
  let previousEnd = 0;
  const segments = rawSegments.map((segment) => {
    const start = Math.max(previousEnd, segment.start_ms);
    const end = Math.max(start, segment.end_ms);
    previousEnd = end;
    return { ...segment, start_ms: start, end_ms: end };
  });
  const overallConfidence = probability(confidences);
  return {
    text: compactText(segments.map((segment) => segment.text).join("\n")),
    segments,
    language: compactText(payload?.result?.language) || null,
    method: "local_whisper_cpp_base_q5_1",
    confidence: overallConfidence,
    limitations: [
      "quantized_base_model_lower_accuracy",
      overallConfidence === null
        ? "confidence_unavailable_without_token_alignment"
        : "confidence_is_mean_token_probability",
      "bounded_single_candidate_decode",
      "domain_terms_and_homophones_may_be_inaccurate"
    ],
    engine: {
      name: "whisper.cpp",
      release: ENGINE_RELEASE,
      commit: ENGINE_COMMIT
    },
    model: {
      name: MODEL_NAME,
      sha256: MODEL_SHA256
    },
    ...(Number.isFinite(processingMs) ? { processing_ms: Math.round(processingMs) } : {}),
    ...(audioPreprocessing ? { audio_preprocessing: audioPreprocessing } : {})
  };
}

function decoderDiagnostic(result) {
  return {
    method: result.method,
    sample_rate: result.sampleRate,
    channel_count: result.channelCount,
    source_channel_count: result.sourceChannelCount,
    duration_ms: result.durationMs,
    input_bytes: result.inputBytes,
    output_bytes: result.outputBytes,
    runtime: result.diagnostics?.runtime ?? "unknown"
  };
}

/**
 * A bounded single-process local ASR fallback for public videos. It never
 * downloads runtime assets, uses authentication, or writes outside its exact
 * versioned/runtime job directories.
 */
export class LocalWhisperAsr {
  constructor({
    platform = process.platform,
    arch = process.arch,
    assetRoot = DEFAULT_ASSET_ROOT,
    runtimeTempRoot = tmpdir(),
    runtimeProvider = defaultRuntimeProvider,
    runImpl = defaultRunImpl,
    probeImpl = defaultProbeImpl,
    audioDecoder = new BrowserAudioDecoder(),
    maxInputBytes = DEFAULT_MAX_INPUT_BYTES,
    maxDurationMs = DEFAULT_MAX_DURATION_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    threads = DEFAULT_THREADS,
    responseReserveMs = DEFAULT_RESPONSE_RESERVE_MS,
    queueWaitMs = DEFAULT_QUEUE_WAIT_MS,
    maxQueued = DEFAULT_MAX_QUEUED,
    preflightTimeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS
  } = {}) {
    this.platform = platform;
    this.arch = arch;
    this.assetRoot = assetRoot;
    this.runtimeTempRoot = runtimeTempRoot;
    this.runtimeProvider = runtimeProvider;
    this.runImpl = runImpl;
    this.probeImpl = probeImpl;
    this.audioDecoder = audioDecoder;
    this.maxInputBytes = integerOption(maxInputBytes, {
      field: "maxInputBytes", minimum: 1, maximum: 32 * 1024 * 1024
    });
    this.maxDurationMs = integerOption(maxDurationMs, {
      field: "maxDurationMs", minimum: 1_000, maximum: 300_000
    });
    this.timeoutMs = integerOption(timeoutMs, {
      field: "timeoutMs", minimum: 1_000, maximum: 285_000
    });
    this.threads = integerOption(threads, {
      field: "threads", minimum: 1, maximum: 8
    });
    this.responseReserveMs = integerOption(responseReserveMs, {
      field: "responseReserveMs", minimum: 1_000, maximum: 30_000
    });
    this.queueWaitMs = integerOption(queueWaitMs, {
      field: "queueWaitMs", minimum: 1, maximum: 120_000
    });
    this.maxQueued = integerOption(maxQueued, {
      field: "maxQueued", minimum: 0, maximum: 8
    });
    this.preflightTimeoutMs = integerOption(preflightTimeoutMs, {
      field: "preflightTimeoutMs", minimum: 1_000, maximum: 30_000
    });
    this.active = false;
    this.waiters = [];
    this.preflightPromise = null;
  }

  get available() {
    return this.platform === "linux" && this.arch === "x64";
  }

  _releaseSlot() {
    const next = this.waiters.shift();
    if (!next) {
      this.active = false;
      return;
    }
    clearTimeout(next.timer);
    next.resolve(this._releaseOnce());
  }

  _releaseOnce() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._releaseSlot();
    };
  }

  async _acquireSlot() {
    if (!this.active) {
      this.active = true;
      return this._releaseOnce();
    }
    if (this.waiters.length >= this.maxQueued) {
      throw new ReaderError(
        "LOCAL_ASR_BUSY",
        "The local speech-to-text queue is full.",
        { status: 503, details: { stage: "queue", reason: "full" } }
      );
    }
    return new Promise((resolvePromise, reject) => {
      const waiter = { resolve: resolvePromise, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new ReaderError(
          "LOCAL_ASR_BUSY",
          "The local speech-to-text queue wait timed out.",
          {
            status: 503,
            details: { stage: "queue", reason: "timeout", timeout_ms: this.queueWaitMs }
          }
        ));
      }, this.queueWaitMs);
      this.waiters.push(waiter);
    });
  }

  async status() {
    if (!this.available) {
      return { platform_supported: false, runtime_verified: false, scope: "single_video" };
    }
    this.preflightPromise ??= (async () => {
      try {
        const runtime = await this.runtimeProvider({
          assetRoot: this.assetRoot,
          runtimeTempRoot: this.runtimeTempRoot,
          inflateImpl: inflate
        });
        await this.probeImpl({ runtime, timeoutMs: this.preflightTimeoutMs });
        return { platform_supported: true, runtime_verified: true, scope: "single_video" };
      } catch (error) {
        return {
          platform_supported: true,
          runtime_verified: false,
          scope: "single_video",
          error: {
            code: error instanceof ReaderError ? error.code : "LOCAL_ASR_RUNTIME_UNAVAILABLE",
            ...(typeof error?.details?.stage === "string" ? { stage: error.details.stage } : {}),
            ...(SAFE_RUNTIME_DEPENDENCIES.includes(error?.details?.dependency)
              ? { dependency: error.details.dependency }
              : {})
          }
        };
      }
    })();
    return this.preflightPromise;
  }

  async transcribe({ bytes: value, mediaType, video, deadlineAt = null } = {}) {
    if (!this.available) {
      throw new ReaderError(
        "LOCAL_ASR_RUNTIME_UNAVAILABLE",
        "The local speech-to-text runtime is unavailable on this platform.",
        { status: 503, details: { platform: "unsupported" } }
      );
    }
    const input = binaryInput(value);
    if (input.byteLength === 0) {
      throw new ReaderError("LOCAL_ASR_EMPTY_INPUT", "The public audio media was empty.", {
        status: 422
      });
    }
    if (input.byteLength > this.maxInputBytes) {
      throw new ReaderError(
        "LOCAL_ASR_INPUT_TOO_LARGE",
        "The public audio media exceeds the local speech-to-text size limit.",
        { status: 422, details: { size: input.byteLength, max_bytes: this.maxInputBytes } }
      );
    }
    let duration = durationMs(video);
    const inputMediaType = canonicalMediaType(mediaType);
    const directExtension = SAFE_INPUT_TYPES.get(inputMediaType);
    const canMeasureDuringDecode = !directExtension && DECODE_INPUT_TYPES.has(inputMediaType);
    if (duration === null && !canMeasureDuringDecode) {
      throw new ReaderError(
        "LOCAL_ASR_DURATION_UNKNOWN",
        "The public media duration is required for bounded local speech-to-text.",
        { status: 422 }
      );
    }
    if (duration !== null && duration > this.maxDurationMs) {
      throw new ReaderError(
        "LOCAL_ASR_DURATION_LIMIT",
        "The public media is longer than the synchronous local speech-to-text limit.",
        { status: 422, details: { duration_ms: duration, max_duration_ms: this.maxDurationMs } }
      );
    }
    const release = await this._acquireSlot();
    const startedAt = Date.now();
    try {
      logLocalAsr("local_asr.started", {
        input_bytes: input.byteLength,
        media_type: inputMediaType || "unknown",
        duration_ms: duration,
        threads: this.threads
      });
      let preparedBytes = input;
      let extension = directExtension;
      let audioPreprocessing = null;
      let boundedDurationMs = duration;
      if (canMeasureDuringDecode) {
        const decoded = await this.audioDecoder.decode(input);
        if (decoded.durationMs > this.maxDurationMs + 2_000) {
          throw new ReaderError(
            "LOCAL_ASR_DURATION_LIMIT",
            "The decoded public media is longer than the synchronous local speech-to-text limit.",
            {
              status: 422,
              details: { duration_ms: decoded.durationMs, max_duration_ms: this.maxDurationMs }
            }
          );
        }
        preparedBytes = binaryInput(decoded.bytes);
        extension = ".wav";
        audioPreprocessing = decoderDiagnostic(decoded);
        duration ??= decoded.durationMs;
        boundedDurationMs = Math.min(this.maxDurationMs, Math.max(duration, decoded.durationMs));
      }
      if (!extension) {
        throw new ReaderError(
          "LOCAL_ASR_MEDIA_UNSUPPORTED",
          "The public audio format is not supported by local speech-to-text.",
          { status: 422, details: { media_type: canonicalMediaType(mediaType) || "unknown" } }
        );
      }

      const runtime = await this.runtimeProvider({
        assetRoot: this.assetRoot,
        runtimeTempRoot: this.runtimeTempRoot,
        inflateImpl: inflate
      });
      const numericDeadline = Number(deadlineAt);
      const hasDeadline = deadlineAt !== null && deadlineAt !== undefined &&
        Number.isFinite(numericDeadline);
      const remainingMs = hasDeadline
        ? Math.floor(numericDeadline - Date.now() - this.responseReserveMs)
        : this.timeoutMs;
      if (remainingMs < 1_000) {
        throw new ReaderError(
          "LOCAL_ASR_DEADLINE_EXCEEDED",
          "Not enough request time remains for bounded local speech-to-text.",
          { status: 503, details: { stage: "deadline" } }
        );
      }
      const inferenceTimeoutMs = Math.min(this.timeoutMs, remainingMs);
      logLocalAsr("local_asr.inference_started", {
        prepared_bytes: preparedBytes.byteLength,
        duration_ms: boundedDurationMs,
        timeout_ms: inferenceTimeoutMs,
        threads: this.threads,
        elapsed_ms: Date.now() - startedAt
      });
      const raw = await this.runImpl({
        runtime,
        bytes: preparedBytes,
        extension,
        durationMs: boundedDurationMs,
        timeoutMs: inferenceTimeoutMs,
        threads: this.threads
      });
      const result = parseWhisperJson(raw, {
        processingMs: Date.now() - startedAt,
        audioPreprocessing
      });
      logLocalAsr("local_asr.completed", {
        duration_ms: boundedDurationMs,
        segment_count: result.segments.length,
        processing_ms: result.processing_ms
      });
      return result;
    } catch (error) {
      logLocalAsr("local_asr.failed", {
        code: error?.code ?? "LOCAL_ASR_INTERNAL",
        elapsed_ms: Date.now() - startedAt
      });
      throw error;
    } finally {
      release();
    }
  }
}

export function createLocalWhisperAsr(options = {}) {
  const engine = new LocalWhisperAsr(options);
  return {
    available: engine.available,
    engine,
    status: engine.status.bind(engine),
    transcribe: engine.transcribe.bind(engine)
  };
}

export function isLocalWhisperAvailable({
  platform = process.platform,
  arch = process.arch
} = {}) {
  return platform === "linux" && arch === "x64";
}
