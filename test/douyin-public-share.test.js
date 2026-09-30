import assert from "node:assert/strict";
import test from "node:test";

import {
  DirectPublicWebProvider,
  parseOfficialShareRouterData
} from "../src/providers/direct-public-web.js";

function sampleAweme(id, media = true) {
  return {
    aweme_id: String(id),
    desc: "public sample",
    video: {
      duration: 440000,
      width: 1080,
      height: 1920,
      ...(media ? {
        play_addr: {
          url_list: ["https://v5-dy-ov-experiment.zjcdn.com/public-sample.mp4"]
        }
      } : {})
    }
  };
}

function routerHtml(items) {
  return `<!doctype html><html><body><script>window._ROUTER_DATA = ${JSON.stringify({
    loaderData: {
      "video_(id)/page": {
        videoInfoRes: { item_list: items }
      }
    }
  })};</script></body></html>`;
}

function responseFor(id, html, { status = 200, url = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: url ?? `https://www.iesdouyin.com/share/video/${id}`,
    headers: { get() { return null; } },
    async text() { return html; }
  };
}

test("official public share parser returns only the exact requested aweme", () => {
  const wanted = "7688672103729483058";
  const other = "7688672103729483999";
  const parsed = parseOfficialShareRouterData(
    routerHtml([sampleAweme(other), sampleAweme(wanted)]),
    wanted
  );
  assert.equal(parsed.aweme_id, wanted);
});

test("DirectPublicWebProvider reads exact public share metadata without launching browser", async () => {
  const id = "7688672103729483058";
  let browserCalls = 0;
  let fetchedUrl = null;
  const provider = new DirectPublicWebProvider({
    fetchImpl: async (url) => {
      fetchedUrl = String(url);
      return responseFor(id, routerHtml([sampleAweme(id)]));
    },
    browserService: {
      async withPage() {
        browserCalls += 1;
        throw new Error("browser must not launch when official share data is usable");
      }
    }
  });

  const result = await provider.readVideo({
    inputUrl: `https://www.douyin.com/video/${id}`,
    resolvedUrl: `https://www.douyin.com/video/${id}`,
    awemeId: id
  });

  assert.equal(fetchedUrl, `https://www.iesdouyin.com/share/video/${id}`);
  assert.equal(result.aweme.aweme_id, id);
  assert.equal(result.meta.method, "official_public_share_page");
  assert.equal(result.meta.transport, "public_http");
  assert.equal(browserCalls, 0);
});

test("official public share fetch rejects a mismatched identity", async () => {
  const id = "7688672103729483058";
  const provider = new DirectPublicWebProvider({
    fetchImpl: async () => responseFor(id, routerHtml([sampleAweme("7688672103729483999")]))
  });
  await assert.rejects(
    () => provider.readOfficialShareVideo(id),
    (error) => ["DOUYIN_PUBLIC_WEB_EMPTY_RESULT", "DOUYIN_PUBLIC_WEB_IDENTITY_MISMATCH"].includes(error.code)
  );
});

test("official public share fetch preserves a visible security boundary", async () => {
  const id = "7688672103729483058";
  const provider = new DirectPublicWebProvider({
    fetchImpl: async () => responseFor(id, "<html><body>请完成安全验证</body></html>")
  });
  await assert.rejects(
    () => provider.readOfficialShareVideo(id),
    (error) => error.code === "DOUYIN_SECURITY_VERIFICATION_REQUIRED"
  );
});

test("official public share fetch preserves a login-only boundary", async () => {
  const id = "7688672103729483058";
  const provider = new DirectPublicWebProvider({
    fetchImpl: async () => responseFor(id, "<html><body>Log in to Douyin</body></html>")
  });
  await assert.rejects(
    () => provider.readOfficialShareVideo(id),
    (error) => error.code === "DOUYIN_LOGIN_REQUIRED"
  );
});

test("official public share metadata must include usable video media", async () => {
  const id = "7688672103729483058";
  const provider = new DirectPublicWebProvider({
    fetchImpl: async () => responseFor(id, routerHtml([sampleAweme(id, false)]))
  });
  await assert.rejects(
    () => provider.readOfficialShareVideo(id),
    (error) => error.code === "DOUYIN_PUBLIC_WEB_IDENTITY_MISMATCH"
  );
});
