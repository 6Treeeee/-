const TIKHUB_BASE = "https://api.tikhub.io";

function reply(res, status, data) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

async function tikHub(path, params, apiKey) {
  const qs = new URLSearchParams();

  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      qs.set(key, String(value));
    }
  }

  const r = await fetch(`${TIKHUB_BASE}${path}?${qs.toString()}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    ok: r.ok,
    status: r.status,
    data
  };
}

function extractData(result) {
  return (
    result?.data?.data ||
    result?.data ||
    null
  );
}

async function resolveAwemeId(url, apiKey) {
  const candidates = [
    "/api/v1/douyin/web/get_aweme_id",
    "/api/v1/douyin/web/fetch_aweme_id"
  ];

  let last;

  for (const path of candidates) {
    const r = await tikHub(path, { url }, apiKey);
    last = r;

    if (r.ok) {
      const d = extractData(r);

      const id =
        d?.aweme_id ||
        d?.data?.aweme_id ||
        r?.data?.aweme_id;

      if (id) {
        return { ok: true, aweme_id: String(id), raw: r.data };
      }
    }
  }

  return { ok: false, raw: last?.data };
}

async function resolveSecUserId(url, apiKey) {
  const candidates = [
    "/api/v1/douyin/web/get_sec_user_id",
    "/api/v1/douyin/web/fetch_sec_user_id"
  ];

  let last;

  for (const path of candidates) {
    const r = await tikHub(path, { url }, apiKey);
    last = r;

    if (r.ok) {
      const d = extractData(r);

      const id =
        d?.sec_user_id ||
        d?.data?.sec_user_id ||
        r?.data?.sec_user_id;

      if (id) {
        return { ok: true, sec_user_id: String(id), raw: r.data };
      }
    }
  }

  return { ok: false, raw: last?.data };
}

async function fetchVideo(url, apiKey) {
  // Route 1: App V3 can sometimes resolve the share URL directly.
  const direct = await tikHub(
    "/api/v1/douyin/app/v3/fetch_one_video_by_share_url",
    { share_url: url },
    apiKey
  );

  if (direct.ok) {
    return {
      ok: true,
      route: "app_v3_share_url",
      data: direct.data
    };
  }

  // Route 2: resolve aweme_id first, then fetch the work.
  const idResult = await resolveAwemeId(url, apiKey);

  if (!idResult.ok) {
    return {
      ok: false,
      error: "Unable to resolve aweme_id",
      direct_error: direct.data,
      id_error: idResult.raw
    };
  }

  const awemeId = idResult.aweme_id;

  const candidates = [
    [
      "/api/v1/douyin/app/v3/fetch_one_video",
      { aweme_id: awemeId }
    ],
    [
      "/api/v1/douyin/web/fetch_one_video",
      { aweme_id: awemeId }
    ]
  ];

  let last;

  for (const [path, params] of candidates) {
    const r = await tikHub(path, params, apiKey);
    last = r;

    if (r.ok) {
      return {
        ok: true,
        route: path,
        aweme_id: awemeId,
        data: r.data
      };
    }
  }

  return {
    ok: false,
    aweme_id: awemeId,
    error: "Video ID resolved but video fetch failed",
    upstream: last?.data
  };
}

async function fetchProfile(url, apiKey) {
  const idResult = await resolveSecUserId(url, apiKey);

  if (!idResult.ok) {
    return {
      ok: false,
      error: "Unable to resolve sec_user_id",
      upstream: idResult.raw
    };
  }

  const secUserId = idResult.sec_user_id;

  // Fetch profile information.
  let profile = null;

  const profileCandidates = [
    "/api/v1/douyin/app/v3/fetch_user_profile",
    "/api/v1/douyin/web/fetch_user_profile"
  ];

  for (const path of profileCandidates) {
    const r = await tikHub(
      path,
      { sec_user_id: secUserId },
      apiKey
    );

    if (r.ok) {
      profile = r.data;
      break;
    }
  }

  // Fetch all public posts with automatic pagination.
  const posts = [];

  let maxCursor = 0;
  let hasMore = true;
  let page = 0;

  // Safety limit prevents an accidental infinite loop.
  const MAX_PAGES = 100;

  while (hasMore && page < MAX_PAGES) {
    page++;

    let result = await tikHub(
      "/api/v1/douyin/app/v3/fetch_user_post_videos",
      {
        sec_user_id: secUserId,
        max_cursor: maxCursor,
        count: 20
      },
      apiKey
    );

    // App fallback -> Web.
    if (!result.ok) {
      result = await tikHub(
        "/api/v1/douyin/web/fetch_user_post_videos",
        {
          sec_user_id: secUserId,
          max_cursor: maxCursor,
          count: 20
        },
        apiKey
      );
    }

    if (!result.ok) {
      return {
        ok: false,
        sec_user_id: secUserId,
        profile,
        posts,
        pages_fetched: page - 1,
        error: "Failed while fetching user posts",
        upstream: result.data
      };
    }

    const body = extractData(result) || {};

    const list =
      body.aweme_list ||
      body.data?.aweme_list ||
      body.list ||
      [];

    if (Array.isArray(list)) {
      posts.push(...list);
    }

    const nextCursor =
      body.max_cursor ??
      body.data?.max_cursor ??
      null;

    const more =
      body.has_more ??
      body.data?.has_more ??
      false;

    hasMore = more === true || more === 1;

    if (!hasMore || nextCursor === null) {
      break;
    }

    if (String(nextCursor) === String(maxCursor)) {
      break;
    }

    maxCursor = nextCursor;
  }

  return {
    ok: true,
    route: "profile",
    sec_user_id: secUserId,
    profile,
    total_posts: posts.length,
    pages_fetched: page,
    posts
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return reply(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  const apiKey = process.env.TIKHUB_API_KEY;

  if (!apiKey) {
    return reply(res, 500, {
      ok: false,
      error: "TIKHUB_API_KEY is not configured"
    });
  }

  const url = req.query.url;
  const type = String(req.query.type || "auto").toLowerCase();

  if (!url) {
    return reply(res, 200, {
      ok: true,
      service: "Douyin Reader",
      status: "running",
      supported: ["video", "profile"],
      usage: {
        automatic: "/api?url=DOUYIN_URL",
        video: "/api?type=video&url=DOUYIN_URL",
        profile: "/api?type=profile&url=DOUYIN_URL"
      }
    });
  }

  try {
    if (type === "video") {
      const result = await fetchVideo(url, apiKey);
      return reply(res, result.ok ? 200 : 400, result);
    }

    if (type === "profile") {
      const result = await fetchProfile(url, apiKey);
      return reply(res, result.ok ? 200 : 400, result);
    }

    /*
      AUTO:
      First test whether the URL resolves to a user.
      If it does, treat it as a profile.
      Otherwise try it as a video.
    */

    const userTest = await resolveSecUserId(url, apiKey);

    if (userTest.ok) {
      const result = await fetchProfile(url, apiKey);
      return reply(res, result.ok ? 200 : 400, result);
    }

    const video = await fetchVideo(url, apiKey);

    if (video.ok) {
      return reply(res, 200, video);
    }

    return reply(res, 400, {
      ok: false,
      error: "Unable to resolve this Douyin URL as profile or video",
      profile_attempt: userTest.raw,
      video_attempt: video
    });

  } catch (error) {
    return reply(res, 500, {
      ok: false,
      error: "Douyin Reader failed",
      detail: error.message
    });
  }
}
