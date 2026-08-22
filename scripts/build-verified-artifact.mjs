import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { normalizeCreator, normalizeVideo } from "../src/normalizers/douyin.js";
import { CreatorAnalyzer } from "../src/services/analysis.js";
import { validatePublicCaptureInputs } from "../src/services/artifacts.js";

const profilePath = resolve(process.argv[2] ?? "artifacts/douyin/profile.raw.json");
const transcriptPath = resolve(process.argv[3] ?? "artifacts/douyin/transcripts.raw.json");
const manifestPath = resolve(process.argv[4] ?? "artifacts/douyin/media/manifest.json");
const outputPath = resolve(process.argv[5] ?? "artifacts/douyin/verified-profile.json");

const profileRaw = JSON.parse(await readFile(profilePath, "utf8"));
const transcriptRaw = JSON.parse(await readFile(transcriptPath, "utf8"));
const mediaManifest = JSON.parse(await readFile(manifestPath, "utf8"));
// Validate capture identity and every public media receipt before reading any
// transcript or emitting a replacement artifact.
const mediaById = validatePublicCaptureInputs({ profileRaw, mediaManifest });
const creator = normalizeCreator(profileRaw.user);
const acquiredAt = profileRaw.captured_at;

function readableTranscript(transcript) {
  const segments = (Array.isArray(transcript.segments) ? transcript.segments : []).map((segment) => ({
    ...segment,
    // faster-whisper can occasionally decode a punctuation token as U+FFFD.
    // Keep the timestamped clause boundary while excluding corrupt glyphs.
    text: String(segment.text ?? "").replaceAll("\uFFFD", "，").trim()
  }));
  return {
    ...transcript,
    segments,
    text: segments.map((segment) => segment.text?.trim()).filter(Boolean).join("\n"),
    normalization: [
      ...(transcript.normalization ?? []),
      "segment_boundaries_preserved_as_newlines"
    ]
  };
}

const posts = profileRaw.aweme_list.map((aweme) => {
  const video = normalizeVideo(aweme, { acquiredAt });
  const rawTranscript = transcriptRaw.transcripts?.[video.aweme_id];
  const transcript = rawTranscript ? readableTranscript(rawTranscript) : null;
  if (!transcript || transcript.status !== "complete") {
    throw new Error(`Missing complete transcript for public aweme ${video.aweme_id}`);
  }
  return { ...video, readable_content: transcript };
});

const pagination = {
  complete: true,
  scope: "public_unauthenticated",
  public_access_exhausted: true,
  upstream_exhausted: false,
  stopped_by_access_boundary: profileRaw.access.explicit_login_more_gate,
  stop_reason: profileRaw.access.explicit_login_more_gate
    ? "login_required_for_more"
    : profileRaw.pagination.has_more
      ? "public_page_stable"
      : "has_more_false",
  expected_posts: profileRaw.access.profile_display_post_count,
  unique_posts: posts.length,
  profile_count_gap: profileRaw.access.public_gap,
  limitation: profileRaw.access.explicit_login_more_gate ? {
    code: "LOGIN_REQUIRED_FOR_MORE_POSTS",
    type: "partial_public_profile",
    message: "登录后查看更多作品",
    public_items: posts.length,
    displayed_post_count: profileRaw.access.profile_display_post_count,
    inaccessible_count: profileRaw.access.public_gap
  } : null
};
const accessFailure = pagination.limitation ? [{
  aweme_id: null,
  count: pagination.limitation.inaccessible_count,
  reason: {
    code: pagination.limitation.code,
    type: pagination.limitation.type,
    message: pagination.limitation.message
  }
}] : [];
const analysis = new CreatorAnalyzer().analyze({
  creator,
  posts,
  failures: accessFailure,
  pagination,
  source: {
    provider: "direct_public_web",
    captured_at: acquiredAt,
    access_boundary: pagination.limitation
  }
});

const transcripts = Object.fromEntries(posts.map((video) => [
  video.aweme_id,
  video.readable_content
]));
const artifact = {
  schema_version: "1.0",
  pipeline_version: "content-reader-douyin-2.0.0",
  captured_at: acquiredAt,
  built_at: new Date().toISOString(),
  access_policy: "public_unauthenticated_only",
  sec_user_id: creator.sec_user_id,
  profile: {
    creator,
    access: profileRaw.access,
    pagination,
    public_aweme_ids: posts.map((video) => video.aweme_id),
    videos: posts.map((video) => {
      const media = mediaById.get(video.aweme_id);
      return {
        aweme_id: video.aweme_id,
        canonical_url: video.canonical_url,
        created_at: video.created_at,
        title: video.title,
        duration_ms: video.media.duration_ms,
        media_read: Boolean(media),
        media_type: media?.media_type ?? null,
        media_content_type: media?.content_type ?? null,
        media_bytes: media?.bytes ?? null,
        transcript_method: video.readable_content.method,
        transcript_segments: video.readable_content.segments.length
      };
    })
  },
  transcripts,
  analysis
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  creator: creator.display_name,
  public_posts: posts.length,
  transcripts: Object.keys(transcripts).length,
  media_read: artifact.profile.videos.filter((item) => item.media_read).length,
  analysis_posts: analysis.analyzed_post_count
}));
