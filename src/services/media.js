import { createHash } from "node:crypto";

import { ReaderError } from "../errors.js";
import { isTerminalAccessError } from "./provider-chain.js";

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const SAFE_SOURCE_HEADERS = new Set([
  "accept",
  "accept-language",
  "origin",
  "referer",
  "user-agent"
]);
const PUBLIC_DOUYIN_MEDIA_HEADERS = Object.freeze({
  Accept: "video/mp4,audio/mp4,audio/*,video/*,application/octet-stream;q=0.8,*/*;q=0.1",
  Referer: "https://www.douyin.com/",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function urlHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function numericHeader(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function contentRangeSize(value) {
  const match = String(value ?? "").match(/bytes\s+\d+-\d+\/(\d+|\*)/i);
  return match && match[1] !== "*" ? numericHeader(match[1]) : null;
}

function mediaKind(mediaType, fallback = "video") {
  return /^audio(?:\/|$)/i.test(String(mediaType ?? "")) ? "audio" : fallback;
}

function mediaTypeFor(source, response) {
  const header = response?.headers?.get?.("content-type")?.split(";", 1)[0]?.trim();
  return header || source.mediaType || source.media_type ||
    (source.kind === "audio" ? "audio/mpeg" : "video/mp4");
}

function isClearlyNotMedia(mediaType) {
  const value = String(mediaType ?? "").toLowerCase();
  return value.startsWith("text/") || value.includes("json") || value.includes("xml");
}

function safeHeaders(value) {
  const output = {};
  if (!value || typeof value !== "object") return output;
  for (const [name, headerValue] of Object.entries(value)) {
    if (SAFE_SOURCE_HEADERS.has(name.toLowerCase()) && typeof headerValue === "string") {
      output[name] = headerValue;
    }
  }
  return output;
}

function safeError(error) {
  return {
    code: error instanceof ReaderError ? error.code : "MEDIA_PROVIDER_ERROR",
    ...(Number.isFinite(error?.status) ? { status: error.status } : {})
  };
}

function acquisitionTime(value) {
  const candidates = [
    value?.acquired_at,
    value?.media_acquired_at,
    value?.media?.acquired_at,
    value?.source?.media_acquired_at,
    value?.source?.acquired_at
  ];
  return candidates.find((candidate) => candidate !== undefined && candidate !== null) ?? null;
}

function timestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return number > 10_000_000_000 ? number : number * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function stableVideoId(video) {
  return video?.aweme_id ?? video?.id ?? video?.item_id ?? video?.group_id ?? null;
}

function refreshedVideo(value) {
  return value?.content && (value.content.aweme_id || value.content.id || value.content.media || value.content.video)
    ? value.content
    : value?.video && (value.video.aweme_id || value.video.id || value.video.media || value.video.video)
      ? value.video
      : value;
}

function entryUrls(entry) {
  if (typeof entry === "string") return [entry];
  if (!entry || typeof entry !== "object") return [];
  const values = [entry.url, entry.src, entry.download_url];
  for (const list of [entry.url_list, entry.urls]) {
    if (Array.isArray(list)) values.push(...list);
  }
  for (const nested of [entry.play_addr, entry.playback, entry.download_addr]) {
    if (Array.isArray(nested)) {
      for (const item of nested) values.push(...entryUrls(item));
    } else if (nested && nested !== entry) {
      values.push(...entryUrls(nested));
    }
  }
  return values.filter((value) => typeof value === "string");
}

function addEntries(output, seen, entries, kind, inheritedAcquiredAt) {
  if (!Array.isArray(entries)) entries = entries === undefined || entries === null ? [] : [entries];
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      addEntries(output, seen, entry, kind, inheritedAcquiredAt);
      continue;
    }
    for (const address of entryUrls(entry)) {
      const parsed = asPublicHttpUrl(address);
      if (!parsed || seen.has(parsed.href)) continue;
      seen.add(parsed.href);
      const declaredType = typeof entry === "object"
        ? entry.mediaType ?? entry.media_type ?? entry.content_type ?? entry.mime_type
        : null;
      const resolvedKind = mediaKind(declaredType, kind);
      output.push({
        url: parsed.href,
        kind: resolvedKind,
        mediaType: declaredType ?? (resolvedKind === "audio" ? "audio/mpeg" : "video/mp4"),
        media_type: declaredType ?? (resolvedKind === "audio" ? "audio/mpeg" : "video/mp4"),
        acquired_at: acquisitionTime(entry) ?? inheritedAcquiredAt,
        headers: safeHeaders(typeof entry === "object" ? entry.headers : null)
      });
    }
  }
}

function durationMs(video) {
  const millisecondValues = [
    video?.duration_ms,
    video?.media?.duration_ms,
  ];
  for (const value of millisecondValues) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    return number;
  }
  for (const value of [video?.duration, video?.video?.duration]) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) continue;
    return number >= 1_000 ? number : number * 1000;
  }
  return null;
}

function originalSoundEntries(video, acquiredAt) {
  const music = video?.music;
  const title = String(music?.title ?? "");
  if (!/(?:创作的原声|original\s+sound)/i.test(title)) return [];

  const videoDuration = durationMs(video);
  const musicDuration = Number(music?.duration_ms ??
    (Number.isFinite(Number(music?.duration)) ? Number(music.duration) * 1000 : NaN));
  if (!Number.isFinite(videoDuration) || !Number.isFinite(musicDuration)) return [];
  const allowedDifference = Math.max(2_000, videoDuration * 0.03);
  if (Math.abs(videoDuration - musicDuration) > allowedDifference) return [];

  return (music.play_urls ?? music.url_list ?? []).map((url) => ({
    url,
    media_type: "audio/mpeg",
    acquired_at: acquisitionTime(music) ?? acquiredAt,
    source_role: "original_sound"
  }));
}

function mediaCandidates(video, acquiredAt) {
  const media = video?.media ?? {};
  const output = [];
  const seen = new Set();

  // Douyin exposes the complete soundtrack for creator-recorded videos as a
  // public MP3. Use it only when the page labels it as the creator's original
  // sound and its duration matches the video; ordinary background music must
  // never replace the video's spoken track.
  addEntries(output, seen, originalSoundEntries(video, acquiredAt), "audio", acquiredAt);

  // Explicit audio-only assets preserve speech while avoiding unnecessary video transfer.
  for (const entries of [
    media.audio_only,
    media.audio,
    media.audio_tracks,
    media.audios,
    media.audio_sources,
    video?.audio_only,
    video?.audio_sources
  ]) {
    addEntries(output, seen, entries, "audio", acquiredAt);
  }

  const transcriptionInput = video?.transcription_input;
  if (transcriptionInput?.strategy === "media" && transcriptionInput.media_url) {
    addEntries(output, seen, [{
      url: transcriptionInput.media_url,
      media_type: transcriptionInput.media_type,
      acquired_at: transcriptionInput.acquired_at
    }], mediaKind(transcriptionInput.media_type), acquiredAt);
  }

  addEntries(output, seen, media.playback, "video", acquiredAt);
  addEntries(output, seen, media.downloads, "video", acquiredAt);

  // Accept raw detail shapes from a refresh callback without making them the primary contract.
  addEntries(output, seen, video?.video?.play_addr, "video", acquiredAt);
  addEntries(output, seen, video?.video?.download_addr, "video", acquiredAt);
  return output;
}

async function boundedBytes(response, maxBytes, diagnostic) {
  const declared = numericHeader(response.headers?.get?.("content-length"));
  if (declared !== null && declared > maxBytes) {
    try { await response.body?.cancel(); } catch { /* already closed */ }
    throw new ReaderError("MEDIA_TOO_LARGE", "The public media exceeds the processing size limit.", {
      status: 422,
      details: { ...diagnostic, size: declared, max_bytes: maxBytes }
    });
  }

  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new ReaderError("MEDIA_TOO_LARGE", "The public media exceeds the processing size limit.", {
        status: 422,
        details: { ...diagnostic, size: bytes.byteLength, max_bytes: maxBytes }
      });
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ReaderError("MEDIA_TOO_LARGE", "The public media exceeds the processing size limit.", {
          status: 422,
          details: { ...diagnostic, size, max_bytes: maxBytes }
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function safeMediaDiagnostic(value, extra = {}) {
  const parsed = asPublicHttpUrl(typeof value === "string" ? value : value?.url);
  return {
    ...(parsed ? { host: parsed.hostname, url_hash: urlHash(parsed.href) } : {}),
    ...(Number.isFinite(extra.status) ? { status: extra.status } : {}),
    ...(Number.isFinite(extra.size) ? { size: extra.size } : {})
  };
}

export class MediaResolver {
  constructor({
    fetchImpl = globalThis.fetch,
    refreshVideo = null,
    maxAgeMs = 10 * 60 * 1000,
    timeoutMs = 30_000,
    maxBytes = 100 * 1024 * 1024,
    retries = 1,
    retryDelayMs = 250,
    now = () => Date.now(),
    sleepImpl = wait
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new ReaderError("MEDIA_NOT_CONFIGURED", "A media fetch implementation is required.", {
        status: 503
      });
    }
    this.fetchImpl = fetchImpl;
    this.refreshVideo = refreshVideo;
    this.maxAgeMs = maxAgeMs;
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.retries = Math.max(0, Math.floor(retries));
    this.retryDelayMs = Math.max(0, retryDelayMs);
    this.now = now;
    this.sleepImpl = sleepImpl;
  }

  async _request(url, options = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { ...options, signal: controller.signal });
        if (attempt < this.retries && TRANSIENT_HTTP_STATUS.has(response.status)) {
          try { await response.body?.cancel(); } catch { /* already closed */ }
          await this.sleepImpl(this.retryDelayMs * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) {
          await this.sleepImpl(this.retryDelayMs * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw new ReaderError(
      lastError?.name === "AbortError" ? "MEDIA_TIMEOUT" : "MEDIA_NETWORK_ERROR",
      lastError?.name === "AbortError" ? "The public media request timed out." : "The public media could not be reached.",
      { status: 502, details: safeMediaDiagnostic(url), cause: lastError }
    );
  }

  async _validate(source) {
    const diagnostic = safeMediaDiagnostic(source);
    try {
      const response = await this._request(source.url, {
        method: "GET",
        redirect: "follow",
        headers: {
          ...PUBLIC_DOUYIN_MEDIA_HEADERS,
          ...source.headers,
          Range: "bytes=0-0"
        }
      });
      const declaredSize = contentRangeSize(response.headers?.get?.("content-range")) ??
        numericHeader(response.headers?.get?.("content-length"));
      const resultDiagnostic = safeMediaDiagnostic(source, {
        status: response.status,
        size: declaredSize
      });

      if (![200, 206].includes(response.status) ||
          (declaredSize !== null && (declaredSize === 0 || declaredSize > this.maxBytes))) {
        try { await response.body?.cancel(); } catch { /* already closed */ }
        return { ok: false, diagnostic: resultDiagnostic };
      }

      const type = mediaTypeFor(source, response);
      if (isClearlyNotMedia(type)) {
        try { await response.body?.cancel(); } catch { /* already closed */ }
        return { ok: false, diagnostic: resultDiagnostic };
      }

      let observedSize = declaredSize;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          const { done, value } = await reader.read();
          if (observedSize === null && !done) observedSize = value.byteLength;
          await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (observedSize === null) observedSize = bytes.byteLength;
      }

      if (!observedSize) return { ok: false, diagnostic: resultDiagnostic };
      return {
        ok: true,
        mediaType: type,
        size: observedSize,
        diagnostic: safeMediaDiagnostic(source, { status: response.status, size: observedSize })
      };
    } catch (error) {
      return {
        ok: false,
        diagnostic: { ...diagnostic, error: safeError(error) }
      };
    }
  }

  async _firstUsable(video, acquiredAt, attempts) {
    const candidates = mediaCandidates(video, acquiredAt);
    for (const candidate of candidates) {
      const validation = await this._validate(candidate);
      attempts.push(validation.diagnostic);
      if (validation.ok) {
        return {
          ...candidate,
          mediaType: validation.mediaType,
          media_type: validation.mediaType,
          acquired_at: candidate.acquired_at ?? new Date(this.now()).toISOString(),
          validated_at: new Date(this.now()).toISOString(),
          diagnostics: validation.diagnostic
        };
      }
    }
    return null;
  }

  async resolve(video) {
    if (!video || typeof video !== "object") {
      throw new ReaderError("MEDIA_VIDEO_REQUIRED", "A normalized video object is required.", {
        status: 400
      });
    }

    const awemeId = stableVideoId(video);
    const acquiredAt = acquisitionTime(video);
    const acquiredMs = timestampMs(acquiredAt);
    const stale = acquiredMs === null || this.now() - acquiredMs > this.maxAgeMs;
    const attempts = [];

    if (!stale) {
      const current = await this._firstUsable(video, acquiredAt, attempts);
      if (current) return current;
    }

    if (typeof this.refreshVideo === "function" && awemeId) {
      try {
        const refreshedAt = new Date(this.now()).toISOString();
        const result = refreshedVideo(await this.refreshVideo(String(awemeId), video));
        if (result && typeof result === "object") {
          const refreshed = await this._firstUsable(
            result,
            acquisitionTime(result) ?? refreshedAt,
            attempts
          );
          if (refreshed) return refreshed;
        }
      } catch (error) {
        // A current public-page access boundary is authoritative. Never use an
        // older CDN URL after Douyin says the content is private/login-gated.
        if (isTerminalAccessError(error)) throw error;
        attempts.push({ refresh: safeError(error) });
      }
    }

    // A refresh failure should not discard a stale URL that is still demonstrably usable.
    if (stale) {
      const current = await this._firstUsable(video, acquiredAt, attempts);
      if (current) return current;
    }

    throw new ReaderError("MEDIA_UNAVAILABLE", "No currently usable public media source was found.", {
      status: 422,
      details: {
        ...(awemeId ? { aweme_id: String(awemeId) } : {}),
        attempts
      }
    });
  }

  async fetch(source) {
    const resolved = source?.url ? source : await this.resolve(source);
    const parsed = asPublicHttpUrl(resolved?.url);
    if (!parsed) {
      throw new ReaderError("MEDIA_SOURCE_INVALID", "The media source is not a public HTTP(S) URL.", {
        status: 422
      });
    }

    const diagnostic = safeMediaDiagnostic(resolved);
    const response = await this._request(parsed.href, {
      method: "GET",
      redirect: "follow",
      headers: {
        ...PUBLIC_DOUYIN_MEDIA_HEADERS,
        ...safeHeaders(resolved.headers),
      }
    });
    const responseDiagnostic = safeMediaDiagnostic(resolved, {
      status: response.status,
      size: numericHeader(response.headers?.get?.("content-length"))
    });

    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* already closed */ }
      throw new ReaderError("MEDIA_FETCH_FAILED", "The public media source could not be downloaded.", {
        status: 502,
        details: responseDiagnostic
      });
    }

    const mediaType = mediaTypeFor(resolved, response);
    if (isClearlyNotMedia(mediaType)) {
      try { await response.body?.cancel(); } catch { /* already closed */ }
      throw new ReaderError("MEDIA_INVALID_RESPONSE", "The media source returned a non-media response.", {
        status: 502,
        details: responseDiagnostic
      });
    }

    const bytes = await boundedBytes(response, this.maxBytes, responseDiagnostic);
    if (bytes.byteLength === 0) {
      throw new ReaderError("MEDIA_EMPTY", "The public media source returned no data.", {
        status: 502,
        details: responseDiagnostic
      });
    }

    return {
      bytes,
      mediaType,
      acquired_at: resolved.acquired_at ?? null,
      source: safeMediaDiagnostic(resolved, { status: response.status, size: bytes.byteLength })
    };
  }
}
