import { spawn } from "node:child_process";
import { ReaderError } from "../errors.js";

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_MS = SAMPLE_RATE * BYTES_PER_SAMPLE / 1000;
const DEFAULT_CHUNK_MS = 240_000;
const DEFAULT_OVERLAP_MS = 5_000;
const DEFAULT_MIN_DURATION_MS = 10 * 60_000;
const DEFAULT_MAX_DURATION_MS = 90 * 60_000;
const MAX_PCM_BYTES_PER_CHUNK = 9 * 1024 * 1024;
const CHUNK_TIMEOUT_MS = 180_000;
const RESPONSE_RESERVE_MS = 20_000;
const PUBLIC_HEADERS = Object.freeze({
  "Accept": "video/mp4,audio/mp4,audio/*,video/*,application/octet-stream;q=0.8,*/*;q=0.1",
  "Referer": "https://www.douyin.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
});
const SAFE_HEADER_NAMES = new Set(["accept", "accept-language", "origin", "referer", "user-agent"]);
const RETRYABLE_EXTRACT_CODES = new Set([
  "STREAMING_AUDIO_EXTRACT_FAILED",
  "STREAMING_AUDIO_EXTRACT_TIMEOUT",
  "STREAMING_AUDIO_CHUNK_INCOMPLETE"
]);
const SPLITTABLE_ASR_CODES = new Set(["LOCAL_ASR_TIMEOUT"]);

function failure(code, message, details = {}) {
  return new ReaderError(code, message, { status: 422, details });
}

function videoDurationMs(video) {
  for (const value of [video?.media?.duration_ms, video?.duration_ms]) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  for (const value of [video?.duration, video?.video?.duration]) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n >= 1000 ? n : n * 1000);
  }
  return null;
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function ffmpegHeaderString(source) {
  const headers = { ...PUBLIC_HEADERS };
  for (const [name, value] of Object.entries(source?.headers ?? {})) {
    if (!SAFE_HEADER_NAMES.has(name.toLowerCase()) || typeof value !== "string" ||
        /[\r\n]/.test(value)) continue;
    headers[name] = value;
  }
  return Object.entries(headers)
    .map(([name, value]) => String(name) + ": " + String(value))
    .join("\r\n") + "\r\n";
}

function remainingMs(deadlineAt, now) {
  if (deadlineAt === null || deadlineAt === undefined) return Number.POSITIVE_INFINITY;
  const value = Number(deadlineAt) - now();
  return Number.isFinite(value) ? value : 0;
}

function extractPublicPcmChunk({
  source, startMs, durationMs, deadlineAt, spawnImpl = spawn, now = Date.now
}) {
  const url = safeSourceUrl(source?.url);
  if (!url) return Promise.reject(failure("MEDIA_SOURCE_INVALID", "Streaming requires a validated public HTTPS media source.", {
    stage: "source_validation"
  }));

  const remaining = remainingMs(deadlineAt, now);
  if (remaining < RESPONSE_RESERVE_MS + 1_000) {
    return Promise.reject(failure("STREAMING_ASR_DEADLINE_EXCEEDED", "Not enough task time remains to extract another audio chunk.", {
      stage: "before_extract"
    }));
  }

  const timeoutMs = Math.max(1_000, Math.min(CHUNK_TIMEOUT_MS, remaining - RESPONSE_RESERVE_MS));
  const maxBytes = Math.min(
    MAX_PCM_BYTES_PER_CHUNK,
    Math.ceil((durationMs + 2_000) * BYTES_PER_MS)
  );
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-rw_timeout", "30000000",
    "-ss", (startMs / 1000).toFixed(3),
    "-headers", ffmpegHeaderString(source),
    "-i", url.href,
    "-t", (durationMs / 1000).toFixed(3),
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-ac", "1", "-ar", String(SAMPLE_RATE),
    "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"
  ];

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let total = 0;
    const chunks = [];
    const finish = (error, bytes = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(bytes);
    };
    const timer = setTimeout(() => {
      try { child?.kill("SIGKILL"); } catch { /* process may already have exited */ }
      finish(failure("STREAMING_AUDIO_EXTRACT_TIMEOUT", "The public media did not yield an audio chunk before its time limit.", {
        stage: "extract", start_ms: startMs, duration_ms: durationMs
      }));
    }, timeoutMs);

    try {
      child = spawnImpl("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch (error) {
      finish(failure("STREAMING_FFMPEG_UNAVAILABLE", "The streaming audio extractor could not start.", {
        stage: "spawn", cause_code: error?.code === "ENOENT" ? "ENOENT" : "SPAWN_FAILED"
      }));
      return;
    }

    child.stdout?.on("data", (value) => {
      if (settled) return;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        try { child.kill("SIGKILL"); } catch { /* process may already have exited */ }
        finish(failure("STREAMING_AUDIO_CHUNK_TOO_LARGE", "The extracted audio chunk exceeded its strict output limit.", {
          stage: "extract", start_ms: startMs, duration_ms: durationMs
        }));
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", (error) => {
      finish(failure(
        error?.code === "ENOENT" ? "STREAMING_FFMPEG_UNAVAILABLE" : "STREAMING_AUDIO_EXTRACT_FAILED",
        "The public media audio extractor failed to start or continue.",
        { stage: "spawn", cause_code: error?.code === "ENOENT" ? "ENOENT" : "SPAWN_FAILED" }
      ));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        finish(failure("STREAMING_AUDIO_EXTRACT_FAILED", "The public media did not yield a valid audio chunk.", {
          stage: "extract", start_ms: startMs, duration_ms: durationMs,
          ...(Number.isInteger(code) ? { exit_code: code } : {}),
          ...(["SIGABRT", "SIGKILL", "SIGSEGV", "SIGTERM"].includes(signal) ? { signal } : {})
        }));
        return;
      }
      if (!total || total % BYTES_PER_SAMPLE !== 0) {
        finish(failure("STREAMING_AUDIO_CHUNK_INCOMPLETE", "The extracted audio chunk was empty or structurally incomplete.", {
          stage: "validate_pcm", start_ms: startMs, duration_ms: durationMs
        }));
        return;
      }
      finish(null, Buffer.concat(chunks, total));
    });
  });
}

function pcmToWav(pcm, sampleRate = SAMPLE_RATE) {
  if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2 !== 0) {
    throw failure("STREAMING_AUDIO_CHUNK_INCOMPLETE", "The extracted PCM audio was not a valid 16-bit mono stream.", {
      stage: "wav_wrap"
    });
  }
  const header = Buffer.alloc(44);
  const dataBytes = pcm.byteLength;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, pcm], header.byteLength + dataBytes);
}

function normalizedText(value) {
  return String(value ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function mergeSegments(chunks, totalDurationMs, overlapMs) {
  const output = [];
  for (const chunk of chunks) {
    for (const segment of chunk.segments) {
      const text = String(segment.text ?? "").trim();
      const startMs = Math.max(0, Math.round(segment.start_ms));
      const endMs = Math.min(totalDurationMs, Math.round(segment.end_ms));
      if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw failure("STREAMING_ASR_INVALID_SEGMENT", "A chunk returned an invalid timestamped transcript segment.", {
          stage: "merge", chunk_index: chunk.index
        });
      }
      const key = normalizedText(text);
      const duplicate = key.length > 1 && output.find((previous) =>
        normalizedText(previous.text) === key &&
        Math.abs(previous.start_ms - startMs) <= overlapMs + 1_000);
      if (duplicate) {
        duplicate.start_ms = Math.min(duplicate.start_ms, startMs);
        duplicate.end_ms = Math.max(duplicate.end_ms, endMs);
        continue;
      }
      output.push({
        start_ms: startMs,
        end_ms: endMs,
        text,
        ...(Number.isFinite(segment.confidence) ? { confidence: segment.confidence } : {})
      });
    }
  }
  output.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  return output;
}

function splitPcm(pcm, splitMs, overlapMs, sampleRate) {
  const bytesPerMs = sampleRate * BYTES_PER_SAMPLE / 1000;
  const overlapHalf = Math.floor(overlapMs / 2);
  const firstEndMs = Math.min(pcm.byteLength / bytesPerMs, splitMs + overlapHalf);
  const secondStartMs = Math.max(0, splitMs - overlapHalf);
  const firstEnd = Math.floor(firstEndMs * bytesPerMs / BYTES_PER_SAMPLE) * BYTES_PER_SAMPLE;
  const secondStart = Math.floor(secondStartMs * bytesPerMs / BYTES_PER_SAMPLE) * BYTES_PER_SAMPLE;
  return [
    { startMs: 0, endMs: firstEnd / bytesPerMs, pcm: pcm.subarray(0, firstEnd) },
    { startMs: secondStart / bytesPerMs, endMs: pcm.byteLength / bytesPerMs, pcm: pcm.subarray(secondStart) }
  ];
}

export function createStreamingWhisperAsr({
  extractChunkImpl = extractPublicPcmChunk,
  chunkDurationMs = DEFAULT_CHUNK_MS,
  overlapMs = DEFAULT_OVERLAP_MS,
  minDurationMs = DEFAULT_MIN_DURATION_MS,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
  sampleRate = SAMPLE_RATE,
  now = Date.now,
  onProgress = null
} = {}) {
  return async function streamingWhisperAsr({ video, mediaResolver, localAsr, deadlineAt = null, requestId = null } = {}) {
    const id = String(video?.aweme_id ?? video?.id ?? "");
    if (!/^\d{10,25}$/.test(id)) {
      throw failure("STREAMING_ASR_VIDEO_ID_INVALID", "A stable video identity is required for streaming transcription.", {
        stage: "identity"
      });
    }
    const duration = videoDurationMs(video);
    if (!Number.isFinite(duration) || duration < minDurationMs || duration > maxDurationMs) {
      throw failure("STREAMING_ASR_DURATION_UNSUPPORTED", "The video duration is outside the streaming transcription policy.", {
        stage: "duration", duration_ms: duration, min_duration_ms: minDurationMs, max_duration_ms: maxDurationMs
      });
    }
    if (!Number.isSafeInteger(chunkDurationMs) || chunkDurationMs < 30_000 ||
        !Number.isSafeInteger(overlapMs) || overlapMs < 0 || overlapMs >= chunkDurationMs) {
      throw failure("STREAMING_ASR_CONFIGURATION_INVALID", "The streaming transcription window configuration is invalid.", {
        stage: "configuration"
      });
    }
    if (typeof mediaResolver?.resolveStreamable !== "function" || typeof localAsr !== "function") {
      throw failure("STREAMING_ASR_NOT_CONFIGURED", "Range-readable media resolution and local Whisper are required.", {
        stage: "configuration"
      });
    }

    const startedAt = now();
    let source = await mediaResolver.resolveStreamable(video);
    if (!safeSourceUrl(source?.url) || source?.diagnostics?.status !== 206) {
      throw failure("STREAMING_ASR_SOURCE_UNVERIFIED", "Streaming requires a verified range-readable public media source.", {
        stage: "source_validation"
      });
    }
    const windows = [];
    for (let startMs = 0; startMs < duration; startMs += chunkDurationMs) {
      windows.push({
        index: windows.length,
        startMs,
        durationMs: Math.min(chunkDurationMs + (startMs + chunkDurationMs < duration ? overlapMs : 0), duration - startMs)
      });
    }

    const emitProgress = async (event) => {
      if (typeof onProgress !== "function") return;
      try {
        await onProgress({
          request_id: requestId,
          aweme_id: id,
          video_duration_ms: duration,
          ...event
        });
      } catch (error) {
        console.warn(JSON.stringify({
          event: "streaming_asr.progress_sink_failed",
          code: error?.code === "ENOENT" ? "ENOENT" : "CHECKPOINT_WRITE_FAILED"
        }));
      }
    };
    await emitProgress({ phase: "started", total_chunks: windows.length, completed_chunks: 0 });

    const completed = [];
    let totalPcmBytes = 0;
    let templateResult = null;
    const transcribePcm = async (pcm, durationMs, parentStartMs, chunkIndex, depth = 0) => {
      const actualDurationMs = Math.round(pcm.byteLength / (sampleRate * BYTES_PER_SAMPLE) * 1000);
      if (!actualDurationMs || Math.abs(actualDurationMs - durationMs) > Math.max(1_500, durationMs * 0.01)) {
        throw failure("STREAMING_AUDIO_CHUNK_INCOMPLETE", "The extracted audio did not cover its expected time window.", {
          stage: "validate_pcm", chunk_index: chunkIndex, expected_duration_ms: durationMs, actual_duration_ms: actualDurationMs
        });
      }
      const wav = pcmToWav(pcm, sampleRate);
      const chunkVideo = {
        ...video,
        duration_ms: actualDurationMs,
        media: { ...(video.media ?? {}), duration_ms: actualDurationMs }
      };
      try {
        const result = await localAsr({
          bytes: wav, mediaType: "audio/wav", video: chunkVideo,
          source: { media_kind: source.kind ?? "video", streaming: true, chunk_index: chunkIndex },
          deadlineAt
        });
        if (!result || result.coverage?.full_audio_scanned !== true ||
            Number(result.coverage.end_ms) < actualDurationMs - 1_000 ||
            !Array.isArray(result.segments)) {
          throw failure("STREAMING_ASR_CHUNK_UNVERIFIED", "A chunk did not pass the full-audio transcription gate.", {
            stage: "validate_asr", chunk_index: chunkIndex
          });
        }
        if (result.segments.length && (!result.engine || !result.model)) {
          throw failure("STREAMING_ASR_ENGINE_UNVERIFIED", "A chunk omitted the pinned local speech-to-text engine identity.", {
            stage: "validate_asr", chunk_index: chunkIndex
          });
        }
        if (result.segments.length && templateResult &&
            (result.engine?.commit !== templateResult.engine?.commit ||
             result.model?.sha256 !== templateResult.model?.sha256)) {
          throw failure("STREAMING_ASR_ENGINE_CHANGED", "The speech-to-text engine or model changed during the task.", {
            stage: "validate_asr", chunk_index: chunkIndex
          });
        }
        if (result.segments.length && !templateResult) templateResult = result;
        return result.segments.map((segment) => ({
          ...segment,
          start_ms: parentStartMs + Number(segment.start_ms),
          end_ms: parentStartMs + Number(segment.end_ms)
        }));
      } catch (error) {
        if (error?.code === "LOCAL_ASR_EMPTY_RESULT") return [];
        const remaining = remainingMs(deadlineAt, now);
        if (SPLITTABLE_ASR_CODES.has(error?.code) && depth < 2 &&
            actualDurationMs > 30_000 && remaining > 120_000) {
          const splitAt = Math.floor(actualDurationMs / 2);
          const subchunks = splitPcm(pcm, splitAt, Math.min(overlapMs, 5_000), sampleRate);
          const first = await transcribePcm(subchunks[0].pcm, subchunks[0].endMs, parentStartMs, chunkIndex, depth + 1);
          const second = await transcribePcm(
            subchunks[1].pcm, subchunks[1].endMs - subchunks[1].startMs,
            parentStartMs + subchunks[1].startMs, chunkIndex, depth + 1
          );
          return [...first, ...second];
        }
        throw error;
      }
    };

    for (const window of windows) {
      const remaining = remainingMs(deadlineAt, now);
      if (remaining < RESPONSE_RESERVE_MS + 1_000) {
        throw failure("STREAMING_ASR_DEADLINE_EXCEEDED", "The task deadline was reached before all audio chunks were processed.", {
          stage: "before_chunk", completed_chunks: completed.length, total_chunks: windows.length,
          chunk_index: window.index
        });
      }

      let pcm;
      let extractError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          pcm = await extractChunkImpl({
            source, startMs: window.startMs, durationMs: window.durationMs,
            deadlineAt, now, sampleRate
          });
          extractError = null;
          break;
        } catch (error) {
          extractError = error;
          if (attempt > 0 || !RETRYABLE_EXTRACT_CODES.has(error?.code)) break;
          try {
            source = await mediaResolver.resolveStreamable(video);
            if (!safeSourceUrl(source?.url) || source?.diagnostics?.status !== 206) {
              throw failure("STREAMING_ASR_SOURCE_UNVERIFIED", "A refreshed media source failed range validation.", {
                stage: "refresh", chunk_index: window.index
              });
            }
          } catch (refreshError) {
            extractError = refreshError;
            break;
          }
        }
      }
      if (extractError || !Buffer.isBuffer(pcm)) {
        throw failure("STREAMING_ASR_CHUNK_FAILED", "A public audio chunk could not be extracted after one safe source refresh.", {
          stage: "extract", chunk_index: window.index, completed_chunks: completed.length,
          total_chunks: windows.length, cause_code: extractError?.code ?? "STREAMING_AUDIO_EXTRACT_FAILED"
        });
      }

      totalPcmBytes += pcm.byteLength;
      const actualDurationMs = Math.round(pcm.byteLength / (sampleRate * BYTES_PER_SAMPLE) * 1000);
      const expected = window.durationMs;
      if (!actualDurationMs || Math.abs(actualDurationMs - expected) > Math.max(1_500, expected * 0.01)) {
        throw failure("STREAMING_AUDIO_CHUNK_INCOMPLETE", "A public audio chunk was shorter than its expected time window.", {
          stage: "validate_pcm", chunk_index: window.index, completed_chunks: completed.length,
          total_chunks: windows.length, expected_duration_ms: expected, actual_duration_ms: actualDurationMs
        });
      }
      const segments = await transcribePcm(pcm, actualDurationMs, window.startMs, window.index);
      completed.push({ ...window, actualDurationMs, segments });
      await emitProgress({
        phase: "chunk_completed",
        chunk_index: window.index,
        chunk_start_ms: window.startMs,
        chunk_end_ms: Math.min(duration, window.startMs + actualDurationMs),
        completed_chunks: completed.length,
        total_chunks: windows.length,
        segment_count: segments.length,
        segments
      });
    }

    if (!templateResult || !completed.some((chunk) => chunk.segments.length)) {
      throw failure("STREAMING_ASR_NO_SPEECH", "The full public audio was scanned but no readable speech segments were returned.", {
        stage: "result_validation", completed_chunks: completed.length, total_chunks: windows.length
      });
    }

    const segments = mergeSegments(completed, duration, overlapMs);
    if (!segments.length) {
      throw failure("STREAMING_ASR_NO_SPEECH", "The full public audio did not yield a readable transcript.", {
        stage: "result_validation", completed_chunks: completed.length, total_chunks: windows.length
      });
    }
    const text = segments.map((segment) => segment.text).join("\n").trim();
    if (!text) {
      throw failure("STREAMING_ASR_EMPTY_TEXT", "The full public audio produced no usable transcript text.", {
        stage: "result_validation", completed_chunks: completed.length, total_chunks: windows.length
      });
    }

    return {
      result: {
        status: "complete",
        text,
        segments,
        language: templateResult.language ?? null,
        method: templateResult.method ?? "local_whisper_cpp_base_q5_1",
        confidence: Number.isFinite(templateResult.confidence) ? templateResult.confidence : null,
        limitations: [
          "streamed_public_audio_chunks",
          "quantized_base_model_lower_accuracy",
          "domain_terms_and_homophones_may_be_inaccurate",
          "audio_transcription_does_not_capture_silent_on_screen_text"
        ],
        engine: templateResult.engine,
        model: templateResult.model,
        processing_ms: now() - startedAt,
        coverage: {
          start_ms: 0,
          end_ms: duration,
          full_audio_scanned: true,
          chunk_count: completed.length
        },
        chunking: {
          strategy: "http_range_ffmpeg_pcm16_mono",
          chunk_count: completed.length,
          overlap_ms: overlapMs,
          pcm_bytes_processed: totalPcmBytes
        },
        audio_preprocessing: {
          method: "ffmpeg_http_range_pcm16_mono",
          sample_rate: sampleRate,
          channel_count: 1,
          duration_ms: duration,
          output_bytes: totalPcmBytes
        }
      },
      source
    };
  };
}
