import assert from "node:assert/strict";
import test from "node:test";

import { publicError, ReaderError } from "../src/errors.js";
import { DouyinReader, resolveDouyinUrl } from "../src/platforms/douyin.js";
import {
  detectsLoginRequiredText,
  DirectPublicWebProvider
} from "../src/providers/direct-public-web.js";
import { paginateTikHubPosts, TikHubProvider } from "../src/providers/tikhub.js";
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
      async executablePath() { return "/tmp/chromium"; }
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

  const runtime = await service.withPage(async ({ runtime: value }) => value);

  assert.equal(runtime.kind, "sparticuz_chromium");
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
  videoDom = null,
  profileDom = null,
  resolutionDom = null,
  access = null,
  gotoError = null,
  currentUrl = "https://www.douyin.com/"
}) {
  const responseListeners = new Set();
  let listenerAttachedBeforeNavigation = false;
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
    async goto() {
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
      const source = operation.toString();
      if (source.includes("document.documentElement && document.body")) return true;
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
    listenerWasAttached: () => listenerAttachedBeforeNavigation
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
    contentWaitMs: 0,
    settleMs: 0
  });

  const result = await provider.readVideo({ awemeId: id });

  assert.equal(result.aweme.aweme_id, id);
  assert.deepEqual(result.aweme.video.play_addr.url_list, [embeddedMedia]);
  assert.deepEqual(result.networkMediaUrls, []);
  assert.equal(result.meta.network_media_count, 0);
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
      assert.equal(init.headers.Authorization, "Bearer gateway-test-secret");
      assert.equal(init.headers["ai-gateway-protocol-version"], "0.0.1");
      assert.equal(init.headers["ai-gateway-auth-method"], "api-key");
      return Response.json({
        text: "网关转写成功",
        language: "zh",
        segments: [{ start: 0, end: 1.25, text: "网关转写成功" }]
      });
    }
  });

  const result = await service.read({ aweme_id: "gateway-video", captions: { tracks: [] } });

  assert.equal(result.status, "complete");
  assert.equal(result.method, "vercel_ai_gateway_openai_whisper_1");
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
      assert.equal(init.headers.Authorization, "Bearer oidc-test-secret");
      assert.equal(init.headers["ai-gateway-protocol-version"], "0.0.1");
      assert.equal(init.headers["ai-gateway-auth-method"], "oidc");
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

test("TranscriptionService uses injected local ASR when hosted credentials are absent", async () => {
  let localCalls = 0;
  const service = new TranscriptionService({
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: null,
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
    localAsr: async ({ bytes, mediaType, video }) => {
      localCalls += 1;
      assert.equal(bytes.byteLength, 2);
      assert.equal(mediaType, "audio/mpeg");
      assert.equal(video.aweme_id, "local-video");
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
    transcriptionFactory: () => ({
      async read() {
        throw new Error("transcription must not run");
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
    transcriptionFactory: () => ({
      async read(video) {
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
