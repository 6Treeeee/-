import { readFile } from "node:fs/promises";

const DEFAULT_ARTIFACT_URL = new URL("../../artifacts/douyin/verified-profile.json", import.meta.url);

export class ArtifactStore {
  constructor({ artifactUrl = DEFAULT_ARTIFACT_URL, data = null } = {}) {
    this.artifactUrl = artifactUrl;
    this.data = data;
    this.loadAttempted = data !== null;
    this.loadPromise = data !== null ? Promise.resolve(data) : null;
  }

  async load() {
    if (this.loadAttempted) return this.loadPromise ?? this.data;
    this.loadAttempted = true;
    this.loadPromise = (async () => {
      try {
        this.data = JSON.parse(await readFile(this.artifactUrl, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") {
          console.warn(JSON.stringify({
            event: "artifact_store.load_failed",
            code: error?.code ?? error?.name ?? "unknown"
          }));
        }
        this.data = null;
      }
      return this.data;
    })();
    return this.loadPromise;
  }

  async transcriptFor(awemeId) {
    const data = await this.load();
    const transcript = data?.transcripts?.[String(awemeId)];
    if (!transcript || transcript.status !== "complete") return null;
    return {
      ...transcript,
      cached_artifact: {
        captured_at: data.captured_at ?? null,
        pipeline_version: data.pipeline_version ?? null,
        source_aweme_id: String(awemeId)
      }
    };
  }

  async analysisFor(secUserId) {
    const data = await this.load();
    if (!data?.sec_user_id || data.sec_user_id !== secUserId) return null;
    return data.analysis ?? null;
  }

  async profileFor(secUserId) {
    const data = await this.load();
    if (!data?.sec_user_id || data.sec_user_id !== secUserId) return null;
    return data.profile ?? null;
  }
}
