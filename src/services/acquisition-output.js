import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { publicError } from "../errors.js";
import { diagnoseAcquisitionResult } from "./acquisition-result.js";

export function createAcquisitionFailure(error, { request_id, aweme_id, elapsed_ms, worker, candidate } = {}) {
  const safe = publicError(error);
  const validation = candidate?.result
    ? diagnoseAcquisitionResult(candidate, { request_id, aweme_id }) : null;
  const isValidationFailure = error?.code === "WORKER_RESULT_INVALID";
  // Retain the safe predicate report before discarding the rejected candidate.
  // Never retain its transcript, media resolution object or arbitrary details.
  return {
    request_id, aweme_id, pass: false, elapsed_ms, worker,
    error: isValidationFailure ? {
      code: "WORKER_RESULT_INVALID",
      message: "Worker result did not provide a verified fresh OCR or full-audio speech-to-text result.",
      details: { required_methods: ["hard_subtitle_ocr", "local_whisper_cpp_base_q5_1"], ...(validation ? {
        actual_method: validation.method,
        text_length: validation.observed.text_length,
        segment_count: validation.observed.segment_count,
        coverage_end_ms: validation.observed.coverage_end_ms,
        validation,
      } : {}) },
    } : { code: error?.code ?? safe.code, message: safe.message,
      ...(safe.details ? { details: safe.details } : {}) },
    diagnostics: {
      schema_version: 1,
      stage: validation ? "result_validation" : "acquisition",
      candidate_available: Boolean(candidate?.result),
      validation,
    },
  };
}

export async function saveAcquisitionOutput(envelope, directory = "acquisition-output") {
  const diagnostics = envelope.diagnostics ?? {
    schema_version: 1, stage: "result_validation", candidate_available: Boolean(envelope.result),
    validation: envelope.result ? diagnoseAcquisitionResult(envelope, {
      request_id: envelope.request_id, aweme_id: envelope.aweme_id,
    }) : null,
  };
  await mkdir(directory, { recursive: true });
  // Write the small safe report first, even if serializing the full success
  // payload subsequently fails. The workflow uploads it on failure as well.
  await writeFile(join(directory, "diagnostics.json"), JSON.stringify(diagnostics));
  await writeFile(join(directory, "result.json"), JSON.stringify(envelope));
}
