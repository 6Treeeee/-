import { PublicBrowserService } from "../src/services/public-browser.js";

export const config = { maxDuration: 45 };

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

function hostOf(value) {
  try { return new URL(value).hostname; } catch { return null; }
}

export default async function handler(req, res) {
  const id = String(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id ?? "");
  if (!/^\d{10,25}$/.test(id)) return res.status(400).json({ ok:false, error:"invalid_id" });

  const target = `https://www.iesdouyin.com/share/video/${id}`;
  const started = Date.now();

  try {
    const browser = new PublicBrowserService({
      navigationTimeoutMs: 20_000,
      protocolTimeoutMs: 30_000,
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 }
    });

    const result = await browser.withPage(async ({ page, runtime }) => {
      await page.setUserAgent(UA);
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

      const media = new Map();
      const apiResponses = [];
      page.on("response", (response) => {
        const url = response.url();
        const type = String(response.headers()["content-type"] ?? "").toLowerCase();
        if ((type.startsWith("video/") || type.startsWith("audio/") || /douyinvod|\.mp4|\.m3u8/i.test(url)) &&
            [200, 206].includes(response.status())) {
          media.set(url, { status: response.status(), type, host: hostOf(url) });
        }
        if (/aweme\/v1\/web\/aweme\/detail|iteminfo|share\/video/i.test(url)) {
          apiResponses.push({
            host: hostOf(url),
            path: (() => { try { return new URL(url).pathname; } catch { return null; } })(),
            status: response.status(),
            type
          });
        }
      });

      let navigationStatus = null;
      try {
        const response = await page.goto(target, { waitUntil:"domcontentloaded", timeout:20_000 });
        navigationStatus = response?.status?.() ?? null;
      } catch (error) {
        navigationStatus = `error:${String(error?.name ?? "navigation")}`;
      }

      const deadline = Date.now() + 12_000;
      let state = null;
      while (Date.now() < deadline) {
        state = await page.evaluate((expectedId) => {
          const visible = (element) => {
            if (!element) return false;
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" &&
              Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
          };
          const video = document.querySelector("video");
          const text = document.body?.innerText ?? "";
          return {
            url: location.href,
            title: document.title,
            canonical: document.querySelector("link[rel='canonical']")?.href ?? null,
            expected_id_present: document.documentElement?.innerHTML?.includes(expectedId) ?? false,
            video_present: Boolean(video),
            current_src: video?.currentSrc || video?.src || null,
            duration: Number.isFinite(video?.duration) ? video.duration : null,
            ready_state: video?.readyState ?? null,
            width: video?.videoWidth || null,
            height: video?.videoHeight || null,
            security_challenge: [
              "#captcha_container",
              "iframe[src*='captcha']",
              "iframe[src*='verify']",
              "[class*='captcha_container']"
            ].some((selector) => [...document.querySelectorAll(selector)].some(visible)) ||
              /安全验证|验证后继续|请完成(?:下列)?验证|拖动.{0,12}滑块/.test(text),
            login_required: /请先登录|登录后(?:才可|方可|即可|可)?(?:观看|查看)/.test(text)
          };
        }, id);
        if (state.video_present && (state.current_src || state.ready_state >= 2)) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      return {
        runtime,
        navigation_status: navigationStatus,
        state,
        media_count: media.size,
        media_hosts: [...new Set([...media.values()].map((item) => item.host).filter(Boolean))],
        api_responses: apiResponses.slice(-30)
      };
    });

    return res.status(200).json({ ok:true, elapsed_ms:Date.now()-started, ...result });
  } catch (error) {
    return res.status(200).json({
      ok:false,
      code:error?.code ?? "MOBILE_BROWSER_PROBE_FAILED",
      message:String(error?.message ?? error).slice(0,240),
      elapsed_ms:Date.now()-started
    });
  }
}
