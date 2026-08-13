export default async function handler(req, res) {
  // 先确认 Vercel 函数本身能够正常运行
  if (req.method === "GET" && !req.query.url) {
    return res.status(200).json({
      ok: true,
      service: "TikHub Douyin Proxy",
      message: "Proxy is running"
    });
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  const douyinUrl = req.query.url;

  if (!douyinUrl) {
    return res.status(400).json({
      ok: false,
      error: "Missing Douyin URL"
    });
  }

  const apiKey = process.env.TIKHUB_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: "TIKHUB_API_KEY is not configured"
    });
  }

  try {
    const endpoint =
      "https://api.tikhub.io/api/v1/douyin/app/v3/fetch_one_video_by_share_url" +
      "?share_url=" +
      encodeURIComponent(douyinUrl);

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    const data = await response.json();

    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "TikHub request failed",
      detail: error.message
    });
  }
}
