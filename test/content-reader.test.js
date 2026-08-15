import test from "node:test";
import assert from "node:assert/strict";

import { readPublicContent } from "../src/content-reader.js";
import { DouyinReader } from "../src/platforms/douyin.js";
import { TikHubClient, TIKHUB_ROUTES } from "../src/services/tikhub.js";

const SEC_ID = "MS4wLjABAAAA_test_public_profile";

function publicPageFetch() {
  return Promise.resolve(new Response("", { status: 200 }));
}

function aweme(id, overrides = {}) {
  return {
    aweme_id: String(id),
    desc: `post ${id}`,
    create_time: 1_700_000_000 + Number(id),
    author: {
      uid: "author-1",
      sec_uid: SEC_ID,
      nickname: "Public creator"
    },
    video: {
      duration: 12_000,
      width: 1080,
      height: 1920,
      play_addr: { url_list: [`https://media.example/${id}.mp4`] },
      cover: { url_list: [`https://media.example/${id}.jpg`] }
    },
    statistics: { play_count: 10, digg_count: 2 },
    ...overrides
  };
}

test("profile pagination exhausts the upstream feed and deduplicates posts", async () => {
  const calls = [];
  const client = {
    async get(route, params) {
      calls.push({ route, params });
      if (route === TIKHUB_ROUTES.profileApp) {
        return {
          data: { user: { sec_uid: SEC_ID, nickname: "Public creator", aweme_count: 3 } },
          meta: { route, request_id: "profile-request" }
        };
      }
      if (route === TIKHUB_ROUTES.postsApp && String(params.max_cursor) === "0") {
        return {
          data: { aweme_list: [aweme(1), aweme(2)], has_more: 1, max_cursor: "next" },
          meta: { route, request_id: "page-1" }
        };
      }
      if (route === TIKHUB_ROUTES.postsApp && params.max_cursor === "next") {
        return {
          data: { aweme_list: [aweme(2), aweme(3)], has_more: 0, max_cursor: "end" },
          meta: { route, request_id: "page-2" }
        };
      }
      throw new Error(`unexpected route ${route}`);
    }
  };

  const reader = new DouyinReader({ client, fetchImpl: publicPageFetch });
  const result = await reader.read({
    url: `https://www.douyin.com/user/${SEC_ID}`,
    type: "profile"
  });

  assert.equal(result.content_type, "profile");
  assert.equal(result.content.creator.display_name, "Public creator");
  assert.deepEqual(result.content.posts.map((post) => post.id), ["1", "2", "3"]);
  assert.equal(result.content.pagination.complete, true);
  assert.equal(result.content.pagination.pages_fetched, 2);
  assert.equal(result.content.pagination.duplicates_removed, 1);
  assert.equal(calls.filter((call) => call.route === TIKHUB_ROUTES.postsWeb).length, 0);
});

test("an independently paginated DouPlus feed can reconcile missing public posts", async () => {
  const calls = [];
  const client = {
    async get(route, params) {
      calls.push({ method: "GET", route, params });
      if (route === TIKHUB_ROUTES.profileApp) {
        return {
          data: { user: { sec_uid: SEC_ID, nickname: "Public creator", aweme_count: 3 } },
          meta: { route, request_id: "profile-request" }
        };
      }
      if (route === TIKHUB_ROUTES.postsApp) throw new Error("App route unavailable");
      if (route === TIKHUB_ROUTES.postsWeb) {
        return {
          data: { aweme_list: [aweme(1), aweme(2)], has_more: 0, max_cursor: "end" },
          meta: { route, request_id: "web-page" }
        };
      }
      throw new Error(`unexpected GET route ${route}`);
    },
    async post(route, body) {
      calls.push({ method: "POST", route, body });
      assert.equal(route, TIKHUB_ROUTES.postsDouPlus);
      return {
        data: { list: [aweme(3)], has_more: false, cursor: "end" },
        meta: { route, request_id: "douplus-page" }
      };
    }
  };

  const reader = new DouyinReader({ client, fetchImpl: publicPageFetch });
  const result = await reader.read({
    url: `https://www.douyin.com/user/${SEC_ID}`,
    type: "profile"
  });

  assert.equal(result.content.pagination.complete, true);
  assert.deepEqual(result.content.posts.map((post) => post.id), ["1", "2", "3"]);
  assert.equal(calls.filter((call) => call.route === TIKHUB_ROUTES.postsApp).length, 2);
  assert.equal(calls.filter((call) => call.route === TIKHUB_ROUTES.postsWeb).length, 2);
  assert.equal(calls.filter((call) => call.route === TIKHUB_ROUTES.postsDouPlus).length, 1);
});

test("a repeated cursor stops pagination and never switches providers mid-series", async () => {
  const calls = [];
  const client = {
    async get(route) {
      calls.push(route);
      if (route === TIKHUB_ROUTES.profileApp) {
        return {
          data: { user: { sec_uid: SEC_ID, nickname: "Public creator", aweme_count: 2 } },
          meta: { route, request_id: "profile-request" }
        };
      }
      if (route === TIKHUB_ROUTES.postsApp) {
        return {
          data: { aweme_list: [aweme(1)], has_more: 1, max_cursor: "0" },
          meta: { route, request_id: "loop-page" }
        };
      }
      throw new Error("web fallback must not be called after page one");
    }
  };

  const reader = new DouyinReader({ client, fetchImpl: publicPageFetch });
  await assert.rejects(
    reader.read({ url: `https://www.douyin.com/user/${SEC_ID}`, type: "profile" }),
    (error) => error.code === "DOUYIN_CURSOR_LOOP"
  );
  assert.equal(calls.includes(TIKHUB_ROUTES.postsWeb), false);
});

test("video retrieval falls back from the documented App route to Web", async () => {
  const client = {
    async get(route) {
      if (route === TIKHUB_ROUTES.videoApp) {
        return {
          data: { filter_list: [{ reason: 8 }] },
          meta: { route, request_id: "app-empty" }
        };
      }
      if (route === TIKHUB_ROUTES.videoWeb) {
        return {
          data: {
            aweme_detail: aweme(99, {
              video: {
                duration: 8_000,
                play_addr: { url_list: ["https://media.example/99.mp4"] },
                cla_info: {
                  caption_infos: [{
                    sub_id: "caption-1",
                    language_code: "zh",
                    format: "webvtt",
                    url: "https://media.example/99.vtt"
                  }]
                }
              }
            })
          },
          meta: { route, request_id: "web-success" }
        };
      }
      throw new Error(`unexpected route ${route}`);
    }
  };

  const reader = new DouyinReader({ client, fetchImpl: publicPageFetch });
  const result = await reader.read({
    url: "https://www.douyin.com/video/99",
    type: "video"
  });

  assert.equal(result.content.id, "99");
  assert.equal(result.source.retrieval.route, TIKHUB_ROUTES.videoWeb);
  assert.equal(result.content.captions.available, true);
  assert.equal(result.content.transcription_input.strategy, "captions");
});

test("private or restricted App results are not retried through Web", async () => {
  const calls = [];
  const client = {
    async get(route) {
      calls.push(route);
      return {
        data: { filter_list: [{ reason: 5 }] },
        meta: { route, request_id: "private-result" }
      };
    }
  };

  const reader = new DouyinReader({ client, fetchImpl: publicPageFetch });
  await assert.rejects(
    reader.read({ url: "https://www.douyin.com/video/100", type: "video" }),
    (error) => error.code === "DOUYIN_VIDEO_RESTRICTED"
  );
  assert.deepEqual(calls, [TIKHUB_ROUTES.videoApp]);
});

test("provider failures are reported as upstream errors, not missing content", async () => {
  const client = {
    async get() {
      throw new Error("simulated upstream outage");
    }
  };

  const reader = new DouyinReader({ client, fetchImpl: publicPageFetch });
  await assert.rejects(
    reader.read({ url: "https://www.douyin.com/video/101", type: "video" }),
    (error) => error.code === "DOUYIN_VIDEO_RETRIEVAL_FAILED" && error.status === 502
  );
});

test("TikHub client uses GET query parameters and Bearer authentication", async () => {
  let observed;
  const client = new TikHubClient({
    apiKey: "secret-test-key",
    retries: 0,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return new Response(JSON.stringify({
        code: 200,
        request_id: "request-1",
        data: { ok: true }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const response = await client.get(TIKHUB_ROUTES.postsApp, {
    sec_user_id: SEC_ID,
    max_cursor: 0,
    count: 20,
    sort_type: 0,
    channel: "normal"
  });

  const url = new URL(observed.url);
  assert.equal(observed.options.method, "GET");
  assert.equal(observed.options.headers.Authorization, "Bearer secret-test-key");
  assert.equal(url.searchParams.get("sec_user_id"), SEC_ID);
  assert.equal(url.searchParams.get("count"), "20");
  assert.equal(response.meta.request_id, "request-1");
});

test("TikHub client sends documented JSON POST bodies", async () => {
  let observed;
  const client = new TikHubClient({
    apiKey: "secret-test-key",
    retries: 0,
    fetchImpl: async (url, options) => {
      observed = { url: String(url), options };
      return new Response(JSON.stringify({ code: 200, data: { list: [] } }), { status: 200 });
    }
  });

  await client.post(TIKHUB_ROUTES.postsDouPlus, {
    sec_uid: SEC_ID,
    cursor: "0",
    count: 20
  });

  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(observed.options.body), {
    sec_uid: SEC_ID,
    cursor: "0",
    count: 20
  });
});

test("the platform router rejects unsupported sources before creating a provider", async () => {
  await assert.rejects(
    readPublicContent({ url: "https://www.youtube.com/watch?v=abc" }),
    (error) => error.code === "UNSUPPORTED_PLATFORM" && error.status === 422
  );
});
