import assert from "node:assert/strict";
import test from "node:test";
import { waitForBoundPublicPlayer } from "../src/services/public-player-wait.js";

test("late public player gets one bounded wait without changing video identity", async () => {
  const waits = [];
  let accessChecks = 0;
  const page = { waitForFunction: async (_ready, options, expected) => {
    waits.push({ timeout: options.timeout, expected });
    if (waits.length === 1) throw Object.assign(new Error("Waiting failed: 15000ms exceeded"), { name: "TimeoutError" });
  } };
  await waitForBoundPublicPlayer({ page, expectedDurationSeconds: 86.634,
    assertAccess: async () => { accessChecks++; }, deadlineAt: Date.now() + 30_000 });
  assert.deepEqual(waits.map(x => x.expected), [86.634, 86.634]);
  assert.equal(waits[0].timeout, 15_000);
  assert.ok(waits[1].timeout > 0 && waits[1].timeout <= 10_000);
  assert.equal(accessChecks, 2);
});

test("access boundary stops the retry before another player wait", async () => {
  let waits = 0;
  const page = { waitForFunction: async () => {
    waits++;
    throw Object.assign(new Error("late player"), { name: "TimeoutError" });
  } };
  await assert.rejects(waitForBoundPublicPlayer({ page, expectedDurationSeconds: 86.634,
    assertAccess: async () => { throw new Error("CAPTCHA_REQUIRED"); },
    deadlineAt: Date.now() + 30_000 }), /CAPTCHA_REQUIRED/);
  assert.equal(waits, 1);
});

test("non-timeout errors and exhausted deadlines are not retried", async () => {
  for (const failure of [new Error("navigation failed"),
    Object.assign(new Error("late player"), { name: "TimeoutError" })]) {
    let waits = 0;
    const page = { waitForFunction: async () => { waits++; throw failure; } };
    await assert.rejects(waitForBoundPublicPlayer({ page, expectedDurationSeconds: 86.634,
      assertAccess: async () => {}, deadlineAt: Date.now() + 500 }), failure);
    assert.equal(waits, 1);
  }
});
