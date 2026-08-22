import { createHash } from "node:crypto";

const TARGET = "https://www.douyin.com/video/7669061012259179785";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

const BROWSER_HEADERS = Object.freeze({
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
});

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

async function boundedBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("BODY_LIMIT_EXCEEDED");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function probe(redirect) {
  const startedAt = performance.now();
  try {
    const response = await fetch(TARGET, {
      cache: "no-store",
      credentials: "omit",
      headers: BROWSER_HEADERS,
      redirect,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const body = await boundedBody(response);
    const html = body.toString("utf8");
    return {
      redirect,
      ok: response.ok,
      status: response.status,
      elapsed_ms: Math.round(performance.now() - startedAt),
      final_url: safeUrl(response.url),
      redirected: response.redirected,
      location: safeUrl(response.headers.get("location")),
      content_type: response.headers.get("content-type")?.split(";", 1)[0] ?? null,
      html_bytes: body.byteLength,
      html_sha256: createHash("sha256").update(body).digest("hex"),
      signals: {
        aweme_id: html.includes("7669061012259179785"),
        render_data: html.includes("RENDER_DATA"),
        router_data: html.includes("_ROUTER_DATA"),
        sigi_state: html.includes("SIGI_STATE"),
        play_address: /play_addr|playApi|play_url/i.test(html),
        media_reference: /\.mp4|\.m3u8|video\/play/i.test(html),
        captcha_or_verify: /captcha|verifycenter|verify-center|验证码/i.test(html),
        login_wall: /登录后|login-modal|passport\/web/i.test(html)
      }
    };
  } catch (error) {
    return {
      redirect,
      ok: false,
      elapsed_ms: Math.round(performance.now() - startedAt),
      error: error?.message === "BODY_LIMIT_EXCEEDED"
        ? "BODY_LIMIT_EXCEEDED"
        : error?.name === "TimeoutError"
          ? "TIMEOUT"
          : "FETCH_FAILED"
    };
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    return response.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  response.setHeader("cache-control", "no-store");
  const manual = await probe("manual");
  const follow = await probe("follow");
  return response.status(200).json({
    ok: true,
    scope: "public_unauthenticated_plain_http",
    target: "douyin_video_7669061012259179785",
    probes: [manual, follow]
  });
}
