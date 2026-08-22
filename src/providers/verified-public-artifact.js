import { ArtifactStore } from "../services/artifacts.js";

export class VerifiedPublicArtifactProvider {
  constructor({ artifactStore = new ArtifactStore(), maxAgeMs } = {}) {
    this.id = "verified_public_artifact";
    this.available = Boolean(artifactStore);
    this.artifactStore = artifactStore;
    this.maxAgeMs = maxAgeMs;
  }

  async readProfile({ secUserId }) {
    const snapshot = await this.artifactStore.verifiedProfileFor(secUserId, {
      ...(this.maxAgeMs === undefined ? {} : { maxAgeMs: this.maxAgeMs })
    });
    if (!snapshot) return null;

    return {
      creator: snapshot.creator,
      items: snapshot.posts,
      items_normalized: true,
      content_preprocessed: true,
      pagination: snapshot.pagination,
      limitation: snapshot.pagination?.limitation ?? null,
      warnings: [{
        code: "VERIFIED_PUBLIC_SNAPSHOT_USED",
        message: "Live public-web retrieval was unavailable; a recent verified logged-out public capture was used.",
        captured_at: snapshot.captured_at,
        age_ms: snapshot.age_ms
      }],
      meta: {
        provider: this.id,
        method: "verified_logged_out_public_capture",
        scope: "public_unauthenticated",
        captured_at: snapshot.captured_at,
        built_at: snapshot.built_at,
        artifact_age_ms: snapshot.age_ms,
        artifact_max_age_ms: snapshot.max_age_ms,
        pipeline_version: snapshot.pipeline_version,
        public_post_count: snapshot.posts.length,
        media_urls_included: false
      }
    };
  }
}
