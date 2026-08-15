import { ReaderError } from "./errors.js";
import { DouyinReader, isDouyinUrl } from "./platforms/douyin.js";

const platformRegistry = [
  {
    id: "douyin",
    detects: isDouyinUrl,
    create: (dependencies) => new DouyinReader(dependencies)
  }
];

export function serviceDescription({ tikhubConfigured = false } = {}) {
  return {
    service: "Content Reader",
    version: "1.0.0",
    status: "running",
    phase: "douyin",
    provider_configured: tikhubConfigured,
    supported: {
      platforms: ["douyin"],
      content_types: ["video", "profile"]
    },
    usage: {
      automatic: "/api?url=PUBLIC_DOUYIN_URL",
      video: "/api?type=video&url=PUBLIC_DOUYIN_VIDEO_URL",
      profile: "/api?type=profile&url=PUBLIC_DOUYIN_PROFILE_URL",
      post: { url: "PUBLIC_DOUYIN_URL", type: "auto" }
    },
    access_policy: "Public content only; no authentication, paywall, DRM, CAPTCHA, or private-content bypass."
  };
}

export async function readPublicContent(input, dependencies = {}) {
  if (!input?.url || typeof input.url !== "string") {
    throw new ReaderError("INVALID_URL", "A public content URL is required.", { status: 400 });
  }

  const platform = platformRegistry.find((candidate) => candidate.detects(input.url));
  if (!platform) {
    throw new ReaderError("UNSUPPORTED_PLATFORM", "Phase 1 currently supports Douyin URLs only.", {
      status: 422
    });
  }

  return platform.create(dependencies).read(input);
}
