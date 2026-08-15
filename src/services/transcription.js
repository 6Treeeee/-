import { Buffer } from "node:buffer";

import { ReaderError } from "../errors.js";
import { MediaResolver, safeMediaDiagnostic } from "./media.js";

const TRANSIENT_HTTP_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactText(value) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };
  return String(value ?? "").replace(
    /&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const hex = entity[1]?.toLowerCase() === "x";
        const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : match;
      }
      return named[entity.toLowerCase()] ?? match;
    }
  );
}

function cleanCueText(value) {
  return compactText(decodeEntities(
    String(value ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]+}/g, "")
  ));
}

function parseClock(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (/^\d+(?:\.\d+)?s$/i.test(text)) return Math.round(Number.parseFloat(text) * 1000);
  if (/^\d+(?:\.\d+)?ms$/i.test(text)) return Math.round(Number.parseFloat(text));
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number.parseFloat(text) * 1000);
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    return null;
  }
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) return null;
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000);
}

function numericTime(value, field = "") {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && (value.includes(":") || /(?:ms|s)$/i.test(value.trim()))) {
    return parseClock(value);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const name = field.toLowerCase();
  if (name.includes("millisecond") || /(^|_)ms($|_)/.test(name) || name.endsWith("ms")) {
    return Math.round(number);
  }
  if (name.includes("second") || ["start", "end", "begin", "duration", "dur"].includes(name)) {
    return Math.round(number * 1000);
  }
  // Douyin subtitle JSON commonly names millisecond offsets start_time/end_time/from/to.
  if (name.includes("time") || ["from", "to"].includes(name)) return Math.round(number);
  return Math.round(number > 100_000 ? number : number * 1000);
}

function normalizedSegment(text, startMs, endMs) {
  const content = cleanCueText(text);
  if (!content) return null;
  const start = Number.isFinite(startMs) ? Math.max(0, Math.round(startMs)) : 0;
  const end = Number.isFinite(endMs) ? Math.max(start, Math.round(endMs)) : start;
  return { start_ms: start, end_ms: end, text: content };
}

function normalizeSegments(segments) {
  const output = [];
  for (const segment of segments ?? []) {
    if (!segment) continue;
    const startField = [
      "start_ms", "startMs", "startSecond", "start_seconds", "start", "start_time", "from", "begin"
    ].find((key) => segment[key] !== undefined && segment[key] !== null);
    const endField = [
      "end_ms", "endMs", "endSecond", "end_seconds", "end", "end_time", "to"
    ].find((key) => segment[key] !== undefined && segment[key] !== null);
    const durationField = ["duration_ms", "durationMs", "durationSecond", "duration", "dur"]
      .find((key) => segment[key] !== undefined && segment[key] !== null);
    const start = startField ? numericTime(segment[startField], startField) : 0;
    let end = endField ? numericTime(segment[endField], endField) : null;
    if (end === null && durationField) {
      const duration = numericTime(segment[durationField], durationField);
      if (duration !== null) end = (start ?? 0) + duration;
    }
    const normalized = normalizedSegment(
      segment.text ?? segment.content ?? segment.utterance ?? segment.transcript ?? segment.word ?? segment.words,
      start,
      end
    );
    if (normalized) output.push(normalized);
  }
  return output.sort((left, right) => left.start_ms - right.start_ms || left.end_ms - right.end_ms);
}

function textFromSegments(segments) {
  const lines = [];
  for (const segment of segments) {
    if (segment.text && segment.text !== lines.at(-1)) lines.push(segment.text);
  }
  return compactText(lines.join("\n"));
}

function parseTimedText(text) {
  const normalized = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const segments = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0 || /^(?:NOTE|STYLE|REGION)(?:\s|$)/i.test(lines[0] ?? "")) continue;
    const [rawStart, rawEnd = ""] = lines[timingIndex].split(/\s+-->\s+/, 2);
    const start = parseClock(rawStart);
    const end = parseClock(rawEnd.split(/\s+/, 1)[0]);
    const segment = normalizedSegment(lines.slice(timingIndex + 1).join("\n"), start, end);
    if (segment && start !== null && end !== null) segments.push(segment);
  }
  return segments;
}

function jsonText(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.text === "string" ? value.text
    : typeof value.transcript === "string" ? value.transcript
      : typeof value.content === "string" ? value.content
        : null;
}

function parseJsonSubtitles(root) {
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();
  let language = root?.language ?? root?.language_code ?? root?.lang ?? null;
  let fullText = jsonText(root);

  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value) || depth > 6) continue;
    seen.add(value);
    if (!language) language = value.language ?? value.language_code ?? value.lang ?? null;
    if (!fullText) fullText = jsonText(value);

    if (Array.isArray(value)) {
      const parsed = normalizeSegments(value);
      if (parsed.length) return { segments: parsed, language, text: fullText };
      for (const child of value) queue.push({ value: child, depth: depth + 1 });
    } else {
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return { segments: [], language, text: fullText };
}

function xmlAttribute(attributes, name) {
  const match = String(attributes ?? "").match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function parseXmlSubtitles(text) {
  const segments = [];
  const pattern = /<(p|text)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const attributes = match[2];
    const startRaw = xmlAttribute(attributes, "begin") ?? xmlAttribute(attributes, "start") ??
      xmlAttribute(attributes, "t");
    const endRaw = xmlAttribute(attributes, "end");
    const durationRaw = xmlAttribute(attributes, "dur") ?? xmlAttribute(attributes, "duration");
    const start = parseClock(startRaw);
    let end = parseClock(endRaw);
    if (end === null && durationRaw !== null) {
      const duration = parseClock(durationRaw);
      if (start !== null && duration !== null) end = start + duration;
    }
    const segment = normalizedSegment(match[3], start, end);
    if (segment && start !== null) segments.push(segment);
  }
  return segments;
}

export function parseSubtitle(text, { format = null, mediaType = null } = {}) {
  const decoded = text instanceof Uint8Array || text instanceof ArrayBuffer
    ? new TextDecoder().decode(text)
    : String(text ?? "");
  const body = decoded.replace(/^\uFEFF/, "").trim();
  if (!body || /<html\b/i.test(body)) return { text: "", segments: [], language: null };
  let language = null;
  let segments = [];
  let suppliedText = null;
  const type = `${format ?? ""} ${mediaType ?? ""}`.toLowerCase();

  if (/json/.test(type) || /^[\[{]/.test(body)) {
    try {
      const parsed = parseJsonSubtitles(JSON.parse(body));
      segments = parsed.segments;
      language = parsed.language;
      suppliedText = parsed.text;
    } catch {
      // Some upstreams mislabel WebVTT as JSON; continue with format detection.
    }
  }
  if (!segments.length && (body.includes("-->") || /vtt|srt|subrip/.test(type))) {
    segments = parseTimedText(body);
  }
  if (!segments.length && (/<(?:tt|p|text)\b/i.test(body) || /xml|ttml/.test(type))) {
    segments = parseXmlSubtitles(body);
  }

  const cleanSupplied = cleanCueText(suppliedText);
  if (!segments.length && cleanSupplied) segments = [normalizedSegment(cleanSupplied, 0, 0)];
  const transcript = textFromSegments(segments);
  return {
    text: transcript,
    segments,
    language: language === null || language === undefined ? null : String(language)
  };
}

function captionUrl(track) {
  const list = (value) => Array.isArray(value) ? value : value ? [value] : [];
  const values = [track?.url, track?.caption_url, ...list(track?.url_list), ...list(track?.urls)];
  for (const value of values) {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch {
      // Try the next public track address.
    }
  }
  return null;
}

function extensionFor(mediaType) {
  const type = String(mediaType ?? "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("wav")) return "wav";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("m4a")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4")) return "mp4";
  return type.startsWith("video/") ? "mp4" : "mp3";
}

function providerError(code, message, provider, status, cause) {
  return new ReaderError(code, message, {
    status: 502,
    details: { provider, ...(Number.isFinite(status) ? { http_status: status } : {}) },
    cause
  });
}

function safeAttempt(method, error) {
  return {
    method,
    code: error instanceof ReaderError ? error.code : "TRANSCRIPTION_PROVIDER_ERROR",
    ...(Number.isFinite(error?.details?.http_status)
      ? { http_status: error.details.http_status }
      : {})
  };
}

function retryAfterMs(response, fallback) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(5_000, Math.max(fallback, seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(5_000, Math.max(fallback, date - Date.now())) : fallback;
}

async function boundedResponseText(response, maxBytes, diagnostic) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await response.body?.cancel(); } catch { /* already closed */ }
    throw new ReaderError("SUBTITLE_TOO_LARGE", "The caption track exceeds the processing size limit.", {
      status: 422,
      details: { ...diagnostic, size: declared, max_bytes: maxBytes }
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new ReaderError("SUBTITLE_TOO_LARGE", "The caption track exceeds the processing size limit.", {
      status: 422,
      details: { ...diagnostic, size: bytes.byteLength, max_bytes: maxBytes }
    });
  }
  return { text: new TextDecoder().decode(bytes), size: bytes.byteLength };
}

function confidenceFromSegments(segments) {
  const values = (segments ?? [])
    .map((segment) => Number(segment.avg_logprob ?? segment.confidence))
    .filter(Number.isFinite)
    .map((value) => value <= 0 ? Math.exp(value) : value)
    .map((value) => Math.max(0, Math.min(1, value)));
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function normalizedResult(result, {
  method,
  language = null,
  confidence = null,
  limitations = [],
  source
}) {
  const segments = normalizeSegments(result?.segments ?? []);
  const suppliedText = compactText(typeof result === "string" ? result : result?.text);
  const text = suppliedText || textFromSegments(segments);
  if (!text) return null;
  if (!segments.length) segments.push({ start_ms: 0, end_ms: 0, text });
  return {
    status: "complete",
    text,
    segments,
    language: result?.language ?? language ?? null,
    method: result?.method ?? method,
    confidence: result?.confidence ?? confidence ?? null,
    limitations: [...new Set([...(limitations ?? []), ...(result?.limitations ?? [])])],
    source
  };
}

export class TranscriptionService {
  constructor({
    fetchImpl = globalThis.fetch,
    mediaResolver = null,
    localAsr = null,
    openAiApiKey = process.env.OPENAI_API_KEY,
    openAIApiKey,
    openaiApiKey,
    aiGatewayApiKey = process.env.AI_GATEWAY_API_KEY,
    gatewayApiKey,
    vercelOidcToken = process.env.VERCEL_OIDC_TOKEN,
    oidcToken,
    openAiModel = "whisper-1",
    gatewayModel = "openai/whisper-1",
    openAiUrl = "https://api.openai.com/v1/audio/transcriptions",
    gatewayUrl = "https://ai-gateway.vercel.sh/v4/ai/transcription-model",
    timeoutMs = 120_000,
    captionTimeoutMs = 20_000,
    maxCaptionBytes = 5 * 1024 * 1024,
    retries = 1,
    retryDelayMs = 250,
    sleepImpl = wait
  } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new ReaderError("TRANSCRIPTION_NOT_CONFIGURED", "A fetch implementation is required.", {
        status: 503
      });
    }
    this.fetchImpl = fetchImpl;
    this.mediaResolver = mediaResolver ?? new MediaResolver({ fetchImpl });
    this.localAsr = localAsr;
    this.openAiApiKey = openAIApiKey ?? openaiApiKey ?? openAiApiKey;
    this.aiGatewayApiKey = gatewayApiKey ?? aiGatewayApiKey;
    this.vercelOidcToken = oidcToken ?? vercelOidcToken;
    this.openAiModel = openAiModel;
    this.gatewayModel = gatewayModel;
    this.openAiUrl = openAiUrl;
    this.gatewayUrl = gatewayUrl;
    this.timeoutMs = timeoutMs;
    this.captionTimeoutMs = captionTimeoutMs;
    this.maxCaptionBytes = maxCaptionBytes;
    this.retries = Math.max(0, Math.floor(retries));
    this.retryDelayMs = Math.max(0, retryDelayMs);
    this.sleepImpl = sleepImpl;
  }

  async _caption(track) {
    if (typeof track?.content === "string" && track.content.trim()) {
      const parsed = parseSubtitle(track.content, {
        format: track.format,
        mediaType: track.media_type ?? track.content_type
      });
      if (parsed.text) return { parsed, diagnostic: { inline: true } };
    }

    const url = captionUrl(track);
    if (!url) throw new ReaderError("SUBTITLE_URL_MISSING", "The caption track has no public URL.", {
      status: 422
    });
    const diagnostic = safeMediaDiagnostic(url);
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.captionTimeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: "GET",
          redirect: "follow",
          headers: { Accept: "text/vtt,application/x-subrip,application/json,application/xml,text/plain;q=0.8" },
          signal: controller.signal
        });
        if (attempt < this.retries && TRANSIENT_HTTP_STATUS.has(response.status)) {
          try { await response.body?.cancel(); } catch { /* already closed */ }
          await this.sleepImpl(retryAfterMs(response, this.retryDelayMs * (attempt + 1)));
          continue;
        }
        if (!response.ok) {
          try { await response.body?.cancel(); } catch { /* already closed */ }
          throw new ReaderError("SUBTITLE_FETCH_FAILED", "The public caption track could not be read.", {
            status: 502,
            details: { ...diagnostic, status: response.status }
          });
        }
        const body = await boundedResponseText(response, this.maxCaptionBytes, diagnostic);
        const parsed = parseSubtitle(body.text, {
          format: track.format,
          mediaType: response.headers?.get?.("content-type") ?? track.media_type
        });
        if (!parsed.text) {
          throw new ReaderError("SUBTITLE_UNUSABLE", "The caption track contained no readable cues.", {
            status: 422,
            details: { ...diagnostic, size: body.size }
          });
        }
        return {
          parsed,
          diagnostic: { ...diagnostic, status: response.status, size: body.size }
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ReaderError) throw error;
        if (attempt < this.retries) {
          await this.sleepImpl(this.retryDelayMs * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new ReaderError(
      lastError?.name === "AbortError" ? "SUBTITLE_TIMEOUT" : "SUBTITLE_NETWORK_ERROR",
      lastError?.name === "AbortError" ? "The caption track request timed out." : "The caption track could not be reached.",
      { status: 502, details: diagnostic, cause: lastError }
    );
  }

  async _providerJson({ provider, timeoutMs = this.timeoutMs, makeRequest }) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await makeRequest(controller.signal);
        if (attempt < this.retries && TRANSIENT_HTTP_STATUS.has(response.status)) {
          try { await response.body?.cancel(); } catch { /* already closed */ }
          await this.sleepImpl(retryAfterMs(response, this.retryDelayMs * (attempt + 1)));
          continue;
        }
        let data;
        try {
          data = await response.json();
        } catch (error) {
          throw providerError(
            "ASR_INVALID_RESPONSE",
            "The speech-to-text provider returned an invalid response.",
            provider,
            response.status,
            error
          );
        }
        if (!response.ok) {
          throw providerError(
            "ASR_PROVIDER_ERROR",
            "The speech-to-text provider rejected the request.",
            provider,
            response.status
          );
        }
        return data;
      } catch (error) {
        lastError = error;
        if (error instanceof ReaderError) throw error;
        if (attempt < this.retries) {
          await this.sleepImpl(this.retryDelayMs * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw providerError(
      lastError?.name === "AbortError" ? "ASR_TIMEOUT" : "ASR_NETWORK_ERROR",
      lastError?.name === "AbortError" ? "The speech-to-text provider timed out." : "The speech-to-text provider could not be reached.",
      provider,
      null,
      lastError
    );
  }

  async _openAi(media) {
    const result = await this._providerJson({
      provider: "openai",
      makeRequest: (signal) => {
        const form = new FormData();
        form.append("model", this.openAiModel);
        form.append("response_format", "verbose_json");
        form.append("timestamp_granularities[]", "segment");
        form.append("file", new Blob([media.bytes], { type: media.mediaType }),
          `audio.${extensionFor(media.mediaType)}`);
        return this.fetchImpl(this.openAiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.openAiApiKey}` },
          body: form,
          signal
        });
      }
    });
    return normalizedResult(result, {
      method: `openai_${this.openAiModel.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      confidence: confidenceFromSegments(result.segments),
      limitations: confidenceFromSegments(result.segments) === null
        ? ["provider_confidence_not_provided"]
        : [],
      source: {
        type: "asr",
        provider: "openai",
        model: this.openAiModel,
        media: media.source
      }
    });
  }

  async _gateway(media) {
    const token = this.aiGatewayApiKey || this.vercelOidcToken;
    const authMethod = this.aiGatewayApiKey ? "api-key" : "oidc";
    const result = await this._providerJson({
      provider: "vercel_ai_gateway",
      makeRequest: (signal) => this.fetchImpl(this.gatewayUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "ai-gateway-protocol-version": "0.0.1",
          "ai-gateway-auth-method": authMethod,
          "ai-transcription-model-specification-version": "4",
          "ai-model-id": this.gatewayModel
        },
        body: JSON.stringify({
          audio: Buffer.from(media.bytes).toString("base64"),
          mediaType: media.mediaType
        }),
        signal
      })
    });
    return normalizedResult(result, {
      method: `vercel_ai_gateway_${this.gatewayModel.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      limitations: ["provider_confidence_not_provided"],
      source: {
        type: "asr",
        provider: "vercel_ai_gateway",
        model: this.gatewayModel,
        media: media.source
      }
    });
  }

  async read(video) {
    if (!video || typeof video !== "object") {
      throw new ReaderError("TRANSCRIPTION_VIDEO_REQUIRED", "A normalized video object is required.", {
        status: 400
      });
    }
    const captionAttempts = [];
    const tracks = Array.isArray(video?.captions?.tracks) ? video.captions.tracks : [];
    for (const track of tracks) {
      if (!captionUrl(track) && !(typeof track?.content === "string" && track.content.trim())) continue;
      try {
        const { parsed, diagnostic } = await this._caption(track);
        const result = normalizedResult(parsed, {
          method: "captions",
          language: parsed.language ?? track.language_code ?? track.language ?? null,
          limitations: [
            "caption_confidence_not_provided",
            ...(parsed.segments.every((segment) => segment.start_ms === 0 && segment.end_ms === 0)
              ? ["caption_timestamps_unavailable"]
              : [])
          ],
          source: {
            type: "caption",
            provider: track.source ?? "douyin",
            ...(track.id !== undefined ? { track_id: String(track.id) } : {}),
            ...(track.format ? { format: String(track.format) } : {}),
            ...diagnostic
          }
        });
        if (result) return result;
      } catch (error) {
        captionAttempts.push(safeAttempt("captions", error));
      }
    }

    let media;
    try {
      const source = await this.mediaResolver.resolve(video);
      media = await this.mediaResolver.fetch(source);
    } catch (error) {
      throw new ReaderError("TRANSCRIPTION_MEDIA_UNAVAILABLE", "No readable public media was available for transcription.", {
        status: error instanceof ReaderError ? error.status : 502,
        details: {
          ...(video.aweme_id ?? video.id ? { aweme_id: String(video.aweme_id ?? video.id) } : {}),
          cause: safeAttempt("media", error),
          ...(captionAttempts.length ? { caption_attempts: captionAttempts } : {})
        },
        cause: error
      });
    }

    const attempts = [];
    const inheritedLimitations = captionAttempts.length ? ["caption_tracks_unusable"] : [];
    if (this.openAiApiKey) {
      try {
        const result = await this._openAi(media);
        if (result) {
          result.limitations = [...new Set([...inheritedLimitations, ...result.limitations])];
          return result;
        }
        attempts.push({ method: "openai", code: "ASR_EMPTY_RESULT" });
      } catch (error) {
        attempts.push(safeAttempt("openai", error));
      }
    }

    if (this.aiGatewayApiKey || this.vercelOidcToken) {
      try {
        const result = await this._gateway(media);
        if (result) {
          result.limitations = [...new Set([...inheritedLimitations, ...result.limitations])];
          return result;
        }
        attempts.push({ method: "vercel_ai_gateway", code: "ASR_EMPTY_RESULT" });
      } catch (error) {
        attempts.push(safeAttempt("vercel_ai_gateway", error));
      }
    }

    if (typeof this.localAsr === "function") {
      try {
        const local = await this.localAsr({
          bytes: media.bytes,
          mediaType: media.mediaType,
          video,
          source: media.source
        });
        const result = normalizedResult(local, {
          method: "local_asr",
          limitations: inheritedLimitations,
          source: { type: "asr", provider: "local", media: media.source }
        });
        if (result) return result;
        attempts.push({ method: "local_asr", code: "ASR_EMPTY_RESULT" });
      } catch (error) {
        attempts.push(safeAttempt("local_asr", error));
      }
    }

    throw new ReaderError("TRANSCRIPTION_UNAVAILABLE", "No configured speech-to-text method produced a transcript.", {
      status: 503,
      details: {
        ...(video.aweme_id ?? video.id ? { aweme_id: String(video.aweme_id ?? video.id) } : {}),
        attempts,
        ...(captionAttempts.length ? { caption_attempts: captionAttempts } : {})
      }
    });
  }
}
