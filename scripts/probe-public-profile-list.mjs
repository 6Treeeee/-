import { mkdir, writeFile } from "node:fs/promises";

import { errorSummary } from "../src/errors.js";
import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { parsePublicProfileProbeUrl, publicProfileProbeReceipt } from "../src/services/public-profile-probe.js";

const outputPath = "profile-probe-output/result.json";
let receipt;
try {
  const target = parsePublicProfileProbeUrl(process.argv[2]);
  const browserService = new PublicBrowserService({
    navigationTimeoutMs: 45_000,
    protocolTimeoutMs: 60_000,
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }
  });
  const provider = new DirectPublicWebProvider({
    browserService,
    retries: 1,
    retryDelayMs: 500,
    contentWaitMs: 22_000,
    settleMs: 700
  });
  const profile = await provider.readProfile({
    inputUrl: target.url,
    secUserId: target.secUserId
  });
  receipt = publicProfileProbeReceipt(profile, target.secUserId);
  if (!receipt.pass) {
    receipt.error = { code: "NO_PUBLIC_VIDEOS_VISIBLE" };
    process.exitCode = 2;
  }
} catch (error) {
  const safe = errorSummary(error);
  receipt = {
    schema_version: "1.0",
    pass: false,
    error: {
      code: error?.code ?? safe.code,
      ...(safe.details?.reason ? { reason: safe.details.reason } : {}),
      ...(safe.details?.cause ? { cause: safe.details.cause } : {})
    }
  };
  process.exitCode = 2;
}

await mkdir("profile-probe-output", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  event: "public_profile_probe.completed",
  pass: receipt.pass,
  error: receipt.error?.code,
  cause: receipt.error?.cause ?? null,
  sec_user_id: receipt.sec_user_id,
  public_post_count: receipt.public_post_count,
  public_video_count: receipt.public_video_count,
  stop_reason: receipt.public_boundary?.stop_reason,
  output: outputPath
}));
