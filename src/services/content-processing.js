import { errorSummary } from "../errors.js";
import { ArtifactStore } from "./artifacts.js";
import { MediaResolver } from "./media.js";
import { sanitizeDiagnostics } from "./provider-chain.js";
import { TranscriptionService } from "./transcription.js";

function readableFailure(video, error) {
  return {
    status: "failed",
    aweme_id: String(video?.aweme_id ?? video?.id ?? ""),
    error: sanitizeDiagnostics(errorSummary(error))
  };
}

function publicResolution(source) {
  return {
    stable_identity: "aweme_id",
    media_kind: source.kind,
    media_type: source.mediaType ?? source.media_type,
    acquired_at: source.acquired_at ?? null,
    validated_at: source.validated_at ?? null,
    validation: source.diagnostics ?? null
  };
}

export class ContentProcessor {
  constructor({
    fetchImpl = globalThis.fetch,
    artifactStore = new ArtifactStore(),
    mediaResolverFactory = null,
    transcriptionFactory = null,
    localAsr = null,
    openAiApiKey = process.env.OPENAI_API_KEY,
    aiGatewayApiKey = process.env.AI_GATEWAY_API_KEY,
    vercelOidcToken = process.env.VERCEL_OIDC_TOKEN,
    maxMediaBytes = 25 * 1024 * 1024,
    profileConcurrency = 3
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.artifactStore = artifactStore;
    this.mediaResolverFactory = mediaResolverFactory;
    this.transcriptionFactory = transcriptionFactory;
    this.localAsr = localAsr;
    this.openAiApiKey = openAiApiKey;
    this.aiGatewayApiKey = aiGatewayApiKey;
    this.vercelOidcToken = vercelOidcToken;
    this.maxMediaBytes = maxMediaBytes;
    this.profileConcurrency = Math.max(1, Math.min(8, Math.floor(profileConcurrency)));
  }

  createMediaResolver(refreshVideo) {
    if (this.mediaResolverFactory) {
      return this.mediaResolverFactory({ refreshVideo, fetchImpl: this.fetchImpl });
    }
    return new MediaResolver({
      fetchImpl: this.fetchImpl,
      refreshVideo,
      maxBytes: this.maxMediaBytes
    });
  }

  createTranscriptionService(mediaResolver) {
    if (this.transcriptionFactory) {
      return this.transcriptionFactory({ mediaResolver, fetchImpl: this.fetchImpl });
    }
    return new TranscriptionService({
      fetchImpl: this.fetchImpl,
      mediaResolver,
      localAsr: this.localAsr,
      openAiApiKey: this.openAiApiKey,
      aiGatewayApiKey: this.aiGatewayApiKey,
      vercelOidcToken: this.vercelOidcToken
    });
  }

  async processVideo(video, { refreshVideo = null, isolateFailure = false } = {}) {
    try {
      const mediaResolver = this.createMediaResolver(refreshVideo);
      const source = await mediaResolver.resolve(video);
      const mediaResolution = publicResolution(source);
      const artifact = await this.artifactStore.transcriptFor(video.aweme_id ?? video.id);

      let readableContent;
      if (artifact) {
        readableContent = {
          ...artifact,
          source: {
            type: "asr",
            provider: "verified_local_artifact",
            stable_aweme_id: String(video.aweme_id ?? video.id),
            media_validation: mediaResolution.validation
          },
          media_resolution: mediaResolution
        };
      } else {
        const transcription = this.createTranscriptionService(mediaResolver);
        readableContent = await transcription.read(video);
        readableContent.media_resolution = mediaResolution;
      }

      return {
        ...video,
        media: { ...video.media, resolved: mediaResolution },
        readable_content: readableContent
      };
    } catch (error) {
      if (!isolateFailure) throw error;
      return { ...video, readable_content: readableFailure(video, error) };
    }
  }

  async processProfile(posts, { refreshVideo = null } = {}) {
    const input = Array.isArray(posts) ? posts : [];
    const output = new Array(input.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= input.length) return;
        output[index] = await this.processVideo(input[index], {
          refreshVideo,
          isolateFailure: true
        });
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(this.profileConcurrency, Math.max(1, input.length)) },
      worker
    ));

    const failures = output
      .filter((video) => video?.readable_content?.status !== "complete")
      .map((video) => ({
        aweme_id: video.aweme_id ?? video.id,
        url: video.canonical_url,
        reason: video.readable_content?.error ?? { code: "CONTENT_READING_FAILED" }
      }));
    return { posts: output, failures };
  }
}
