export const config = { maxDuration: 30 };

const USER_AGENTS = {
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"
};

function firstMatch(text, regex) {
  const match = String(text ?? "").match(regex);
  return match?.[1]?.trim() ?? null;
}

function summarize(text, type, expectedId) {
  const compact = String(text ?? "").slice(0, 2_000_000);
  const urls = [...compact.matchAll(/https?:\/\/[^"'<>\s]+/g)].map((match) => match[0]);
  const scriptHosts = [...compact.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .map((value) => {
      try { return new URL(value, "https://www.douyin.com").hostname; } catch { return null; }
    })
    .filter(Boolean);
  const mediaHosts = urls
    .filter((value) => /douyinvod|video|play_addr|playAddr|\.mp4|\.m3u8/i.test(value))
    .slice(0, 30)
    .map((value) => {
      try { return new URL(value.replace(/\\u002F/g, "/")).hostname; } catch { return null; }
    })
    .filter(Boolean);

  return {
    content_type: type || null,
    bytes: Buffer.byteLength(compact),
    contains_expected_id: compact.includes(String(expectedId)),
    contains_security: /安全验证|验证后继续|captcha|verify/i.test(compact),
    contains_login: /请先登录|登录后/.test(compact),
    has_initial_state: /__INITIAL_STATE__|RENDER_DATA|UNIVERSAL_DATA_FOR_REHYDRATION|_ROUTER_DATA/.test(compact),
    title: firstMatch(compact, /<title[^>]*>([^<]*)<\/title>/i),
    meta_description: firstMatch(compact, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i) ??
      firstMatch(compact, /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i),
    og_title: firstMatch(compact, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) ??
      firstMatch(compact, /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:title["']/i),
    og_video: firstMatch(compact, /<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']*)["']/i) ??
      firstMatch(compact, /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:video(?::url)?["']/i),
    canonical: firstMatch(compact, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) ??
      firstMatch(compact, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i),
    script_hosts: [...new Set(scriptHosts)].slice(0, 20),
    media_hosts: [...new Set(mediaHosts)],
    body_markers: {
      root: /id=["']root["']/.test(compact),
      video_tag: /<video\b/i.test(compact),
      json_ld: /application\/ld\+json/i.test(compact)
    }
  };
}

async function fetchSurface(url, uaName, ua, expectedId) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": ua,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      redirect: "manual",
      signal: AbortSignal.timeout(12000)
    });
    const body = await response.text();
    const parsed = new URL(url);
    return {
      ua: uaName,
      url: parsed.origin + parsed.pathname + parsed.search,
      status: response.status,
      location: response.headers.get("location"),
      ...summarize(body, response.headers.get("content-type"), expectedId),
      elapsed_ms: Date.now() - started
    };
  } catch (error) {
    const parsed = new URL(url);
    return {
      ua: uaName,
      url: parsed.origin + parsed.pathname + parsed.search,
      error: String(error?.message ?? error).slice(0, 160),
      elapsed_ms: Date.now() - started
    };
  }
}

export default async function handler(req, res) {
  const id = String(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id ?? "");
  if (!/^\d{10,25}$/.test(id)) {
    return res.status(400).json({ ok: false, error: "invalid_id" });
  }

  const urls = [
    `https://www.douyin.com/video/${id}`,
    `https://www.douyin.com/video/${id}?previous_page=app_code_link`,
    `https://www.iesdouyin.com/share/video/${id}`
  ];

  const results = [];
  for (const [uaName, ua] of Object.entries(USER_AGENTS)) {
    for (const url of urls) {
      results.push(await fetchSurface(url, uaName, ua, id));
    }
  }

  return res.status(200).json({
    ok: true,
    expected_aweme_id: id,
    results
  });
}
