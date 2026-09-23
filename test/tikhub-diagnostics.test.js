import test from "node:test";
import assert from "node:assert/strict";
import { ReaderError, publicError } from "../src/errors.js";
import { ProviderChain } from "../src/services/provider-chain.js";
import { TikHubProvider } from "../src/providers/tikhub.js";
import { TikHubClient, TIKHUB_ROUTES } from "../src/services/tikhub.js";

async function diagnose(status, envelope) {
  const routes = [];
  const client = new TikHubClient({ apiKey: "test-secret-key", retries: 0,
    fetchImpl: async url => {
      routes.push(new URL(url).pathname);
      return new Response(JSON.stringify(envelope), { status });
    }
  });
  const chain = new ProviderChain([
    { id: "direct_public_web", async readVideo() {
      throw new ReaderError("DOUYIN_SECURITY_VERIFICATION_REQUIRED", "verification", {
        status: 422, details: { provider: "direct_public_web",
          reason: "visible_security_challenge", access_scope: "provider_path" }
      });
    } }, new TikHubProvider({ client })
  ]);
  try { await chain.run("readVideo", { awemeId: "7673753332166430002" }); }
  catch (error) { return { error: publicError(error), routes }; }
  assert.fail("upstream failure must remain a failure");
}

test("TikHub HTTP and API diagnostics survive the full public error wrapping", async t => {
  for (const [http, code] of [[401, 401], [402, 402], [429, 429], [503, "SERVICE_BUSY"], [200, 402]]) {
    await t.test(`${http}/${code}`, async () => {
      const { error, routes } = await diagnose(http, { code, message: "Provider rejected the request." });
      assert.equal(error.code, "DOUYIN_SECURITY_VERIFICATION_REQUIRED");
      assert.equal(error.status, 422);
      assert.deepEqual(routes, [TIKHUB_ROUTES.videoApp, TIKHUB_ROUTES.videoWeb]);
      assert.deepEqual(error.details.provider_attempts[1].upstream_errors,
        routes.map(route => ({ route, http_status: http, code, message: "Provider rejected the request." })));
    });
  }
});

test("TikHub messages redact echoed credentials and signed URLs before public exposure", async () => {
  const { error } = await diagnose(402, {
    code: 402,
    message: "Rejected test-secret-key Bearer bearer-secret https://example.test/x?token=url-secret cookie: cookie-secret",
    authorization: "never-copy-this-header", body: "never-copy-this-body"
  });
  const serialized = JSON.stringify(error);
  assert.doesNotMatch(serialized, /test-secret-key|bearer-secret|url-secret|cookie-secret|never-copy/);
  const summary = error.details.provider_attempts[1].upstream_errors[0];
  assert.equal(summary.http_status, 402);
  assert.match(summary.message, /\[redacted\]/);
  assert.deepEqual(Object.keys(summary), ["route", "http_status", "code", "message"]);
});

test("TikHub redacts before clipping long messages and ignores non-scalar API codes", async () => {
  const { error } = await diagnose(402, { code: { token: "not-a-code" },
    message: "x".repeat(295) + "test-secret-key" + "y".repeat(400) });
  const summary = error.details.provider_attempts[1].upstream_errors[0];
  assert.equal(summary.code, null);
  assert.ok(summary.message.length <= 301);
  assert.doesNotMatch(summary.message, /test-/);
});
