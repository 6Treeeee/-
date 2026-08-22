import { ReaderError, errorSummary } from "../errors.js";
import { TikHubClient, TIKHUB_ROUTES } from "../services/tikhub.js";
import {
  extractAweme,
  extractPostPage,
  extractSecUserId,
  extractUser,
  postIdentity,
  restrictionReason
} from "../normalizers/douyin.js";

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

export async function paginateTikHubPosts(
  client,
  { secUserId, route, provider, extraParams = {}, maxPages = 100 }
) {
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
      response = await client.get(route, {
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
      throw new ReaderError(
        "UPSTREAM_SCHEMA_MISMATCH",
        "TikHub's Douyin post response had an unknown shape.",
        {
          status: 502,
          details: {
            provider,
            route,
            cursor,
            pages_fetched: pages.length,
            request_id: response.meta?.request_id ?? null
          }
        }
      );
    }

    items.push(...page.items);
    pages.push({
      cursor,
      next_cursor: page.maxCursor,
      item_count: page.items.length,
      has_more: page.hasMore,
      request_id: response.meta?.request_id ?? null
    });

    if (page.hasMore === false) {
      return { provider, route, items, pages, exhausted: true };
    }
    if (page.hasMore !== true) {
      throw new ReaderError(
        "UPSTREAM_SCHEMA_MISMATCH",
        "TikHub omitted Douyin's has_more pagination field.",
        {
          status: 502,
          details: { provider, route, cursor, pages_fetched: pages.length }
        }
      );
    }
    if (!page.maxCursor) {
      throw new ReaderError(
        "DOUYIN_CURSOR_MISSING",
        "Douyin indicated more posts but returned no next cursor.",
        {
          status: 502,
          details: { provider, cursor, pages_fetched: pages.length }
        }
      );
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

function unavailable(message, attempts, cause) {
  return new ReaderError("DOUYIN_PROVIDER_UNAVAILABLE", message, {
    status: 502,
    details: { provider: "tikhub", attempts },
    cause
  });
}

export class TikHubProvider {
  constructor({ apiKey, fetchImpl = globalThis.fetch, client, clientOptions = {} } = {}) {
    this.id = "tikhub";
    this.fetchImpl = fetchImpl;
    this.client = client ?? (apiKey ? new TikHubClient({ ...clientOptions, apiKey, fetchImpl }) : null);
    this.available = Boolean(this.client);
  }

  async resolveSecUserId(url) {
    if (!this.client) throw unavailable("TikHub is not configured.", []);
    const response = await this.client.get(TIKHUB_ROUTES.secUserId, { url });
    const secUserId = extractSecUserId(response.data);
    if (!secUserId) {
      throw new ReaderError(
        "DOUYIN_PROFILE_ID_NOT_FOUND",
        "The public profile URL did not yield a sec_user_id.",
        {
          status: 422,
          details: {
            provider: this.id,
            route: response.meta?.route,
            request_id: response.meta?.request_id ?? null
          }
        }
      );
    }
    return { secUserId, meta: response.meta };
  }

  async readVideo({ inputUrl }) {
    if (!this.client) throw unavailable("TikHub is not configured.", []);

    const attempts = [];
    for (const route of [TIKHUB_ROUTES.videoApp, TIKHUB_ROUTES.videoWeb]) {
      const result = await attempt(() => this.client.get(route, { share_url: inputUrl }));
      if (!result.ok) {
        attempts.push({ route, error: errorSummary(result.error) });
        continue;
      }

      const aweme = extractAweme(result.value.data);
      if (aweme) {
        return {
          aweme,
          meta: {
            provider: this.id,
            route,
            request_id: result.value.meta?.request_id ?? null,
            attempts: attempts.length + 1
          }
        };
      }

      const restriction = restrictionReason(result.value.data);
      if (restriction && [5, 10].includes(restriction.reason)) {
        throw new ReaderError(
          "DOUYIN_PROVIDER_RESTRICTION_UNVERIFIED",
          "TikHub returned a restriction marker that requires confirmation from the public page.",
          {
            status: 502,
            details: {
              provider: this.id,
              authoritative: false,
              route,
              request_id: result.value.meta?.request_id ?? null,
              restriction
            }
          }
        );
      }

      attempts.push({
        route,
        request_id: result.value.meta?.request_id ?? null,
        restriction,
        error: { code: "EMPTY_VIDEO_RESULT", message: "No usable public video object was returned." }
      });
    }

    throw unavailable("TikHub returned no usable public video result.", attempts);
  }

  async readProfile({ secUserId }) {
    if (!this.client) throw unavailable("TikHub is not configured.", []);
    if (!secUserId) {
      throw new ReaderError("DOUYIN_PROFILE_ID_NOT_FOUND", "A sec_user_id is required.", {
        status: 422,
        details: { provider: this.id }
      });
    }

    let profileResponse = null;
    const profileAttempts = [];
    for (const route of [TIKHUB_ROUTES.profileApp, TIKHUB_ROUTES.profileWeb]) {
      const result = await attempt(() => this.client.get(route, { sec_user_id: secUserId }));
      if (result.ok && extractUser(result.value.data)) {
        profileResponse = result.value;
        break;
      }
      profileAttempts.push(result.ok
        ? { route, request_id: result.value.meta?.request_id ?? null, error: "user_not_found_in_response" }
        : { route, error: errorSummary(result.error) });
    }

    const primary = await attempt(() => paginateTikHubPosts(this.client, {
      secUserId,
      route: TIKHUB_ROUTES.postsApp,
      provider: "tikhub_app_v3_normal",
      extraParams: { sort_type: 0, channel: "normal" }
    }));

    const warnings = [];
    const attemptedSeries = new Set(["tikhub_app_v3_normal"]);
    let series;
    if (primary.ok) {
      series = [primary.value];
    } else if (primary.error?.details?.pages_fetched === 0) {
      const lite = await attempt(() => paginateTikHubPosts(this.client, {
        secUserId,
        route: TIKHUB_ROUTES.postsApp,
        provider: "tikhub_app_v3_lite",
        extraParams: { sort_type: 0, channel: "lite" }
      }));
      attemptedSeries.add("tikhub_app_v3_lite");
      if (lite.ok) {
        series = [lite.value];
      } else {
        const web = await paginateTikHubPosts(this.client, {
          secUserId,
          route: TIKHUB_ROUTES.postsWeb,
          provider: "tikhub_web",
          extraParams: { filter_type: 0 }
        });
        attemptedSeries.add("tikhub_web");
        series = [web];
      }
      warnings.push({ code: "TIKHUB_APP_POSTS_UNAVAILABLE", detail: errorSummary(primary.error) });
      if (!lite.ok) {
        warnings.push({ code: "TIKHUB_APP_LITE_POSTS_UNAVAILABLE", detail: errorSummary(lite.error) });
      }
    } else {
      throw primary.error;
    }

    let merged = mergePostSeries(series);
    const user = extractUser(profileResponse?.data) ?? series[0].items[0]?.author ?? {};
    const expectedPosts = Number.isFinite(Number(user?.aweme_count ?? user?.video_count))
      ? Number(user.aweme_count ?? user.video_count)
      : null;

    if (expectedPosts !== null && merged.items.length < expectedPosts) {
      const candidates = [
        {
          route: TIKHUB_ROUTES.postsApp,
          provider: "tikhub_app_v3_lite",
          extraParams: { sort_type: 0, channel: "lite" }
        },
        {
          route: TIKHUB_ROUTES.postsWeb,
          provider: "tikhub_web",
          extraParams: { filter_type: 0 }
        },
        {
          route: TIKHUB_ROUTES.postsWeb,
          provider: "tikhub_web_hot",
          extraParams: { filter_type: 3 }
        }
      ].filter((candidate) => !attemptedSeries.has(candidate.provider));

      for (const candidate of candidates) {
        attemptedSeries.add(candidate.provider);
        const result = await attempt(() => paginateTikHubPosts(this.client, {
          secUserId,
          ...candidate
        }));
        if (result.ok) {
          series.push(result.value);
          merged = mergePostSeries(series);
          if (merged.items.length >= expectedPosts) break;
        } else {
          warnings.push({
            code: "TIKHUB_RECONCILIATION_SOURCE_FAILED",
            provider: candidate.provider,
            detail: errorSummary(result.error)
          });
        }
      }
    }

    const exhausted = series.every((item) => item.exhausted);
    const countConsistent = expectedPosts === null || merged.items.length >= expectedPosts;
    if (!countConsistent) {
      warnings.push({
        code: "POST_COUNT_MISMATCH",
        expected_posts: expectedPosts,
        accessible_unique_posts: merged.items.length,
        message: "Public unauthenticated feeds were exhausted, but the profile display count is larger."
      });
    }
    if (!profileResponse) {
      warnings.push({ code: "PROFILE_METADATA_DERIVED_FROM_POST", attempts: profileAttempts });
    }

    return {
      creator: user,
      items: merged.items,
      pagination: {
        complete: exhausted,
        scope: "public_unauthenticated",
        upstream_exhausted: exhausted,
        count_consistent: countConsistent,
        expected_posts: expectedPosts,
        profile_count_gap: expectedPosts === null ? null : Math.max(0, expectedPosts - merged.items.length),
        unique_posts: merged.items.length,
        duplicates_removed: merged.duplicates,
        pages_fetched: series.reduce((total, item) => total + item.pages.length, 0),
        series: series.map((item) => ({ provider: item.provider, pages: item.pages }))
      },
      limitation: countConsistent ? null : {
        type: "partial_public_profile",
        reason: "display_count_exceeds_public_feed",
        message: "The public feed was exhausted before the profile display count was reached."
      },
      warnings,
      meta: {
        provider: this.id,
        identity: { sec_user_id: secUserId },
        profile: profileResponse?.meta ?? null,
        post_series: series.map((item) => ({
          provider: item.provider,
          route: item.route,
          pages_fetched: item.pages.length
        }))
      }
    };
  }
}
