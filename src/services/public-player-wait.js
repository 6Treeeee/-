export async function waitForBoundPublicPlayer({ page, expectedDurationSeconds, assertAccess, deadlineAt }) {
  const ready = (expected) => [...document.querySelectorAll("video")].some((video) =>
    video.readyState >= 2 && video.videoWidth && Number.isFinite(video.duration) &&
    Math.abs(video.duration - expected) <= Math.max(3, expected * .02));
  try {
    await page.waitForFunction(ready, { timeout: 15_000 }, expectedDurationSeconds);
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    await assertAccess();
    const remaining = Math.min(10_000, deadlineAt - Date.now() - 1000);
    if (remaining < 1000) throw error;
    await page.waitForFunction(ready, { timeout: remaining }, expectedDurationSeconds);
    await assertAccess();
  }
}


/**
 * When a verified public video has no duration in its metadata, the current
 * public player's duration is a valid fallback ONLY after revalidating the
 * exact requested page identity. Ambiguous players must not be guessed.
 */
export async function verifiedPublicPlayerDuration({
  page, assertAccess, deadlineAt, maxDurationMs = 7_200_000
}) {
  await assertAccess();
  const observation = () => {
    const candidates = [...document.querySelectorAll("video")]
      .filter((v) => Number.isFinite(v.duration) && v.duration > 0 &&
        v.videoWidth > 0 && v.readyState >= 2 &&
        v.getBoundingClientRect().width > 0 && v.getBoundingClientRect().height > 0)
      .map((v) => ({
        seconds: v.duration,
        playing: !v.paused && !v.ended,
        area: v.getBoundingClientRect().width * v.getBoundingClientRect().height
      }));
    if (!candidates.length) return { status: "unavailable" };
    const playing = candidates.filter((v) => v.playing);
    const eligible = playing.length === 1 ? playing : candidates;
    const longest = Math.max(...eligible.map((v) => v.seconds));
    const shortest = Math.min(...eligible.map((v) => v.seconds));
    if (eligible.length > 1 && longest - shortest > Math.max(3, longest * .02)) {
      return { status: "ambiguous", candidates: eligible.length };
    }
    const candidate = eligible.sort((a,b) => b.area - a.area)[0];
    return { status: "ready", duration_ms: Math.round(candidate.seconds * 1000) };
  };
  let sample = await page.evaluate(observation);
  if (sample?.status === "unavailable") {
    const remaining = Math.max(1000, Math.min(15_000, Number(deadlineAt) - Date.now() - 1000));
    if (Number.isFinite(remaining) && remaining >= 1000) {
      try {
        await page.waitForFunction(
          () => [...document.querySelectorAll("video")].some((v) =>
            v.videoWidth > 0 && v.readyState >= 2 &&
            Number.isFinite(v.duration) && v.duration > 0),
          { timeout: remaining }
        );
        sample = await page.evaluate(observation);
      } catch (error) {
        if (error?.name !== "TimeoutError") throw error;
      }
    }
  }
  await assertAccess();
  if (sample?.status === "ambiguous") {
    throw Object.assign(new Error("Public page contains multiple different video durations."), {
      code: "OCR_PLAYER_DURATION_AMBIGUOUS"
    });
  }
  if (sample?.status !== "ready" || !Number.isFinite(sample.duration_ms) ||
      sample.duration_ms <= 0) {
    throw Object.assign(new Error("Verified public video player duration is unavailable."), {
      code: "OCR_EXPECTED_DURATION_MISSING"
    });
  }
  if (sample.duration_ms > maxDurationMs) {
    throw Object.assign(new Error("Public video duration exceeds the verified OCR worker limit."), {
      code: "OCR_DURATION_UNSUPPORTED"
    });
  }
  return sample.duration_ms / 1000;
}
