import test from "node:test";
import assert from "node:assert/strict";
import { registerDouyinTools } from "../src/mcp/douyin-tools.js";

const awemeId = "7688672103729483058";
const accepted = {
  status: "completed", pass: true, request_id: "request-1", aweme_id: awemeId,
  run_id: 123, run_url: "https://github.com/6Treeeee/-/actions/runs/123", attempt: 1, commit: "c".repeat(40), elapsed_ms: 220_000,
  result: {
    source: { cookie: "do-not-return" },
    content: {
      aweme_id: awemeId, title: "Example title", description: "Example description", duration_ms: 440_000,
      author: { id: "internal-id", display_name: "Example creator", unique_id: "creator-id",
        sec_user_id: "MS4wLjABexample", profile_url: "https://www.douyin.com/user/MS4wLjABexample",
        signature: "do-not-return-profile-bio", avatar_urls: ["https://avatar.example/private"] },
      media: { playback: { url: "https://media.example/private-signed-url" } },
      readable_content: {
        status: "complete", method: "hard_subtitle_ocr", text: "First subtitle. Second subtitle.", confidence: 0.98,
        segments: [{ start_ms: 1000, end_ms: 2000, text: "First subtitle.", confidence: 0.99 },
          { start_ms: 2000, end_ms: 3000, text: "Second subtitle.", confidence: 0.97 }],
        limitations: ["visual_subtitles_only_not_spoken_audio"],
        source: { fresh_capture: true, transcript_cache_read: false,
          coverage: { full_video_scanned: true, start_ms: 0, end_ms: 440_000 } },
      },
    },
  },
};
const zString = { trim() { return this; }, min() { return this; }, max() { return this; }, describe() { return this; } };
const z = { string: () => zString };

function fixture({ principal = { workspace_ids: ["content-reader"] }, trigger, poll, fetchImpl } = {}) {
  const tools = new Map();
  const calls = [];
  const server = { registerTool(name, metadata, handler) { tools.set(name, { metadata, handler }); } };
  registerDouyinTools(server, { principal, z, fetchImpl,
    workerFactory: () => ({
      trigger: async id => { calls.push(["trigger", id]); return trigger?.(id) ?? { status: "queued", request_id: "request-1", task: "signed-ticket", poll_after_ms: 10_000 }; },
      poll: async task => { calls.push(["poll", task]); return poll?.(task) ?? { status: "running", request_id: "request-1", aweme_id: awemeId, poll_after_ms: 10_000 }; },
    }),
  });
  return { tools, calls };
}

test("a public video link starts the existing worker and returns a poll ticket", async () => {
  const { tools, calls } = fixture();
  const response = await tools.get("start_douyin_read").handler({ url: `https://www.douyin.com/video/${awemeId}?source=share` });
  assert.deepEqual(calls, [["trigger", awemeId]]);
  assert.equal(response.structuredContent.status, "queued");
  assert.equal(response.structuredContent.task, "signed-ticket");
  assert.equal(tools.get("start_douyin_read").metadata.annotations.readOnlyHint, false);
  assert.equal(tools.get("get_douyin_read_result").metadata.annotations.readOnlyHint, true);
});

test("a principal without content-reader access cannot trigger or poll", async () => {
  const { tools, calls } = fixture({ principal: { workspace_ids: ["a2a-control"] } });
  await assert.rejects(tools.get("start_douyin_read").handler({ url: `https://www.douyin.com/video/${awemeId}` }), { statusCode: 403 });
  await assert.rejects(tools.get("get_douyin_read_result").handler({ task: "signed-ticket" }), { statusCode: 403 });
  assert.deepEqual(calls, []);
});

test("pending and failed worker states never appear as a completed transcript", async () => {
  const { tools } = fixture();
  const pending = await tools.get("get_douyin_read_result").handler({ task: "signed-ticket" });
  assert.equal(pending.structuredContent.status, "running");
  assert.equal(pending.structuredContent.task, "signed-ticket");
  assert.equal(pending.structuredContent.readable_content, undefined);

  const failedFixture = fixture({ poll: () => ({ status: "failed", aweme_id: awemeId, error: { code: "VIDEO_ACCESS_RESTRICTED", message: "Public video unavailable." } }) });
  const failed = await failedFixture.tools.get("get_douyin_read_result").handler({ task: "signed-ticket" });
  assert.equal(failed.structuredContent.status, "failed");
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent.readable_content, undefined);
});

test("worker failures never echo raw upstream error text", async () => {
  const { tools } = fixture({ poll: () => ({ status: "failed", aweme_id: awemeId,
    error: { code: "UPSTREAM_ERROR", message: "Bearer private-token and signed-media-url" } }) });
  const failed = await tools.get("get_douyin_read_result").handler({ task: "signed-ticket" });
  assert.equal(failed.structuredContent.error.code, "UPSTREAM_ERROR");
  assert(!JSON.stringify(failed.structuredContent).includes("private-token"));
  assert(!JSON.stringify(failed.structuredContent).includes("signed-media-url"));
});

test("a completed result exposes transcript and provenance without media URLs or cookies", async () => {
  const { tools } = fixture({ poll: () => accepted });
  const response = await tools.get("get_douyin_read_result").handler({ task: "signed-ticket" });
  const value = response.structuredContent;
  assert.equal(value.status, "completed");
  assert.equal(value.request_id, "request-1");
  assert.equal(value.aweme_id, awemeId);
  assert.equal(value.duration_ms, 440_000);
  assert.deepEqual(value.author, {
    display_name: "Example creator",
    unique_id: "creator-id",
    sec_user_id: "MS4wLjABexample",
    profile_url: "https://www.douyin.com/user/MS4wLjABexample",
  });
  assert.equal(value.worker.attempt, 1);
  assert.equal(value.worker.commit, "c".repeat(40));
  assert.equal(value.readable_content.segments.length, 2);
  assert.equal(value.readable_content.fresh_capture, true);
  assert.equal(value.readable_content.transcript_cache_read, false);
  assert.equal(value.readable_content.coverage.full_video_scanned, true);
  assert.equal(value.readable_content.text, "First subtitle. Second subtitle.");
  assert.equal(value.media, undefined);
  assert.equal(value.source, undefined);
  assert.equal(value.readable_content.source, undefined);
  assert(!JSON.stringify(value).includes("private-signed-url"));
  assert(!JSON.stringify(value).includes("do-not-return"));
  assert(!JSON.stringify(value).includes("do-not-return-profile-bio"));
  assert(!JSON.stringify(value).includes("avatar.example"));
});

test("a mismatched worker result is rejected instead of summarized", async () => {
  const mismatched = structuredClone(accepted);
  mismatched.aweme_id = "7688672103729483059";
  const { tools } = fixture({ poll: () => mismatched });
  const response = await tools.get("get_douyin_read_result").handler({ task: "signed-ticket" });
  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.status, "failed");
  assert.equal(response.structuredContent.error.code, "WORKER_RESULT_INVALID");
});


function acceptedSpeechResult() {
  const result = structuredClone(accepted);
  result.result.content.readable_content = {
    status: "complete",
    method: "local_whisper_cpp_base_q5_1",
    text: "First spoken phrase. Second spoken phrase.",
    segments: [
      { start_ms: 0, end_ms: 10_000, text: "First spoken phrase.", confidence: null },
      { start_ms: 200_000, end_ms: 211_000, text: "Second spoken phrase.", confidence: null },
    ],
    confidence: null,
    limitations: ["quantized_base_model_lower_accuracy", "uncorrected_asr_homophones"],
    source: {
      type: "asr", provider: "local_whisper_cpp", fresh_capture: true, transcript_cache_read: false,
      stable_aweme_id: awemeId, engine: {name:"whisper.cpp"}, model: {sha256:"a".repeat(64)},
      coverage: {start_ms:0, end_ms:440_000, full_audio_scanned:true, chunk_count:2},
    },
    media_resolution: {
      stable_identity: "aweme_id", media_kind: "audio",
      validated_at:"2026-10-24T12:00:00Z", validation:{status:206},
    },
  };
  return result;
}

test("a verified Whisper transcription completes through the real MCP projection without being relabeled as OCR", async () => {
  const { tools } = fixture({ poll: () => acceptedSpeechResult() });
  const response = await tools.get("get_douyin_read_result").handler({ task: "signed-ticket" });
  assert.equal(response.isError, undefined);
  const value = response.structuredContent;
  assert.equal(value.status, "completed");
  assert.equal(value.aweme_id, awemeId);
  assert.equal(value.readable_content.method, "local_whisper_cpp_base_q5_1");
  assert.equal(value.readable_content.coverage.full_audio_scanned, true);
  assert.equal(value.readable_content.coverage.chunk_count, 2);
  assert.equal(value.readable_content.coverage.end_ms, 440_000);
  assert.equal(value.readable_content.coverage.full_video_scanned, undefined);
  assert.equal(value.readable_content.segments.length, 2);
  assert.equal(value.readable_content.text, "First spoken phrase. Second spoken phrase.");
  assert.equal(value.readable_content.confidence, null);
  assert.equal(value.readable_content.source, undefined);
  assert.equal(value.result, undefined);
  assert.equal(value.media, undefined);
  assert(!JSON.stringify(value).includes("do-not-return"));
  assert(!JSON.stringify(value).includes("private-signed-url"));
});

test("MCP rejects incomplete, mismatched, or unverified Whisper results instead of fabricating a transcript", async () => {
  const modifications = [
    r => r.result.content.readable_content.source.coverage.full_audio_scanned = false,
    r => r.result.content.readable_content.source.coverage.end_ms = 5_000,
    r => r.result.content.readable_content.source.coverage.chunk_count = 0,
    r => r.result.content.readable_content.source.stable_aweme_id = "7000000000000000000",
    r => r.result.content.readable_content.source.fresh_capture = false,
    r => r.result.content.readable_content.source.transcript_cache_read = true,
    r => r.result.content.readable_content.source.model.sha256 = "invalid",
    r => r.result.content.readable_content.media_resolution.validated_at = null,
    r => r.result.content.readable_content.media_resolution.validation.status = 403,
    r => r.result.content.readable_content.segments[1].end_ms = 900_000,
    r => r.result.content.readable_content.segments[0].text = "",
    r => r.result.content.aweme_id = "7000000000000000000",
  ];
  for (const mutate of modifications) {
    const bad=acceptedSpeechResult();
    mutate(bad);
    const { tools } = fixture({poll:()=>bad});
    const response = await tools.get("get_douyin_read_result").handler({task:"signed-ticket"});
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.status, "failed");
    assert.equal(response.structuredContent.error.code, "WORKER_RESULT_INVALID");
    assert.equal(response.structuredContent.readable_content, undefined);
  }
});
