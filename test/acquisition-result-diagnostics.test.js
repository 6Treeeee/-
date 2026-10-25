import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { diagnoseAcquisitionArtifact, diagnoseAcquisitionResult, verifyAcquisitionResult } from "../src/services/acquisition-result.js";
import { createAcquisitionFailure, saveAcquisitionOutput } from "../src/services/acquisition-output.js";
import { publicError } from "../src/errors.js";

const expected = { request_id: "767e9a51-f123-45d0-a232-f45f342faedb", aweme_id: "7698100976309275939" };
function candidate() {
  return { ...expected, pass: true, result: { content: {
    aweme_id: expected.aweme_id, duration_ms: 1006516,
    readable_content: { status: "complete", method: "local_whisper_cpp_base_q5_1",
      text: "PRIVATE_TRANSCRIPT_SENTINEL", segments: [
        { start_ms: 1000, end_ms: 2000, text: "PRIVATE_SEGMENT_SENTINEL" },
        { start_ms: 3000, end_ms: 4000, text: "PRIVATE_SEGMENT_SENTINEL" }],
      source: { type: "asr", provider: "local_whisper_cpp", fresh_capture: true,
        transcript_cache_read: false, stable_aweme_id: expected.aweme_id,
        engine: { name: "whisper.cpp" }, model: { sha256: "a".repeat(64) },
        coverage: { full_audio_scanned: true, start_ms: 0, end_ms: 1006516, chunk_count: 4 } },
      media_resolution: { stable_identity: "aweme_id", media_kind: "video", validated_at: "2026-10-26",
        validation: { status: 206 }, url: "https://private.invalid/media?token=KEY_SENTINEL" },
    },
  } } };
}
function readable(value) { return value.result.content.readable_content; }
function rejection(value) {
  let error;
  try { verifyAcquisitionResult(value, expected); } catch (caught) { error = caught; }
  assert.equal(error?.code, "WORKER_RESULT_INVALID");
  return error;
}

test("diagnostic checks agree with unchanged acceptance and contain no private fields", () => {
  const value = candidate();
  assert.equal(verifyAcquisitionResult(value, expected), value);
  const diagnostic = diagnoseAcquisitionResult(value, expected);
  assert.equal(diagnostic.accepted, true);
  assert.equal(Object.keys(diagnostic.checks).length, 37);
  assert.deepEqual(diagnostic.failed_checks, []);
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|KEY_SENTINEL|https?:|private\.invalid/);
});

test("each base predicate reports its rejection independently", () => {
  const cases = [
    [v => v.request_id = "other", "request_id_match"],
    [v => v.aweme_id = "other", "envelope_video_id_match"],
    [v => v.result.content.aweme_id = "other", "content_video_id_match"],
    [v => v.pass = false, "envelope_pass_true"],
    [v => v.result.content.duration_ms = Infinity, "duration_finite"],
    [v => v.result.content.duration_ms = 0, "duration_positive"],
    [v => readable(v).status = "partial", "readable_status_complete"],
    [v => readable(v).segments = null, "segments_array"],
    [v => readable(v).segments = [], "segments_nonempty"],
    [v => readable(v).text = null, "text_string"],
    [v => readable(v).text = " ", "text_nonempty"],
    [v => readable(v).method = "PRIVATE_METHOD_SENTINEL", "method_supported"],
  ];
  for (const [mutate, failed] of cases) {
    const value = candidate(); mutate(value);
    const error = rejection(value);
    assert.equal(error.details.validation.checks[failed], false, failed);
    assert.equal(error.details.validation.accepted, false, failed);
    assert.ok(error.details.validation.failed_checks.includes(failed), failed);
  }
});

test("each ASR identity, provenance and coverage predicate stays fail-closed", () => {
  const cases = [
    [r => r.source.type = "ocr", "source_type_asr"],
    [r => r.source.provider = "local", "source_provider_local_whisper"],
    [r => r.source.fresh_capture = false, "fresh_capture_true"],
    [r => r.source.transcript_cache_read = true, "transcript_cache_read_false"],
    [r => r.source.stable_aweme_id = "other", "source_video_id_match"],
    [r => r.source.engine.name = "other", "engine_whisper_cpp"],
    [r => r.source.model.sha256 = "KEY_SENTINEL", "model_sha256_valid"],
    [r => r.source.coverage.full_audio_scanned = false, "full_audio_scanned_true"],
    [r => r.source.coverage.start_ms = 1, "coverage_start_zero"],
    [r => r.source.coverage.end_ms = NaN, "coverage_end_finite"],
    [r => r.source.coverage.end_ms = 1005515, "coverage_end_covers_duration"],
    [r => r.source.coverage.end_ms = 1016517, "coverage_end_within_duration"],
    [r => r.source.coverage.chunk_count = 1.5, "chunk_count_integer"],
    [r => r.source.coverage.chunk_count = 0, "chunk_count_positive"],
    [r => r.media_resolution.stable_identity = "title", "media_stable_identity_aweme"],
    [r => r.media_resolution.media_kind = "image", "media_kind_audio_or_video"],
    [r => r.media_resolution.validated_at = null, "media_validated_at_present"],
    [r => r.media_resolution.validation.status = 403, "media_validation_http_success"],
  ];
  for (const [mutate, failed] of cases) {
    const value = candidate(); mutate(readable(value));
    const diagnostic = rejection(value).details.validation;
    assert.equal(diagnostic.checks[failed], false, failed);
    assert.equal(diagnostic.accepted, false, failed);
    assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|KEY_SENTINEL|https?:|private\.invalid/);
  }
});

test("every timestamp and segment-text failure identifies its index without its text", () => {
  const cases = [
    [r => r.segments[0].start_ms = undefined, "segment_start_finite", 0],
    [r => r.segments[0].end_ms = undefined, "segment_end_finite", 0],
    [r => r.segments[1].start_ms = 500, "segment_start_monotonic", 1],
    [r => r.segments[0].end_ms = 1000, "segment_positive_duration", 0],
    [r => r.segments[0].start_ms = -1, "segment_start_nonnegative", 0],
    [r => r.segments[1].end_ms = 1016517, "segment_end_within_duration", 1],
    [r => r.segments[0].text = " ", "segment_text_nonempty", 0],
  ];
  for (const [mutate, failed, index] of cases) {
    const value = candidate(); mutate(readable(value));
    const diagnostic = publicError(rejection(value)).details.validation;
    assert.equal(diagnostic.checks[failed], false, failed);
    assert.equal(diagnostic.segments.violation_counts[failed], 1);
    assert.equal(diagnostic.segments.examples[0].index, index);
    assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|KEY_SENTINEL|https?:/);
  }
});

test("all independent failures are counted while examples remain bounded", () => {
  const value = candidate(), r = readable(value);
  r.source.fresh_capture = false;
  r.source.coverage.full_audio_scanned = false;
  r.segments = Array.from({ length: 80 }, (_, index) => ({ start_ms: index, end_ms: index, text: "PRIVATE_SEGMENT_SENTINEL" }));
  const diagnostic = rejection(value).details.validation;
  assert.equal(diagnostic.checks.fresh_capture_true, false);
  assert.equal(diagnostic.checks.full_audio_scanned_true, false);
  assert.equal(diagnostic.checks.segment_positive_duration, false);
  assert.equal(diagnostic.segments.violating_count, 80);
  assert.equal(diagnostic.segments.violation_counts.segment_positive_duration, 80);
  assert.equal(diagnostic.segments.examples.length, 10);
  assert.equal(diagnostic.segments.examples_truncated, true);
});

test("OCR diagnostics preserve the existing OCR contract", () => {
  const value = candidate(), r = readable(value);
  r.method = "hard_subtitle_ocr";
  r.source = { fresh_capture: true, transcript_cache_read: false,
    coverage: { full_video_scanned: true, end_ms: 1006516 } };
  assert.equal(verifyAcquisitionResult(value, expected), value);
  assert.equal(diagnoseAcquisitionResult(value, expected).accepted, true);
  r.source.coverage.full_video_scanned = false;
  assert.deepEqual(rejection(value).details.validation.failed_checks, ["full_video_scanned_true"]);
});

test("failure output persists safe diagnostics after the rejected candidate is discarded", async t => {
  const directory = await mkdtemp(join(tmpdir(), "acquisition-diagnostic-test-"));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  const value = candidate(); readable(value).segments[1].end_ms = 3000;
  const failure = createAcquisitionFailure(rejection(value), { ...expected, candidate: value,
    elapsed_ms: 100, worker: { run_id: "42", attempt: "1", commit: "a".repeat(40) } });
  await saveAcquisitionOutput(failure, directory);
  const raw = await readFile(join(directory, "result.json"), "utf8");
  const report = JSON.parse(await readFile(join(directory, "diagnostics.json"), "utf8"));
  assert.equal(JSON.parse(raw).pass, false);
  assert.equal(JSON.parse(raw).result, undefined);
  assert.equal(report.stage, "result_validation");
  assert.deepEqual(report.validation.failed_checks, ["segment_positive_duration"]);
  assert.equal(report.validation.segments.examples[0].index, 1);
  assert.doesNotMatch(raw + JSON.stringify(report), /PRIVATE_|KEY_SENTINEL|https?:|private\.invalid/);
});

test("an acquisition failure before a candidate exists does not invent validation failures", () => {
  const failure = createAcquisitionFailure(Error("PRIVATE_ERROR_SENTINEL"), expected);
  assert.equal(failure.pass, false);
  assert.equal(failure.diagnostics.candidate_available, false);
  assert.equal(failure.diagnostics.validation, null);
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_ERROR_SENTINEL/);
});

test("archived failure summaries remain UNKNOWN, rather than diagnosing their discarded candidate", () => {
  const failure = { ...expected, pass: false, error: { code: "WORKER_RESULT_INVALID", details: {
    actual_method: "local_whisper_cpp_base_q5_1", text_length: 6060, segment_count: 570,
    coverage_end_ms: 1006516, text: "PRIVATE_TRANSCRIPT_SENTINEL", token: "KEY_SENTINEL",
  } } };
  const diagnostic = diagnoseAcquisitionArtifact(failure, expected);
  assert.equal(diagnostic.status, "unavailable_candidate_not_retained");
  assert.equal(diagnostic.failed_checks, null);
  assert.equal(Object.keys(diagnostic.checks).length, 37);
  assert.equal(diagnostic.checks_complete, false);
  assert.equal(diagnostic.unknown_check_count, 32);
  assert.equal(diagnostic.checks.method_supported, true);
  assert.equal(diagnostic.checks.text_string, true);
  assert.equal(diagnostic.checks.segments_array, true);
  assert.equal(diagnostic.checks.segments_nonempty, true);
  assert.equal(diagnostic.checks.coverage_end_finite, true);
  assert.equal(diagnostic.checks.full_audio_scanned_true, null);
  assert.equal(diagnostic.checks.segment_positive_duration, null);
  assert.equal(diagnostic.observed_summary.text_length, 6060);
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|KEY_SENTINEL/);
});

test("offline diagnosis can read new safe failure reports without claiming a content replay", () => {
  const value = candidate(); readable(value).segments[0].end_ms = 1000;
  const failure = createAcquisitionFailure(rejection(value), { ...expected, candidate: value });
  failure.diagnostics.validation.arbitrary = "PRIVATE_REPORT_SENTINEL";
  failure.diagnostics.validation.segments.examples[0].text = "PRIVATE_REPORT_SENTINEL";
  failure.diagnostics.validation.segments.examples[0].failed_checks.push("PRIVATE_REPORT_SENTINEL");
  const diagnostic = diagnoseAcquisitionArtifact(failure, expected);
  assert.equal(diagnostic.status, "retained_safe_diagnostics");
  assert.equal(diagnostic.candidate_available, false);
  assert.deepEqual(diagnostic.validation.failed_checks, ["segment_positive_duration"]);
  assert.equal(diagnostic.validation.segments.examples[0].index, 0);
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_|KEY_SENTINEL|https?:/);
});
