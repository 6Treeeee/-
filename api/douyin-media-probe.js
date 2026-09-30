import crypto from "node:crypto";

import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { normalizeVideo } from "../src/normalizers/douyin.js";
import { MediaResolver } from "../src/services/media.js";
import { PublicBrowserService } from "../src/services/public-browser.js";

export const config = { maxDuration: 60 };

function hostOf(value) {
  try { return new URL(value).hostname; } catch { return null; }
}

async function seek(page, target) {
  await page.evaluate(async (time) => {
    const video = document.querySelector("video");
    if (!video) throw new Error("NO_VIDEO");
    video.pause();
    if (Math.abs(video.currentTime - time) < 0.02 && video.readyState >= 2) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("SEEK_TIMEOUT")); }, 8000);
      const cleanup = () => { clearTimeout(timer); video.removeEventListener("seeked", done); };
      const done = () => { cleanup(); resolve(); };
      video.addEventListener("seeked", done, { once: true });
      video.currentTime = time;
    });
  }, target);
}

export default async function handler(req, res) {
  const id = String(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id ?? "");
  if (!/^\d{10,25}$/.test(id)) return res.status(400).json({ ok:false, error:"invalid_id" });
  let stage = "start";
  try {
    stage = "share_metadata";
    const provider = new DirectPublicWebProvider({
      fetchImpl: globalThis.fetch,
      browserService: { async withPage() { throw new Error("BROWSER_METADATA_PATH_FORBIDDEN"); } }
    });
    const retrieval = await provider.readVideo({
      inputUrl: `https://www.douyin.com/video/${id}`,
      resolvedUrl: `https://www.douyin.com/video/${id}`,
      awemeId: id
    });
    stage = "normalize";
    const video = normalizeVideo(retrieval.aweme, {
      inputUrl: `https://www.douyin.com/video/${id}`,
      resolvedUrl: `https://www.douyin.com/video/${id}`,
      acquiredAt: retrieval.meta.acquired_at
    });
    stage = "media_resolve";
    const media = await new MediaResolver({
      fetchImpl: globalThis.fetch,
      maxBytes: 100 * 1024 * 1024,
      timeoutMs: 12000,
      retries: 0
    }).resolve(video);

    stage = "browser_decode";
    const browser = new PublicBrowserService({ protocolTimeoutMs: 45000 });
    const decoded = await browser.withPage(async ({ page, runtime }) => {
      await page.setExtraHTTPHeaders({
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Referer: "https://www.douyin.com/"
      });
      await page.setContent("<!doctype html><html><body style='margin:0;background:#000'><video muted playsinline preload='auto' style='width:1280px;height:720px;object-fit:contain'></video></body></html>", { waitUntil:"domcontentloaded" });
      await page.evaluate((source) => {
        const video = document.querySelector("video");
        video.src = source; video.muted = true; video.preload = "auto"; video.load();
      }, media.url);
      await page.waitForFunction((expected) => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2 && v.videoWidth > 0 && Number.isFinite(v.duration) &&
          Math.abs(v.duration - expected) <= Math.max(3, expected * .02);
      }, { timeout: 20000 }, video.media.duration_ms / 1000);
      const duration = await page.evaluate(() => document.querySelector("video").duration);
      const targets = [0.5, duration / 2, Math.max(0.5, duration - 0.5)];
      const frames = [];
      for (const target of targets) {
        await seek(page, target);
        const image = await page.screenshot({ type:"jpeg", quality:45, clip:{x:0,y:0,width:1280,height:720}, captureBeyondViewport:false });
        frames.push({
          requested: +target.toFixed(3),
          actual: await page.evaluate(() => +document.querySelector("video").currentTime.toFixed(3)),
          sha256: crypto.createHash("sha256").update(image).digest("hex").slice(0,16),
          bytes: image.length
        });
      }
      return { runtime, duration, frames };
    });

    return res.status(200).json({
      ok:true,
      aweme_id:video.aweme_id,
      retrieval_method:retrieval.meta.method,
      duration_ms:video.media.duration_ms,
      media_host:hostOf(media.url),
      media_status:media.diagnostics?.status ?? null,
      media_size:media.diagnostics?.size ?? null,
      browser:decoded.runtime,
      decoded_duration_seconds:decoded.duration,
      frames:decoded.frames
    });
  } catch (error) {
    const safe = {
      event:"douyin_media_probe.failed",
      stage,
      code:error?.code ?? "PROBE_FAILED",
      message:String(error?.message ?? "").slice(0,200)
    };
    console.error(JSON.stringify(safe));
    return res.status(200).json({ ok:false, ...safe });
  }
}
