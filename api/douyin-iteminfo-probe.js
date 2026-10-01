export const config = { maxDuration: 30 };

const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function hostOf(value) {
  try { return new URL(value).hostname; } catch { return null; }
}

export default async function handler(req, res) {
  const id = String(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id ?? "");
  if (!/^\d{10,25}$/.test(id)) return res.status(400).json({ ok:false, error:"invalid_id" });
  const url = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(id)}`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": `https://www.iesdouyin.com/share/video/${id}`
      },
      redirect: "manual",
      signal: AbortSignal.timeout(12000)
    });
    const type = response.headers.get("content-type") || "";
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    const item = payload?.item_list?.[0] ?? null;
    const observedId = String(item?.aweme_id ?? item?.awemeId ?? "");
    const media = item?.video?.play_addr?.url_list?.[0] ?? item?.video?.download_addr?.url_list?.[0] ?? null;
    return res.status(200).json({
      ok: response.status === 200 && observedId === id && Boolean(media),
      http_status: response.status,
      content_type: type,
      body_prefix: payload ? null : text.slice(0,120),
      item_count: Array.isArray(payload?.item_list) ? payload.item_list.length : null,
      observed_aweme_id: observedId || null,
      expected_aweme_id: id,
      media_host: hostOf(media),
      media_present: Boolean(media)
    });
  } catch (error) {
    return res.status(200).json({
      ok:false,
      error:"legacy_iteminfo_fetch_failed",
      message:String(error?.message ?? "").slice(0,160)
    });
  }
}
