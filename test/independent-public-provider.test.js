import test from "node:test";
import assert from "node:assert/strict";
import { ReaderError } from "../src/errors.js";
import { ProviderChain } from "../src/services/provider-chain.js";
import { TikHubProvider } from "../src/providers/tikhub.js";

const id = "7421538381705907475";
const context = { awemeId: id, inputUrl: `https://www.douyin.com/video/${id}?challenge=unused` };
const publicVideo = () => ({ aweme_id: id, video: {}, status: {
  is_private: false, is_prohibited: false, allow_share: true, private_status: 0
} });
function setup(data, { code = "DOUYIN_SECURITY_VERIFICATION_REQUIRED", scope = "provider_path" } = {}) {
  const calls = [];
  const direct = { id: "direct_public_web", async readVideo() {
    calls.push("direct");
    throw new ReaderError(code, "boundary", { status: 422, details: {
      provider: "direct_public_web", reason: "visible_security_challenge", access_scope: scope
    } });
  } };
  const tikhub = new TikHubProvider({ client: { async get(route, params) {
    calls.push({ route, params });
    return { data, meta: { route } };
  } } });
  const artifact = { id: "verified_public_artifact", async readVideo() {
    assert.fail("a challenged path must never fall back to stale artifacts");
  } };
  return { chain: new ProviderChain([direct, artifact, tikhub, artifact]), calls };
}

test("path challenge permits one independent canonical public video read with provenance", async () => {
  const { chain, calls } = setup({ aweme_detail: publicVideo() });
  const result = await chain.run("readVideo", context);
  assert.equal(result.value.aweme.aweme_id, id);
  assert.equal(result.value.meta.access_evidence, "provider_reported_public_status");
  assert.deepEqual(result.attempts.map(x => x.status), ["access_restricted", "success"]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, { share_url: `https://www.douyin.com/video/${id}` });
});

test("all restriction markers override matching data and stop internal route retries", async (t) => {
  for (const payload of [
    ...[5, 8, 10, 999].map(reason => ({ filter_list: [{ reason }] })),
    { filter_list: [{}, { reason: 5 }] },
    { filter_detail: { reason: 8 } },
    { nested: { filter_detail: "restricted" } },
    { is_paid: true }, { video: { drm_type: 1 } }
  ]) await t.test(JSON.stringify(payload), async () => {
    const { chain, calls } = setup({ aweme_detail: publicVideo(), ...payload });
    await assert.rejects(chain.run("readVideo", context), e =>
      e.code === "DOUYIN_SECURITY_VERIFICATION_REQUIRED" &&
      e.details.provider_attempts[1].error.code === "DOUYIN_PROVIDER_RESTRICTION_UNVERIFIED" &&
      e.details.provider_attempts[1].error.details.authoritative === false);
    assert.equal(calls.length, 2);
  });
});

test("missing or restrictive public status cannot be accepted after a challenge", async (t) => {
  for (const status of [undefined, {}, { ...publicVideo().status, allow_share: false },
    { ...publicVideo().status, is_private: true }, { ...publicVideo().status, private_status: 1 }]) {
    await t.test(JSON.stringify(status) ?? "missing", async () => {
      const { chain, calls } = setup({ aweme_detail: { ...publicVideo(), status } });
      await assert.rejects(chain.run("readVideo", context), e =>
        e.code === "DOUYIN_SECURITY_VERIFICATION_REQUIRED" &&
        ["DOUYIN_PROVIDER_ACCESS_UNVERIFIED", "DOUYIN_PROVIDER_RESTRICTION_UNVERIFIED"]
          .includes(e.details.provider_attempts[1].error.code));
      assert.equal(calls.length, 2);
    });
  }
});

test("content boundaries and ambiguous challenges remain terminal", async (t) => {
  for (const code of ["DOUYIN_LOGIN_REQUIRED", "DOUYIN_CAPTCHA_REQUIRED", "DOUYIN_PRIVATE_CONTENT",
    "DOUYIN_PAID_CONTENT", "DOUYIN_DRM_RESTRICTED", "DOUYIN_ACCESS_RESTRICTED", "DOUYIN_CONTENT_UNAVAILABLE"]) {
    await t.test(code, async () => {
      const { chain, calls } = setup({ aweme_detail: publicVideo() }, { code });
      await assert.rejects(chain.run("readVideo", context), e => e.code === code);
      assert.deepEqual(calls, ["direct"]);
    });
  }
  const { chain, calls } = setup({}, { scope: "content_or_unknown" });
  await assert.rejects(chain.run("readVideo", context), { code: "DOUYIN_SECURITY_VERIFICATION_REQUIRED" });
  assert.deepEqual(calls, ["direct"]);
});

test("wrong identity and empty results fail without artifact fallback", async () => {
  for (const data of [{}, { aweme_detail: { ...publicVideo(), aweme_id: "1" } }]) {
    const { chain, calls } = setup(data);
    await assert.rejects(chain.run("readVideo", context), e =>
      e.code === "DOUYIN_SECURITY_VERIFICATION_REQUIRED" &&
      e.details.provider_attempts[1].error.code === "DOUYIN_PROVIDER_UNAVAILABLE");
    assert.equal(calls.length, 3);
  }
});
