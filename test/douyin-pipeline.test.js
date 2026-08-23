import assert from "node:assert/strict";
import test from "node:test";

import { publicError, ReaderError } from "../src/errors.js";
import { DouyinReader, resolveDouyinUrl } from "../src/platforms/douyin.js";
import {
  detectsLoginRequiredText,
  detectsProfilePostsLoginBoundaryText,
  DirectPublicWebProvider
} from "../src/providers/direct-public-web.js";
import { paginateTikHubPosts, TikHubProvider } from "../src/providers/tikhub.js";
import { extractMp4Audio } from "../src/services/audio-extraction.js";
import { ContentProcessor } from "../src/services/content-processing.js";
import { ArtifactStore } from "../src/services/artifacts.js";
import { MediaResolver } from "../src/services/media.js";
import { ProviderChain, sanitizeDiagnostics } from "../src/services/provider-chain.js";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { TIKHUB_ROUTES } from "../src/services/tikhub.js";
import { TranscriptionService } from "../src/services/transcription.js";

const NOW = Date.parse("2026-08-15T04:00:00.000Z");

test("Sparticuz Chromium uses shell mode and the fresh default browser context", async () => {
  let createContextCalls = 0;
  let launchOptions;
  let defaultArgsInput;
  let closed = false;
  let executablePathCalls = 0;
  const page = {
    setDefaultNavigationTimeout() {},
    setDefaultTimeout() {},
    async setViewport() {},
    async setUserAgent() {},
    async setExtraHTTPHeaders() {}
  };
  const defaultContext = {
    async newPage() { return page; },
    async close() { throw new Error("the default context must not be closed directly"); }
  };
  const browser = {
    defaultBrowserContext() { return defaultContext; },
    async createBrowserContext() {
      createContextCalls += 1;
      return defaultContext;
    },
    async userAgent() { return "HeadlessChrome/149.0"; },
    async close() { closed = true; }
  };
  const service = new PublicBrowserService({
    env: { VERCEL: "1" },
    chromiumImpl: {
      args: ["--no-sandbox"],
      async executablePath() { executablePathCalls += 1; return "/tmp/chromium"; }
    },
    puppeteerImpl: {
      async defaultArgs(input) {
        defaultArgsInput = input;
        return [...input.args, "--puppeteer-default"];
      },
      async launch(options) {
        launchOptions = options;
        return browser;
      }
    }
  });

  await service.prepare();
  const runtime = await service.withPage(async ({ runtime: value }) => value);

  assert.equal(runtime.kind, "sparticuz_chromium");
  assert.equal(executablePathCalls, 1);
  assert.equal(service.chromiumImpl.setGraphicsMode, false);
  assert.equal(createContextCalls, 0);
  assert.deepEqual(defaultArgsInput, { args: ["--no-sandbox"], headless: "shell" });
  assert.equal(launchOptions.headless, "shell");
  assert.deepEqual(launchOptions.args, ["--no-sandbox", "--puppeteer-default"]);
  assert.equal(closed, true);
});

function aweme(id, overrides = {}) {
  return {
    aweme_id: String(id),
    desc: `video ${id}`,
    create_time: 1_723_680_000,
    author: {
      sec_uid: "MS4wLjABAAAApublic",
      nickname: "Public creator"
    },
    video: {
      duration: 12_000,
      width: 1080,
      height: 1920,
      play_addr: {
        url_list: [`https://media.example.test/${id}.mp4?token=temporary-${id}`]
      }
    },
    ...overrides
  };
}

function publicResolutionFetch() {
  return Promise.resolve(new Response("", {
    status: 200,
    headers: { "content-type": "text/html" }
  }));
}

function jsonResponse(url, body, { status = 200, headers = {} } = {}) {
  return {
    url: () => url,
    status: () => status,
    headers: () => ({ "content-type": "application/json", ...headers }),
    json: async () => body
  };
}

function mediaResponse(url, { status = 206, mediaType = "video/mp4" } = {}) {
  return {
    url: () => url,
    status: () => status,
    headers: () => ({ "content-type": mediaType })
  };
}

function fakeBrowserPage({
  responses = [],
  playbackResponses = [],
  videoDom = null,
  profileDom = null,
  resolutionDom = null,
  access = null,
  gotoError = null,
  evaluateErrors = [],
  currentUrl = "https://www.douyin.com/"
}) {
  const responseListeners = new Set();
  let listenerAttachedBeforeNavigation = false;
  let navigatedTo = null;
  let playbackPrimeCalls = 0;
  const pendingEvaluateErrors = [...evaluateErrors];
  const safeAccess = access ?? {
    explicitMoreGate: false,
    securityChallenge: false,
    privateContent: false,
    unavailable: false,
    loginRequired: false
  };

  const page = {
    on(event, listener) {
      if (event === "response") responseListeners.add(listener);
    },
    off(event, listener) {
      if (event === "response") responseListeners.delete(listener);
    },
    async goto(value) {
      navigatedTo = String(value);
      listenerAttachedBeforeNavigation = responseListeners.size > 0;
      for (const response of responses) {
        for (const listener of responseListeners) listener(response);
      }
      if (gotoError) throw gotoError;
      return { status: () => 200 };
    },
    url() {
      return currentUrl;
    },
    async evaluate(operation) {
      if (pendingEvaluateErrors.length) throw pendingEvaluateErrors.shift();
      const source = operation.toString();
      if (source.includes("document.documentElement && document.body")) return true;
      if (source.includes('video.preload = "auto"')) {
        playbackPrimeCalls += 1;
        for (const response of playbackResponses) {
          for (const listener of responseListeners) listener(response);
        }
        return true;
      }
      if (source.includes("durationSeconds")) {
        if (!videoDom) throw new Error("Unexpected video DOM snapshot");
        return videoDom;
      }
      if (source.includes("compactCount")) {
        if (!profileDom) throw new Error("Unexpected profile DOM snapshot");
        return profileDom;
      }
      if (source.includes("canonical: document.querySelector")) {
        if (!resolutionDom) throw new Error("Unexpected resolution DOM snapshot");
        return resolutionDom;
      }
      if (source.includes("visibleChallengeElement")) return safeAccess;
      if (source.includes("scrollIntoView")) return null;
      throw new Error(`Unexpected browser evaluate operation: ${source.slice(0, 80)}`);
    }
  };

  return {
    page,
    browserService: {
      async withPage(operation) {
        return operation({ page, runtime: { kind: "injected-test-browser" } });
      }
    },
    listenerWasAttached: () => listenerAttachedBeforeNavigation,
    navigatedTo: () => navigatedTo,
    playbackPrimeCalls: () => playbackPrimeCalls
  };
}

function validationResponse({ status = 206, mediaType = "video/mp4", totalSize = 128 } = {}) {
  return new Response(new Uint8Array([1]), {
    status,
    headers: {
      "content-type": mediaType,
      "content-range": `bytes 0-0/${totalSize}`
    }
  });
}

function completedTranscript(text, method = "test_asr") {
  return {
    status: "complete",
    text,
    segments: [{ start_ms: 0, end_ms: 1_000, text }],
    language: "zh",
    method,
    confidence: null,
    limitations: [],
    source: { type: "asr", provider: "test" }
  };
}

test("TikHub HTTP 402 falls through ProviderChain/DouyinReader to the direct provider", async () => {
  const routes = [];
  const tikhub = new TikHubProvider({
    client: {
      async get(route) {
        routes.push(route);
        throw new ReaderError("UPSTREAM_HTTP_ERROR", "TikHub rejected the request.", {
          status: 502,
          details: {
            route,
            http_status: 402,
            authorization: "Bearer tikhub-secret"
          }
        });
      }
    }
  });
  let directCalls = 0;
  const direct = {
    id: "direct_public_web",
    available: true,
    async readVideo() {
      directCalls += 1;
      return {
        aweme: aweme("7670118101211453413"),
        networkMediaUrls: [
          "https://cdn.example.test/7670118101211453413.mp4?signature=secret"
        ],
        meta: { provider: "direct_public_web", method: "injected_public_browser" }
      };
    }
  };

  const reader = new DouyinReader({
    providers: [tikhub, direct],
    fetchImpl: publicResolutionFetch,
    processContent: false
  });
  const result = await reader.read({
    url: "https://www.douyin.com/video/7670118101211453413"
  });

  assert.equal(result.content.aweme_id, "7670118101211453413");
  assert.equal(result.source.provider_attempts[0].provider, "tikhub");
  assert.equal(result.source.provider_attempts[0].status, "failed");
  assert.equal(result.source.provider_attempts[1].provider, "direct_public_web");
  assert.equal(result.source.provider_attempts[1].status, "success");
  assert.deepEqual(routes, [TIKHUB_ROUTES.videoApp, TIKHUB_ROUTES.videoWeb]);
  assert.equal(directCalls, 1);
  assert.doesNotMatch(JSON.stringify(result.source.provider_attempts), /tikhub-secret/);
});

test("DouyinReader reserves a bounded retrieval window when local ASR is available", () => {
  const defaultDirect = new DirectPublicWebProvider({ browserService: {} });
  assert.equal(defaultDirect.videoNavigationTimeoutMs, null);

  const reader = new DouyinReader({
    apiKey: "configured-tikhub-key",
    localAsr: async () => ({ text: "local" }),
    processContent: false
  });

  const tikhub = reader.chain.get("tikhub");
  const direct = reader.chain.get("direct_public_web");
  assert.equal(tikhub.client.timeoutMs, 6_000);
  assert.equal(tikhub.client.retries, 0);
  assert.equal(direct.videoNavigationTimeoutMs, 15_000);
  assert.equal(direct.videoContentWaitMs, 15_000);
  assert.equal(direct.retries, 1);
});

test("DouyinReader starts cold browser preparation while the first video provider runs", async () => {
  let prepareCalls = 0;
  const direct = {
    id: "direct_public_web",
    available: true,
    async prepare() { prepareCalls += 1; },
    async readVideo() { throw new Error("TikHub succeeds in this timing test"); }
  };
  const reader = new DouyinReader({
    providers: [{
      id: "tikhub",
      available: true,
      async readVideo() {
        assert.equal(prepareCalls, 1);
        return { aweme: aweme("7669061012259179785") };
      }
    }, direct],
    localAsr: async () => ({ text: "local" }),
    processContent: false
  });

  const result = await reader.read({
    url: "https://www.douyin.com/video/7669061012259179785",
    type: "video"
  });
  assert.equal(result.content.aweme_id, "7669061012259179785");
  assert.equal(prepareCalls, 1);
});

test("resolveDouyinUrl retries transient public redirect failures", async () => {
  let calls = 0;
  const result = await resolveDouyinUrl(
    "https://v.douyin.com/public-short/",
    async () => {
      calls += 1;
      if (calls < 3) return new Response("", { status: 503 });
      if (calls === 3) {
        return new Response("", {
          status: 302,
          headers: { location: "https://www.douyin.com/video/7670118101211453413" }
        });
      }
      return new Response("", { status: 200 });
    },
    { retryDelayMs: 0, sleepImpl: async () => {} }
  );

  assert.equal(calls, 4);
  assert.equal(result.finalUrl, "https://www.douyin.com/video/7670118101211453413");
  assert.equal(result.resolved, true);
  assert.equal(result.hops[0].attempts, 3);
});

test("resolveDouyinUrl does not refetch an already stable canonical video URL", async () => {
  let calls = 0;
  const value = "https://www.douyin.com/video/7669061012259179785";
  const result = await resolveDouyinUrl(value, async () => {
    calls += 1;
    throw new Error("canonical URLs must not spend the request budget on duplicate HTML fetches");
  });

  assert.equal(calls, 0);
  assert.equal(result.finalUrl, value);
  assert.equal(result.resolved, false);
  assert.deepEqual(result.hops, []);
});

test("DirectPublicWebProvider resolves content type in an ordinary public browser", async () => {
  const fake = fakeBrowserPage({
    resolutionDom: {
      url: "https://www.douyin.com/video/7670118101211453413",
      canonical: "https://www.douyin.com/video/7670118101211453413"
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    settleMs: 0
  });

  const result = await provider.resolveContent({
    inputUrl: "https://v.douyin.com/public-short/"
  });

  assert.equal(result.contentType, "video");
  assert.equal(result.finalUrl, "https://www.douyin.com/video/7670118101211453413");
  assert.equal(result.meta.method, "public_unauthenticated_browser_resolution");
});

test("DirectPublicWebProvider resolves a public profile route before enforcing its post-login boundary", async () => {
  const profileUrl = "https://www.douyin.com/user/public-gated-user";
  const fake = fakeBrowserPage({
    resolutionDom: { url: profileUrl, canonical: profileUrl },
    access: {
      explicitMoreGate: true,
      profilePostsBoundaryText: "登录后免费畅享高清视频",
      securityChallenge: false,
      privateContent: false,
      unavailable: false,
      loginRequired: true
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    settleMs: 0
  });

  const result = await provider.resolveContent({ inputUrl: "https://v.douyin.com/public-profile/" });

  assert.equal(result.contentType, "profile");
  assert.equal(result.finalUrl, profileUrl);
});

test("DouyinReader uses browser resolution when a short URL remains unknown", async () => {
  let browserResolutionCalls = 0;
  const direct = {
    id: "direct_public_web",
    available: true,
    async resolveContent() {
      browserResolutionCalls += 1;
      return {
        finalUrl: "https://www.douyin.com/video/7670118101211453413",
        contentType: "video",
        meta: { provider: "direct_public_web", method: "test_browser_resolution" }
      };
    },
    async readVideo() {
      return { aweme: aweme("7670118101211453413"), meta: { provider: "direct_public_web" } };
    }
  };
  const reader = new DouyinReader({
    providers: [direct],
    fetchImpl: publicResolutionFetch,
    processContent: false
  });

  const result = await reader.read({
    url: "https://v.douyin.com/public-short/",
    type: "auto"
  });

  assert.equal(browserResolutionCalls, 1);
  assert.equal(result.content_type, "video");
  assert.equal(result.content.aweme_id, "7670118101211453413");
  assert.equal(result.source.resolution.browser_fallback.method, "test_browser_resolution");
});

test("DirectPublicWebProvider returns captured public video metadata and media", async () => {
  const id = "7670118101211453413";
  const publicMedia = `https://v3-dy-o.douyinvod.com/${id}.mp4?x-expires=999&signature=temporary`;
  const detailUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}`;
  const fake = fakeBrowserPage({
    responses: [
      jsonResponse(detailUrl, { aweme_detail: aweme(id) }),
      mediaResponse(publicMedia)
    ],
    videoDom: {
      canonical: `https://www.douyin.com/video/${id}`,
      title: "A public video - 抖音",
      description: "Public description",
      media: [publicMedia],
      durationSeconds: 12,
      width: 1080,
      height: 1920,
      hydration: []
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0
  });

  const result = await provider.readVideo({ awemeId: id });

  assert.equal(result.aweme.aweme_id, id);
  assert.deepEqual(result.networkMediaUrls, [publicMedia]);
  assert.deepEqual(result.meta.endpoints_observed, ["/aweme/v1/web/aweme/detail/"]);
  assert.deepEqual(result.meta.network_media_hosts, ["v3-dy-o.douyinvod.com"]);
  assert.equal(result.meta.method, "public_unauthenticated_browser");
  assert.equal(result.meta.attempts, 1);
  assert.equal(fake.listenerWasAttached(), true);
});

test("DirectPublicWebProvider survives a transient execution-context navigation race", async () => {
  const id = "7670118101211453413";
  const publicMedia = `https://v3-dy-o.douyinvod.com/${id}.mp4`;
  const contextRace = new Error("Execution context was destroyed, most likely because of a navigation.");
  const fake = fakeBrowserPage({
    responses: [
      jsonResponse(`https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}`, {
        aweme_detail: aweme(id)
      }),
      mediaResponse(publicMedia)
    ],
    evaluateErrors: [contextRace],
    videoDom: {
      canonical: `https://www.douyin.com/video/${id}`,
      title: "A public video - 抖音",
      description: "Public description",
      media: [publicMedia],
      durationSeconds: 12,
      width: 1080,
      height: 1920,
      hydration: []
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0
  });

  const result = await provider.readVideo({ awemeId: id });

  assert.equal(result.aweme.aweme_id, id);
  assert.equal(result.meta.attempts, 1);
});

test("DirectPublicWebProvider ignores lookalike API and play responses from non-Douyin hosts", async () => {
  const id = "7670118101211453413";
  const domMedia = `https://v3-dy-o.douyinvod.com/${id}.mp4?signature=public-page`;
  const fake = fakeBrowserPage({
    responses: [
      jsonResponse(
        `https://untrusted.example/aweme/v1/web/aweme/detail/?aweme_id=${id}`,
        { aweme_detail: aweme(id, { desc: "untrusted injected metadata" }) }
      ),
      mediaResponse(`https://untrusted.example/aweme/v1/play/?video_id=${id}`)
    ],
    videoDom: {
      canonical: `https://www.douyin.com/video/${id}`,
      title: "Public DOM title - 抖音",
      description: "Public DOM description",
      media: [domMedia],
      durationSeconds: 12,
      width: 1080,
      height: 1920,
      hydration: []
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0
  });

  const result = await provider.readVideo({ awemeId: id });

  assert.equal(result.aweme.desc, "Public DOM title");
  assert.deepEqual(result.networkMediaUrls, [domMedia]);
  assert.deepEqual(result.meta.endpoints_observed, []);
  assert.deepEqual(result.meta.network_media_hosts, []);
});

test("DirectPublicWebProvider accepts usable play_addr media when the browser does not autoplay", async () => {
  const id = "7670118101211453413";
  const embeddedMedia = `https://v3-dy-o.douyinvod.com/${id}.mp4?signature=detail-response`;
  const fake = fakeBrowserPage({
    responses: [jsonResponse(
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}`,
      { aweme_detail: aweme(id, {
        video: {
          duration: 12_000,
          play_addr: { url_list: [embeddedMedia] }
        }
      }) }
    )],
    videoDom: {
      canonical: `https://www.douyin.com/video/${id}`,
      title: "Public metadata",
      description: "Public description",
      media: [],
      durationSeconds: null,
      width: null,
      height: null,
      hydration: []
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    videoContentWaitMs: 1_500,
    settleMs: 0
  });

  const startedAt = Date.now();
  const result = await provider.readVideo({ awemeId: id });

  assert.equal(result.aweme.aweme_id, id);
  assert.deepEqual(result.aweme.video.play_addr.url_list, [embeddedMedia]);
  assert.deepEqual(result.networkMediaUrls, []);
  assert.equal(result.meta.network_media_count, 0);
  assert.ok(Date.now() - startedAt < 1_000);
});

test("DirectPublicWebProvider primes ordinary muted playback once to expose public media", async () => {
  const id = "7670118101211453413";
  const publicMedia = `https://v3-dy-o.douyinvod.com/${id}.mp4?signature=playback`;
  const fake = fakeBrowserPage({
    playbackResponses: [
      jsonResponse(`https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${id}`, {
        aweme_detail: aweme(id)
      }),
      mediaResponse(publicMedia)
    ],
    videoDom: {
      canonical: `https://www.douyin.com/video/${id}`,
      title: "Public metadata",
      description: "Public description",
      media: [],
      videoPresent: true,
      durationSeconds: null,
      width: null,
      height: null,
      hydration: []
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    videoContentWaitMs: 1_500,
    settleMs: 0
  });

  const result = await provider.readVideo({ awemeId: id });

  assert.equal(fake.playbackPrimeCalls(), 1);
  assert.equal(result.aweme.aweme_id, id);
  assert.deepEqual(result.networkMediaUrls, [publicMedia]);
});

test("paginateTikHubPosts stops only when the public upstream is exhausted", async () => {
  const cursors = [];
  const client = {
    async get(route, params) {
      cursors.push(params.max_cursor);
      if (params.max_cursor === "0") {
        return {
          data: { aweme_list: [aweme("1"), aweme("2")], has_more: 1, max_cursor: "20" },
          meta: { request_id: "page-1" }
        };
      }
      return {
        data: { aweme_list: [aweme("2"), aweme("3")], has_more: 0, max_cursor: "40" },
        meta: { request_id: "page-2" }
      };
    }
  };

  const result = await paginateTikHubPosts(client, {
    secUserId: "public-user",
    route: TIKHUB_ROUTES.postsWeb,
    provider: "test_web"
  });

  assert.deepEqual(cursors, ["0", "20"]);
  assert.equal(result.exhausted, true);
  assert.equal(result.pages.length, 2);
  assert.deepEqual(result.items.map((item) => item.aweme_id), ["1", "2", "2", "3"]);
  assert.equal(result.pages.at(-1).has_more, false);
});

test("paginateTikHubPosts rejects a repeated cursor", async () => {
  const client = {
    async get() {
      return {
        data: { aweme_list: [aweme("1")], has_more: 1, max_cursor: "0" },
        meta: { request_id: "loop" }
      };
    }
  };

  await assert.rejects(
    paginateTikHubPosts(client, {
      secUserId: "public-user",
      route: TIKHUB_ROUTES.postsWeb,
      provider: "test_web"
    }),
    (error) => error?.code === "DOUYIN_CURSOR_LOOP" && error?.details?.cursor === "0"
  );
});

test("paginateTikHubPosts rejects has_more without a next cursor", async () => {
  const client = {
    async get() {
      return {
        data: { aweme_list: [aweme("1")], has_more: 1 },
        meta: { request_id: "missing" }
      };
    }
  };

  await assert.rejects(
    paginateTikHubPosts(client, {
      secUserId: "public-user",
      route: TIKHUB_ROUTES.postsWeb,
      provider: "test_web"
    }),
    (error) => error?.code === "DOUYIN_CURSOR_MISSING"
  );
});

test("TikHubProvider deduplicates overlapping profile pages", async () => {
  const client = {
    async get(route, params) {
      if (route === TIKHUB_ROUTES.profileApp) {
        return {
          data: {
            user: {
              sec_uid: "public-user",
              nickname: "Creator",
              aweme_count: 3
            }
          },
          meta: { request_id: "profile" }
        };
      }
      if (route === TIKHUB_ROUTES.postsApp && params.max_cursor === "0") {
        return {
          data: { aweme_list: [aweme("1"), aweme("2")], has_more: 1, max_cursor: "20" },
          meta: { request_id: "page-1" }
        };
      }
      if (route === TIKHUB_ROUTES.postsApp && params.max_cursor === "20") {
        return {
          data: { aweme_list: [aweme("2"), aweme("3")], has_more: 0, max_cursor: "40" },
          meta: { request_id: "page-2" }
        };
      }
      throw new Error(`Unexpected TikHub route ${route}`);
    }
  };

  const result = await new TikHubProvider({ client }).readProfile({ secUserId: "public-user" });

  assert.deepEqual(result.items.map((item) => item.aweme_id), ["1", "2", "3"]);
  assert.equal(result.pagination.unique_posts, 3);
  assert.equal(result.pagination.duplicates_removed, 1);
  assert.equal(result.pagination.pages_fetched, 2);
  assert.equal(result.pagination.complete, true);
});

test("DirectPublicWebProvider records the explicit login-for-more public boundary", async () => {
  const profileDom = {
    listPresent: true,
    links: [
      { id: "100", kind: "video", title: "First public post" },
      { id: "101", kind: "video", title: "Second public post" }
    ],
    explicitMoreGate: true,
    pageTitle: "Creator的抖音",
    description: "A public creator",
    creator: {
      nickname: "Creator",
      signature: "Public signature",
      aweme_count: 3,
      aweme_count_text: "3"
    }
  };
  const access = {
    explicitMoreGate: true,
    securityChallenge: false,
    privateContent: false,
    unavailable: false,
    loginRequired: false
  };
  const fake = fakeBrowserPage({ profileDom, access });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0,
    maxScrollRounds: 1
  });

  const result = await provider.readProfile({ secUserId: "public-user" });

  assert.deepEqual(result.items.map((item) => item.aweme_id), ["100", "101"]);
  assert.equal(result.pagination.complete, true);
  assert.equal(result.pagination.public_access_exhausted, true);
  assert.equal(result.pagination.upstream_exhausted, false);
  assert.equal(result.pagination.stop_reason, "login_required_for_more");
  assert.equal(result.limitation.code, "LOGIN_REQUIRED_FOR_MORE_POSTS");
  assert.equal(result.limitation.public_items, 2);
  assert.equal(result.limitation.inaccessible_count, 1);
});

test("a profile-wide login gate preserves visible creator metadata and a zero-post public boundary", async () => {
  const profileDom = {
    listPresent: false,
    links: [],
    explicitMoreGate: true,
    profilePostsBoundaryText: "登录后免费畅享高清视频",
    pageTitle: "南飞的彦（业务看主页）的抖音",
    description: "南飞的彦（业务看主页）的公开主页",
    creator: {
      nickname: "南飞的彦（业务看主页）",
      signature: null,
      aweme_count: 27,
      aweme_count_text: "27"
    }
  };
  const access = {
    explicitMoreGate: true,
    profilePostsBoundaryText: "登录后免费畅享高清视频",
    securityChallenge: false,
    privateContent: false,
    unavailable: false,
    loginRequired: true
  };
  const fake = fakeBrowserPage({ profileDom, access });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0,
    maxScrollRounds: 1
  });
  const reader = new DouyinReader({ providers: [provider], processContent: false });

  const result = await reader.read({
    url: "https://www.douyin.com/user/public-gated-user",
    type: "profile"
  });

  assert.equal(result.content.creator.display_name, "南飞的彦（业务看主页）");
  assert.deepEqual(result.content.posts, []);
  assert.equal(result.content.pagination.complete, true);
  assert.equal(result.content.pagination.scope, "public_unauthenticated");
  assert.equal(result.content.pagination.public_access_exhausted, true);
  assert.equal(result.content.pagination.upstream_exhausted, false);
  assert.equal(result.content.pagination.stopped_by_access_boundary, true);
  assert.equal(result.content.pagination.stop_reason, "login_required_for_posts");
  assert.equal(result.content.pagination.expected_posts, 27);
  assert.equal(result.content.pagination.unique_posts, 0);
  assert.equal(result.content.pagination.profile_count_gap, 27);
  assert.equal(result.content.pagination.count_consistent, false);
  assert.equal(result.content.limitation.code, "LOGIN_REQUIRED_FOR_MORE_POSTS");
  assert.equal(result.content.limitation.public_items, 0);
  assert.equal(result.content.limitation.inaccessible_count, 27);
  assert.equal(result.content.limitation.message, "登录后免费畅享高清视频");
});

test("a profile login gate without trustworthy public metadata remains a terminal login boundary", async () => {
  const fake = fakeBrowserPage({
    profileDom: {
      listPresent: false,
      links: [],
      explicitMoreGate: true,
      profilePostsBoundaryText: "登录后免费畅享高清视频",
      pageTitle: "抖音",
      description: null,
      creator: {
        nickname: null,
        signature: null,
        aweme_count: null,
        aweme_count_text: null
      }
    },
    access: {
      explicitMoreGate: true,
      profilePostsBoundaryText: "登录后免费畅享高清视频",
      securityChallenge: false,
      privateContent: false,
      unavailable: false,
      loginRequired: false
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0,
    maxScrollRounds: 1
  });

  await assert.rejects(
    provider.readProfile({ resolvedUrl: "https://www.douyin.com/user/public-gated-user" }),
    (error) => error?.code === "DOUYIN_LOGIN_REQUIRED" && error?.status === 422
  );
});

test("DirectPublicWebProvider recovers when DOM is readable after navigation timeout", async () => {
  const timeout = new Error("Navigation timeout of 35000 ms exceeded");
  timeout.name = "TimeoutError";
  const profileDom = {
    listPresent: true,
    links: [{ id: "100", kind: "video", title: "Public post" }],
    explicitMoreGate: true,
    pageTitle: "Creator的抖音",
    description: "A public creator",
    creator: {
      nickname: "Creator",
      signature: "Public signature",
      aweme_count: 2,
      aweme_count_text: "2"
    }
  };
  const fake = fakeBrowserPage({
    profileDom,
    gotoError: timeout,
    currentUrl: "https://www.douyin.com/user/public-user",
    access: {
      explicitMoreGate: true,
      securityChallenge: false,
      privateContent: false,
      unavailable: false,
      loginRequired: false
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0,
    maxScrollRounds: 1
  });

  const result = await provider.readProfile({ secUserId: "public-user" });

  assert.deepEqual(result.items.map((item) => item.aweme_id), ["100"]);
  assert.equal(result.limitation.code, "LOGIN_REQUIRED_FOR_MORE_POSTS");
});

test("DirectPublicWebProvider makes a third bounded attempt for transient browser failures", async () => {
  const provider = new DirectPublicWebProvider({
    browserService: {},
    retryDelayMs: 0
  });
  let calls = 0;

  const result = await provider.runWithRetry(async () => {
    calls += 1;
    if (calls < 3) {
      throw new ReaderError("DOUYIN_PUBLIC_WEB_TRANSIENT", "Temporary public browser failure.", {
        status: 502
      });
    }
    return { meta: { provider: "direct_public_web" } };
  }, "https://www.douyin.com/video/1234567890123456789");

  assert.equal(calls, 3);
  assert.equal(result.meta.attempts, 3);
});

test("DirectPublicWebProvider prefers Douyin's resolved public share-profile route", async () => {
  const profileDom = {
    listPresent: true,
    links: [{ id: "100", kind: "video", title: "Public post" }],
    explicitMoreGate: true,
    pageTitle: "Creator的抖音",
    description: "A public creator",
    creator: {
      nickname: "Creator",
      signature: "Public signature",
      aweme_count: 2,
      aweme_count_text: "2"
    }
  };
  const fake = fakeBrowserPage({
    profileDom,
    access: {
      explicitMoreGate: true,
      securityChallenge: false,
      privateContent: false,
      unavailable: false,
      loginRequired: false
    }
  });
  const provider = new DirectPublicWebProvider({
    browserService: fake.browserService,
    retries: 0,
    contentWaitMs: 0,
    settleMs: 0,
    maxScrollRounds: 1
  });

  await provider.readProfile({
    resolvedUrl: "https://www.iesdouyin.com/share/user/public-user?token=tracking-secret",
    secUserId: "public-user"
  });

  assert.equal(fake.navigatedTo(), "https://www.iesdouyin.com/share/user/public-user");
});

test("MediaResolver refreshes an invalid current URL using the stable aweme_id", async () => {
  const oldUrl = "https://old-media.example.test/video.mp4?token=old-secret";
  const newUrl = "https://new-media.example.test/audio.mp3?token=new-secret";
  const calls = [];
  const refreshCalls = [];
  const resolver = new MediaResolver({
    now: () => NOW,
    maxAgeMs: 60_000,
    retries: 0,
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, range: init.headers.Range });
      if (url === oldUrl) return new Response("", { status: 403 });
      if (url === newUrl) return validationResponse({ mediaType: "audio/mpeg" });
      throw new Error(`Unexpected URL ${url}`);
    },
    refreshVideo: async (awemeId) => {
      refreshCalls.push(awemeId);
      return {
        aweme_id: awemeId,
        media: {
          acquired_at: "2026-08-15T04:00:00.000Z",
          audio_only: [{ url: newUrl, media_type: "audio/mpeg" }]
        }
      };
    }
  });

  const source = await resolver.resolve({
    aweme_id: "42",
    media: {
      acquired_at: "2026-08-15T03:59:30.000Z",
      playback: [{ url: oldUrl }]
    }
  });

  assert.deepEqual(refreshCalls, ["42"]);
  assert.deepEqual(calls.map((item) => item.url), [oldUrl, newUrl]);
  assert.ok(calls.every((item) => item.range === "bytes=0-0"));
  assert.equal(source.url, newUrl);
  assert.equal(source.kind, "audio");
  assert.equal(source.acquired_at, "2026-08-15T04:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(source.diagnostics), /old-secret|new-secret|\?/);
});

test("MediaResolver refreshes stale media before trying the expired URL", async () => {
  const oldUrl = "https://old-media.example.test/video.mp4?expires=1";
  const newUrl = "https://new-media.example.test/video.mp4?expires=2";
  const calls = [];
  let refreshedId = null;
  const resolver = new MediaResolver({
    now: () => NOW,
    maxAgeMs: 60_000,
    retries: 0,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === oldUrl) throw new Error("stale URL should not be attempted after successful refresh");
      return validationResponse();
    },
    refreshVideo: async (awemeId) => {
      refreshedId = awemeId;
      return {
        aweme_id: awemeId,
        media: {
          acquired_at: "2026-08-15T04:00:00.000Z",
          playback: [{ url: newUrl }]
        }
      };
    }
  });

  const source = await resolver.resolve({
    aweme_id: "99",
    media: {
      acquired_at: "2026-08-15T02:00:00.000Z",
      playback: [{ url: oldUrl }]
    }
  });

  assert.equal(refreshedId, "99");
  assert.deepEqual(calls, [newUrl]);
  assert.equal(source.url, newUrl);
});

test("MediaResolver never uses stale media after a terminal public access restriction", async () => {
  let staleFetches = 0;
  const resolver = new MediaResolver({
    now: () => NOW,
    maxAgeMs: 60_000,
    retries: 0,
    fetchImpl: async () => {
      staleFetches += 1;
      return validationResponse();
    },
    refreshVideo: async () => {
      throw new ReaderError("DOUYIN_PRIVATE_CONTENT", "This video is now private.", {
        status: 422
      });
    }
  });

  await assert.rejects(
    resolver.resolve({
      aweme_id: "now-private",
      media: {
        acquired_at: "2026-08-15T02:00:00.000Z",
        playback: [{ url: "https://media.example.test/stale.mp4" }]
      }
    }),
    (error) => error?.code === "DOUYIN_PRIVATE_CONTENT"
  );
  assert.equal(staleFetches, 0);
});

test("direct public access detection recognizes login-after-viewing wording", () => {
  assert.equal(detectsLoginRequiredText("登录后即可观看完整视频"), true);
  assert.equal(detectsLoginRequiredText("请先登录"), true);
  assert.equal(detectsLoginRequiredText("登录后可获得更多推荐"), false);
  assert.equal(detectsProfilePostsLoginBoundaryText("登录后查看更多作品"), true);
  assert.equal(detectsProfilePostsLoginBoundaryText("登录后免费畅享高清视频"), true);
  assert.equal(detectsProfilePostsLoginBoundaryText("登录后 免费畅享 高清视频"), true);
  assert.equal(detectsProfilePostsLoginBoundaryText("登录后可获得更多推荐"), false);
});

test("MediaResolver sends browser-compatible public headers for validation and download", async () => {
  const requests = [];
  const url = "https://v3-dy-o.douyinvod.com/public.mp4?signature=temporary";
  const resolver = new MediaResolver({
    now: () => NOW,
    retries: 0,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      if (init.headers.Range) return validationResponse();
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "3" }
      });
    }
  });
  const source = await resolver.resolve({
    aweme_id: "headers",
    media: {
      acquired_at: "2026-08-15T04:00:00.000Z",
      playback: [{
        url,
        headers: {
          Cookie: "must-not-forward",
          Authorization: "Bearer must-not-forward"
        }
      }]
    }
  });
  const media = await resolver.fetch(source);

  assert.equal(media.bytes.byteLength, 3);
  assert.equal(requests.length, 2);
  for (const { init } of requests) {
    assert.equal(init.headers.Referer, "https://www.douyin.com/");
    assert.match(init.headers.Accept, /video\/mp4/);
    assert.match(init.headers["User-Agent"], /Chrome\//);
    assert.equal(init.headers.Cookie, undefined);
    assert.equal(init.headers.Authorization, undefined);
  }
  assert.equal(requests[0].init.headers.Range, "bytes=0-0");
  assert.equal(requests[1].init.headers.Range, undefined);
});

test("MediaResolver prefers a duration-matched public creator original-sound MP3", async () => {
  const requests = [];
  const resolver = new MediaResolver({
    retries: 0,
    now: () => NOW,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(new Uint8Array([1]), {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-range": "bytes 0-0/876664"
        }
      });
    }
  });

  const source = await resolver.resolve({
    aweme_id: "original-sound-video",
    acquired_at: new Date(NOW).toISOString(),
    media: {
      duration_ms: 54_720,
      playback: [{ url: "https://video.example.test/full.mp4", media_type: "video/mp4" }]
    },
    music: {
      title: "@公开作者创作的原声",
      duration_ms: 54_000,
      play_urls: ["https://music.douyinstatic.com/original.mp3?token=expiring"]
    }
  });

  assert.equal(source.kind, "audio");
  assert.equal(source.mediaType, "audio/mpeg");
  assert.match(requests[0].url, /original\.mp3/);
  assert.doesNotMatch(JSON.stringify(source.diagnostics), /expiring/);
});

test("MediaResolver never substitutes unrelated music for the spoken video track", async () => {
  const requested = [];
  const resolver = new MediaResolver({
    retries: 0,
    now: () => NOW,
    fetchImpl: async (url) => {
      requested.push(String(url));
      return new Response(new Uint8Array([1]), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-0/1000"
        }
      });
    }
  });

  const source = await resolver.resolve({
    aweme_id: "background-music-video",
    acquired_at: new Date(NOW).toISOString(),
    media: {
      duration_ms: 60_000,
      playback: [{ url: "https://video.example.test/full.mp4", media_type: "video/mp4" }]
    },
    music: {
      title: "Background track",
      duration_ms: 180_000,
      play_urls: ["https://music.example.test/wrong.mp3"]
    }
  });

  assert.equal(source.kind, "video");
  assert.equal(requested.length, 1);
  assert.match(requested[0], /full\.mp4/);
});

test("TranscriptionService prefers real subtitle tracks and preserves timestamps", async () => {
  const vtt = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:03.250",
    "第一句话",
    "",
    "00:00:04.000 --> 00:00:06.500",
    "第二句话"
  ].join("\n");
  const mediaResolver = {
    async resolve() {
      throw new Error("media resolver must not run when subtitles are usable");
    },
    async fetch() {
      throw new Error("media fetch must not run when subtitles are usable");
    }
  };
  const service = new TranscriptionService({
    mediaResolver,
    retries: 0,
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    fetchImpl: async () => new Response(vtt, {
      status: 200,
      headers: { "content-type": "text/vtt" }
    })
  });

  const result = await service.read({
    aweme_id: "subtitle-video",
    captions: {
      tracks: [{
        id: "zh-1",
        url: "https://captions.example.test/subtitle.vtt?token=temporary",
        format: "vtt",
        language_code: "zh-CN",
        source: "douyin"
      }]
    }
  });

  assert.equal(result.status, "complete");
  assert.equal(result.method, "captions");
  assert.equal(result.language, "zh-CN");
  assert.equal(result.text, "第一句话\n第二句话");
  assert.deepEqual(result.segments, [
    { start_ms: 1_000, end_ms: 3_250, text: "第一句话" },
    { start_ms: 4_000, end_ms: 6_500, text: "第二句话" }
  ]);
  assert.doesNotMatch(JSON.stringify(result.source), /temporary/);
});

test("TranscriptionService falls back from OpenAI failure to Vercel AI Gateway", async () => {
  const calls = [];
  const source = {
    url: "https://media.example.test/audio.mp3?token=signed",
    kind: "audio",
    mediaType: "audio/mpeg",
    acquired_at: "2026-08-15T04:00:00.000Z",
    diagnostics: { host: "media.example.test", url_hash: "safe" }
  };
  const service = new TranscriptionService({
    retries: 0,
    mediaResolver: {
      async resolve() {
        return source;
      },
      async fetch() {
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "audio/mpeg",
          source: { host: "media.example.test", url_hash: "safe" }
        };
      }
    },
    openAiApiKey: "openai-test-secret",
    aiGatewayApiKey: "gateway-test-secret",
    vercelOidcToken: null,
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("api.openai.com")) {
        assert.equal(init.headers.Authorization, "Bearer openai-test-secret");
        return Response.json({ error: { message: "billing" } }, { status: 402 });
      }
      assert.equal(url, "https://ai-gateway.vercel.sh/v4/ai/transcription-model");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer gateway-test-secret");
      assert.equal(headers.get("ai-gateway-protocol-version"), "0.0.1");
      assert.equal(headers.get("ai-gateway-auth-method"), "api-key");
      return Response.json({
        text: "网关转写成功",
        language: "zh",
        segments: [{ startSecond: 0, endSecond: 1.25, text: "网关转写成功" }]
      });
    }
  });

  const result = await service.read({ aweme_id: "gateway-video", captions: { tracks: [] } });

  assert.equal(result.status, "complete");
  assert.equal(result.method, "vercel_ai_gateway_openai_gpt_4o_mini_transcribe");
  assert.equal(result.source.provider, "vercel_ai_gateway");
  assert.deepEqual(result.segments, [
    { start_ms: 0, end_ms: 1_250, text: "网关转写成功" }
  ]);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /openai-test-secret|gateway-test-secret|signed/);
});

test("TranscriptionService identifies Vercel OIDC authentication to AI Gateway", async () => {
  const service = new TranscriptionService({
    retries: 0,
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: "oidc-test-secret",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://ai-gateway.vercel.sh/v4/ai/transcription-model");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("authorization"), "Bearer oidc-test-secret");
      assert.equal(headers.get("ai-gateway-protocol-version"), "0.0.1");
      assert.equal(headers.get("ai-gateway-auth-method"), "oidc");
      return Response.json({ text: "OIDC 网关转写成功", language: "zh", segments: [] });
    }
  });

  const result = await service._gateway({
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: "audio/mpeg",
    source: { host: "media.example.test", url_hash: "safe" }
  });

  assert.equal(result.status, "complete");
  assert.equal(result.text, "OIDC 网关转写成功");
  assert.doesNotMatch(JSON.stringify(result), /oidc-test-secret/);
});

test("TranscriptionService falls back between current Gateway transcription models", async () => {
  const models = [];
  const service = new TranscriptionService({
    retries: 0,
    openAiApiKey: null,
    aiGatewayApiKey: "gateway-model-fallback-secret",
    vercelOidcToken: null,
    gatewayFactory: ({ apiKey }) => {
      assert.equal(apiKey, "gateway-model-fallback-secret");
      return {
        transcriptionModel(modelId) {
          models.push(modelId);
          return {
            async doGenerate() {
              if (modelId === "openai/gpt-4o-mini-transcribe") {
                const error = new Error("provider body token=must-not-leak");
                error.statusCode = 403;
                error.type = "forbidden";
                error.ruleId = "model-access-policy";
                error.responseBody = '{"token":"must-not-leak"}';
                throw error;
              }
              return {
                text: "后备模型转写成功",
                language: "zh",
                segments: [{ startSecond: 0, endSecond: 1.5, text: "后备模型转写成功" }]
              };
            }
          };
        }
      };
    }
  });

  const result = await service._gateway({
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: "audio/mpeg",
    source: { host: "media.example.test", url_hash: "safe" }
  });

  assert.deepEqual(models, ["openai/gpt-4o-mini-transcribe", "openai/whisper-1"]);
  assert.equal(result.method, "vercel_ai_gateway_openai_whisper_1");
  assert.equal(result.source.model, "openai/whisper-1");
  assert.deepEqual(result.source.model_attempts, [{
    model: "openai/gpt-4o-mini-transcribe",
    code: "ASR_PROVIDER_ERROR",
    http_status: 403,
    error_type: "forbidden",
    rule_id: "model-access-policy"
  }]);
  assert.doesNotMatch(JSON.stringify(result), /gateway-model-fallback-secret|must-not-leak|responseBody/);
});

test("TranscriptionService exposes only safe per-model Gateway failure diagnostics", async () => {
  const service = new TranscriptionService({
    retries: 0,
    openAiApiKey: null,
    aiGatewayApiKey: "gateway-all-fail-secret",
    vercelOidcToken: null,
    mediaResolver: {
      async resolve() {
        return { url: "https://media.example.test/audio.mp3", kind: "audio", mediaType: "audio/mpeg" };
      },
      async fetch() {
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "audio/mpeg",
          source: { host: "media.example.test", url_hash: "safe" }
        };
      }
    },
    gatewayFactory: () => ({
      transcriptionModel(modelId) {
        return {
          async doGenerate() {
            const error = new Error(`secret provider message for ${modelId}`);
            error.statusCode = modelId.includes("mini") ? 403 : 404;
            error.type = modelId.includes("mini") ? "forbidden" : "model_not_found";
            if (modelId.includes("mini")) error.ruleId = "blocked-model-rule";
            error.responseBody = JSON.stringify({
              error: { type: "body-secret", message: "body-token" },
              authorization: "Bearer response-authorization-secret"
            });
            error.requestBodyValues = { token: "request-token" };
            throw error;
          }
        };
      }
    })
  });

  await assert.rejects(
    service.read({ aweme_id: "gateway-all-fail", captions: { tracks: [] } }),
    (error) => {
      assert.equal(error.code, "TRANSCRIPTION_UNAVAILABLE");
      assert.deepEqual(error.details.attempts, [{
        method: "vercel_ai_gateway",
        code: "ASR_PROVIDER_ERROR",
        http_status: 404,
        model_attempts: [
          {
            model: "openai/gpt-4o-mini-transcribe",
            code: "ASR_PROVIDER_ERROR",
            http_status: 403,
            error_type: "forbidden",
            rule_id: "blocked-model-rule"
          },
          {
            model: "openai/whisper-1",
            code: "ASR_PROVIDER_ERROR",
            http_status: 404,
            error_type: "model_not_found"
          }
        ]
      }]);
      assert.doesNotMatch(
        JSON.stringify(error),
        /gateway-all-fail-secret|secret provider message|body-secret|body-token|response-authorization-secret|request-token|responseBody|requestBodyValues/
      );
      return true;
    }
  );
});

test("TranscriptionService extracts only allowlisted diagnostics from the SDK access_denied body", async () => {
  let calls = 0;
  const service = new TranscriptionService({
    retries: 2,
    retryDelayMs: 0,
    openAiApiKey: null,
    aiGatewayApiKey: "gateway-test-secret",
    vercelOidcToken: null,
    gatewayModel: "openai/whisper-1",
    fetchImpl: async () => {
      calls += 1;
      return Response.json({
        error: {
          type: "access_denied",
          message: "account secret detail that must not be exposed",
          param: {
            ruleId: "team-entitlement-policy",
            token: "nested-body-secret"
          }
        },
        authorization: "Bearer outer-body-secret"
      }, { status: 403 });
    }
  });

  await assert.rejects(
    service._gateway({
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "audio/mpeg",
      source: { host: "media.example.test", url_hash: "safe" }
    }),
    (error) => {
      assert.equal(error.code, "ASR_PROVIDER_ERROR");
      assert.deepEqual(error.details, {
        provider: "vercel_ai_gateway",
        http_status: 403,
        model_attempts: [{
          model: "openai/whisper-1",
          code: "ASR_PROVIDER_ERROR",
          http_status: 403,
          error_type: "access_denied",
          rule_id: "team-entitlement-policy"
        }]
      });
      assert.doesNotMatch(
        JSON.stringify(error),
        /gateway-test-secret|account secret detail|nested-body-secret|outer-body-secret|responseBody/
      );
      return true;
    }
  );
  assert.equal(calls, 1);
});

test("TranscriptionService retries a transient Gateway failure once", async () => {
  let calls = 0;
  const service = new TranscriptionService({
    retries: 1,
    retryDelayMs: 0,
    sleepImpl: async () => {},
    openAiApiKey: null,
    aiGatewayApiKey: "gateway-test-secret",
    vercelOidcToken: null,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({
          error: { type: "internal_server_error", message: "temporary" }
        }, { status: 503 });
      }
      return Response.json({ text: "重试后成功", language: "zh", segments: [] });
    }
  });

  const result = await service._gateway({
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: "audio/mpeg",
    source: { host: "media.example.test", url_hash: "safe" }
  });

  assert.equal(result.text, "重试后成功");
  assert.equal(calls, 2);
});

test("TranscriptionService demuxes public MP4 audio before hosted ASR", async () => {
  const originalBytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
  const audioMp4Bytes = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  let extractionCalls = 0;
  const service = new TranscriptionService({
    retries: 0,
    openAiApiKey: null,
    aiGatewayApiKey: "gateway-test-secret",
    vercelOidcToken: null,
    mediaResolver: {
      async resolve() {
        return { url: "https://media.example.test/video.mp4", kind: "video", mediaType: "video/mp4" };
      },
      async fetch() {
        return {
          bytes: originalBytes,
          mediaType: "video/mp4",
          source: { host: "media.example.test", url_hash: "safe" }
        };
      }
    },
    audioExtractor: async (bytes) => {
      extractionCalls += 1;
      assert.equal(bytes, originalBytes);
      return {
        bytes: audioMp4Bytes,
        mediaType: "audio/mp4",
        method: "mp4_aac_remux",
        codec: "mp4a.40.2",
        sampleRate: 44_100,
        channelCount: 2,
        inputBytes: originalBytes.byteLength,
        outputBytes: audioMp4Bytes.byteLength
      };
    },
    fetchImpl: async (_input, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.mediaType, "audio/mp4");
      assert.deepEqual(new Uint8Array(Buffer.from(request.audio, "base64")), audioMp4Bytes);
      return Response.json({
        text: "提取后转写成功",
        language: "zh",
        segments: [{ startSecond: 0, endSecond: 1, text: "提取后转写成功" }]
      });
    }
  });

  const result = await service.read({ aweme_id: "mp4-video", captions: { tracks: [] } });

  assert.equal(extractionCalls, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.source.media.audio_extraction.method, "mp4_aac_remux");
  assert.equal(result.source.media.audio_extraction.input_bytes, 6);
  assert.equal(result.source.media.audio_extraction.output_bytes, 12);
  assert.doesNotMatch(JSON.stringify(result), /gateway-test-secret/);
});

test("TranscriptionService safely falls back when MP4 audio demux is unsupported", async () => {
  const originalBytes = new Uint8Array([4, 5, 6]);
  const service = new TranscriptionService({
    retries: 0,
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    fetchImpl: async () => {
      throw new Error("No hosted provider should be called");
    },
    mediaResolver: {
      async resolve() {
        return { url: "https://media.example.test/video.mp4", kind: "video", mediaType: "video/mp4" };
      },
      async fetch() {
        return {
          bytes: originalBytes,
          mediaType: "video/mp4",
          source: { host: "media.example.test", url_hash: "safe" }
        };
      }
    },
    audioExtractor: async () => {
      throw new ReaderError("AUDIO_EXTRACTION_UNSUPPORTED_CODEC", "unsupported", {
        status: 422,
        details: { source_url: "https://secret.example.test/?token=must-not-leak" }
      });
    },
    localAsr: async ({ bytes, mediaType }) => {
      assert.equal(bytes, originalBytes);
      assert.equal(mediaType, "video/mp4");
      return { text: "原始媒体仍可转写", language: "zh", segments: [] };
    }
  });

  const result = await service.read({ aweme_id: "unsupported-audio", captions: { tracks: [] } });

  assert.equal(result.status, "complete");
  assert.ok(result.limitations.includes("audio_extraction_unavailable"));
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|secret\.example/);
});

test("built-in MP4 audio extractor rejects empty media with a stable safe code", async () => {
  await assert.rejects(
    extractMp4Audio(new Uint8Array()),
    (error) => error instanceof ReaderError && error.code === "AUDIO_EXTRACTION_EMPTY_INPUT"
  );
});

test("built-in MP4 audio extractor rejects malformed media without parser data leakage", async () => {
  await assert.rejects(
    extractMp4Audio(new Uint8Array([1, 2, 3, 4])),
    (error) => {
      assert.equal(error.code, "AUDIO_EXTRACTION_EMPTY_RESULT");
      assert.equal(error.status, 422);
      assert.doesNotMatch(JSON.stringify(error), /stack|fileStart|ArrayBuffer/);
      return true;
    }
  );
});

function mockMp4AudioFile(track, {
  initialization = [1, 2],
  segment = [3, 4, 5],
  container = {}
} = {}) {
  return {
    setSegmentOptions(id, _user, options) {
      assert.equal(id, track.id);
      assert.equal(options.rapAlignement, false);
    },
    initializeSegmentation(mode) {
      assert.equal(mode, "per-track");
      return [{ id: track.id, buffer: Uint8Array.from(initialization).buffer }];
    },
    start() {
      this.onSegment(track.id, null, Uint8Array.from(segment).buffer, 1, true);
    },
    appendBuffer() {
      this.onReady({ ...container, audioTracks: [track] });
    },
    flush() {}
  };
}

test("built-in MP4 audio extractor preserves valid MPEG-4 object type 63 and track duration", async () => {
  const track = {
    id: 7,
    codec: "mp4a.40.63",
    duration: 52_920,
    timescale: 1_000,
    audio: { sample_rate: 48_000, channel_count: 6 }
  };

  const result = await extractMp4Audio(new Uint8Array([9]), {
    createFileImpl: () => mockMp4AudioFile(track)
  });

  assert.equal(result.codec, "mp4a.40.63");
  assert.equal(result.sampleRate, 48_000);
  assert.equal(result.channelCount, 6);
  assert.equal(result.durationMs, 52_920);
  assert.equal(result.mediaType, "audio/mp4");
  assert.equal(result.outputBytes, 5);
  assert.deepEqual(result.bytes, new Uint8Array([1, 2, 3, 4, 5]));
});

test("built-in MP4 audio extractor uses movie duration for fragmented audio tracks", async () => {
  const track = {
    id: 9,
    codec: "mp4a.40.2",
    duration: 0,
    timescale: 48_000,
    audio: { sample_rate: 48_000, channel_count: 2 }
  };

  const result = await extractMp4Audio(new Uint8Array([9]), {
    createFileImpl: () => mockMp4AudioFile(track, {
      container: { movie_duration: 92_648, movie_timescale: 1_000 }
    })
  });

  assert.equal(result.durationMs, 92_648);
});

test("built-in MP4 audio extractor rejects MPEG-4 object types above 63", async () => {
  const track = {
    id: 8,
    codec: "mp4a.40.64",
    duration: 1_000,
    timescale: 1_000,
    audio: { sample_rate: 44_100, channel_count: 2 }
  };

  await assert.rejects(
    extractMp4Audio(new Uint8Array([9]), {
      createFileImpl: () => mockMp4AudioFile(track)
    }),
    (error) => {
      assert.equal(error.code, "AUDIO_EXTRACTION_UNSUPPORTED_CODEC");
      assert.equal(error.details.codec, "mp4a.40.64");
      return true;
    }
  );
});

test("TranscriptionService uses injected local ASR when hosted credentials are absent", async () => {
  let localCalls = 0;
  const requestDeadlineAt = Date.now() + 285_000;
  const service = new TranscriptionService({
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    requestDeadlineAt,
    retries: 0,
    fetchImpl: async () => {
      throw new Error("No hosted provider should be called");
    },
    mediaResolver: {
      async resolve() {
        return { url: "https://media.example.test/a.mp3", kind: "audio", mediaType: "audio/mpeg" };
      },
      async fetch() {
        return {
          bytes: new Uint8Array([8, 9]),
          mediaType: "audio/mpeg",
          source: { host: "media.example.test", url_hash: "safe" }
        };
      }
    },
    localAsr: async ({ bytes, mediaType, video, deadlineAt }) => {
      localCalls += 1;
      assert.equal(bytes.byteLength, 2);
      assert.equal(mediaType, "audio/mpeg");
      assert.equal(video.aweme_id, "local-video");
      assert.equal(deadlineAt, requestDeadlineAt);
      return {
        text: "本地转写成功",
        language: "zh",
        confidence: 0.91,
        segments: [{ start_ms: 0, end_ms: 2_000, text: "本地转写成功" }]
      };
    }
  });

  const result = await service.read({ aweme_id: "local-video", captions: { tracks: [] } });

  assert.equal(localCalls, 1);
  assert.equal(result.status, "complete");
  assert.equal(result.method, "local_asr");
  assert.equal(result.confidence, 0.91);
  assert.equal(result.source.provider, "local");
});

test("TranscriptionService preserves retryable local ASR queue backpressure", async () => {
  const service = new TranscriptionService({
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    mediaResolver: {
      async resolve() {
        return { url: "https://media.example.test/a.mp3", kind: "audio", mediaType: "audio/mpeg" };
      },
      async fetch() {
        return {
          bytes: new Uint8Array([8, 9]),
          mediaType: "audio/mpeg",
          source: { host: "media.example.test", url_hash: "safe" }
        };
      }
    },
    localAsr: async () => {
      throw new ReaderError("LOCAL_ASR_BUSY", "The local speech-to-text queue is full.", {
        status: 503,
        details: { stage: "queue", reason: "full" }
      });
    }
  });

  await assert.rejects(
    () => service.read({ aweme_id: "busy-video", captions: { tracks: [] } }),
    (error) => {
      assert.equal(error.code, "LOCAL_ASR_BUSY");
      assert.equal(error.status, 503);
      assert.deepEqual(error.details, { stage: "queue", reason: "full" });
      return true;
    }
  );
});

test("TranscriptionService reserves request time for local ASR after hosted Gateway failure", () => {
  const withLocalFallback = new TranscriptionService({
    localAsr: async () => ({ text: "local" })
  });
  assert.equal(withLocalFallback.gatewayTimeoutMs, 4_000);
  assert.equal(withLocalFallback.gatewayRetries, 0);

  const hostedOnly = new TranscriptionService({ timeoutMs: 42_000, retries: 2 });
  assert.equal(hostedOnly.gatewayTimeoutMs, 42_000);
  assert.equal(hostedOnly.gatewayRetries, 2);
});

test("ContentProcessor preserves public captions across a transient media validation failure", async () => {
  let resolveCalls = 0;
  let fetchCalls = 0;
  const processor = new ContentProcessor({
    artifactStore: { transcriptFor: async () => null },
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    fetchImpl: async () => {
      throw new Error("inline captions must not make a network request");
    },
    mediaResolverFactory: () => ({
      async resolve() {
        resolveCalls += 1;
        throw new ReaderError("MEDIA_NETWORK_ERROR", "The CDN was temporarily unavailable.", {
          status: 502,
          details: { source_url: "https://media.example.test/a.mp4?token=must-not-leak" }
        });
      },
      async fetch() {
        fetchCalls += 1;
        throw new Error("caption success must not fetch the media body");
      }
    })
  });

  const result = await processor.processVideo({
    aweme_id: "caption-transient-media",
    media: {},
    captions: {
      tracks: [{
        source: "douyin",
        language_code: "zh",
        format: "vtt",
        content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n字幕仍然可读"
      }]
    }
  });

  assert.equal(resolveCalls, 1);
  assert.equal(fetchCalls, 0);
  assert.equal(result.readable_content.status, "complete");
  assert.equal(result.readable_content.method, "captions");
  assert.equal(result.readable_content.text, "字幕仍然可读");
  assert.ok(result.readable_content.limitations.includes("media_validation_unavailable"));
  assert.equal(result.media.resolved.validation.status, "unavailable");
  assert.equal(result.media.resolved.validation.code, "MEDIA_NETWORK_ERROR");
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|media\.example\.test/);
});

test("ContentProcessor never serves captions across a terminal media restriction", async () => {
  let resolveCalls = 0;
  const processor = new ContentProcessor({
    artifactStore: { transcriptFor: async () => null },
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    fetchImpl: async () => {
      throw new Error("inline captions must not make a network request");
    },
    mediaResolverFactory: () => ({
      async resolve() {
        resolveCalls += 1;
        throw new ReaderError("DOUYIN_PRIVATE_CONTENT", "The video is now private.", {
          status: 422
        });
      }
    })
  });

  await assert.rejects(
    processor.processVideo({
      aweme_id: "caption-now-private",
      media: {},
      captions: {
        tracks: [{
          format: "vtt",
          content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n旧字幕"
        }]
      }
    }),
    (error) => error instanceof ReaderError && error.code === "DOUYIN_PRIVATE_CONTENT"
  );
  assert.equal(resolveCalls, 1);
});

test("TranscriptionService preserves a terminal media restriction before ASR", async () => {
  const service = new TranscriptionService({
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    mediaResolver: {
      async resolve() {
        throw new ReaderError("DOUYIN_LOGIN_REQUIRED", "Login is required for this media.", {
          status: 422
        });
      },
      async fetch() {
        throw new Error("terminal resolution must stop before media fetch");
      }
    }
  });

  await assert.rejects(
    service.read({ aweme_id: "login-required", captions: { tracks: [] } }),
    (error) => error instanceof ReaderError && error.code === "DOUYIN_LOGIN_REQUIRED"
  );
});

test("ContentProcessor resolves and fetches ASR media exactly once", async () => {
  let resolveCalls = 0;
  let fetchCalls = 0;
  let asrCalls = 0;
  const resolvedSource = {
    url: "https://media.example.test/audio.mp3",
    kind: "audio",
    mediaType: "audio/mpeg",
    acquired_at: "2026-08-22T10:00:00.000Z",
    validated_at: "2026-08-22T10:00:01.000Z",
    diagnostics: { host: "media.example.test", status: 206, size: 321 }
  };
  const processor = new ContentProcessor({
    artifactStore: { transcriptFor: async () => null },
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    mediaResolverFactory: () => ({
      async resolve(video) {
        resolveCalls += 1;
        assert.equal(video.aweme_id, "single-resolve-asr");
        return resolvedSource;
      },
      async fetch(source) {
        fetchCalls += 1;
        assert.equal(source, resolvedSource);
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "audio/mpeg",
          source: { host: "media.example.test", status: 200, size: 3 }
        };
      }
    }),
    localAsr: async ({ bytes, mediaType }) => {
      asrCalls += 1;
      assert.equal(bytes.byteLength, 3);
      assert.equal(mediaType, "audio/mpeg");
      return completedTranscript("只解析一次", "local_asr");
    }
  });

  const result = await processor.processVideo({
    aweme_id: "single-resolve-asr",
    media: {},
    captions: { tracks: [] }
  });

  assert.equal(resolveCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.equal(asrCalls, 1);
  assert.equal(result.readable_content.status, "complete");
  assert.equal(result.readable_content.method, "local_asr");
  assert.equal(result.media.resolved.validation.status, 206);
  assert.equal(result.readable_content.media_resolution.validation.status, 206);
});

test("ContentProcessor isolates a single-video content-reading failure", async () => {
  const processor = new ContentProcessor({
    artifactStore: { transcriptFor: async () => null },
    mediaResolverFactory: () => ({
      async resolve() {
        throw new ReaderError("MEDIA_UNAVAILABLE", "No public media", {
          status: 422,
          details: { authorization: "Bearer media-secret" }
        });
      }
    }),
    transcriptionFactory: ({ mediaResolver }) => ({
      async read(video) {
        await mediaResolver.resolve(video);
        throw new Error("unreachable after media failure");
      }
    })
  });

  const result = await processor.processVideo({ aweme_id: "broken" }, { isolateFailure: true });

  assert.equal(result.aweme_id, "broken");
  assert.equal(result.readable_content.status, "failed");
  assert.equal(result.readable_content.error.code, "MEDIA_UNAVAILABLE");
  assert.equal(result.readable_content.error.details.authorization, "[redacted]");
  assert.doesNotMatch(JSON.stringify(result), /media-secret/);
});

test("ContentProcessor continues profile-wide processing when one video fails", async () => {
  const processor = new ContentProcessor({
    profileConcurrency: 2,
    artifactStore: { transcriptFor: async () => null },
    mediaResolverFactory: () => ({
      async resolve(video) {
        if (video.aweme_id === "2") {
          throw new ReaderError("MEDIA_UNAVAILABLE", "No usable public media", { status: 422 });
        }
        return {
          url: `https://media.example.test/${video.aweme_id}.mp4`,
          kind: "video",
          mediaType: "video/mp4",
          acquired_at: "2026-08-15T04:00:00.000Z",
          validated_at: "2026-08-15T04:00:01.000Z",
          diagnostics: { host: "media.example.test", status: 206, size: 128 }
        };
      }
    }),
    transcriptionFactory: ({ mediaResolver }) => ({
      async read(video) {
        await mediaResolver.resolve(video);
        return completedTranscript(`read ${video.aweme_id}`);
      }
    })
  });

  const result = await processor.processProfile([
    { aweme_id: "1", canonical_url: "https://www.douyin.com/video/1", media: {} },
    { aweme_id: "2", canonical_url: "https://www.douyin.com/video/2", media: {} },
    { aweme_id: "3", canonical_url: "https://www.douyin.com/video/3", media: {} }
  ]);

  assert.deepEqual(result.posts.map((item) => item.aweme_id), ["1", "2", "3"]);
  assert.deepEqual(result.posts.map((item) => item.readable_content.status), [
    "complete",
    "failed",
    "complete"
  ]);
  assert.equal(result.posts[0].readable_content.text, "read 1");
  assert.equal(result.posts[2].readable_content.text, "read 3");
  assert.deepEqual(result.failures.map((item) => item.aweme_id), ["2"]);
  assert.equal(result.failures[0].reason.code, "MEDIA_UNAVAILABLE");
  assert.equal(result.status, "partial");
  assert.equal(result.complete, false);
});

test("ContentProcessor disables local ASR for a multi-video synchronous profile while preserving artifacts and captions", async () => {
  let localAsrCalls = 0;
  const processor = new ContentProcessor({
    profileConcurrency: 3,
    artifactStore: {
      async transcriptFor(awemeId) {
        return awemeId === "artifact"
          ? completedTranscript("verified artifact", "verified_artifact")
          : null;
      }
    },
    mediaResolverFactory: () => ({
      async resolve(video) {
        return {
          url: `https://media.example.test/${video.aweme_id}.mp3`,
          kind: "audio",
          mediaType: "audio/mpeg",
          acquired_at: "2026-08-15T04:00:00.000Z",
          validated_at: "2026-08-15T04:00:01.000Z",
          diagnostics: { host: "media.example.test", status: 206, size: 1 }
        };
      },
      async fetch() {
        return {
          bytes: new Uint8Array([1]),
          mediaType: "audio/mpeg",
          acquired_at: "2026-08-15T04:00:00.000Z",
          source: { host: "media.example.test", status: 200, size: 1 }
        };
      }
    }),
    localAsr: async () => {
      localAsrCalls += 1;
      return completedTranscript("local transcript", "local_test");
    },
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null
  });

  const result = await processor.processProfile([
    { aweme_id: "artifact", canonical_url: "https://www.douyin.com/video/artifact", media: {} },
    {
      aweme_id: "caption",
      canonical_url: "https://www.douyin.com/video/caption",
      media: {},
      captions: {
        tracks: [{
          format: "vtt",
          content: "WEBVTT\n\n00:00.000 --> 00:01.000\npublic caption"
        }]
      }
    },
    { aweme_id: "local-only", canonical_url: "https://www.douyin.com/video/local-only", media: {} }
  ]);

  assert.equal(localAsrCalls, 0);
  assert.equal(result.policy.code, "PROFILE_LOCAL_ASR_DISABLED");
  assert.equal(result.policy.mode, "synchronous_multi_video");
  assert.equal(result.policy.local_asr.allowed, false);
  assert.equal(result.policy.local_asr.invoked, false);
  assert.equal(result.status, "partial");
  assert.equal(result.complete, false);
  assert.deepEqual(result.posts.map((post) => post.readable_content.status), [
    "complete",
    "complete",
    "failed"
  ]);
  assert.equal(result.posts[0].readable_content.source.provider, "verified_local_artifact");
  assert.equal(result.posts[1].readable_content.method, "captions");
  assert.equal(result.posts[2].readable_content.error.code, "TRANSCRIPTION_UNAVAILABLE");
  assert.equal(result.posts[2].readable_content.error.policy_code, "PROFILE_LOCAL_ASR_DISABLED");
  assert.equal(result.failures[0].reason.policy_code, "PROFILE_LOCAL_ASR_DISABLED");
});

test("ContentProcessor preserves hosted ASR while local ASR is disabled for a multi-video profile", async () => {
  let hostedAsrCalls = 0;
  let localAsrCalls = 0;
  const processor = new ContentProcessor({
    artifactStore: { transcriptFor: async () => null },
    mediaResolverFactory: () => ({
      async resolve(video) {
        return {
          url: `https://media.example.test/${video.aweme_id}.mp3`,
          kind: "audio",
          mediaType: "audio/mpeg",
          acquired_at: "2026-08-15T04:00:00.000Z",
          validated_at: "2026-08-15T04:00:01.000Z",
          diagnostics: { host: "media.example.test", status: 206, size: 1 }
        };
      },
      async fetch() {
        return {
          bytes: new Uint8Array([1]),
          mediaType: "audio/mpeg",
          acquired_at: "2026-08-15T04:00:00.000Z",
          source: { host: "media.example.test", status: 200, size: 1 }
        };
      }
    }),
    fetchImpl: async () => {
      hostedAsrCalls += 1;
      return new Response(JSON.stringify({
        text: "hosted transcript",
        language: "zh",
        segments: [{ start: 0, end: 1, text: "hosted transcript", avg_logprob: -0.1 }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    openAiApiKey: "hosted-test-key",
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    localAsr: async () => {
      localAsrCalls += 1;
      return completedTranscript("local transcript", "local_test");
    }
  });

  const result = await processor.processProfile([
    { aweme_id: "hosted-1", canonical_url: "https://www.douyin.com/video/hosted-1", media: {} },
    { aweme_id: "hosted-2", canonical_url: "https://www.douyin.com/video/hosted-2", media: {} }
  ]);

  assert.equal(hostedAsrCalls, 2);
  assert.equal(localAsrCalls, 0);
  assert.equal(result.status, "complete");
  assert.equal(result.complete, true);
  assert.equal(result.policy.code, "PROFILE_LOCAL_ASR_DISABLED");
  assert.deepEqual(result.posts.map((post) => post.readable_content.method), [
    "openai_whisper_1",
    "openai_whisper_1"
  ]);
});

test("ContentProcessor permits local ASR for a single-video profile", async () => {
  let localAsrCalls = 0;
  let mediaOptions;
  const processor = new ContentProcessor({
    artifactStore: { transcriptFor: async () => null },
    mediaResolverFactory: (options) => {
      mediaOptions = options;
      return {
        async resolve() {
          return {
            url: "https://media.example.test/single.mp3",
            kind: "audio",
            mediaType: "audio/mpeg",
            diagnostics: { host: "media.example.test", status: 206, size: 1 }
          };
        },
        async fetch() {
          return {
            bytes: new Uint8Array([1]),
            mediaType: "audio/mpeg",
            source: { host: "media.example.test", status: 200, size: 1 }
          };
        }
      };
    },
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
    localAsr: async () => {
      localAsrCalls += 1;
      return {
        text: "single local transcript",
        segments: [{ start_ms: 0, end_ms: 1_000, text: "single local transcript" }],
        method: "local_test"
      };
    }
  });

  const result = await processor.processProfile([
    {
      aweme_id: "single",
      canonical_url: "https://www.douyin.com/video/single",
      media: { duration_ms: 1_000 }
    }
  ]);

  assert.equal(localAsrCalls, 1);
  assert.equal(mediaOptions.timeoutMs, 12_000);
  assert.equal(mediaOptions.retries, 0);
  assert.equal(result.policy, undefined);
  assert.equal(result.status, "complete");
  assert.equal(result.complete, true);
  assert.equal(result.posts[0].readable_content.method, "local_test");
});

test("DouyinReader exposes profile processing status, completion, and bounded local-ASR policy", async () => {
  const policy = {
    code: "PROFILE_LOCAL_ASR_DISABLED",
    mode: "synchronous_multi_video",
    reason: "bounded_request_budget",
    post_count: 2,
    local_asr: { allowed: false, invoked: false }
  };
  const posts = ["1", "2"].map((awemeId) => ({
    id: awemeId,
    aweme_id: awemeId,
    canonical_url: `https://www.douyin.com/video/${awemeId}`,
    media: {},
    captions: { available: false, tracks: [] }
  }));
  const reader = new DouyinReader({
    providers: [{
      id: "direct_public_web",
      available: true,
      async readProfile() {
        return {
          creator: {
            id: "public-user",
            sec_user_id: "public-user",
            display_name: "Public creator",
            stats: { post_count: 2 }
          },
          items: posts,
          items_normalized: true,
          pagination: {
            complete: true,
            public_access_exhausted: true,
            upstream_exhausted: true,
            unique_posts: 2
          },
          meta: { provider: "direct_public_web" }
        };
      }
    }],
    fetchImpl: publicResolutionFetch,
    processContent: true,
    processor: {
      async processProfile(input) {
        const error = {
          code: "TRANSCRIPTION_UNAVAILABLE",
          message: "No synchronous method produced a transcript.",
          policy_code: policy.code
        };
        return {
          posts: [
            { ...input[0], readable_content: completedTranscript("complete post") },
            { ...input[1], readable_content: { status: "failed", error } }
          ],
          failures: [{
            aweme_id: input[1].aweme_id,
            url: input[1].canonical_url,
            reason: error
          }],
          status: "partial",
          complete: false,
          policy
        };
      }
    }
  });

  const result = await reader.read({
    url: "https://www.douyin.com/user/public-user",
    type: "profile"
  });

  assert.equal(result.content.pagination.complete, true);
  assert.equal(result.content.processing.status, "partial");
  assert.equal(result.content.processing.complete, false);
  assert.equal(result.content.processing.attempted_posts, 2);
  assert.equal(result.content.processing.successfully_content_read, 1);
  assert.equal(result.content.processing.failed_posts.length, 1);
  assert.equal(result.content.processing.policy.code, "PROFILE_LOCAL_ASR_DISABLED");
  assert.equal(result.content.processing.failed_posts[0].reason.policy_code,
    "PROFILE_LOCAL_ASR_DISABLED");
});

test("ArtifactStore shares one in-flight load across concurrent profile workers", async () => {
  const store = new ArtifactStore();

  const [first, second, third] = await Promise.all([
    store.load(),
    store.load(),
    store.load()
  ]);

  assert.ok(first);
  assert.strictEqual(second, first);
  assert.strictEqual(third, first);
  assert.equal(Object.keys(first.transcripts ?? {}).length, 18);
});

test("verified profile artifact is internally complete and contains no expiring URLs or credentials", async () => {
  const artifact = await new ArtifactStore().load();
  const profileIds = artifact.profile.public_aweme_ids.map(String);
  const transcriptIds = Object.keys(artifact.transcripts).map(String);
  const analysisIds = artifact.analysis.per_video.map((item) => String(item.aweme_id));

  assert.deepEqual(new Set(transcriptIds), new Set(profileIds));
  assert.deepEqual(new Set(analysisIds), new Set(profileIds));
  assert.equal(artifact.analysis.public_post_count, profileIds.length);
  assert.equal(artifact.analysis.analyzed_post_count, profileIds.length);
  assert.ok(artifact.profile.videos.every((video) =>
    video.media_read === true && Number(video.media_bytes) > 0));

  for (const transcript of Object.values(artifact.transcripts)) {
    assert.equal(transcript.status, "complete");
    assert.ok(transcript.text.trim().length > 0);
    assert.ok(Array.isArray(transcript.segments) && transcript.segments.length > 0);
    let previousEnd = 0;
    for (const segment of transcript.segments) {
      assert.ok(segment.start_ms >= previousEnd);
      assert.ok(segment.end_ms >= segment.start_ms);
      assert.ok(segment.text.trim().length > 0);
      previousEnd = segment.end_ms;
    }
  }

  for (const video of artifact.profile.videos) {
    const transcript = artifact.transcripts[String(video.aweme_id)];
    const finalTimestamp = transcript.segments.at(-1)?.end_ms ?? 0;
    assert.ok(Math.abs(finalTimestamp - Number(video.duration_ms)) <= 2_000);
  }

  const serialized = JSON.stringify(artifact);
  assert.ok(Buffer.byteLength(serialized) < 4.5 * 1024 * 1024);
  assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._~+/=-]+/i);
  assert.doesNotMatch(serialized, /[?&](?:token|signature|x-expires|expires|auth_key|x-bogus|a_bogus)=/i);
  assert.doesNotMatch(serialized, /"(?:authorization|api[_-]?key|cookie|secret|token)"\s*:/i);
  assert.doesNotMatch(serialized, /\uFFFD/u);
});

test("provider diagnostics redact credentials and signed URL query values", () => {
  const safe = sanitizeDiagnostics({
    authorization: "Bearer bearer-secret",
    api_key: "api-secret",
    cookie: "session=cookie-secret",
    request: {
      url: "https://cdn.example.test/video.mp4?token=url-secret&expires=999",
      nestedSecret: "nested-secret"
    },
    message: "Authorization: Bearer message-secret",
    inline: "provider failed token=inline-secret",
    embedded: "fetch failed at https://cdn.example.test/video.mp4?X-Amz-Signature=embedded-secret&Expires=123"
  });
  const serialized = JSON.stringify(safe);

  assert.equal(safe.authorization, "[redacted]");
  assert.equal(safe.api_key, "[redacted]");
  assert.equal(safe.cookie, "[redacted]");
  assert.equal(safe.request.nestedSecret, "[redacted]");
  assert.match(safe.request.url, /^https:\/\/cdn\.example\.test\/video\.mp4#[a-f0-9]{12}$/);
  assert.doesNotMatch(
    serialized,
    /bearer-secret|api-secret|cookie-secret|url-secret|nested-secret|message-secret|inline-secret|embedded-secret|Expires=123|expires=999/
  );
});

test("publicError sanitizes embedded signed URLs in ReaderError details", () => {
  const safe = publicError(new ReaderError(
    "UPSTREAM_ERROR",
    "failed at https://media.example.test/a.mp4?X-Bogus=message-secret",
    {
      status: 502,
      details: {
        cause: "GET https://media.example.test/a.mp4?msToken=detail-secret returned 502",
        cookie: "session=detail-cookie"
      }
    }
  ));
  const serialized = JSON.stringify(safe);

  assert.equal(safe.status, 502);
  assert.equal(safe.details.cookie, "[redacted]");
  assert.doesNotMatch(serialized, /message-secret|detail-secret|detail-cookie|X-Bogus|msToken/);
  assert.match(safe.message, /https:\/\/media\.example\.test\/a\.mp4#[a-f0-9]{12}/);
});

test("terminal login, CAPTCHA/security, and private errors never fall through providers", async (t) => {
  for (const code of [
    "DOUYIN_LOGIN_REQUIRED",
    "DOUYIN_CAPTCHA_REQUIRED",
    "DOUYIN_SECURITY_VERIFICATION_REQUIRED",
    "DOUYIN_PRIVATE_CONTENT"
  ]) {
    await t.test(code, async () => {
      let fallbackCalls = 0;
      const chain = new ProviderChain([
        {
          id: "public_provider",
          async readVideo() {
            throw new ReaderError(code, "Access boundary", {
              status: 422,
              details: { authorization: "Bearer terminal-secret" }
            });
          }
        },
        {
          id: "must_not_run",
          async readVideo() {
            fallbackCalls += 1;
            return { aweme: aweme("fallback") };
          }
        }
      ]);

      await assert.rejects(
        chain.run("readVideo", {}, { usable: (value) => Boolean(value?.aweme) }),
        (error) => error?.code === code &&
          error?.details?.authorization === "[redacted]" &&
          error?.details?.provider_attempts?.[0]?.status === "access_restricted"
      );
      assert.equal(fallbackCalls, 0);
    });
  }
});
