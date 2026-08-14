const TIKHUB_BASE = "https://api.tikhub.io";

function reply(res, status, data) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

async function callTikHub(path, params, apiKey) {
  const query = new URLSearchParams(params);

  const response = await fetch(
    `${TIKHUB_BASE}${path}?${query.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    }
  );

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

  const douyinUrl = req.query.url;

  if (!douyinUrl) {
    return reply(res, 200, {
      ok: true,
      service: "Finance Tree Douyin Resolver",
      status: "running",
      usage: "/api?url=DOUYIN_SHARE_URL"
    });
  }

  try {
    const result = await callTikHub(
      "/api/v1/douyin/app/v3/fetch_one_video_by_share_url",
      {
        share_url: douyinUrl
      },
      apiKey
    );

    if (!result.ok) {
      return reply(res, result.status, {
        ok: false,
        input_url: douyinUrl,
        error: "TikHub failed to resolve the Douyin link",
        upstream: result.data
      });
    }

    return reply(res, 200, {
      ok: true,
      source: "douyin",
      input_url: douyinUrl,
      data: result.data
    });

  } catch (error) {
    return reply(res, 500, {
      ok: false,
      error: "Douyin resolver failed",
      detail: error.message
    });
  }
}
