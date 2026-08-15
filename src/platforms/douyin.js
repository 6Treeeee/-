import { ReaderError, errorSummary } from "../errors.js";
import { TikHubClient, TIKHUB_ROUTES } from "../services/tikhub.js";
import {
  extractAweme,
  extractPostPage,
  extractSecUserId,
  extractUser,
  normalizeCreator,
  normalizeVideo,
  postIdentity,
  restrictionReason
} from "../normalizers/douyin.js";

const DOUYIN_HOSTS = ["douyin.com", "iesdouyin.com"];
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

function isDouyinHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return DOUYIN_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function isDouyinUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      isDouyinHost(url.hostname);
  } catch {
    return false;
  }
}

function validatedDouyinUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ReaderError("INVALID_URL", "A valid public URL is required.", { status: 400 });
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ReaderError("INVALID_URL", "Only public HTTP(S) URLs without credentials are accepted.", { status: 400 });
  }
  if (!isDouyinHost(url.hostname)) {
    throw new ReaderError("UNSUPPORTED_PLATFORM", "Phase 1 currently supports Douyin URLs only.", {
      status: 422,
      details: { detected_host: url.hostname }
    });
  }
  return url;
}

async function closeBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The redirect was already bodyless or consumed by the runtime.
  }
}

export async function resolveDouyinUrl(value, fetchImpl = globalThis.fetch) {
  let current = validatedDouyinUrl(value);
  const visited = new Set();
  const hops = [];

  for (let index = 0; index < 6; index += 1) {
    if (visited.has(current.href)) {
      return { finalUrl: current.href, resolved: false, hops, warning: "redirect_loop" };
    }
    visited.add(current.href);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": MOBILE_USER_AGENT, Accept: "text/html,*/*" },
        signal: controller.signal
      });
      const location = response.headers.get("location");
      hops.push({ status: response.status, host: current.hostname });
      await closeBody(response);

      if (!REDIRECT_STATUS.has(response.status) || !location) {
        return {
          finalUrl: current.href,
          resolved: current.href !== value,
          hops
        };
      }

      current = validatedDouyinUrl(new URL(location, current).href);
    } catch (error) {
      if (error instanceof ReaderError) throw error;
      return {
        finalUrl: current.href,
        resolved: current.href !== value,
        hops,
        warning: error?.name === "AbortError" ? "resolution_timeout" : "resolution_failed"
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { finalUrl: current.href, resolved: true, hops, warning: "redirect_limit" };
}

function publicSourceUrl(value) {
  const url = validatedDouyinUrl(value);
  url.hash = "";
  const pathIdentifiesContent = /\/(?:share\/)?(?:user|video)\//i.test(url.pathname) ||
    /\/note\//i.test(url.pathname);
  if (pathIdentifiesContent) {
    url.search = "";
  } else {
    const secUid = url.searchParams.get("sec_uid");
    const modalId = url.searchParams.get("modal_id");
    url.search = "";
    if (secUid) url.searchParams.set("sec_uid", secUid);
    if (modalId) url.searchParams.set("modal_id", modalId);
  }
  return url.href;
}

export function detectDouyinContentType(value) {
  const url = validatedDouyinUrl(value);
  const path = decodeURIComponent(url.pathname);
  if (/\/(?:share\/)?user\//i.test(path) || url.searchParams.has("sec_uid")) return "profile";
  if (/\/(?:share\/)?video\/\d+/i.test(path) || /\/note\/\d+/i.test(path) ||
      url.searchParams.has("modal_id")) return "video";
  return "unknown";
}

function secUserIdFromUrl(value) {
  const url = validatedDouyinUrl(value);
  const match = decodeURIComponent(url.pathname).match(/\/(?:share\/)?user\/([^/?#]+)/i);
  return match?.[1] ?? url.searchParams.get("sec_uid") ?? null;
}

async function attempt(operation) {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, error };
  }
}

function paginationFailure(message, cause, context) {
  return new ReaderError("DOUYIN_PAGINATION_FAILED", message, {
    status: 502,
    details: { ...context, cause: errorSummary(cause) },
    cause
  });
}

async function paginatePosts(client, { secUserId, route, provider, extraParams = {}, maxPages = 100 }) {
  const items = [];
  const pages = [];
  const seenCursors = new Set();
  let cursor = "0";

  while (pages.length < maxPages) {
    if (seenCursors.has(cursor)) {
      throw new ReaderError("DOUYIN_CURSOR_LOOP", "Douyin returned a repeated pagination cursor.", {
        status: 502,
        details: { provider, cursor, pages_fetched: pages.length }
      });
    }
    seenCursors.add(cursor);

    let response;
    try {
      response = provider === "douplus"
        ? await client.post(route, {
            sec_uid: secUserId,
            cursor,
            count: 20
          })
        : await client.get(route, {
            sec_user_id: secUserId,
            max_cursor: cursor,
            count: 20,
            ...extraParams
          });
    } catch (error) {
      throw paginationFailure("A Douyin post page could not be retrieved.", error, {
        provider,
        cursor,
        pages_fetched: pages.length
      });
    }

    const page = extractPostPage(response.data);
    if (!page.recognized) {
      throw new ReaderError("UPSTREAM_SCHEMA_MISMATCH", "TikHub's Douyin post response had an unknown shape.", {
        status: 502,
        details: {
          provider,
          route,
          cursor,
          pages_fetched: pages.length,
          request_id: response.meta.request_id
        }
      });
    }

    items.push(...page.items);
    pages.push({
      cursor,
      next_cursor: page.maxCursor,
      item_count: page.items.length,
      has_more: page.hasMore,
      request_id: response.meta.request_id
    });

    if (page.hasMore === false) {
      return { provider, route, items, pages, exhausted: true };
    }
    if (page.hasMore !== true) {
      throw new ReaderError("UPSTREAM_SCHEMA_MISMATCH", "TikHub omitted Douyin's has_more pagination field.", {
        status: 502,
        details: { provider, route, cursor, pages_fetched: pages.length }
      });
    }
    if (!page.maxCursor) {
      throw new ReaderError("DOUYIN_CURSOR_MISSING", "Douyin indicated more posts but returned no next cursor.", {
        status: 502,
        details: { provider, cursor, pages_fetched: pages.length }
      });
    }
    cursor = page.maxCursor;
  }

  throw new ReaderError("DOUYIN_PAGE_LIMIT", "The profile exceeded the pagination safety limit.", {
    status: 502,
    details: { provider, max_pages: maxPages, posts_seen: items.length }
  });
}

function mergePostSeries(series) {
  const unique = new Map();
  let anonymous = 0;
  let duplicates = 0;

  for (const result of series) {
    for (const item of result.items) {
      const id = postIdentity(item) ?? `anonymous-${anonymous++}`;
      if (unique.has(id)) duplicates += 1;
      else unique.set(id, item);
    }
  }
  return { items: [...unique.values()], duplicates };
}

export class DouyinReader {
  constructor({ apiKey, fetchImpl = globalThis.fetch, client } = {}) {
    this.fetchImpl = fetchImpl;
    this.client = client ?? new TikHubClient({ apiKey, fetchImpl });
  }

  async resolveSecUserId(inputUrl, resolvedUrl) {
    const direct = secUserIdFromUrl(resolvedUrl) ?? secUserIdFromUrl(inputUrl);
    if (direct) return { secUserId: direct, retrieval: { method: "public_redirect" } };

    const response = await this.client.get(TIKHUB_ROUTES.secUserId, { url: inputUrl });
    const secUserId = extractSecUserId(response.data);
    if (!secUserId) {
      throw new ReaderError("DOUYIN_PROFILE_ID_NOT_FOUND", "The public profile URL did not yield a sec_user_id.", {
        status: 422,
        details: { route: response.meta.route, request_id: response.meta.request_id }
      });
    }
    return { secUserId, retrieval: response.meta };
  }

  async readVideo({ inputUrl, resolvedUrl, resolution }) {
    const attempts = [];
    let successfulResponses = 0;
    for (const route of [TIKHUB_ROUTES.videoApp, TIKHUB_ROUTES.videoWeb]) {
      const result = await attempt(() => this.client.get(route, { share_url: inputUrl }));
      if (!result.ok) {
        attempts.push({ route, error: errorSummary(result.error) });
        continue;
      }
      successfulResponses += 1;

      const aweme = extractAweme(result.value.data);
      if (aweme) {
        return {
          schema_version: "1.0",
          platform: "douyin",
          content_type: "video",
          source: {
            input_url: inputUrl,
            resolved_url: resolvedUrl,
            resolution,
            retrieval: result.value.meta
          },
          content: normalizeVideo(aweme, { inputUrl, resolvedUrl })
        };
      }

      const restriction = restrictionReason(result.value.data);
      if (route === TIKHUB_ROUTES.videoApp && restriction && [5, 10].includes(restriction.reason)) {
        throw new ReaderError(
          "DOUYIN_VIDEO_RESTRICTED",
          "Douyin marked this content as private or visible only to selected users.",
          {
            status: 422,
            details: {
              route,
              request_id: result.value.meta.request_id,
              restriction
            }
          }
        );
      }

      attempts.push({
        route,
        request_id: result.value.meta.request_id,
        restriction,
        error: { code: "EMPTY_VIDEO_RESULT", message: "No public video object was returned." }
      });
    }

    if (successfulResponses === 0) {
      throw new ReaderError("DOUYIN_VIDEO_RETRIEVAL_FAILED", "Douyin's retrieval providers could not be reached.", {
        status: 502,
        details: { attempts }
      });
    }

    throw new ReaderError("DOUYIN_VIDEO_UNAVAILABLE", "No accessible public Douyin video data was returned.", {
      status: 422,
      details: { attempts }
    });
  }

  async readProfile({ inputUrl, resolvedUrl, resolution, knownSecUserId = null }) {
    const idResult = knownSecUserId
      ? { secUserId: knownSecUserId, retrieval: { method: "content_detection" } }
      : await this.resolveSecUserId(inputUrl, resolvedUrl);
    const secUserId = idResult.secUserId;

    let profileResponse = null;
    const profileAttempts = [];
    for (const route of [TIKHUB_ROUTES.profileApp, TIKHUB_ROUTES.profileWeb]) {
      const result = await attempt(() => this.client.get(route, { sec_user_id: secUserId }));
      if (result.ok && extractUser(result.value.data)) {
        profileResponse = result.value;
        break;
      }
      profileAttempts.push(result.ok
        ? { route, request_id: result.value.meta.request_id, error: "user_not_found_in_response" }
        : { route, error: errorSummary(result.error) });
    }

    const primary = await attempt(() => paginatePosts(this.client, {
      secUserId,
      route: TIKHUB_ROUTES.postsApp,
      provider: "app_v3_normal",
      extraParams: { sort_type: 0, channel: "normal" }
    }));

    let series;
    const warnings = [];
    const attemptedProviders = new Set(["app_v3_normal"]);
    if (primary.ok) {
      series = [primary.value];
    } else if (primary.error?.details?.pages_fetched === 0) {
      const lite = await attempt(() => paginatePosts(this.client, {
        secUserId,
        route: TIKHUB_ROUTES.postsApp,
        provider: "app_v3_lite",
        extraParams: { sort_type: 0, channel: "lite" }
      }));
      attemptedProviders.add("app_v3_lite");
      const web = lite.ok ? null : await paginatePosts(this.client, {
          secUserId,
          route: TIKHUB_ROUTES.postsWeb,
          provider: "web",
          extraParams: { filter_type: 0 }
        });
      if (!lite.ok) attemptedProviders.add("web");
      series = [lite.ok ? lite.value : web];
      warnings.push({ code: "APP_POSTS_UNAVAILABLE", detail: errorSummary(primary.error) });
      if (!lite.ok) warnings.push({ code: "APP_LITE_POSTS_UNAVAILABLE" });
    } else {
      throw primary.error;
    }

    let merged = mergePostSeries(series);
    const initialUser = extractUser(profileResponse?.data) ?? series[0].items[0]?.author ?? {};
    let creator = normalizeCreator(initialUser);
    if (!creator.sec_user_id) creator = { ...creator, sec_user_id: secUserId };
    const expectedPosts = creator.stats?.post_count ?? null;

    if (expectedPosts !== null && merged.items.length < expectedPosts) {
      const candidates = [
        {
          route: TIKHUB_ROUTES.postsApp,
          provider: "app_v3_lite",
          extraParams: { sort_type: 0, channel: "lite" }
        },
        {
          route: TIKHUB_ROUTES.postsWeb,
          provider: "web_reconciliation",
          extraParams: { filter_type: 0 }
        },
        {
          route: TIKHUB_ROUTES.postsDouPlus,
          provider: "douplus"
        }
      ].filter((candidate) => !attemptedProviders.has(
        candidate.provider === "web_reconciliation" ? "web" : candidate.provider
      ));

      for (const candidate of candidates) {
        attemptedProviders.add(candidate.provider === "web_reconciliation" ? "web" : candidate.provider);
        const result = await attempt(() => paginatePosts(this.client, { secUserId, ...candidate }));
        if (result.ok) {
          series.push(result.value);
          merged = mergePostSeries(series);
          if (merged.items.length >= expectedPosts) break;
        } else {
          warnings.push({ code: "RECONCILIATION_SOURCE_FAILED", provider: candidate.provider });
        }
      }
    }

    const posts = merged.items.map((item) => normalizeVideo(item));
    const complete = series.every((item) => item.exhausted) &&
      (expectedPosts === null || posts.length >= expectedPosts);
    if (!complete) {
      warnings.push({
        code: "POST_COUNT_MISMATCH",
        expected_posts: expectedPosts,
        accessible_unique_posts: posts.length
      });
    }
    if (!profileResponse) {
      warnings.push({ code: "PROFILE_METADATA_DERIVED_FROM_POST", attempts: profileAttempts });
    }

    return {
      schema_version: "1.0",
      platform: "douyin",
      content_type: "profile",
      source: {
        input_url: inputUrl,
        resolved_url: resolvedUrl,
        resolution,
        identity_retrieval: idResult.retrieval,
        profile_retrieval: profileResponse?.meta ?? null,
        post_retrieval: series.map((item) => ({
          provider: item.provider,
          route: item.route,
          pages_fetched: item.pages.length
        }))
      },
      content: {
        creator,
        posts,
        pagination: {
          complete,
          upstream_exhausted: series.every((item) => item.exhausted),
          expected_posts: expectedPosts,
          unique_posts: posts.length,
          duplicates_removed: merged.duplicates,
          pages_fetched: series.reduce((total, item) => total + item.pages.length, 0),
          series: series.map((item) => ({
            provider: item.provider,
            pages: item.pages
          }))
        },
        warnings
      }
    };
  }

  async read({ url, type = "auto" }) {
    const inputUrl = validatedDouyinUrl(url).href;
    const resolution = await resolveDouyinUrl(inputUrl, this.fetchImpl);
    const resolvedUrl = resolution.finalUrl;
    const sourceResolution = {
      ...resolution,
      finalUrl: publicSourceUrl(resolution.finalUrl)
    };
    const requestedType = String(type).toLowerCase();

    if (!["auto", "video", "profile"].includes(requestedType)) {
      throw new ReaderError("INVALID_CONTENT_TYPE", "type must be auto, video, or profile.", { status: 400 });
    }

    let detectedType = requestedType === "auto" ? detectDouyinContentType(resolvedUrl) : requestedType;
    if (detectedType === "profile") {
      return this.readProfile({ inputUrl, resolvedUrl: sourceResolution.finalUrl, resolution: sourceResolution });
    }
    if (detectedType === "video") {
      return this.readVideo({ inputUrl, resolvedUrl: sourceResolution.finalUrl, resolution: sourceResolution });
    }

    const profileProbe = await attempt(() => this.resolveSecUserId(inputUrl, resolvedUrl));
    if (profileProbe.ok) {
      return this.readProfile({
        inputUrl,
        resolvedUrl: sourceResolution.finalUrl,
        resolution: sourceResolution,
        knownSecUserId: profileProbe.value.secUserId
      });
    }

    const video = await attempt(() => this.readVideo({
      inputUrl,
      resolvedUrl: sourceResolution.finalUrl,
      resolution: sourceResolution
    }));
    if (video.ok) return video.value;

    throw new ReaderError("DOUYIN_CONTENT_NOT_RESOLVED", "The URL was neither a readable public profile nor video.", {
      status: 422,
      details: {
        profile: errorSummary(profileProbe.error),
        video: errorSummary(video.error)
      }
    });
  }
}
