import test from "node:test";
import assert from "node:assert/strict";
import { registerDouyinTools } from "../src/mcp/douyin-tools.js";

const awemeId = "7688672103729483058";
const accepted = {
  status: "completed", pass: true, aweme_id: awemeId, run_id: 123, run_url: "https://github.com/6Treeeee/-/actions/runs/123", elapsed_ms: 220_000,
  result: {
    source: { cookie: "do-not-return" },
    content: {
      aweme_id: awemeId, title: "Example title", description: "Example description", duration_ms: 440_000,
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

test("a completed result exposes transcript and provenance without media URLs or cookies", async () => {
  const { tools } = fixture({ poll: () => accepted });
  const response = await tools.get("get_douyin_read_result").handler({ task: "signed-ticket" });
  const value = response.structuredContent;
  assert.equal(value.status, "completed");
  assert.equal(value.aweme_id, awemeId);
  assert.equal(value.duration_ms, 440_000);
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

