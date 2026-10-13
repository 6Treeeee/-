import { timingSafeEqual } from "node:crypto";

const PREVIEW = "https://git-codex-a2a-control-loop-1790063688-9925s-projects.vercel.app/api/acquisition";
const API_PATH = "/api/acquisition";
const MAX_REQUEST_BYTES = 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const TASK = /^[A-Za-z0-9_.-]{1,4096}$/;
const VIDEO_ID = /^\d{15,22}$/;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|\s*$)/i;
const RESPONSE_STATUSES = new Set([200, 202, 400, 401, 403, 502, 503]);

function send(res, status, value) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.status(status).json(value);
}

function error(res, status, code) {
  return send(res, status, { ok: false, error: { code } });
}

function equal(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function contentLength(headers) {
  const raw = headers?.["content-length"];
  if (raw == null) return 0;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return Infinity;
  return Number(raw);
}

function parseBody(req) {
  try {
    const body = req.body;
    if (typeof body === "string") {
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return null;
      return JSON.parse(body);
    }
    if (body && typeof body === "object") {
      // Vercel normally parses JSON before invoking this handler; re-encoding
      // still bounds the object the proxy will actually forward.
      if (Buffer.byteLength(JSON.stringify(body)) <= MAX_REQUEST_BYTES) return body;
    }
  } catch { /* Malformed JSON can make Vercel's req.body getter throw. */ }
  return null;
}

async function readJson(response) {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_RESPONSE_BYTES)) return null;
  if (!JSON_CONTENT_TYPE.test(response.headers.get("content-type") || "")) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const data = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
  try {
    const parsed = JSON.parse(data.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createProxyHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
  tokenResolver,
} = {}) {
  if (typeof tokenResolver !== "function") throw new TypeError("tokenResolver is required");

  return async function handler(req, res) {
    let incoming;
    try { incoming = new URL(req.url, "https://proxy.invalid"); }
    catch { return error(res, 400, "INVALID_REQUEST"); }
    if (incoming.pathname !== API_PATH) return error(res, 404, "NOT_FOUND");
    if (req.method !== "GET" && req.method !== "POST") return error(res, 405, "METHOD_NOT_ALLOWED");
    // This is a separate, public proxy project. Its production deployment is
    // the sole OIDC identity intended for the protected project's Preview.
    if (env.VERCEL_ENV !== "production") return error(res, 503, "PROXY_PRODUCTION_ONLY");

    const key = env.CONTENT_READER_WORKER_API_KEY;
    const auth = req.headers?.authorization;
    if (typeof key !== "string" || key.length < 32 || key.length > 256 ||
        typeof auth !== "string" || auth.length > 300 || !equal(auth, `Bearer ${key}`)) {
      return error(res, 401, "WORKER_UNAUTHORIZED");
    }

    let target = PREVIEW;
    let payload;
    if (req.method === "GET") {
      const entries = [...incoming.searchParams.entries()];
      if (entries.length !== 1 || entries[0][0] !== "task" ||
          !TASK.test(entries[0][1]) || contentLength(req.headers) !== 0 ||
          (req.body !== undefined && req.body !== null)) {
        return error(res, 400, "INVALID_TASK");
      }
      target += `?task=${encodeURIComponent(entries[0][1])}`;
    } else {
      if (incoming.search || contentLength(req.headers) > MAX_REQUEST_BYTES ||
          typeof req.headers?.["content-type"] !== "string" ||
          !JSON_CONTENT_TYPE.test(req.headers["content-type"])) {
        return error(res, 400, "INVALID_AWEME_ID");
      }
      const body = parseBody(req);
      if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
          !VIDEO_ID.test(body.aweme_id)) {
        return error(res, 400, "INVALID_AWEME_ID");
      }
      payload = JSON.stringify({ aweme_id: body.aweme_id });
    }

    let oidc;
    try { oidc = await tokenResolver(); } catch { /* No trusted token. */ }
    if (typeof oidc !== "string" || oidc.length > 16_384 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(oidc)) {
      return error(res, 503, "OIDC_UNAVAILABLE");
    }

    let upstream;
    try {
      upstream = await fetchImpl(target, {
        method: req.method,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${key}`,
          "x-vercel-trusted-oidc-idp-token": oidc,
          accept: "application/json",
          ...(payload ? { "content-type": "application/json" } : {}),
        },
        ...(payload ? { body: payload } : {}),
      });
    } catch {
      return error(res, 502, "PREVIEW_UNAVAILABLE");
    }
    if (upstream.redirected || (upstream.status >= 300 && upstream.status < 400)) {
      return error(res, 502, "PREVIEW_REDIRECTED");
    }
    if (!RESPONSE_STATUSES.has(upstream.status)) return error(res, 502, "PREVIEW_HTTP_ERROR");
    const body = await readJson(upstream);
    if (!body) return error(res, 502, "PREVIEW_RESPONSE_INVALID");
    return send(res, upstream.status, body);
  };
}
