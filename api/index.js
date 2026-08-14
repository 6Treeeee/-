const TIKHUB_BASE = "https://api.tikhub.io";

function reply(res, status, body) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

async function tikhub(path, params, apiKey) {
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") {
      qs.set(k, String(v));
    }
  }

  const r = await fetch(`${TIKHUB_BASE}${path}?${qs}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json"
    }
  });

  const text = await r.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    httpOk: r.ok,
    status: r.status,
    json
  };
}

function apiSucceeded(r) {
  if (!r?.httpOk) return false;

  const code = r?.json?.code;

  return (
    code === undefined ||
    code === null ||
    code === 0 ||
    code === 200
  );
}

function payload(r) {
  return r?.json?.data ?? null;
}

function findStringDeep(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(obj, key) &&
      obj[key] !== null &&
      obj[key] !== undefined &&
      String(obj[key]).length > 0
    ) {
      return String(obj[key]);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findStringDeep(value, keys, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

async function expandUrl(inputUrl) {
  try {
    const r = await fetch(inputUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
      }
    });

    return {
      ok: true,
      finalUrl: r.url || inputUrl,
      status: r.status
    };
  } catch (e) {
    return {
      ok: false,
      finalUrl: inputUrl,
      error: e.message
    };
  }
}

async function fetchVideo(shareUrl, apiKey) {
  const attempts = [];

  // 1. App V3 share URL
  let r = await tikhub(
    "/api/v1/douyin/app/v3/fetch_one_video_by_share_url",
    { share_url: shareUrl },
    apiKey
  );

  attempts.push({
    route: "app_v3_share",
    status: r.status,
    response: r.json
  });

  if (apiSucceeded(r) && payload(r)) {
    return {
      ok: true,
      type: "video",
      route: "app_v3_share",
      data: payload(r),
      raw: r.json
    };
  }

  // 2. Official Web fallback for share URLs
  r = await tikhub(
    "/api/v1/douyin/web/fetch_one_video_by_share_url",
    { share_url: shareUrl },
    apiKey
  );

  attempts.push({
    route: "web_share",
    status: r.status,
    response: r.json
  });

  if (apiSucceeded(r) && payload(r)) {
    return {
      ok: true,
      type: "video",
      route: "web_share",
      data: payload(r),
      raw: r.json
    };
  }

  return {
    ok: false,
    type: "video",
    error: "Both App V3 and Web video-share routes failed",
    attempts
  };
}

async function resolveSecUserId(profileUrl, apiKey) {
  const r = await tikhub(
    "/api/v1/douyin/web/get_sec_user_id",
    { url: profileUrl },
    apiKey
  );

  if (!apiSucceeded(r)) {
    return {
      ok: false,
      response: r.json
    };
  }

  const id = findStringDeep(
    r.json,
    ["sec_user_id", "sec_uid", "secUserId"]
  );

  if (!id) {
    return {
      ok: false,
      error: "TikHub responded but sec_user_id was not found",
      response: r.json
    };
  }

  return {
    ok: true,
    sec_user_id: id,
    response: r.json
  };
}

function extractPostPage(r) {
  const root = payload(r) ?? r?.json ?? {};

  let list = null;

  if (Array.isArray(root?.aweme_list)) {
    list = root.aweme_list;
  } else if (Array.isArray(root?.data?.aweme_list)) {
    list = root.data.aweme_list;
  } else if (Array.isArray(root?.list)) {
    list = root.list;
  } else if (Array.isArray(root?.data?.list)) {
    list = root.data.list;
  }

  const maxCursor =
    root?.max_cursor ??
    root?.data?.max_cursor ??
    null;

  const hasMore =
    root?.has_more ??
    root?.data?.has_more ??
    false;

  return {
    list: list || [],
    maxCursor,
    hasMore: hasMore === true || hasMore === 1
  };
}

async function fetchProfile(profileUrl, apiKey) {
  const idResult = await resolveSecUserId(profileUrl, apiKey);

  if (!idResult.ok) {
    return {
      ok: false,
      type: "profile",
      error: "Could not resolve sec_user_id",
      detail: idResult
    };
  }

  const secUserId = idResult.sec_user_id;

  const posts = [];
  const pageDebug = [];

  let cursor = 0;
  let page = 0;
  let hasMore = true;

  const MAX_PAGES = 100;

  while (hasMore && page < MAX_PAGES) {
    page++;

    // App V3 first
    let r = await tikhub(
      "/api/v1/douyin/app/v3/fetch_user_post_videos",
      {
        sec_user_id: secUserId,
        max_cursor: cursor,
        count: 20
      },
      apiKey
    );

    let route = "app_v3_posts";

    // Web fallback
    if (!apiSucceeded(r)) {
      r = await tikhub(
        "/api/v1/douyin/web/fetch_user_post_videos",
        {
          sec_user_id: secUserId,
          max_cursor: cursor,
          count: 20
        },
        apiKey
      );

      route = "web_posts";
    }

   
