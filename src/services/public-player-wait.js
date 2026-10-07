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
