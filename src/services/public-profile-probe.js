const SEC_USER_ID = /^[A-Za-z0-9_-]{10,200}$/;
const AWEME_ID = /^\d{15,22}$/;
const MAX_REPORTED_POSTS = 50;

export function parsePublicProfileProbeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A canonical public Douyin profile URL is required.");
  }
  const host = url.hostname.toLowerCase();
  const match = host === "www.douyin.com"
    ? url.pathname.match(/^\/user\/([^/]+)\/?$/)
    : host === "www.iesdouyin.com"
      ? url.pathname.match(/^\/share\/user\/([^/]+)\/?$/)
      : null;
  const secUserId = match?.[1] ?? "";
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || !SEC_USER_ID.test(secUserId)) {
    throw new Error("A canonical public Douyin profile URL is required.");
  }
  return { url: url.href, secUserId };
}

export function publicProfileProbeReceipt(profile, secUserId) {
  const observedId = profile?.creator?.sec_uid ?? profile?.creator?.sec_user_id;
  if (observedId !== secUserId || !Array.isArray(profile?.items) ||
      profile?.meta?.method !== "public_unauthenticated_browser" ||
      profile?.pagination?.scope !== "public_unauthenticated" ||
      profile?.pagination?.complete !== true) {
    throw new Error("The public profile listing is incomplete or its creator identity is unverified.");
  }
  const posts = profile.items.map((item) => {
    const awemeId = String(item?.aweme_id ?? "");
    const authorId = item?.author?.sec_uid ?? item?.author?.sec_user_id ?? null;
    if (!AWEME_ID.test(awemeId) || (authorId && authorId !== secUserId)) {
      throw new Error("The public profile contains an invalid post identity.");
    }
    const kind = item.public_post_kind === "video" || item.public_post_kind === "note"
      ? item.public_post_kind
      : Array.isArray(item.images) && item.images.length > 0
        ? "note" : item.video ? "video" : "unknown";
    return {
      aweme_id: awemeId,
      kind,
      ...(kind !== "unknown"
        ? { url: `https://www.douyin.com/${kind}/${awemeId}` }
        : {})
    };
  });
  if (new Set(posts.map((post) => post.aweme_id)).size !== posts.length) {
    throw new Error("The public profile contains duplicate post identities.");
  }
  const pagination = profile.pagination;
  const publicVideoCount = posts.filter((post) => post.kind === "video").length;
  return {
    schema_version: "1.0",
    pass: publicVideoCount > 0,
    scope: "public_unauthenticated",
    sec_user_id: secUserId,
    acquired_at: profile.meta.acquired_at,
    browser_kind: profile.meta.browser?.kind ?? null,
    public_post_count: posts.length,
    public_video_count: publicVideoCount,
    reported_post_count: Math.min(posts.length, MAX_REPORTED_POSTS),
    output_truncated: posts.length > MAX_REPORTED_POSTS,
    posts: posts.slice(0, MAX_REPORTED_POSTS),
    public_boundary: {
      public_access_exhausted: pagination.public_access_exhausted,
      stopped_by_access_boundary: pagination.stopped_by_access_boundary,
      upstream_exhausted: pagination.upstream_exhausted,
      stop_reason: pagination.stop_reason,
      pages_captured: pagination.pages_captured,
      displayed_post_count: pagination.displayed_post_count,
      profile_count_gap: pagination.profile_count_gap,
      limitation_code: profile.limitation?.code ?? null
    }
  };
}
