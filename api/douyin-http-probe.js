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

function mediaUrlsFromItem(item) {
  const video = item?.video ?? {};
  const addresses = [
    video.play_addr,
    video.play_addr_h264,
    video.play_addr_265,
    video.play_addr_bytevc1,
    video.download_addr,
    video.download_suffix_logo_addr,
    ...(Array.isArray(video.bit_rate) ? video.bit_rate.flatMap((rate) => [
      rate?.play_addr,
      rate?.play_addr_265
    ]) : [])
  ];
  return [...new Set(addresses.flatMap((address) =>
    Array.isArray(address?.url_list) ? address.url_list : []
  ).filter((value) => /^https?:\/\//i.test(String(value ?? ""))))];
}

function findExactItems(root, expectedId) {
  const matches = [];
  const queue = [{ value: root, path: "$", depth: 0 }];
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 12000 && matches.length < 8) {
    const { value, path, depth } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    const id = String(value.aweme_id ?? value.awemeId ?? value.item_id ?? value.itemId ?? "");
    if (id === String(expectedId)) {
      const media = mediaUrlsFromItem(value);
      matches.push({
        path,
        keys: Object.keys(value).slice(0, 50),
        has_video: Boolean(value.video),
        video_keys: value.video && typeof value.video === "object"
          ? Object.keys(value.video).slice(0, 50) : [],
        desc: typeof value.desc === "string" ? value.desc.slice(0, 180) : null,
        duration: Number(value.video?.duration ?? value.duration ?? 0) || null,
        media_count: media.length,
        media_hosts: [...new Set(media.map((url) => {
          try { return new URL(url).hostname; } catch { return null; }
        }).filter(Boolean))]
      });
    }
    if (depth >= 10) continue;
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object") {
        queue.push({ value: child, path: `${path}.${key}`, depth: depth + 1 });
      }
    }
  }
  return matches;
}

function summarizeParsedState(root) {
  const urls = [];
  const keyPaths = [];
  const scalars = {};
  const queue = [{ value: root, path: "$", depth: 0 }];
  const seen = new Set();
  let visited = 0;
  while (queue.length && visited < 16000) {
    const { value, path, depth } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (/video|play|cover|duration|item|token|url/i.test(key) && keyPaths.length < 160) {
        keyPaths.push(childPath);
      }
      if (typeof child === "string") {
        if (/^https?:\/\//i.test(child) && urls.length < 80) {
          try {
            const parsed = new URL(child.replace(/\\u002F/g, "/"));
            urls.push({ host: parsed.hostname, path: parsed.pathname });
          } catch {}
        }
        if (/^(serverToken|itemId|appName|host|lastPath|renderInSSR)$/i.test(key)) {
          scalars[childPath] = key.toLowerCase().includes("token")
            ? { present: Boolean(child), length: child.length }
            : child.slice(0, 200);
        }
      } else if (typeof child === "number" || typeof child === "boolean") {
        if (/^(itemId|renderInSSR|duration)$/i.test(key)) scalars[childPath] = child;
      }
      if (depth < 11 && child && typeof child === "object") {
        queue.push({ value: child, path: childPath, depth: depth + 1 });
      }
    }
  }
  return {
    visited_objects: visited,
    media_like_key_paths: keyPaths,
    url_hosts_paths: [...new Map(urls.map((item) => [`${item.host}${item.path}`, item])).values()],
    selected_scalars: scalars
  };
}

function parseStateScripts(html, expectedId) {
  const scripts = [...String(html ?? "").matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .map((match, index) => ({ index, attrs: match[1] ?? "", text: match[2] ?? "" }))
    .filter((item) =>
      item.text.includes(String(expectedId)) ||
      /__INITIAL_STATE__|RENDER_DATA|UNIVERSAL_DATA_FOR_REHYDRATION|_ROUTER_DATA/.test(item.text)
    );

  return scripts.slice(0, 16).map((item) => {
    const rawCandidates = [item.text];
    try {
      const decoded = decodeURIComponent(item.text);
      if (decoded !== item.text) rawCandidates.push(decoded);
    } catch {}

    let parsed = null;
    let parse_mode = null;
    for (const raw of rawCandidates) {
      const candidates = [raw];
      const firstObject = raw.indexOf("{"), lastObject = raw.lastIndexOf("}");
      if (firstObject >= 0 && lastObject > firstObject) {
        candidates.push(raw.slice(firstObject, lastObject + 1));
      }
      for (const candidate of candidates) {
        try {
          parsed = JSON.parse(candidate);
          parse_mode = raw === item.text ? "json" : "decoded_json";
          break;
        } catch {}
      }
      if (parsed) break;
    }

    const idx = item.text.indexOf(String(expectedId));
    return {
      index: item.index,
      attrs: item.attrs.slice(0, 220),
      length: item.text.length,
      contains_expected_id: idx >= 0,
      json_parsed: Boolean(parsed),
      parse_mode,
      root_keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 50) : [],
      exact_items: parsed ? findExactItems(parsed, expectedId) : [],
      state_summary: parsed ? summarizeParsedState(parsed) : null
    };
  });
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
    },
    state_scripts: parseStateScripts(compact, expectedId)
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
