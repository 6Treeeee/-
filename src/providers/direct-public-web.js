import { ReaderError, sanitizeDiagnostics } from "../errors.js";
import {
  extractAweme,
  extractPostPage,
  extractUser,
  postIdentity
} from "../normalizers/douyin.js";
import { PublicBrowserService } from "../services/public-browser.js";

const PROVIDER = "direct_public_web";
const DETAIL_PATH = "/aweme/v1/web/aweme/detail/";
const POSTS_PATH = "/aweme/v1/web/aweme/post/";
const PROFILE_PATH = "/aweme/v1/web/user/profile/other/";
const PLAY_PATH = "/aweme/v1/play/";
const LOGIN_REQUIRED_TEXT_PATTERN_SOURCE =
  "请先登录|登录后(?:才可|方可|即可|可)?(?:观看|查看)";
const TERMINAL_ACCESS_CODES = new Set([
  "DOUYIN_LOGIN_REQUIRED",
  "DOUYIN_PRIVATE_CONTENT",
  "DOUYIN_SECURITY_VERIFICATION_REQUIRED",
  "DOUYIN_CONTENT_UNAVAILABLE"
]);
const RETRYABLE_CODES = new Set([
  "DOUYIN_PUBLIC_WEB_TRANSIENT",
  "DOUYIN_PUBLIC_WEB_EMPTY_RESULT"
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function detectsLoginRequiredText(value) {
  return new RegExp(LOGIN_REQUIRED_TEXT_PATTERN_SOURCE).test(String(value ?? ""));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return { url, host: url.hostname.toLowerCase(), path: url.pathname };
  } catch {
    return null;
  }
}

function isDouyinHost(host) {
  return host === "douyin.com" || host.endsWith(".douyin.com") ||
    host === "iesdouyin.com" || host.endsWith(".iesdouyin.com");
}

function validatedTarget(value) {
  const parsed = safeUrl(value);
  if (!parsed || !["http:", "https:"].includes(parsed.url.protocol) ||
      parsed.url.username || parsed.url.password || !isDouyinHost(parsed.host)) {
    throw new ReaderError("INVALID_URL", "A public Douyin HTTP(S) URL is required.", {
      status: 400
    });
  }
  return parsed.url.href;
}

function targetDiagnostic(value) {
  const parsed = safeUrl(value);
  return parsed ? { host: parsed.host, path: parsed.path } : { host: null, path: null };
}

function awemeIdFromUrl(value) {
  const parsed = safeUrl(value);
  if (!parsed) return null;
  return parsed.path.match(/\/(?:video|note)\/(\d+)/)?.[1] ??
    parsed.url.searchParams.get("modal_id")?.match(/^\d+$/)?.[0] ?? null;
}

function secUserIdFromUrl(value) {
  const parsed = safeUrl(value);
  if (!parsed) return null;
  return decodeURIComponent(parsed.path).match(/\/(?:share\/)?user\/([^/?#]+)/i)?.[1] ??
    parsed.url.searchParams.get("sec_uid") ?? null;
}

function videoTarget({ inputUrl, resolvedUrl, awemeId }) {
  const id = String(awemeId ?? awemeIdFromUrl(resolvedUrl) ?? awemeIdFromUrl(inputUrl) ?? "");
  if (/^\d+$/.test(id)) return { target: `https://www.douyin.com/video/${id}`, awemeId: id };
  return { target: validatedTarget(resolvedUrl ?? inputUrl), awemeId: null };
}

function profileTarget({ inputUrl, resolvedUrl, secUserId }) {
  const id = String(secUserId ?? secUserIdFromUrl(resolvedUrl) ?? secUserIdFromUrl(inputUrl) ?? "");
  if (/^[A-Za-z0-9_-]+$/.test(id)) {
    return { target: `https://www.douyin.com/user/${encodeURIComponent(id)}`, secUserId: id };
  }
  return { target: validatedTarget(resolvedUrl ?? inputUrl), secUserId: null };
}

function contentTypeFromUrl(value) {
  const parsed = safeUrl(value);
  if (!parsed || !isDouyinHost(parsed.host)) return "unknown";
  if (/\/(?:share\/)?user\//i.test(parsed.path) || parsed.url.searchParams.has("sec_uid")) {
    return "profile";
  }
  if (/\/(?:share\/)?(?:video|note)\/\d+/i.test(parsed.path) ||
      /^\d+$/.test(parsed.url.searchParams.get("modal_id") ?? "")) {
    return "video";
  }
  return "unknown";
}

function isMediaResponse(url, response) {
  const parsed = safeUrl(url);
  if (!parsed || ![200, 206].includes(response.status())) return false;
  const headers = response.headers();
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  const mediaType = contentType.startsWith("video/") || contentType.startsWith("audio/") ||
    contentType.includes("application/octet-stream");
  const mediaHost = parsed.host === "douyinvod.com" || parsed.host.endsWith(".douyinvod.com");
  const douyinPlayEndpoint = isDouyinHost(parsed.host) &&
    (parsed.path === PLAY_PATH || parsed.path.startsWith(PLAY_PATH));
  return mediaType && (mediaHost || douyinPlayEndpoint);
}

function readAccessSignals(payload) {
  const result = {
    loginRequired: false,
    securityChallenge: false,
    privateContent: false,
    unavailable: false
  };
  const queue = [{ value: payload, depth: 0 }];
  const seen = new Set();
  let visited = 0;

  while (queue.length && visited < 4_000) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    visited += 1;

    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === "verify_ticket" && child) result.securityChallenge = true;
      if (normalizedKey === "status_code" && Number(child) === 2483) result.loginRequired = true;

      if (typeof child === "string" &&
          /message|msg|description|desc|toast|prompt|notice|status/i.test(key)) {
        if (detectsLoginRequiredText(child)) result.loginRequired = true;
        if (/私密账号|私密作品|仅自己可见|作者仅允许/.test(child)) result.privateContent = true;
        if (/作品已删除|内容不存在|视频不见了|暂时无法观看/.test(child)) result.unavailable = true;
      }

      if (depth < 6 && child && typeof child === "object") {
        queue.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return result;
}

function mergeSignals(target, source) {
  for (const key of Object.keys(target)) target[key] ||= Boolean(source[key]);
}

function createCapture({ expectedAwemeId = null, expectedSecUserId = null } = {}) {
  const state = {
    aweme: null,
    profilePayloads: [],
    postPages: [],
    media: new Map(),
    endpointPaths: new Set(),
    signals: {
      loginRequired: false,
      securityChallenge: false,
      privateContent: false,
      unavailable: false
    }
  };
  const pending = new Set();
  let page;

  async function handleResponse(response) {
    const value = response.url();
    const parsed = safeUrl(value);
    if (!parsed) return;

    if (isMediaResponse(value, response)) {
      state.media.set(value, {
        url: value,
        host: parsed.host,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? null
      });
      return;
    }

    if (!isDouyinHost(parsed.host) ||
        ![DETAIL_PATH, POSTS_PATH, PROFILE_PATH].includes(parsed.path)) return;
    state.endpointPaths.add(parsed.path);

    let payload;
    try {
      payload = await response.json();
    } catch {
      return;
    }
    mergeSignals(state.signals, readAccessSignals(payload));

    if (parsed.path === DETAIL_PATH) {
      const aweme = extractAweme(payload);
      const id = postIdentity(aweme);
      if (aweme && (!expectedAwemeId || !id || id === expectedAwemeId)) state.aweme = aweme;
      return;
    }

    if (parsed.path === PROFILE_PATH) {
      state.profilePayloads.push(payload);
      return;
    }

    const responseSecUserId = parsed.url.searchParams.get("sec_user_id");
    if (expectedSecUserId && responseSecUserId && responseSecUserId !== expectedSecUserId) return;
    const postPage = extractPostPage(payload);
    if (!postPage.recognized) return;
    const requestCursor = parsed.url.searchParams.get("max_cursor") ?? "0";
    const ids = postPage.items.map(postIdentity).filter(Boolean);
    const signature = `${requestCursor}:${postPage.maxCursor ?? ""}:${ids.join(",")}`;
    if (state.postPages.some((item) => item.signature === signature)) return;
    state.postPages.push({
      signature,
      requestCursor,
      maxCursor: postPage.maxCursor,
      hasMore: postPage.hasMore,
      items: postPage.items
    });
  }

  function listener(response) {
    const operation = handleResponse(response).finally(() => pending.delete(operation));
    pending.add(operation);
  }

  return {
    state,
    attach(targetPage) {
      page = targetPage;
      page.on("response", listener);
    },
    async drain() {
      if (pending.size) await Promise.allSettled([...pending]);
    },
    detach() {
      page?.off("response", listener);
    }
  };
}

async function pageAccessSnapshot(page) {
  return page.evaluate((loginPatternSource) => {
    function visible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    }

    const visibleText = document.body?.innerText ?? "";
    const explicitMoreGate = [...document.querySelectorAll("body *")].some((element) =>
      element.children.length === 0 && visible(element) &&
      element.textContent?.trim() === "登录后查看更多作品"
    );
    const visibleChallengeElement = [
      "#captcha_container",
      "iframe[src*='captcha']",
      "iframe[src*='verify']",
      "[class*='captcha_container']"
    ].some((selector) => [...document.querySelectorAll(selector)].some(visible));

    return {
      explicitMoreGate,
      securityChallenge: visibleChallengeElement ||
        /安全验证|验证后继续|请完成(?:下列)?验证|拖动.{0,12}滑块/.test(visibleText),
      privateContent: /该账号为私密账号|私密账号.{0,20}作品|私密作品|仅自己可见|作者仅允许/.test(visibleText),
      unavailable: /作品已删除|内容不存在|视频不见了|当前作品不可见|暂时无法观看/.test(visibleText),
      loginRequired: new RegExp(loginPatternSource).test(visibleText)
    };
  }, LOGIN_REQUIRED_TEXT_PATTERN_SOURCE);
}

async function videoDomSnapshot(page) {
  return page.evaluate(() => {
    const media = [];
    for (const element of document.querySelectorAll("video, video source, audio, audio source")) {
      for (const value of [element.currentSrc, element.src, element.getAttribute?.("src")]) {
        if (/^https?:\/\//i.test(value ?? "")) media.push(value);
      }
    }
    const video = document.querySelector("video");
    const canonical = document.querySelector("link[rel='canonical']")?.href ?? null;
    const metaDescription = document.querySelector("meta[name='description']")?.content ??
      document.querySelector("meta[property='og:description']")?.content ?? null;
    const metaTitle = document.querySelector("meta[property='og:title']")?.content ?? document.title ?? null;
    const hydration = [...document.querySelectorAll(
      "script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#RENDER_DATA, script[id*='RENDER_DATA']"
    )].map((element) => element.textContent).filter(Boolean).slice(0, 3);

    return {
      canonical,
      title: metaTitle,
      description: metaDescription,
      media: [...new Set(media)],
      durationSeconds: Number.isFinite(video?.duration) ? video.duration : null,
      width: video?.videoWidth || null,
      height: video?.videoHeight || null,
      hydration
    };
  });
}

function hydratedAweme(texts) {
  for (const text of texts ?? []) {
    for (const candidate of [text, (() => {
      try {
        return decodeURIComponent(text);
      } catch {
        return null;
      }
    })()]) {
      if (!candidate) continue;
      try {
        const aweme = extractAweme(JSON.parse(candidate));
        if (aweme) return aweme;
      } catch {
        // The candidate was an executable script rather than JSON state.
      }
    }
  }
  return null;
}

function cleanVideoTitle(value) {
  return String(value ?? "").replace(/\s*-\s*抖音\s*$/, "").trim() || null;
}

function embeddedAwemeMediaUrls(aweme) {
  const video = aweme?.video ?? {};
  const sources = [
    video.play_addr,
    video.play_addr_h264,
    video.play_addr_265,
    video.play_addr_bytevc1,
    video.download_addr,
    video.download_suffix_logo_addr,
    ...(video.bit_rate ?? []).flatMap((rate) => [rate?.play_addr, rate?.play_addr_265]),
    ...(video.bit_rate_audio ?? []).flatMap((rate) => [
      rate?.audio_meta?.url_list,
      rate?.play_addr
    ])
  ];
  const urls = [];
  const visit = (value) => {
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const key of ["url", "url_list", "urls", "download_url"]) visit(value[key]);
  };
  for (const source of sources) visit(source);
  return [...new Set(urls)];
}

function fallbackAweme({ awemeId, dom, mediaUrls }) {
  if (!awemeId || (!dom.title && !dom.description && mediaUrls.length === 0)) return null;
  const creator = String(dom.description ?? "").match(/-\s*([^\n-]+?)于\d{8}发布在抖音/)?.[1]?.trim();
  const date = String(dom.description ?? "").match(/于(\d{4})(\d{2})(\d{2})发布在抖音/);
  const createdAt = date
    ? Math.floor(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) / 1000)
    : undefined;

  return {
    aweme_id: awemeId,
    desc: cleanVideoTitle(dom.title) ?? dom.description ?? "",
    ...(createdAt ? { create_time: createdAt } : {}),
    ...(creator ? { author: { nickname: creator } } : {}),
    video: {
      ...(dom.durationSeconds ? { duration: Math.round(dom.durationSeconds * 1000) } : {}),
      ...(dom.width ? { width: dom.width } : {}),
      ...(dom.height ? { height: dom.height } : {}),
      play_addr: { url_list: mediaUrls }
    }
  };
}

async function profileDomSnapshot(page) {
  return page.evaluate(() => {
    function visible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    }

    function compactCount(value) {
      const match = String(value ?? "").replace(/,/g, "").match(/([\d.]+)\s*(万|亿)?/);
      if (!match) return null;
      const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
      const number = Number(match[1]) * multiplier;
      return Number.isFinite(number) ? Math.round(number) : null;
    }

    const list = document.querySelector("[data-e2e='user-post-list']");
    const links = [];
    for (const anchor of list?.querySelectorAll("a[href]") ?? []) {
      const url = new URL(anchor.href, location.href);
      const match = url.pathname.match(/^\/(?:video|note)\/(\d+)/);
      if (!match) continue;
      links.push({
        id: match[1],
        kind: url.pathname.startsWith("/note/") ? "note" : "video",
        title: anchor.getAttribute("title") ?? anchor.getAttribute("aria-label") ??
          anchor.innerText?.trim() ?? null
      });
    }

    const countElement = document.querySelector("[data-e2e='user-tab-count']");
    const title = document.querySelector("[data-e2e='user-title']")?.textContent?.trim() ??
      document.querySelector("h1")?.textContent?.trim() ?? null;
    const pageTitle = document.title ?? null;
    const nickname = title ?? pageTitle?.match(/^(.+?)的抖音/)?.[1] ?? null;
    const description = document.querySelector("meta[name='description']")?.content ?? null;
    const signature = document.querySelector("[data-e2e='user-signature']")?.textContent?.trim() ?? null;
    const explicitMoreGate = [...document.querySelectorAll("body *")].some((element) =>
      element.children.length === 0 && visible(element) &&
      element.textContent?.trim() === "登录后查看更多作品"
    );

    return {
      listPresent: Boolean(list),
      links,
      explicitMoreGate,
      pageTitle,
      description,
      creator: {
        nickname,
        signature,
        aweme_count: compactCount(countElement?.textContent),
        aweme_count_text: countElement?.textContent?.trim() ?? null
      }
    };
  });
}

function accessError(access, { hasPublicContent = false } = {}) {
  if (access.securityChallenge) {
    return new ReaderError(
      "DOUYIN_SECURITY_VERIFICATION_REQUIRED",
      "Douyin requires a visible security verification before this content can be read.",
      { status: 422, details: { provider: PROVIDER, reason: "visible_security_challenge" } }
    );
  }
  if (access.privateContent) {
    return new ReaderError("DOUYIN_PRIVATE_CONTENT", "This Douyin content is private.", {
      status: 422,
      details: { provider: PROVIDER, reason: "private_content" }
    });
  }
  if (access.unavailable && !hasPublicContent) {
    return new ReaderError("DOUYIN_CONTENT_UNAVAILABLE", "This Douyin content is unavailable publicly.", {
      status: 422,
      details: { provider: PROVIDER, reason: "public_content_unavailable" }
    });
  }
  if (access.loginRequired && !hasPublicContent) {
    return new ReaderError("DOUYIN_LOGIN_REQUIRED", "Douyin requires login for this content.", {
      status: 422,
      details: { provider: PROVIDER, reason: "login_required" }
    });
  }
  return null;
}

function isTransientError(error) {
  if (error instanceof ReaderError) return RETRYABLE_CODES.has(error.code);
  return error?.name === "TimeoutError" ||
    /Navigation|Target closed|Session closed|Protocol error|net::ERR_|Execution context was destroyed/i
      .test(String(error?.message ?? ""));
}

function causeDiagnostic(cause) {
  if (!cause) return null;
  return sanitizeDiagnostics({
    name: cause?.name ?? "Error",
    code: cause?.code ?? null,
    message: cause?.message ?? "The browser operation failed."
  });
}

function transientError(cause, target, message = "The public Douyin browser request failed transiently.") {
  return new ReaderError("DOUYIN_PUBLIC_WEB_TRANSIENT", message, {
    status: 502,
    details: {
      provider: PROVIDER,
      target: targetDiagnostic(target),
      ...(cause ? { cause: causeDiagnostic(cause) } : {})
    },
    cause
  });
}

function responseStatusError(response, target) {
  const status = response?.status?.();
  if ([403, 408, 425, 429, 500, 502, 503, 504].includes(status)) {
    return transientError(null, target, "Douyin temporarily rejected the public browser request.");
  }
  if ([401, 407].includes(status)) {
    return new ReaderError("DOUYIN_LOGIN_REQUIRED", "Douyin requires login for this content.", {
      status: 422,
      details: { provider: PROVIDER, http_status: status }
    });
  }
  if ([404, 410, 451].includes(status)) {
    return new ReaderError("DOUYIN_CONTENT_UNAVAILABLE", "This Douyin content is unavailable publicly.", {
      status: 422,
      details: { provider: PROVIDER, http_status: status }
    });
  }
  return null;
}

function paginationState(postPages) {
  const seenRequestCursors = new Set();
  let repeatedCursor = null;
  let missingCursor = null;

  for (const page of postPages) {
    if (seenRequestCursors.has(page.requestCursor) && page.hasMore === true) {
      repeatedCursor ??= page.requestCursor;
    }
    seenRequestCursors.add(page.requestCursor);
    if (page.hasMore === true && !page.maxCursor) missingCursor ??= page.requestCursor;
    if (page.hasMore === true && page.maxCursor === page.requestCursor) {
      repeatedCursor ??= page.requestCursor;
    }
  }

  return {
    exhausted: postPages.some((page) => page.hasMore === false),
    repeatedCursor,
    missingCursor
  };
}

function mergeProfileItems({ postPages, domLinks, creator, visibleBoundary }) {
  const byId = new Map();
  const apiOrder = [];
  for (const page of postPages) {
    for (const item of page.items) {
      const id = postIdentity(item);
      if (!id || byId.has(id)) continue;
      byId.set(id, item);
      apiOrder.push(id);
    }
  }

  const domOrder = [...domLinks.keys()];
  const order = visibleBoundary ? domOrder : [...domOrder, ...apiOrder.filter((id) => !domLinks.has(id))];
  return order.map((id) => byId.get(id) ?? {
    aweme_id: id,
    desc: domLinks.get(id)?.title ?? "",
    author: creator
  });
}

export class DirectPublicWebProvider {
  constructor({
    browserService,
    retries = 1,
    retryDelayMs = 350,
    contentWaitMs = 22_000,
    settleMs = 700,
    maxScrollRounds = 30,
    stableScrollRounds = 3
  } = {}) {
    this.id = PROVIDER;
    this.available = true;
    this.browser = browserService ?? new PublicBrowserService();
    this.retries = Math.max(0, retries);
    this.retryDelayMs = retryDelayMs;
    this.contentWaitMs = contentWaitMs;
    this.settleMs = settleMs;
    this.maxScrollRounds = maxScrollRounds;
    this.stableScrollRounds = stableScrollRounds;
  }

  async runWithRetry(operation, target) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const result = await operation();
        result.meta = { ...result.meta, attempts: attempt + 1 };
        return result;
      } catch (error) {
        if (error instanceof ReaderError && TERMINAL_ACCESS_CODES.has(error.code)) throw error;
        const retryable = isTransientError(error);
        if (!retryable) {
          if (error instanceof ReaderError) throw error;
          throw new ReaderError("DOUYIN_PUBLIC_WEB_FAILED", "The public Douyin browser request failed.", {
            status: 502,
            details: { provider: PROVIDER, target: targetDiagnostic(target) },
            cause: error
          });
        }
        lastError = error instanceof ReaderError ? error : transientError(error, target);
        if (attempt < this.retries) await delay(this.retryDelayMs * (attempt + 1));
      }
    }
    throw lastError;
  }

  async resolveContent({ inputUrl, resolvedUrl } = {}) {
    const target = validatedTarget(resolvedUrl ?? inputUrl);
    return this.runWithRetry(() => this.browser.withPage(async ({ page, runtime }) => {
      let navigationResponse;
      try {
        navigationResponse = await page.goto(target, { waitUntil: "domcontentloaded" });
      } catch (error) {
        throw transientError(error, target, "The public Douyin URL did not resolve in the browser.");
      }
      const statusError = responseStatusError(navigationResponse, target);
      if (statusError) throw statusError;
      await delay(this.settleMs);

      const access = await pageAccessSnapshot(page);
      const failure = accessError(access);
      if (failure) throw failure;
      const pageState = await page.evaluate(() => ({
        url: location.href,
        canonical: document.querySelector("link[rel='canonical']")?.href ?? null
      }));
      const candidate = [pageState.url, pageState.canonical]
        .map((value) => {
          try { return validatedTarget(value); } catch { return null; }
        })
        .find((value) => contentTypeFromUrl(value) !== "unknown");
      const contentType = contentTypeFromUrl(candidate);
      if (!candidate || contentType === "unknown") {
        throw new ReaderError(
          "DOUYIN_PUBLIC_WEB_EMPTY_RESULT",
          "The public Douyin browser could not determine the content type.",
          { status: 502, details: { provider: PROVIDER, target: targetDiagnostic(target) } }
        );
      }
      return {
        finalUrl: candidate,
        contentType,
        meta: {
          provider: PROVIDER,
          method: "public_unauthenticated_browser_resolution",
          target: targetDiagnostic(target),
          resolved_target: targetDiagnostic(candidate),
          browser: runtime
        }
      };
    }), target);
  }

  async readVideo({ inputUrl, resolvedUrl, awemeId } = {}) {
    const selected = videoTarget({ inputUrl, resolvedUrl, awemeId });
    return this.runWithRetry(() => this.browser.withPage(async ({ page, runtime }) => {
      const capture = createCapture({ expectedAwemeId: selected.awemeId });
      capture.attach(page);
      const acquiredAt = new Date().toISOString();
      try {
        let navigationResponse;
        try {
          navigationResponse = await page.goto(selected.target, { waitUntil: "domcontentloaded" });
        } catch (error) {
          throw transientError(error, selected.target, "The public Douyin video page did not load in time.");
        }
        const statusError = responseStatusError(navigationResponse, selected.target);
        if (statusError) throw statusError;

        const deadline = Date.now() + this.contentWaitMs;
        let dom = await videoDomSnapshot(page);
        while (Date.now() < deadline) {
          await capture.drain();
          dom = await videoDomSnapshot(page);
          const access = await pageAccessSnapshot(page);
          const visibleMedia = dom.media.length > 0 || capture.state.media.size > 0;
          const failure = accessError(access, { hasPublicContent: Boolean(capture.state.aweme || visibleMedia) });
          if (failure) throw failure;
          if (capture.state.aweme && visibleMedia) break;
          await delay(250);
        }

        await delay(this.settleMs);
        await capture.drain();
        dom = await videoDomSnapshot(page);
        const access = await pageAccessSnapshot(page);
        const observedMediaUrls = [...new Set([
          ...capture.state.media.keys(),
          ...dom.media.filter((value) => /^https?:\/\//i.test(value))
        ])];
        const hydration = hydratedAweme(dom.hydration);
        const aweme = capture.state.aweme ?? hydration ?? fallbackAweme({
          awemeId: selected.awemeId,
          dom,
          mediaUrls: observedMediaUrls
        });
        const usableMediaUrls = [...new Set([
          ...observedMediaUrls,
          ...embeddedAwemeMediaUrls(aweme)
        ])];
        const combinedAccess = { ...access };
        mergeSignals(combinedAccess, capture.state.signals);
        const failure = accessError(combinedAccess, {
          hasPublicContent: Boolean(aweme && (usableMediaUrls.length || aweme.images))
        });
        if (failure) throw failure;

        if (!aweme || usableMediaUrls.length === 0) {
          throw new ReaderError(
            "DOUYIN_PUBLIC_WEB_EMPTY_RESULT",
            "The public Douyin page did not yield usable video metadata and media.",
            {
              status: 502,
              details: {
                provider: PROVIDER,
                target: targetDiagnostic(selected.target),
                metadata_found: Boolean(aweme),
                media_found: usableMediaUrls.length > 0
              }
            }
          );
        }

        return {
          aweme,
          networkMediaUrls: observedMediaUrls,
          meta: {
            provider: PROVIDER,
            method: "public_unauthenticated_browser",
            acquired_at: acquiredAt,
            target: targetDiagnostic(selected.target),
            browser: runtime,
            endpoints_observed: [...capture.state.endpointPaths],
            network_media_count: capture.state.media.size,
            network_media_hosts: [...new Set(
              [...capture.state.media.values()].map((item) => item.host)
            )],
            page: {
              title: dom.title,
              description: dom.description,
              canonical_host: safeUrl(dom.canonical)?.host ?? null,
              canonical_path: safeUrl(dom.canonical)?.path ?? null
            }
          }
        };
      } finally {
        capture.detach();
      }
    }), selected.target);
  }

  async readProfile({ inputUrl, resolvedUrl, secUserId } = {}) {
    const selected = profileTarget({ inputUrl, resolvedUrl, secUserId });
    return this.runWithRetry(() => this.browser.withPage(async ({ page, runtime }) => {
      const capture = createCapture({ expectedSecUserId: selected.secUserId });
      capture.attach(page);
      const acquiredAt = new Date().toISOString();
      try {
        let navigationResponse;
        try {
          navigationResponse = await page.goto(selected.target, { waitUntil: "domcontentloaded" });
        } catch (error) {
          throw transientError(error, selected.target, "The public Douyin profile page did not load in time.");
        }
        const statusError = responseStatusError(navigationResponse, selected.target);
        if (statusError) throw statusError;

        const domLinks = new Map();
        let dom = null;
        let stableRounds = 0;
        let previousCount = 0;
        const deadline = Date.now() + this.contentWaitMs;

        for (let round = 0; round < this.maxScrollRounds; round += 1) {
          await capture.drain();
          dom = await profileDomSnapshot(page);
          for (const link of dom.links) if (!domLinks.has(link.id)) domLinks.set(link.id, link);
          const access = await pageAccessSnapshot(page);
          const failure = accessError(access, { hasPublicContent: domLinks.size > 0 });
          if (failure) throw failure;
          if (dom.explicitMoreGate || access.explicitMoreGate) break;

          const pagination = paginationState(capture.state.postPages);
          if (pagination.exhausted && stableRounds >= 1) break;
          if (domLinks.size === previousCount) stableRounds += 1;
          else stableRounds = 0;
          previousCount = domLinks.size;

          if (stableRounds >= this.stableScrollRounds && Date.now() >= deadline) break;
          await page.evaluate(() => {
            const list = document.querySelector("[data-e2e='user-post-list']");
            const last = list?.querySelector("a[href]:last-of-type");
            if (last) last.scrollIntoView({ block: "end" });
            else window.scrollTo(0, document.body.scrollHeight);
          });
          await delay(this.settleMs);
        }

        await capture.drain();
        dom = await profileDomSnapshot(page);
        for (const link of dom.links) if (!domLinks.has(link.id)) domLinks.set(link.id, link);
        const access = await pageAccessSnapshot(page);
        const explicitBoundary = Boolean(dom.explicitMoreGate || access.explicitMoreGate);
        const profileUser = capture.state.profilePayloads.map(extractUser).find(Boolean);
        const firstAuthor = capture.state.postPages
          .flatMap((pageResult) => pageResult.items)
          .find((item) => item?.author)?.author;
        const creator = {
          ...(profileUser ?? firstAuthor ?? {}),
          ...(selected.secUserId ? { sec_uid: selected.secUserId, sec_user_id: selected.secUserId } : {}),
          ...(!profileUser?.nickname && dom.creator.nickname ? { nickname: dom.creator.nickname } : {}),
          ...(!profileUser?.signature && dom.creator.signature ? { signature: dom.creator.signature } : {}),
          ...(!Number.isFinite(Number(profileUser?.aweme_count)) && dom.creator.aweme_count !== null
            ? { aweme_count: dom.creator.aweme_count }
            : {})
        };
        const items = mergeProfileItems({
          postPages: capture.state.postPages,
          domLinks,
          creator,
          visibleBoundary: explicitBoundary
        });
        const combinedAccess = { ...access };
        mergeSignals(combinedAccess, capture.state.signals);
        const failure = accessError(combinedAccess, { hasPublicContent: items.length > 0 });
        if (failure) throw failure;

        if (!dom.listPresent && items.length === 0) {
          throw new ReaderError(
            "DOUYIN_PUBLIC_WEB_EMPTY_RESULT",
            "The public Douyin page did not yield a readable creator profile.",
            {
              status: 502,
              details: { provider: PROVIDER, target: targetDiagnostic(selected.target) }
            }
          );
        }

        const cursors = paginationState(capture.state.postPages);
        if (!explicitBoundary && cursors.repeatedCursor) {
          throw new ReaderError("DOUYIN_CURSOR_LOOP", "Douyin returned a repeated public pagination cursor.", {
            status: 502,
            details: {
              provider: PROVIDER,
              cursor: cursors.repeatedCursor,
              pages_captured: capture.state.postPages.length
            }
          });
        }
        if (!explicitBoundary && cursors.missingCursor) {
          throw new ReaderError("DOUYIN_CURSOR_MISSING", "Douyin indicated more public posts but omitted the next cursor.", {
            status: 502,
            details: {
              provider: PROVIDER,
              cursor: cursors.missingCursor,
              pages_captured: capture.state.postPages.length
            }
          });
        }
        if (!explicitBoundary && !cursors.exhausted) {
          throw new ReaderError(
            "DOUYIN_PAGINATION_INCOMPLETE",
            "The public profile feed did not expose an access boundary or an exhausted cursor.",
            {
              status: 502,
              details: {
                provider: PROVIDER,
                pages_captured: capture.state.postPages.length,
                public_items_seen: items.length
              }
            }
          );
        }

        const displayCount = Number.isFinite(Number(creator.aweme_count))
          ? Number(creator.aweme_count)
          : dom.creator.aweme_count;
        const limitation = explicitBoundary ? {
          code: "LOGIN_REQUIRED_FOR_MORE_POSTS",
          type: "partial_public_profile",
          message: "登录后查看更多作品",
          scope: "public_unauthenticated",
          public_items: items.length,
          displayed_post_count: displayCount,
          inaccessible_count: displayCount === null ? null : Math.max(0, displayCount - items.length)
        } : null;
        const publicBoundaryReached = explicitBoundary || cursors.exhausted;

        return {
          creator,
          items,
          pagination: {
            complete: publicBoundaryReached,
            scope: "public_unauthenticated",
            public_access_exhausted: publicBoundaryReached,
            upstream_exhausted: cursors.exhausted,
            stopped_by_access_boundary: explicitBoundary,
            stop_reason: explicitBoundary
              ? "login_required_for_more"
              : cursors.exhausted
                ? "has_more_false"
                : "browser_dom_stable",
            pages_captured: capture.state.postPages.length,
            unique_items: items.length,
            displayed_post_count: displayCount,
            profile_count_gap: displayCount === null ? null : Math.max(0, displayCount - items.length)
          },
          limitation,
          meta: {
            provider: PROVIDER,
            method: "public_unauthenticated_browser",
            acquired_at: acquiredAt,
            target: targetDiagnostic(selected.target),
            browser: runtime,
            endpoints_observed: [...capture.state.endpointPaths],
            dom_links_scoped_to: "[data-e2e=user-post-list]",
            page: {
              title: dom.pageTitle,
              description: dom.description
            }
          }
        };
      } finally {
        capture.detach();
      }
    }), selected.target);
  }
}
