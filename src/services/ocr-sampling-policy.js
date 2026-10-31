export function visualStepForDuration(durationMs) {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0 || duration <= 5 * 60_000) return 250;
  if (duration <= 10 * 60_000) return 350;
  if (duration <= 30 * 60_000) return 500;
  if (duration <= 90 * 60_000) return 750;
  return 1_000;
}
