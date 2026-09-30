import { readPublicContent } from "../src/content-reader.js";
import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { HardSubtitleOcr } from "../src/services/hard-subtitle-ocr.js";

const url = process.argv[2] || "https://www.douyin.com/video/7688672103729483058";
const id = url.match(/\/(?:video|note)\/(\d+)/)?.[1];
if (!id) throw new Error("A canonical Douyin video URL is required.");

const serverless = process.env.PROBE_SERVERLESS === "1";
const browserService = new PublicBrowserService({
  ...(serverless
    ? { env: { ...process.env, VERCEL: "1", VERCEL_ENV: "preview" }, platform: "linux" }
    : { executablePath: process.env.CHROME_PATH }),
  navigationTimeoutMs: 45_000,
  protocolTimeoutMs: 60_000,
  viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
});
const directProvider = new DirectPublicWebProvider({
  browserService,
  retries: 2,
  retryDelayMs: 500,
  videoNavigationTimeoutMs: 45_000,
  videoContentWaitMs: 22_000,
  settleMs: 700
});
const hardSubtitles = new HardSubtitleOcr({
  env: process.env,
  provider: directProvider,
  requestId: "ci-full-content"
});

const startedAt = Date.now();
const requestBudgetMs = Number(process.env.PROBE_REQUEST_BUDGET_MS ?? 1_400_000);
const deadlineAt = startedAt + requestBudgetMs;
const result = await readPublicContent({
  url,
  type: "video",
  fresh: true
}, {
  fetchImpl: globalThis.fetch,
  providers: [directProvider],
  hardSubtitleOcr: hardSubtitles.read.bind(hardSubtitles),
  localAsr: null,
  openAiApiKey: null,
  aiGatewayApiKey: null,
  vercelOidcToken: null,
  requestId: "ci-full-content",
  requestDeadlineAt: deadlineAt
});

const readable = result.content?.readable_content;
const segments = Array.isArray(readable?.segments) ? readable.segments : [];
const first = segments[0] ?? null;
const last = segments.at(-1) ?? null;
const durationMs = Number(result.content?.duration_ms ?? result.content?.media?.duration_ms ?? 0);
const coverageEnd = Number(readable?.source?.coverage?.end_ms ?? 0);
const elapsedMs = Date.now() - startedAt;
const fullCoverage = Boolean(
  readable?.status === "complete" &&
  readable?.method === "hard_subtitle_ocr" &&
  readable?.source?.fresh_capture === true &&
  readable?.source?.transcript_cache_read === false &&
  readable?.source?.coverage?.full_video_scanned === true &&
  durationMs > 0 &&
  coverageEnd >= durationMs - 1000 &&
  segments.length > 0
);

console.log(JSON.stringify({
  pass: fullCoverage,
  aweme_id: result.content?.aweme_id ?? result.content?.id ?? id,
  duration_ms: durationMs,
  readable_status: readable?.status ?? null,
  method: readable?.method ?? null,
  segment_count: segments.length,
  text_length: String(readable?.text ?? "").length,
  first_segment: first ? { start_ms: first.start_ms, end_ms: first.end_ms, text: first.text } : null,
  last_segment: last ? { start_ms: last.start_ms, end_ms: last.end_ms, text: last.text } : null,
  fresh_capture: readable?.source?.fresh_capture ?? null,
  transcript_cache_read: readable?.source?.transcript_cache_read ?? null,
  full_video_scanned: readable?.source?.coverage?.full_video_scanned ?? null,
  coverage_end_ms: coverageEnd,
  elapsed_ms: elapsedMs,
  request_budget_ms: requestBudgetMs,
  serverless_runtime: serverless,
  within_request_budget: elapsedMs < requestBudgetMs
}, null, 2));

if (!fullCoverage || elapsedMs >= requestBudgetMs) process.exitCode = 2;
