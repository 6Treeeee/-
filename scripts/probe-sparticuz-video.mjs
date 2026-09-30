import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { MediaResolver } from "../src/services/media.js";

const id = process.argv[2] || "7688672103729483058";
const url = `https://www.douyin.com/video/${id}`;

const browserService = new PublicBrowserService({
  env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview" },
  platform: "linux",
  navigationTimeoutMs: 45_000,
  protocolTimeoutMs: 60_000,
  viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
});
const provider = new DirectPublicWebProvider({
  browserService,
  retries: 1,
  videoNavigationTimeoutMs: 45_000,
  videoContentWaitMs: 22_000,
  settleMs: 700
});

const result = await provider.readVideo({
  inputUrl: url,
  resolvedUrl: url,
  awemeId: id
});

const media = await new MediaResolver({
  refreshVideo: async () => (await provider.readVideo({
    inputUrl: url,
    resolvedUrl: url,
    awemeId: id
  })).aweme
}).resolve(result.aweme);

let host = null;
try { host = new URL(media.url).hostname; } catch {}

console.log(JSON.stringify({
  pass: String(result.aweme?.aweme_id ?? "") === id && Boolean(media?.url),
  aweme_id: result.aweme?.aweme_id ?? null,
  duration: result.aweme?.video?.duration ?? null,
  provider: result.meta?.provider ?? null,
  method: result.meta?.method ?? null,
  browser: result.meta?.browser ?? null,
  attempts: result.meta?.attempts ?? null,
  media_validated: Boolean(media?.url),
  media_host: host,
  media_type: media?.mediaType ?? media?.media_type ?? null,
  media_size: media?.diagnostics?.size ?? null
}, null, 2));
