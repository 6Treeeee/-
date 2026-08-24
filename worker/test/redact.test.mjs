import assert from "node:assert/strict";
import test from "node:test";

import { createSafeLogger, redact } from "../lib/redact.mjs";

test("redacts nested secret fields, bearer values, query secrets, and PEM material", () => {
  const safe = redact({
    authorization: "Bearer top-secret",
    nested: {
      note: "call https://example.test?a=1&token=top-secret",
      private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    },
  });
  assert.equal(safe.authorization, "[REDACTED]");
  assert.equal(safe.nested.private_key, "[REDACTED]");
  assert.equal(safe.nested.note.includes("top-secret"), false);
});
test("safe logger redacts data before forwarding", () => {
  const calls = [];
  const logger = createSafeLogger({
    info: (...args) => calls.push(args),
  });
  logger.info("Bearer top-secret", { api_key: "top-secret", safe: "ok" });
  assert.deepEqual(calls, [["Bearer [REDACTED]", { api_key: "[REDACTED]", safe: "ok" }]]);
});
