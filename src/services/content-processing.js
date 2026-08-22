import { errorSummary } from "../errors.js";
import { ArtifactStore } from "./artifacts.js";
import { MediaResolver } from "./media.js";
import { isTerminalAccessError, sanitizeDiagnostics } from "./provider-chain.js";
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

function unavailableResolution(error) {
  return {
    stable_identity: "aweme_id",
    media_kind: null,
    media_type: null,
    acquired_at: null,
    validated_at: null,
    validation: sanitizeDiagnostics({
      status: "unavailable",
      code: error?.code ?? "MEDIA_VALIDATION_FAILED"
    })
  };
}

function synchronousProfilePolicy(postCount, localAsr) {
  if (postCount <= 1 || typeof localAsr !== "function") return null;
  return {
    code: "PROFILE_LOCAL_ASR_DISABLED",
    mode: "synchronous_multi_video",
    reason: "bounded_request_budget",
    post_count: postCount,
    local_asr: {
      allowed: false,
      invoked: false
    }
  };
}

function attachPolicyToFailure(video, policy) {
  const readable = video?.readable_content;
  if (!policy || readable?.status === "complete" ||
      readable?.error?.code !== "TRANSCRIPTION_UNAVAILABLE") {
    return video;
  }
  return {
    ...video,
    readable_content: {
      ...readable,
      error: {
        ...readable.error,
        policy_code: policy.code
      }
    }
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

  createTranscriptionService(mediaResolver, { localAsr = this.localAsr } = {}) {
    if (this.transcriptionFactory) {
      return this.transcriptionFactory({
        mediaResolver,
        fetchImpl: this.fetchImpl,
        localAsr
      });
    }
    return new TranscriptionService({
      fetchImpl: this.fetchImpl,
      mediaResolver,
      localAsr,
      openAiApiKey: this.openAiApiKey,
      aiGatewayApiKey: this.aiGatewayApiKey,
      vercelOidcToken: this.vercelOidcToken
    });
  }

  async processVideo(video, {
    refreshVideo = null,
    isolateFailure = false,
    localAsr = this.localAsr
  } = {}) {
    try {
      const mediaResolver = this.createMediaResolver(refreshVideo);
      const artifact = await this.artifactStore.transcriptFor(video.aweme_id ?? video.id);

      let readableContent;
      let mediaResolution = null;
      if (artifact) {
        const source = await mediaResolver.resolve(video);
        mediaResolution = publicResolution(source);
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
        const transcription = this.createTranscriptionService(mediaResolver, { localAsr });
        readableContent = await transcription.read(video);
        mediaResolution = readableContent.media_resolution ?? null;

        // A real TranscriptionService attaches the source it resolved for ASR,
        // so this branch is normally caption-only. Keeping the fallback for
        // injected transcription services preserves the invariant that every
        // non-caption result has validated media without resolving it twice.
        if (!mediaResolution) {
          try {
            const source = await mediaResolver.resolve(video);
            mediaResolution = publicResolution(source);
            readableContent.media_resolution = mediaResolution;
          } catch (error) {
            if (isTerminalAccessError(error)) throw error;
            if (readableContent.method !== "captions") throw error;

            // Captions are independently readable public content. A transient
            // CDN/media failure is diagnostic, not a reason to discard them.
            mediaResolution = unavailableResolution(error);
            readableContent.media_resolution = mediaResolution;
            readableContent.limitations = [...new Set([
              ...(readableContent.limitations ?? []),
              "media_validation_unavailable"
            ])];
            readableContent.source = {
              ...readableContent.source,
              media_validation: sanitizeDiagnostics({
                status: "unavailable",
                code: error?.code ?? "MEDIA_VALIDATION_FAILED"
              })
            };
          }
        }
      }

      return {
        ...video,
        media: {
          ...video.media,
          ...(mediaResolution ? { resolved: mediaResolution } : {})
        },
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
    // A profile request must finish inside one bounded synchronous Function
    // invocation. Running or queueing multiple CPU-bound local Whisper jobs
    // cannot truthfully satisfy that contract, so multi-video profiles retain
    // captions, hosted ASR, and verified artifacts but do not invoke local ASR.
    const policy = synchronousProfilePolicy(input.length, this.localAsr);
    const profileLocalAsr = policy ? null : this.localAsr;
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= input.length) return;
        const processed = await this.processVideo(input[index], {
          refreshVideo,
          isolateFailure: true,
          localAsr: profileLocalAsr
        });
        output[index] = attachPolicyToFailure(processed, policy);
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
    const successfullyContentRead = output.length - failures.length;
    const complete = failures.length === 0;
    const status = complete ? "complete" : successfullyContentRead > 0 ? "partial" : "failed";
    return {
      posts: output,
      failures,
      status,
      complete,
      ...(policy ? { policy } : {})
    };
  }
}
