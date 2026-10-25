import { ReaderError } from "../errors.js";

const ACCEPTED_METHODS = ["hard_subtitle_ocr", "local_whisper_cpp_base_q5_1"];

function hasReadableText(readable) {
  return readable?.status === "complete" &&
    Array.isArray(readable.segments) && readable.segments.length > 0 &&
    typeof readable.text === "string" && Boolean(readable.text.trim());
}

function verifiedOcr(readable, duration) {
  const source = readable.source;
  return readable.method === "hard_subtitle_ocr" &&
    source?.fresh_capture === true && source?.transcript_cache_read === false &&
    source?.coverage?.full_video_scanned === true &&
    Number(source.coverage.end_ms) >= duration - 1000;
}

function verifiedAudioInference(readable, duration, id) {
  const source = readable.source;
  const coverage = source?.coverage;
  const media = readable.media_resolution;
  const validatedStatus = Number(media?.validation?.status);
  if (readable.method !== "local_whisper_cpp_base_q5_1" ||
      source?.type !== "asr" || source?.provider !== "local_whisper_cpp" ||
      source?.fresh_capture !== true || source?.transcript_cache_read !== false ||
      source?.stable_aweme_id !== id || source?.engine?.name !== "whisper.cpp" ||
      !/^[a-f0-9]{64}$/.test(String(source?.model?.sha256 ?? "")) ||
      coverage?.full_audio_scanned !== true || coverage?.start_ms !== 0 ||
      !Number.isFinite(coverage?.end_ms) ||
      coverage.end_ms < duration - 1000 || coverage.end_ms > duration + 10000 ||
      !Number.isInteger(coverage?.chunk_count) || coverage.chunk_count < 1 ||
      media?.stable_identity !== "aweme_id" ||
      !["video", "audio"].includes(media?.media_kind) ||
      !media?.validated_at || ![200, 206].includes(validatedStatus)) return false;

  // Timestamps must be authentic, nonnegative and monotonic; zero-length
  // placeholders and invented segments must not satisfy the acceptance gate.
  let previousStart = 0;
  for (const segment of readable.segments) {
    const start = Number(segment?.start_ms);
    const end = Number(segment?.end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousStart ||
        end <= start || start < 0 || end > duration + 10000 ||
        typeof segment?.text !== "string" || !segment.text.trim()) return false;
    previousStart = start;
  }
  return true;
}

// Diagnostics never copy transcript, identity strings, engine/model strings,
// media addresses or arbitrary error data. Keep the acceptance gates above
// unchanged; evaluate every applicable predicate here without short-circuiting.
export function diagnoseAcquisitionResult(envelope, expected) {
  const content = envelope?.result?.content;
  const readable = content?.readable_content;
  const source = readable?.source;
  const coverage = source?.coverage;
  const media = readable?.media_resolution;
  const duration = Number(content?.duration_ms ?? content?.media?.duration_ms ?? 0);
  const id = String(content?.aweme_id ?? content?.id ?? "");
  const segments = Array.isArray(readable?.segments) ? readable.segments : [];
  const method = ACCEPTED_METHODS.includes(readable?.method) ? readable.method : "unknown";
  const checks = {
    request_id_match: envelope?.request_id === expected.request_id,
    envelope_video_id_match: envelope?.aweme_id === expected.aweme_id,
    content_video_id_match: id === expected.aweme_id,
    envelope_pass_true: envelope?.pass === true,
    duration_finite: Number.isFinite(duration),
    duration_positive: duration > 0,
    readable_status_complete: readable?.status === "complete",
    segments_array: Array.isArray(readable?.segments),
    segments_nonempty: segments.length > 0,
    text_string: typeof readable?.text === "string",
    text_nonempty: typeof readable?.text === "string" && Boolean(readable.text.trim()),
    method_supported: method !== "unknown",
  };
  const segmentChecks = ["segment_start_finite", "segment_end_finite",
    "segment_start_monotonic", "segment_positive_duration", "segment_start_nonnegative",
    "segment_end_within_duration", "segment_text_nonempty"];
  const violationCounts = Object.fromEntries(segmentChecks.map(key => [key, 0]));
  const examples = [];
  let violatingSegments = 0;
  if (method === "hard_subtitle_ocr") {
    Object.assign(checks, {
      fresh_capture_true: source?.fresh_capture === true,
      transcript_cache_read_false: source?.transcript_cache_read === false,
      full_video_scanned_true: coverage?.full_video_scanned === true,
      coverage_end_covers_duration: Number(coverage?.end_ms) >= duration - 1000,
    });
  } else if (method === "local_whisper_cpp_base_q5_1") {
    Object.assign(checks, {
      source_type_asr: source?.type === "asr",
      source_provider_local_whisper: source?.provider === "local_whisper_cpp",
      fresh_capture_true: source?.fresh_capture === true,
      transcript_cache_read_false: source?.transcript_cache_read === false,
      source_video_id_match: source?.stable_aweme_id === id,
      engine_whisper_cpp: source?.engine?.name === "whisper.cpp",
      model_sha256_valid: /^[a-f0-9]{64}$/.test(String(source?.model?.sha256 ?? "")),
      full_audio_scanned_true: coverage?.full_audio_scanned === true,
      coverage_start_zero: coverage?.start_ms === 0,
      coverage_end_finite: Number.isFinite(coverage?.end_ms),
      coverage_end_covers_duration: coverage?.end_ms >= duration - 1000,
      coverage_end_within_duration: coverage?.end_ms <= duration + 10000,
      chunk_count_integer: Number.isInteger(coverage?.chunk_count),
      chunk_count_positive: coverage?.chunk_count >= 1,
      media_stable_identity_aweme: media?.stable_identity === "aweme_id",
      media_kind_audio_or_video: ["video", "audio"].includes(media?.media_kind),
      media_validated_at_present: Boolean(media?.validated_at),
      media_validation_http_success: [200, 206].includes(Number(media?.validation?.status)),
    });
    let previousStart = 0;
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const start = Number(segment?.start_ms), end = Number(segment?.end_ms);
      const predicates = {
        segment_start_finite: Number.isFinite(start),
        segment_end_finite: Number.isFinite(end),
        segment_start_monotonic: !(start < previousStart),
        segment_positive_duration: !(end <= start),
        segment_start_nonnegative: !(start < 0),
        segment_end_within_duration: !(end > duration + 10000),
        segment_text_nonempty: typeof segment?.text === "string" && Boolean(segment.text.trim()),
      };
      const failures = segmentChecks.filter(key => !predicates[key]);
      if (failures.length) {
        violatingSegments++;
        for (const key of failures) violationCounts[key]++;
        if (examples.length < 10) examples.push({ index, failed_checks: failures,
          start_ms: Number.isFinite(start) ? start : null,
          end_ms: Number.isFinite(end) ? end : null,
          previous_start_ms: Number.isFinite(previousStart) ? previousStart : null });
      }
      previousStart = start;
    }
    for (const key of segmentChecks) checks[key] = violationCounts[key] === 0;
  }
  const finite = value => Number.isFinite(value) ? value : null;
  return {
    schema_version: 1, scope: "verifyAcquisitionResult", method,
    accepted: Object.values(checks).every(Boolean),
    failed_checks: Object.keys(checks).filter(key => !checks[key]), checks,
    observed: {
      duration_ms: finite(duration),
      text_length: typeof readable?.text === "string" ? readable.text.length : null,
      segment_count: Array.isArray(readable?.segments) ? segments.length : null,
      coverage_start_ms: finite(coverage?.start_ms),
      coverage_end_ms: finite(coverage?.end_ms),
      chunk_count: finite(coverage?.chunk_count),
      media_validation_http_status: finite(Number(media?.validation?.status)),
    },
    ...(method === "local_whisper_cpp_base_q5_1" ? { segments: {
      evaluated_count: segments.length, violating_count: violatingSegments,
      violation_counts: violationCounts, examples,
      examples_truncated: violatingSegments > examples.length,
    } } : {}),
  };
}

export function diagnoseAcquisitionArtifact(envelope, expected) {
  if (envelope?.result) return {
    status: "diagnosed", candidate_available: true,
    validation: diagnoseAcquisitionResult(envelope, expected),
  };
  const prior = envelope?.error?.details;
  const saved = envelope?.diagnostics?.validation ?? prior?.validation ?? envelope?.validation;
  const suppliedMethod = saved?.method ?? prior?.actual_method;
  const method = ACCEPTED_METHODS.includes(suppliedMethod) ? suppliedMethod : "unknown";
  // A saved pass=false failure envelope is not the candidate that was tested.
  // Never misreport its missing fields as the original rejection conditions.
  const template = diagnoseAcquisitionResult({ result: { content: {
    readable_content: { method },
  } } }, expected);
  const names = Object.keys(template.checks);
  const finite = value => Number.isFinite(value) ? value : null;
  if (saved?.schema_version === 1 && saved.scope === "verifyAcquisitionResult" &&
      saved.method === method && names.every(name => typeof saved.checks?.[name] === "boolean")) {
    // Saved diagnostics are evidence, not a revalidation of missing content.
    // Project only schema-owned keys; never echo arbitrary artifact fields.
    const checks = Object.fromEntries(names.map(name => [name, saved.checks[name]]));
    const validation = { schema_version: 1, scope: "verifyAcquisitionResult", method,
      accepted: Object.values(checks).every(Boolean),
      failed_checks: names.filter(name => !checks[name]), checks,
      observed: Object.fromEntries(Object.keys(template.observed).map(name => [name, finite(saved.observed?.[name])])),
    };
    if (template.segments) {
      const count = value => Number.isInteger(value) && value >= 0 ? value : null;
      const examples = (Array.isArray(saved.segments?.examples) ? saved.segments.examples : [])
        .filter(item => Number.isInteger(item?.index) && item.index >= 0).slice(0, 10).map(item => ({
          index: item.index, failed_checks: names.filter(name => item.failed_checks?.includes?.(name)),
          start_ms: finite(item.start_ms), end_ms: finite(item.end_ms), previous_start_ms: finite(item.previous_start_ms),
        }));
      validation.segments = { evaluated_count: count(saved.segments?.evaluated_count),
        violating_count: count(saved.segments?.violating_count),
        violation_counts: Object.fromEntries(Object.keys(template.segments.violation_counts)
          .map(name => [name, count(saved.segments?.violation_counts?.[name])])),
        examples, examples_truncated: saved.segments?.examples_truncated === true };
    }
    return { status: "retained_safe_diagnostics", candidate_available: false, validation };
  }
  const partialChecks = Object.fromEntries(names.map(name => [name, null]));
  // These summaries are emitted conditionally by the verifier itself. They
  // establish only their specific predicates, never a complete ASR result.
  if ([...ACCEPTED_METHODS, "captions", "unknown"].includes(prior?.actual_method)) {
    partialChecks.method_supported = ACCEPTED_METHODS.includes(prior.actual_method);
  }
  if (Number.isInteger(prior?.text_length) && prior.text_length >= 0) {
    partialChecks.text_string = true;
    if (prior.text_length === 0) partialChecks.text_nonempty = false;
  }
  if (Number.isInteger(prior?.segment_count) && prior.segment_count >= 0) {
    partialChecks.segments_array = true;
    partialChecks.segments_nonempty = prior.segment_count > 0;
  }
  if (method === "local_whisper_cpp_base_q5_1" && Number.isFinite(prior?.coverage_end_ms)) {
    partialChecks.coverage_end_finite = true;
  }
  const knownFailures = names.filter(name => partialChecks[name] === false);
  return {
    status: "unavailable_candidate_not_retained", candidate_available: false,
    reason: "Only a failure summary was retained; unresolved predicates cannot be reconstructed.",
    validation: null, failed_checks: knownFailures.length ? knownFailures : null,
    checks_complete: false, checks: partialChecks,
    summary_inferred_checks: names.filter(name => partialChecks[name] !== null),
    unknown_check_count: names.filter(name => partialChecks[name] === null).length,
    observed_summary: {
      method, text_length: finite(prior?.text_length), segment_count: finite(prior?.segment_count),
      coverage_end_ms: finite(prior?.coverage_end_ms),
    },
  };
}

export function verifyAcquisitionResult(envelope, expected) {
  const content = envelope?.result?.content;
  const readable = content?.readable_content;
  const duration = Number(content?.duration_ms ?? content?.media?.duration_ms ?? 0);
  const id = String(content?.aweme_id ?? content?.id ?? "");
  const baseValid = envelope?.request_id === expected.request_id &&
    envelope?.aweme_id === expected.aweme_id && id === expected.aweme_id &&
    envelope?.pass === true && Number.isFinite(duration) && duration > 0 &&
    hasReadableText(readable);
  if (baseValid && (verifiedOcr(readable, duration) || verifiedAudioInference(readable, duration, id))) {
    return envelope;
  }
  throw new ReaderError("WORKER_RESULT_INVALID",
    "Worker result did not provide a verified fresh OCR or full-audio speech-to-text result.", {
      status: 502,
      details: {
        required_methods: ACCEPTED_METHODS,
        actual_method: ACCEPTED_METHODS.includes(readable?.method) || readable?.method === "captions"
          ? readable.method : "unknown",
        validation: diagnoseAcquisitionResult(envelope, expected),
        // Safe diagnostics only. Do not put transcript text or media URLs in errors.
        ...(typeof readable?.text === "string" ? { text_length: readable.text.length } : {}),
        ...(Array.isArray(readable?.segments) ? { segment_count: readable.segments.length } : {}),
        ...(Number.isFinite(readable?.source?.coverage?.end_ms)
          ? { coverage_end_ms: readable.source.coverage.end_ms } : {})
      }
    });
}
