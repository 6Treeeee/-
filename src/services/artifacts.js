import { readFile } from "node:fs/promises";

const DEFAULT_ARTIFACT_URL = new URL("../../artifacts/douyin/verified-profile.json", import.meta.url);
const DEFAULT_PROFILE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function stringId(value) {
  return value === undefined || value === null ? null : String(value);
}

export function validatePublicCaptureInputs({ profileRaw, mediaManifest }) {
  const profileCapturedAt = profileRaw?.captured_at;
  const manifestCapturedAt = mediaManifest?.captured_at;
  if (!profileCapturedAt || !Number.isFinite(Date.parse(profileCapturedAt))) {
    throw new Error("The public profile capture has no valid captured_at timestamp.");
  }
  if (manifestCapturedAt !== profileCapturedAt) {
    throw new Error(
      "The media manifest does not belong to the current public profile capture (captured_at mismatch)."
    );
  }

  const publicItems = Array.isArray(profileRaw?.aweme_list) ? profileRaw.aweme_list : [];
  const publicIds = publicItems.map((item) => stringId(item?.aweme_id)).filter(Boolean);
  if (publicIds.length === 0 || new Set(publicIds).size !== publicIds.length) {
    throw new Error("The current public profile capture has no unique visible post set.");
  }
  const expectedVisible = Number(profileRaw?.access?.public_visible_post_count);
  if (!Number.isFinite(expectedVisible) || expectedVisible !== publicIds.length) {
    throw new Error("The current public profile visible-post count does not match its accepted items.");
  }

  if (!Array.isArray(mediaManifest?.failures)) {
    throw new Error("The media manifest has no explicit failure ledger.");
  }
  if (mediaManifest.failures.length > 0) {
    const failedIds = mediaManifest.failures.map((item) => stringId(item?.aweme_id))
      .filter(Boolean).join(", ");
    throw new Error(`The media manifest contains failed public posts: ${failedIds || "unknown"}.`);
  }

  const receipts = Array.isArray(mediaManifest?.results) ? mediaManifest.results : [];
  const mediaById = new Map();
  for (const receipt of receipts) {
    const awemeId = stringId(receipt?.aweme_id);
    if (!awemeId || mediaById.has(awemeId)) {
      throw new Error("The media manifest contains a missing or duplicate aweme_id receipt.");
    }
    if (!String(receipt?.path ?? "").trim() || !String(receipt?.media_type ?? "").trim() ||
        !String(receipt?.content_type ?? "").trim() || Number(receipt?.bytes) < 1_000) {
      throw new Error(`The media manifest receipt for ${awemeId} is not a successful media read.`);
    }
    mediaById.set(awemeId, receipt);
  }

  const missing = publicIds.filter((awemeId) => !mediaById.has(awemeId));
  const unexpected = [...mediaById.keys()].filter((awemeId) => !publicIds.includes(awemeId));
  if (missing.length > 0) {
    throw new Error(`Missing successful media receipts for public posts: ${missing.join(", ")}.`);
  }
  if (unexpected.length > 0) {
    throw new Error(`The media manifest contains posts outside the current public capture: ${unexpected.join(", ")}.`);
  }
  return mediaById;
}

function artifactMediaResolution(video, capturedAt) {
  return {
    stable_identity: "aweme_id",
    media_kind: video.media_type ?? "video",
    media_type: video.media_content_type ?? video.content_type ?? "video/mp4",
    acquired_at: capturedAt,
    validated_at: capturedAt,
    validation: {
      status: "verified_at_capture",
      bytes: Number(video.media_bytes) || null,
      method: "ordinary_logged_out_public_capture"
    }
  };
}

function artifactPost({ creator, video, transcript, evidence, capturedAt }) {
  const awemeId = stringId(video.aweme_id);
  const mediaResolution = artifactMediaResolution(video, capturedAt);
  return {
    id: awemeId,
    aweme_id: awemeId,
    canonical_url: `https://www.douyin.com/video/${awemeId}`,
    content_kind: video.media_type === "image" ? "image_post" : "video",
    title: video.title ?? evidence?.title ?? null,
    description: evidence?.source_evidence?.description ?? video.title ?? null,
    created_at: video.created_at ?? evidence?.created_at ?? null,
    author: creator,
    hashtags: evidence?.source_evidence?.hashtags ?? [],
    media: {
      duration_ms: Number(video.duration_ms) || null,
      acquired_at: capturedAt,
      audio: [],
      playback: [],
      downloads: [],
      images: [],
      resolved: mediaResolution
    },
    captions: { available: false, tracks: [] },
    chapters: evidence?.chapters ?? { available: false, entries: [] },
    transcription_input: {
      strategy: "verified_transcript",
      stable_aweme_id: awemeId,
      media_url_included: false
    },
    engagement: evidence?.source_evidence?.engagement ?? {},
    readable_content: {
      ...transcript,
      source: {
        type: "asr",
        provider: "verified_public_artifact",
        stable_aweme_id: awemeId,
        captured_at: capturedAt
      },
      media_resolution: mediaResolution,
      cached_artifact: {
        captured_at: capturedAt,
        source_aweme_id: awemeId
      }
    }
  };
}

export class ArtifactStore {
  constructor({
    artifactUrl = DEFAULT_ARTIFACT_URL,
    data = null,
    profileMaxAgeMs = DEFAULT_PROFILE_MAX_AGE_MS,
    now = () => Date.now()
  } = {}) {
    this.artifactUrl = artifactUrl;
    this.data = data;
    this.profileMaxAgeMs = profileMaxAgeMs;
    this.now = now;
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

  async verifiedProfileFor(secUserId, { maxAgeMs = this.profileMaxAgeMs } = {}) {
    const data = await this.load();
    if (!data || data.access_policy !== "public_unauthenticated_only") return null;
    if (!secUserId || stringId(data.sec_user_id) !== stringId(secUserId)) return null;

    const capturedAtMs = Date.parse(data.captured_at ?? "");
    const nowMs = Number(this.now());
    const ageMs = nowMs - capturedAtMs;
    if (!Number.isFinite(capturedAtMs) || !Number.isFinite(nowMs) ||
        !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
        ageMs > maxAgeMs || ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) {
      return null;
    }

    const publicIds = (data.profile?.public_aweme_ids ?? []).map(stringId).filter(Boolean);
    const videos = Array.isArray(data.profile?.videos) ? data.profile.videos : [];
    const videoById = new Map(videos.map((video) => [stringId(video.aweme_id), video]));
    const evidenceById = new Map((data.analysis?.per_video ?? [])
      .map((item) => [stringId(item.aweme_id), item]));
    const uniqueIds = new Set(publicIds);
    if (!data.profile?.creator || publicIds.length === 0 || uniqueIds.size !== publicIds.length ||
        Number(data.analysis?.public_post_count) !== publicIds.length ||
        Number(data.analysis?.analyzed_post_count) !== publicIds.length) {
      return null;
    }

    const posts = [];
    for (const awemeId of publicIds) {
      const video = videoById.get(awemeId);
      const transcript = data.transcripts?.[awemeId];
      const evidence = evidenceById.get(awemeId);
      if (!video?.media_read || !Number(video.media_bytes) ||
          transcript?.status !== "complete" || !String(transcript.text ?? "").trim() ||
          !Array.isArray(transcript.segments) || transcript.segments.length === 0 || !evidence) {
        return null;
      }
      posts.push(artifactPost({
        creator: data.profile.creator,
        video,
        transcript,
        evidence,
        capturedAt: data.captured_at
      }));
    }

    return {
      creator: data.profile.creator,
      posts,
      pagination: data.profile.pagination ?? {},
      access: data.profile.access ?? null,
      analysis: data.analysis,
      captured_at: data.captured_at,
      built_at: data.built_at ?? null,
      pipeline_version: data.pipeline_version ?? null,
      age_ms: Math.max(0, ageMs),
      max_age_ms: maxAgeMs
    };
  }
}
