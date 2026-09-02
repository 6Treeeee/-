import { getVercelOidcToken } from "@vercel/oidc";

import { readPublicContent, serviceDescription } from "../src/content-reader.js";
import { publicError, ReaderError } from "../src/errors.js";
import { createLocalWhisperAsr } from "../src/services/local-whisper.js";
import { HardSubtitleOcr } from "../src/services/hard-subtitle-ocr.js";

export const config = {
  maxDuration: 300
};

export const REQUEST_BUDGET_MS = 292_000;

export function runtimeRequestBudget(env = process.env) {
  if (env.VERCEL || env.VERCEL_ENV || !env.CONTENT_READER_OCR_PYTHON) return REQUEST_BUDGET_MS;
  const configured = Number(env.CONTENT_READER_LOCAL_REQUEST_BUDGET_MS ?? 1_500_000);
  return Number.isFinite(configured) ? Math.max(REQUEST_BUDGET_MS, Math.min(1_500_000, configured)) : 1_500_000;
}

// The engine prepares and integrity-checks its pinned assets lazily on first
// use. One instance also enforces one CPU transcription at a time per warm
// Function process.
const localWhisper = createLocalWhisperAsr();
const hardSubtitles = new HardSubtitleOcr();

export function withRequestDeadline(operation, deadlineAt) {
  const remainingMs = Math.floor(Number(deadlineAt) - Date.now());
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return Promise.reject(new ReaderError(
      "REQUEST_DEADLINE_EXCEEDED",
      "The bounded content-reading request ran out of time.",
      { status: 503, details: { stage: "request" } }
    ));
  }
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ReaderError(
      "REQUEST_DEADLINE_EXCEEDED",
      "The bounded content-reading request ran out of time.",
      { status: 503, details: { stage: "request" } }
    )), remainingMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

function setCommonHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Request-Id");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function reply(res, status, body) {
  setCommonHeaders(res);
  return res.status(status).json(body);
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function requestInput(req) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const debug = first(req.query?.debug) ?? body.debug;
  return {
    url: first(req.query?.url) ?? body.url,
    type: first(req.query?.type) ?? body.type ?? "auto",
    debug: debug === "1" || debug === true,
    fresh: first(req.query?.fresh) === "1" || body.fresh === true
  };
}

function requestId(req) {
  const supplied = first(req.headers?.["x-request-id"]);
  return typeof supplied === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export async function resolveRuntimeGatewayAuth({
  aiGatewayApiKey = process.env.AI_GATEWAY_API_KEY,
  tokenResolver = getVercelOidcToken
} = {}) {
  if (aiGatewayApiKey) return { aiGatewayApiKey, vercelOidcToken: null };
  try {
    return { aiGatewayApiKey: null, vercelOidcToken: await tokenResolver() };
  } catch {
    return { aiGatewayApiKey: null, vercelOidcToken: null };
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCommonHeaders(res);
    return res.status(204).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return reply(res, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." }
    });
  }

  const input = requestInput(req);
  const id = requestId(req);
  const startedAt = Date.now();
  // Asset hashing/extraction and the CLI startup probe share the same cached
  // runtime promise used by transcription. Start them concurrently with public
  // retrieval on cold requests instead of paying both cold starts serially.
  if (input.url && localWhisper.available) void localWhisper.status();
  // Vercel Functions deliver OIDC through the per-request context header, so
  // this must be resolved inside the handler rather than at module load time.
  const gatewayAuth = await resolveRuntimeGatewayAuth();

  if (!input.url) {
    const localWhisperStatus = await localWhisper.status();
    return reply(res, 200, {
      ok: true,
      request_id: id,
      ...serviceDescription({
        tikhubConfigured: Boolean(process.env.TIKHUB_API_KEY),
        directPublicWebAvailable: true,
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        gatewayConfigured: Boolean(gatewayAuth.aiGatewayApiKey || gatewayAuth.vercelOidcToken),
        localWhisperConfigured: localWhisperStatus.runtime_verified,
        localWhisperStatus,
        hardSubtitleStatus: hardSubtitles.status()
      })
    });
  }

  try {
    const requestDeadlineAt = startedAt + runtimeRequestBudget();
    const result = await withRequestDeadline(readPublicContent(input, {
      apiKey: process.env.TIKHUB_API_KEY,
      fetchImpl: globalThis.fetch,
      requestId: id,
      openAiApiKey: process.env.OPENAI_API_KEY,
      aiGatewayApiKey: gatewayAuth.aiGatewayApiKey,
      vercelOidcToken: gatewayAuth.vercelOidcToken,
      localAsr: localWhisper.available ? localWhisper.transcribe : null,
      hardSubtitleOcr: hardSubtitles.available ? hardSubtitles.read.bind(hardSubtitles) : null,
      requestDeadlineAt
    }), requestDeadlineAt);

    console.info(JSON.stringify({
      event: "content_reader.completed",
      request_id: id,
      platform: result.platform,
      content_type: result.content_type,
      item_count: result.content_type === "profile" ? result.content.posts.length : 1,
      content_read_count: result.content_type === "profile"
        ? result.content.processing?.successfully_content_read
        : Number(result.content.readable_content?.status === "complete"),
      duration_ms: Date.now() - startedAt
    }));

    return reply(res, 200, {
      ok: true,
      request_id: id,
      ...result
    });
  } catch (error) {
    const safe = publicError(error);

    console.error(JSON.stringify({
      event: "content_reader.failed",
      request_id: id,
      code: safe.code,
      duration_ms: Date.now() - startedAt
    }));

    return reply(res, safe.status, {
      ok: false,
      request_id: id,
      error: {
        code: safe.code,
        message: safe.message,
        ...(safe.details ? { details: safe.details } : {})
      }
    });
  }
}
