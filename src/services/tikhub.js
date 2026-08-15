import { ReaderError } from "../errors.js";

export const TIKHUB_ROUTES = Object.freeze({
  videoApp: "/api/v1/douyin/app/v3/fetch_one_video_by_share_url",
  videoWeb: "/api/v1/douyin/web/fetch_one_video_by_share_url",
  secUserId: "/api/v1/douyin/web/get_sec_user_id",
  profileApp: "/api/v1/douyin/app/v3/handler_user_profile",
  profileWeb: "/api/v1/douyin/web/handler_user_profile",
  postsApp: "/api/v1/douyin/app/v3/fetch_user_post_videos",
  postsWeb: "/api/v1/douyin/web/fetch_user_post_videos"
});

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clippedText(value, max = 300) {
  const text = typeof value === "string" ? value : "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export class TikHubClient {
  constructor({
    apiKey,
    fetchImpl = globalThis.fetch,
    baseUrl = "https://api.tikhub.io",
    timeoutMs = 45_000,
    retries = 1
  }) {
    if (!apiKey) {
      throw new ReaderError(
        "SERVICE_NOT_CONFIGURED",
        "The Douyin retrieval provider is not configured.",
        { status: 503 }
      );
    }

    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.retries = retries;
  }

  async get(route, params = {}) {
    return this.request(route, { method: "GET", params });
  }

  async request(route, { method, params = {} } = {}) {
    const url = new URL(`${this.baseUrl}${route}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
            "User-Agent": "ContentReader/1.0"
          },
          signal: controller.signal
        });

        const text = await response.text();
        let envelope;
        try {
          envelope = JSON.parse(text);
        } catch {
          throw new ReaderError(
            "UPSTREAM_INVALID_RESPONSE",
            "TikHub returned a non-JSON response.",
            {
              status: 502,
              details: {
                route,
                http_status: response.status,
                body_preview: clippedText(text)
              }
            }
          );
        }

        if (!response.ok) {
          const failure = new ReaderError(
            "UPSTREAM_HTTP_ERROR",
            "TikHub rejected the request.",
            {
              status: 502,
              details: {
                route,
                http_status: response.status,
                code: envelope?.code ?? null,
                message: clippedText(envelope?.message),
                request_id: envelope?.request_id ?? null
              }
            }
          );

          if (attempt < this.retries && RETRYABLE_STATUS.has(response.status)) {
            lastError = failure;
            await wait(250 * (attempt + 1));
            continue;
          }
          throw failure;
        }

        if (Number(envelope?.code) !== 200) {
          const failure = new ReaderError(
            "UPSTREAM_API_ERROR",
            "TikHub returned an unsuccessful API result.",
            {
              status: 502,
              details: {
                route,
                http_status: response.status,
                code: envelope?.code ?? null,
                message: clippedText(envelope?.message),
                message_zh: clippedText(envelope?.message_zh),
                request_id: envelope?.request_id ?? null
              }
            }
          );
          if (attempt < this.retries && RETRYABLE_STATUS.has(Number(envelope?.code))) {
            lastError = failure;
            await wait(250 * (attempt + 1));
            continue;
          }
          throw failure;
        }

        return {
          data: envelope.data,
          meta: {
            provider: "tikhub",
            route,
            http_status: response.status,
            code: envelope.code,
            request_id: envelope.request_id ?? null,
            attempts: attempt + 1
          }
        };
      } catch (error) {
        if (error instanceof ReaderError) throw error;

        const timedOut = error?.name === "AbortError";
        const failure = new ReaderError(
          timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR",
          timedOut ? "TikHub timed out." : "TikHub could not be reached.",
          {
            status: 502,
            details: { route, attempts: attempt + 1 }
          }
        );

        if (attempt < this.retries) {
          lastError = failure;
          await wait(250 * (attempt + 1));
          continue;
        }
        throw failure;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  }
}
