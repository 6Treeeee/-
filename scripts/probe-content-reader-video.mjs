import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { MediaResolver } from "../src/services/media.js";

const id = process.argv[2] || "7688672103729483058";
const url = `https://www.douyin.com/video/${id}`;

const browserService = new PublicBrowserService({
  executablePath: process.env.CHROME_PATH,
  navigationTimeoutMs: 45_000,
  protocolTimeoutMs: 60_000
});
const provider = new DirectPublicWebProvider({
  browserService,
  retries: 2,
  videoContentWaitMs: 22_000,
  settleMs: 700
});

const result = await provider.readVideo({
  inputUrl: url,
  resolvedUrl: url,
  awemeId: id
});

const aweme = result.aweme;
const mediaResolver = new MediaResolver({
  refreshVideo: async () => {
    const refreshed = await provider.readVideo({
      inputUrl: url,
      resolvedUrl: url,
      awemeId: id
    });
    return refreshed.aweme;
  },
  maxBytes: 100 * 1024 * 1024
});
const media = await mediaResolver.resolve(aweme);

const safeHost = (value) => {
  try { return new URL(value).hostname; } catch { return null; }
};

console.log(JSON.stringify({
  pass: String(aweme?.aweme_id ?? "") === id && Boolean(media?.url),
  aweme_id: aweme?.aweme_id ?? null,
  desc: aweme?.desc ?? null,
  duration: aweme?.video?.duration ?? aweme?.duration ?? null,
  provider: result.meta?.provider ?? null,
  method: result.meta?.method ?? null,
  browser: result.meta?.browser ?? null,
  attempts: result.meta?.attempts ?? null,
  network_media_count: result.meta?.network_media_count ?? null,
  network_media_hosts: result.meta?.network_media_hosts ?? [],
  observed_media_hosts: (result.networkMediaUrls ?? []).map(safeHost).filter(Boolean),
  resolved_media_host: safeHost(media?.url),
  resolved_media_type: media?.mediaType ?? media?.media_type ?? null,
  resolved_media_size: media?.diagnostics?.size ?? null
}, null, 2));
