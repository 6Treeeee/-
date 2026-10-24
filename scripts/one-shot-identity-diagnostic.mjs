import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { PublicBrowserService } from "../src/services/public-browser.js";

const awemeId = "7699751880649428250";
const browserService = new PublicBrowserService({
  env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview" },
  platform: "linux", navigationTimeoutMs: 30000, protocolTimeoutMs: 45000,
  viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
});
const provider = new DirectPublicWebProvider({
  browserService, retries: 1, retryDelayMs: 500,
  videoNavigationTimeoutMs: 30000,
  videoContentWaitMs: 10000,
  videoDetailTimeoutMs: 5000, videoDetailTotalTimeoutMs: 7000, settleMs: 700
});
const output = { probe: "single_identity_only", expected_id: awemeId };
const start = Date.now();
try {
  const result = await provider.readVideo({
    inputUrl: `https://www.douyin.com/video/${awemeId}`,
    resolvedUrl: `https://www.douyin.com/video/${awemeId}`,
    awemeId
  });
  output.status = "metadata_retrieved";
  output.observed_id = String(result.aweme?.aweme_id ?? result.aweme?.id ?? "");
  output.identity_match = output.observed_id === awemeId;
  output.attempts = result.meta?.attempts ?? null;
  output.identity_source = result.meta?.identity?.source ?? null;
  output.media_candidates = Array.isArray(result.networkMediaUrls) ? result.networkMediaUrls.length : 0;
} catch (error) {
  output.status = "failed";
  output.error_code = String(error?.code ?? "UNKNOWN").slice(0,70);
  const d = error?.details ?? {};
  output.failure_source = ["page_url","canonical","detail_response","live_player_page","metadata"].includes(d.source)
    ? d.source : null;
  output.observed_id = /^\d{15,22}$/.test(String(d.observed_aweme_id ?? "")) ? String(d.observed_aweme_id) : null;
}
output.elapsed_ms = Date.now()-start;
console.log("TREE_IDENTITY_RESULT", JSON.stringify(output));
