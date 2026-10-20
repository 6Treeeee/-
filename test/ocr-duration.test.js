import test from "node:test";
import assert from "node:assert/strict";
import { assertOcrDuration, HardSubtitleOcr } from "../src/services/hard-subtitle-ocr.js";

test("synchronous callers retain 25 minutes and errors contain actual duration", () => {
  assert.equal(new HardSubtitleOcr({ env: {} }).maxDurationMs, 1_500_000);
  assert.equal(assertOcrDuration(1_500_000), 1_500_000);
  assert.throws(() => assertOcrDuration(1_500_001), error => {
    assert.equal(error.code, "OCR_DURATION_UNSUPPORTED");
    assert.deepEqual(error.details, { duration_ms: 1_500_001, max_duration_ms: 1_500_000 });
    return true;
  });
});

test("explicit worker bound admits long media but rejects oversized and invalid durations", () => {
  const worker = new HardSubtitleOcr({ env: {}, maxDurationMs: 7_200_000 });
  assert.equal(assertOcrDuration(1_500_001, worker.maxDurationMs), 1_500_001);
  assert.equal(assertOcrDuration(7_200_000, worker.maxDurationMs), 7_200_000);
  for (const duration of [7_200_001, 0, -1, NaN, Infinity]) {
    assert.throws(() => assertOcrDuration(duration, worker.maxDurationMs), { code: "OCR_DURATION_UNSUPPORTED" });
  }
  assert.throws(() => assertOcrDuration(Infinity, worker.maxDurationMs), error => error.details.duration_ms === null);
});

test("invalid configuration cannot remove the duration bound", () => {
  for (const maxDurationMs of [0, -1, 7_200_001, Infinity, NaN, 1.5, "7200000"]) {
    assert.throws(() => new HardSubtitleOcr({ env: {}, maxDurationMs }), RangeError);
  }
});
