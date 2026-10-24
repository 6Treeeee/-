import test from "node:test";
import assert from "node:assert/strict";
import { verifyAcquisitionResult } from "../src/services/acquisition-result.js";

const id = "7699751880649428250";
const requestId = "7c0b063e-a70f-4637-b9d8-92328870101a";
function verifiedSample() {
  return {
    request_id: requestId, aweme_id: id, pass: true,
    result: { content: {
      aweme_id: id, media: { duration_ms: 720534 },
      readable_content: {
        status: "complete", method: "local_whisper_cpp_base_q5_1",
        text: "真实公开视频口播\n第二段口播",
        segments: [
          { start_ms: 0, end_ms: 1840, text: "真实公开视频口播" },
          { start_ms: 717320, end_ms: 720534, text: "第二段口播" }
        ],
        source: {
          type: "asr", provider: "local_whisper_cpp",
          stable_aweme_id: id, fresh_capture: true, transcript_cache_read: false,
          engine: {name: "whisper.cpp"},
          model: {sha256: "a".repeat(64)},
          coverage: {start_ms: 0, end_ms: 720534, full_audio_scanned: true, chunk_count: 3}
        },
        media_resolution: {
          stable_identity: "aweme_id", media_kind: "audio",
          validated_at: "2026-10-24T20:40:15.174Z",
          validation: {status: 206}
        }
      }
    } }
  };
}
const expected = {request_id:requestId,aweme_id:id};
test("preview accepts real worker's ASR structure with verified source", () => {
  const record=verifiedSample();
  assert.equal(verifyAcquisitionResult(record,expected),record);
});
test("preview never accepts a mismatched, cached, partial, or source-less ASR", () => {
  const edits=[
    e=>e.request_id="wrong",
    e=>e.result.content.aweme_id="7654321098765432109",
    e=>e.result.content.readable_content.source.stable_aweme_id="7654321098765432109",
    e=>e.result.content.readable_content.source.fresh_capture=false,
    e=>e.result.content.readable_content.source.transcript_cache_read=true,
    e=>e.result.content.readable_content.source.coverage.full_audio_scanned=false,
    e=>e.result.content.readable_content.source.coverage.end_ms=200000,
    e=>e.result.content.readable_content.source.model.sha256=null,
    e=>e.result.content.readable_content.media_resolution.validation.status=403,
    e=>e.result.content.readable_content.media_resolution.validated_at=null,
    e=>e.result.content.readable_content.segments[1].end_ms=900000,
    e=>e.result.content.readable_content.segments[1].start_ms=-2
  ];
  for(const edit of edits) {
    const record=verifiedSample();edit(record);
    assert.throws(()=>verifyAcquisitionResult(record,expected),{code:"WORKER_RESULT_INVALID"});
  }
});
