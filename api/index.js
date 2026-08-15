import { readPublicContent, serviceDescription } from "../src/content-reader.js";
import { ReaderError, publicError } from "../src/errors.js";

export const config = {
  maxDuration: 300
};

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
    debug: debug === "1" || debug === true
  };
}

function requestId(req) {
  const supplied = first(req.headers?.["x-request-id"]);
  return typeof supplied === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
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

  if (!input.url) {
    return reply(res, 200, {
      ok: true,
      request_id: id,
      ...serviceDescription({
        tikhubConfigured: Boolean(process.env.TIKHUB_API_KEY)
      })
    });
  }

  const startedAt = Date.now();

  try {
    if (!process.env.TIKHUB_API_KEY) {
      throw new ReaderError(
        "SERVICE_NOT_CONFIGURED",
        "The Douyin retrieval provider is not configured.",
        { status: 503 }
      );
    }

    const result = await readPublicContent(input, {
      apiKey: process.env.TIKHUB_API_KEY,
      fetchImpl: globalThis.fetch,
      requestId: id
    });

    console.info(JSON.stringify({
      event: "content_reader.completed",
      request_id: id,
      platform: result.platform,
      content_type: result.content_type,
      item_count: result.content_type === "profile" ? result.content.posts.length : 1,
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
