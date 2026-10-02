const VIDEO_ID = /^\d{15,22}$/;
const SHORT_CODE = /^\/[A-Za-z0-9_-]{1,128}\/?$/;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const VIDEO_HOSTS = new Set(["douyin.com", "www.douyin.com"]);
const SHARE_HOSTS = new Set(["iesdouyin.com", "www.iesdouyin.com"]);
const SHORT_HOST = "v.douyin.com";

function invalid(code, message) {
  return Object.assign(new Error(message), { code, status: 400 });
}

function safeUrl(input) {
  if (typeof input !== "string" || input.length > 2048) {
    throw invalid("INVALID_DOUYIN_URL", "Provide one public Douyin video URL.");
  }
  let url;
  try { url = new URL(input); } catch {
    throw invalid("INVALID_DOUYIN_URL", "Provide one public Douyin video URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw invalid("INVALID_DOUYIN_URL", "Only a standard HTTPS Douyin URL is accepted.");
  }
  // Shared links often carry tracking parameters. They are never needed to
  // identify a public video or resolve a v.douyin.com code.
  url.search = "";
  url.hash = "";
  return url;
}

function classify(url) {
  const canonical = VIDEO_HOSTS.has(url.hostname) && /^\/video\/(\d{15,22})\/?$/.exec(url.pathname);
  if (canonical) return { kind: "video", aweme_id: canonical[1] };
  const share = SHARE_HOSTS.has(url.hostname) && /^\/share\/video\/(\d{15,22})\/?$/.exec(url.pathname);
  if (share) return { kind: "video", aweme_id: share[1] };
  if (url.hostname === SHORT_HOST && SHORT_CODE.test(url.pathname)) {
    return { kind: "short", url: url.href };
  }
  throw invalid("UNSUPPORTED_DOUYIN_URL", "The URL is not a supported public Douyin video or share link.");
}

export function parseDouyinVideoUrl(input) {
  return classify(safeUrl(input));
}

export async function resolveDouyinVideoId(input, {
  fetchImpl = globalThis.fetch,
  maxRedirects = 5,
  timeoutMs = 8_000
} = {}) {
  let current = parseDouyinVideoUrl(input);
  if (current.kind === "video") return current.aweme_id;
  const seen = new Set();
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < maxRedirects; hop++) {
    if (seen.has(current.url)) throw invalid("DOUYIN_SHORT_LINK_LOOP", "The share link redirects in a loop.");
    seen.add(current.url);
    let response;
    try {
      response = await fetchImpl(current.url, { method: "GET", redirect: "manual", signal });
    } catch {
      throw invalid("DOUYIN_SHORT_LINK_UNAVAILABLE", "The public share link could not be resolved.");
    }
    if (response.redirected || !REDIRECT_STATUS.has(response.status)) {
      throw invalid("DOUYIN_SHORT_LINK_UNRESOLVED", "The share link did not redirect to a supported public video.");
    }
    const location = response.headers.get("location");
    if (!location) throw invalid("DOUYIN_SHORT_LINK_UNRESOLVED", "The share link did not provide a video URL.");
    let target;
    try { target = new URL(location, current.url); } catch {
      throw invalid("DOUYIN_SHORT_LINK_UNRESOLVED", "The share link provided an invalid redirect.");
    }
    // Validate before the next request. Never send credentials or fetch a
    // third-party host supplied by a redirect (including lookalike domains).
    current = classify(safeUrl(target.href));
    if (current.kind === "video") return current.aweme_id;
  }
  throw invalid("DOUYIN_SHORT_LINK_TOO_MANY_REDIRECTS", "The share link did not resolve within the redirect limit.");
}


