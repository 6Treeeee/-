import assert from "node:assert/strict";
import test from "node:test";

import { ReaderError } from "../src/errors.js";
import { DouyinReader } from "../src/platforms/douyin.js";
import { CreatorAnalyzer } from "../src/services/analysis.js";
import { ArtifactStore, validatePublicCaptureInputs } from "../src/services/artifacts.js";

const SEC_UID = "MS4wLjABAAAA_verified_public_creator";
const CAPTURED_AT = "2026-08-22T09:44:32.340Z";
const NOW = Date.parse("2026-08-22T10:00:00.000Z");

function fixtureArtifact(overrides = {}) {
  const awemeId = "7673013072324660089";
  const transcript = {
    status: "complete",
    text: "真实客户需求应该先于技术展示。",
    segments: [{ start_ms: 0, end_ms: 2_000, text: "真实客户需求应该先于技术展示。" }],
    language: "zh",
    method: "local_faster_whisper_asr",
    confidence: { kind: "segment_log_probability", mean: 0.92 },
    limitations: ["ASR text can contain recognition errors."]
  };
  return {
    schema_version: "1.0",
    pipeline_version: "content-reader-douyin-2.0.0",
    captured_at: CAPTURED_AT,
    built_at: CAPTURED_AT,
    access_policy: "public_unauthenticated_only",
    sec_user_id: SEC_UID,
    profile: {
      creator: {
        id: "creator-1",
        sec_user_id: SEC_UID,
        display_name: "Public creator",
        profile_url: `https://www.douyin.com/user/${SEC_UID}`,
        stats: { post_count: 2 }
      },
      access: {
        scope: "public_unauthenticated",
        explicit_login_more_gate: true,
        public_visible_post_count: 1,
        profile_display_post_count: 2,
        public_gap: 1
      },
      pagination: {
        complete: true,
        scope: "public_unauthenticated",
        public_access_exhausted: true,
        upstream_exhausted: false,
        stopped_by_access_boundary: true,
        stop_reason: "login_required_for_more",
        expected_posts: 2,
        unique_posts: 1,
        profile_count_gap: 1,
        limitation: {
          code: "LOGIN_REQUIRED_FOR_MORE_POSTS",
          type: "partial_public_profile",
          message: "登录后查看更多作品",
          public_items: 1,
          displayed_post_count: 2,
          inaccessible_count: 1
        }
      },
      public_aweme_ids: [awemeId],
      videos: [{
        aweme_id: awemeId,
        canonical_url: `https://www.douyin.com/video/${awemeId}`,
        created_at: "2026-08-21T10:00:00.000Z",
        title: "Public video",
        duration_ms: 2_000,
        media_read: true,
        media_type: "video",
        media_content_type: "video/mp4",
        media_bytes: 1_024,
        transcript_method: "local_faster_whisper_asr",
        transcript_segments: 1
      }]
    },
    transcripts: { [awemeId]: transcript },
    analysis: {
      public_post_count: 1,
      analyzed_post_count: 1,
      per_video: [{
        aweme_id: awemeId,
        url: `https://www.douyin.com/video/${awemeId}`,
        created_at: "2026-08-21T10:00:00.000Z",
        title: "Public video",
        chapters: { available: false, entries: [] },
        source_evidence: {
          description: "真实客户需求应该先于技术展示。",
          hashtags: ["AI"],
          engagement: { likes: 10 }
        },
        readable_content: transcript
      }]
    },
    ...overrides
  };
}

function resolutionFetch() {
  return Promise.resolve(new Response("", {
    status: 200,
    headers: { "content-type": "text/html" }
  }));
}

test("artifact builds require same-capture successful media receipts for every visible post", async (t) => {
  const profileRaw = {
    captured_at: CAPTURED_AT,
    access: { public_visible_post_count: 2 },
    aweme_list: [{ aweme_id: "1" }, { aweme_id: "2" }]
  };
  const mediaManifest = {
    captured_at: CAPTURED_AT,
    failures: [],
    results: ["1", "2"].map((awemeId) => ({
      aweme_id: awemeId,
      path: `C:\\public-capture\\${awemeId}.mp4`,
      media_type: "audio",
      content_type: "video/mp4",
      bytes: 10_000
    }))
  };

  assert.equal(validatePublicCaptureInputs({ profileRaw, mediaManifest }).size, 2);

  await t.test("rejects a manifest from an older profile capture", () => {
    assert.throws(
      () => validatePublicCaptureInputs({
        profileRaw,
        mediaManifest: { ...mediaManifest, captured_at: "2026-08-21T09:44:32.340Z" }
      }),
      /captured_at mismatch/
    );
  });

  await t.test("rejects a visible post without a successful receipt", () => {
    assert.throws(
      () => validatePublicCaptureInputs({
        profileRaw,
        mediaManifest: { ...mediaManifest, results: mediaManifest.results.slice(0, 1) }
      }),
      /Missing successful media receipts.*2/
    );
  });

  await t.test("rejects any recorded media-read failure", () => {
    assert.throws(
      () => validatePublicCaptureInputs({
        profileRaw,
        mediaManifest: {
          ...mediaManifest,
          failures: [{ aweme_id: "2", error: "HTTP 503 with signed-url-secret" }]
        }
      }),
      /failed public posts: 2/
    );
  });
});

test("ArtifactStore returns only fresh, identity-matched, internally complete public profiles", async () => {
  const store = new ArtifactStore({ data: fixtureArtifact(), now: () => NOW });
  const snapshot = await store.verifiedProfileFor(SEC_UID);

  assert.ok(snapshot);
  assert.equal(snapshot.posts.length, 1);
  assert.equal(snapshot.posts[0].readable_content.status, "complete");
  assert.equal(snapshot.posts[0].readable_content.source.provider, "verified_public_artifact");
  assert.equal(snapshot.posts[0].media.resolved.stable_identity, "aweme_id");
  assert.equal(snapshot.posts[0].media.resolved.validation.status, "verified_at_capture");
  assert.equal(snapshot.posts[0].transcription_input.media_url_included, false);
  assert.equal(snapshot.pagination.limitation.message, "登录后查看更多作品");

  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /[?&](?:token|signature|x-expires|expires|auth_key)=/i);
  assert.doesNotMatch(serialized, /https?:\/\/(?:v\d+-dy|.*douyinvod).*\.mp4/i);
  assert.equal(await store.verifiedProfileFor("MS4wLjABAAAA_other"), null);
});

test("ArtifactStore rejects stale, future-dated, and incomplete profile captures", async () => {
  const stale = new ArtifactStore({
    data: fixtureArtifact(),
    profileMaxAgeMs: 60_000,
    now: () => NOW
  });
  assert.equal(await stale.verifiedProfileFor(SEC_UID), null);

  const future = new ArtifactStore({
    data: fixtureArtifact({ captured_at: "2026-08-23T10:00:00.000Z" }),
    now: () => NOW
  });
  assert.equal(await future.verifiedProfileFor(SEC_UID), null);

  const incompleteData = fixtureArtifact();
  incompleteData.transcripts = {};
  const incomplete = new ArtifactStore({ data: incompleteData, now: () => NOW });
  assert.equal(await incomplete.verifiedProfileFor(SEC_UID), null);
});

test("profile retrieval falls back from a nonterminal Direct failure to the verified public artifact", async () => {
  let directCalls = 0;
  let processorCalls = 0;
  const direct = {
    id: "direct_public_web",
    available: true,
    async readProfile() {
      directCalls += 1;
      throw new ReaderError(
        "DOUYIN_PAGINATION_INCOMPLETE",
        "The public page did not expose a usable grid.",
        { status: 502, details: { authorization: "Bearer direct-secret" } }
      );
    }
  };
  const reader = new DouyinReader({
    directProvider: direct,
    artifactStore: new ArtifactStore({ data: fixtureArtifact(), now: () => NOW }),
    fetchImpl: resolutionFetch,
    processContent: true,
    processor: {
      async processProfile() {
        processorCalls += 1;
        throw new Error("preprocessed artifact posts must not be processed again");
      }
    }
  });

  const result = await reader.read({
    url: `https://www.douyin.com/user/${SEC_UID}`,
    type: "profile"
  });

  assert.equal(directCalls, 1);
  assert.equal(processorCalls, 0);
  assert.deepEqual(result.source.provider_attempts.map(({ provider, status }) => ({ provider, status })), [
    { provider: "direct_public_web", status: "failed" },
    { provider: "verified_public_artifact", status: "success" }
  ]);
  assert.equal(result.source.retrieval.method, "verified_logged_out_public_capture");
  assert.equal(result.source.retrieval.media_urls_included, false);
  assert.equal(result.content.creator.sec_user_id, SEC_UID);
  assert.equal(result.content.posts.length, 1);
  assert.equal(result.content.posts[0].readable_content.status, "complete");
  assert.equal(result.content.processing.successfully_content_read, 1);
  assert.equal(result.content.processing.failed_posts.length, 0);
  assert.equal(result.content.pagination.complete, true);
  assert.equal(result.content.pagination.profile_count_gap, 1);
  assert.equal(result.content.limitation.message, "登录后查看更多作品");
  assert.equal(result.content.analysis.analyzed_post_count, 1);
  assert.equal(result.content.analysis.inaccessible_or_failed_posts[0].count, 1);
  assert.doesNotMatch(JSON.stringify(result), /direct-secret/);
});

test("terminal public access errors stop before the verified artifact fallback", async () => {
  let artifactCalls = 0;
  const artifactStore = {
    async verifiedProfileFor() {
      artifactCalls += 1;
      return { should_not_be_used: true };
    },
    async transcriptFor() { return null; }
  };
  const direct = {
    id: "direct_public_web",
    available: true,
    async readProfile() {
      throw new ReaderError("DOUYIN_CAPTCHA_REQUIRED", "A CAPTCHA is visible.", { status: 422 });
    }
  };
  const reader = new DouyinReader({
    directProvider: direct,
    artifactStore,
    fetchImpl: resolutionFetch,
    processContent: false
  });

  await assert.rejects(
    reader.read({ url: `https://www.douyin.com/user/${SEC_UID}`, type: "profile" }),
    (error) => error.code === "DOUYIN_CAPTCHA_REQUIRED"
  );
  assert.equal(artifactCalls, 0);
});

test("creator change evidence compares distinct videos instead of duplicating one mixed statement", () => {
  const readable = (text) => ({
    status: "complete",
    text,
    segments: [{ start_ms: 0, end_ms: 1_000, text }]
  });
  const posts = [
    {
      aweme_id: "pause-video",
      canonical_url: "https://www.douyin.com/video/1",
      created_at: "2026-07-24T10:00:00.000Z",
      title: "暂停合作保证交付，成熟后重新开放合作",
      readable_content: readable("客户增长超过产品成熟速度，所以暂停合作，成熟后重新开放合作。")
    },
    {
      aweme_id: "scale-video",
      canonical_url: "https://www.douyin.com/video/2",
      created_at: "2026-07-25T10:00:00.000Z",
      title: "招商与分公司规划",
      readable_content: readable("下一阶段讨论招商和分公司规模。")
    }
  ];

  const analysis = new CreatorAnalyzer().analyze({
    creator: { display_name: "Public creator" },
    posts,
    pagination: { unique_posts: posts.length, scope: "public_unauthenticated" }
  });
  const change = analysis.contradictions_or_changes.find((item) =>
    item.type === "delivery_before_scale");

  assert.ok(change);
  assert.deepEqual(change.evidence.map((item) => item.aweme_id), ["pause-video", "scale-video"]);
});
