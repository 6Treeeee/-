import { parseOfficialShareRouterData } from "../src/providers/direct-public-web.js";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export default async function handler(req, res) {
  const id = String(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id ?? "");
  if (!/^\d{10,25}$/.test(id)) {
    return res.status(400).json({ ok: false, error: "invalid_id" });
  }
  try {
    const response = await fetch(`https://www.iesdouyin.com/share/video/${id}`, {
      redirect: "follow",
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        "Accept": "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(15000)
    });
    const text = await response.text();
    const finalUrl = new URL(response.url);
    const safe = {
      host: finalUrl.hostname,
      path: finalUrl.pathname
    };
    const parsed = parseOfficialShareRouterData(text, id);
    return res.status(200).json({
      ok: true,
      upstream_status: response.status,
      final_url: safe,
      body_length: text.length,
      has_router_data: /window\._ROUTER_DATA\s*=/.test(text),
      has_target_id: text.includes(id),
      has_visible_security_text: /验证码|安全验证|完成验证|security verification/i.test(
        text.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      ),
      has_login_text: /扫码登录|登录抖音|Log in to Douyin/i.test(
        text.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      ),
      parser_exact_aweme: Boolean(parsed),
      parsed_aweme_id: parsed?.aweme_id ?? null,
      parsed_has_video: Boolean(parsed?.video)
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.name === "TimeoutError" ? "timeout" : "fetch_failed",
      message: String(error?.message ?? "").slice(0, 200)
    });
  }
}
