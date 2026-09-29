import test from "node:test";
import assert from "node:assert/strict";

import {
  PublicBrowserService,
  resolvePublicBrowserRuntime
} from "../src/services/public-browser.js";

test("Vercel public browser keeps graphics enabled", async () => {
  const chromium = {
    args: ["--example"],
    setGraphicsMode: false,
    executablePath: async () => "/tmp/chromium"
  };

  const runtime = await resolvePublicBrowserRuntime({
    chromiumImpl: chromium,
    env: { VERCEL: "1" },
    platform: "linux"
  });

  assert.equal(chromium.setGraphicsMode, true);
  assert.equal(runtime.kind, "sparticuz_chromium");
  assert.equal(runtime.headless, "shell");
});

test("public browser defaults to a desktop-sized viewport", () => {
  const service = new PublicBrowserService();
  assert.deepEqual(service.viewport, {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1
  });
});
