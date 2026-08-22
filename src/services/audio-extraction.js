import { createFile } from "mp4box";

import { ReaderError } from "../errors.js";

function concat(chunks, total) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function audioConfig(track) {
  const codecMatch = String(track?.codec ?? "").match(/^mp4a\.40\.(\d+)$/i);
  const objectType = Number(codecMatch?.[1]);
  const sampleRate = Number(track?.audio?.sample_rate);
  const channelCount = Number(track?.audio?.channel_count);
  const durationMs = Number(track?.duration) >= 0 && Number(track?.timescale) > 0
    ? Math.round((Number(track.duration) / Number(track.timescale)) * 1000)
    : null;
  if (!Number.isInteger(objectType) || objectType < 1 || objectType > 63 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isInteger(channelCount) || channelCount < 1) {
    throw new ReaderError(
      "AUDIO_EXTRACTION_UNSUPPORTED_CODEC",
      "The public MP4 audio track is not supported by the built-in extractor.",
      {
        status: 422,
        details: {
          codec: track?.codec ?? null,
          sample_rate: Number.isFinite(sampleRate) ? sampleRate : null,
          channel_count: Number.isFinite(channelCount) ? channelCount : null
        }
      }
    );
  }
  return { objectType, sampleRate, channelCount, durationMs };
}

/**
 * Remux the AAC speech track already present in a public MP4 into an audio-only
 * fragmented MP4. This is container extraction, not decoding, so it is fast
 * enough for a serverless request and substantially reduces the payload sent
 * to speech-to-text providers. audio/mp4 is also an explicitly supported ASR
 * input, unlike a raw AAC/ADTS stream.
 */
export async function extractMp4Audio(bytes, {
  maxOutputBytes = 25 * 1024 * 1024,
  createFileImpl = createFile
} = {}) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (!input.byteLength) {
    throw new ReaderError("AUDIO_EXTRACTION_EMPTY_INPUT", "The MP4 media was empty.", {
      status: 422
    });
  }

  return new Promise((resolve, reject) => {
    const file = createFileImpl();
    const chunks = [];
    let total = 0;
    let config = null;
    let trackId = null;
    let settled = false;

    const addChunk = (value) => {
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
      total += chunk.byteLength;
      if (total > maxOutputBytes) {
        throw new ReaderError(
          "AUDIO_EXTRACTION_TOO_LARGE",
          "The extracted audio exceeds the processing size limit.",
          { status: 422, details: { size: total, max_bytes: maxOutputBytes } }
        );
      }
      chunks.push(chunk);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof ReaderError ? error : new ReaderError(
        "AUDIO_EXTRACTION_FAILED",
        "The public MP4 audio track could not be extracted.",
        { status: 422, cause: error }
      ));
    };

    file.onError = (message) => fail(new ReaderError(
      "AUDIO_EXTRACTION_INVALID_MP4",
      "The public media was not a readable MP4 container.",
      { status: 422, details: { parser_message: String(message ?? "invalid_mp4").slice(0, 200) } }
    ));
    file.onReady = (info) => {
      try {
        const track = info?.audioTracks?.[0];
        if (!track) {
          throw new ReaderError(
            "AUDIO_EXTRACTION_NO_AUDIO_TRACK",
            "The public MP4 contained no audio track.",
            { status: 422 }
          );
        }
        config = audioConfig(track);
        trackId = track.id;
        file.setSegmentOptions(track.id, null, {
          nbSamples: 1_000,
          rapAlignement: false
        });
        const initializations = file.initializeSegmentation("per-track");
        const initialization = initializations.find((entry) => entry.id === track.id);
        if (!initialization?.buffer) {
          throw new ReaderError(
            "AUDIO_EXTRACTION_INITIALIZATION_FAILED",
            "The public MP4 audio track could not be initialized.",
            { status: 422 }
          );
        }
        addChunk(initialization.buffer);
        file.start();
      } catch (error) {
        fail(error);
      }
    };
    file.onSegment = (id, _user, buffer) => {
      if (settled || id !== trackId || !config) return;
      try {
        addChunk(buffer);
      } catch (error) {
        fail(error);
      }
    };

    try {
      const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
      buffer.fileStart = 0;
      file.appendBuffer(buffer);
      file.flush();
      queueMicrotask(() => {
        if (settled) return;
        if (!config || trackId === null || chunks.length < 2) {
          fail(new ReaderError(
            "AUDIO_EXTRACTION_EMPTY_RESULT",
            "The public MP4 audio track yielded no readable samples.",
            { status: 422 }
          ));
          return;
        }
        settled = true;
        resolve({
          bytes: concat(chunks, total),
          mediaType: "audio/mp4",
          method: "mp4_aac_remux",
          codec: `mp4a.40.${config.objectType}`,
          sampleRate: config.sampleRate,
          channelCount: config.channelCount,
          durationMs: config.durationMs,
          inputBytes: input.byteLength,
          outputBytes: total
        });
      });
    } catch (error) {
      fail(error);
    }
  });
}
